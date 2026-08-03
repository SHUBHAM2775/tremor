from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from pydantic import BaseModel
import requests
import logging

from app.db import get_db, SessionLocal
from app.models import Page, Revision
from app.ingest.history_fetcher import fetch_and_store_history, API_URL, HEADERS
from app.ml.anomaly import compute_page_anomaly_score
from app.llm.summarize import generate_dispute_summary
from app.queue import (
    enqueue_track_job, get_job_status, cache_get, cache_set,
    is_redis_available, pop_candidates_from_buffer, get_candidate_buffer_size
)
from app.workers.track_worker import run_track_job, run_load_more_batch_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pages", tags=["pages"])

# ── Pydantic models ─────────────────────────────────────────────────────────

class PageResponse(BaseModel):
    id: int
    title: str
    wiki: str
    anomaly_score: Optional[float] = None
    cluster_id: Optional[int] = None
    x: Optional[float] = None
    y: Optional[float] = None
    last_checked: Optional[datetime] = None
    conflict_type: Optional[str] = None
    conflict_type_confidence: Optional[float] = None

    class Config:
        from_attributes = True

class RevisionResponse(BaseModel):
    id: int
    revision_id: int
    editor: str
    timestamp: datetime
    byte_change: int
    comment: str
    is_revert: bool
    is_bot: bool

    class Config:
        from_attributes = True

class PageDetailResponse(BaseModel):
    page: PageResponse
    recent_revisions: List[RevisionResponse]

class TimelinePoint(BaseModel):
    time: str
    edits: int
    reverts: int

class TimelineResponse(BaseModel):
    window_label: str
    window_days: int
    data: List[TimelinePoint]

class TrackRequest(BaseModel):
    title: str

class TrackResponse(BaseModel):
    message: str
    job_id: Optional[str] = None
    queued: bool = False
    redis_available: bool = False


# ── Routes ──────────────────────────────────────────────────────────────────
# NOTE: All static/specific routes MUST be defined before parametric routes
# like /{page_id} to ensure FastAPI matches them correctly.

@router.get("", response_model=List[PageResponse])
def get_pages(limit: int = 250, db: Session = Depends(get_db)):
    """
    Returns list of tracked pages sorted by anomaly score (highest first).
    Response is cached in Redis for 30 s when available.
    """
    cache_key = f"tremor:pages_list:{limit}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    rows = db.query(Page).order_by(Page.anomaly_score.desc().nullslast()).limit(limit).all()
    result = [PageResponse.model_validate(p).model_dump(mode="json") for p in rows]
    cache_set(cache_key, result)
    return result


@router.get("/search")
def search_page(
    title: str = Query(..., description="Wikipedia page title to look up"),
    db: Session = Depends(get_db),
):
    """
    Checks if a given title is already tracked in the local DB.
    Returns {found: true, page: {...}} or {found: false, title: ...}.
    """
    normalized = title.strip()
    page = db.query(Page).filter(
        func.lower(Page.title) == func.lower(normalized)
    ).first()
    if page:
        return {"found": True, "page": PageResponse.model_validate(page)}
    # Partial / contains match
    pages = db.query(Page).filter(
        Page.title.ilike(f"%{normalized}%")
    ).order_by(Page.anomaly_score.desc().nullslast()).limit(10).all()
    if pages:
        return {"found": True, "partial_matches": [PageResponse.model_validate(p) for p in pages]}
    return {"found": False, "title": normalized}


@router.get("/check-wikipedia")
def check_wikipedia(title: str = Query(..., description="Wikipedia page title to validate")):
    """
    Validates whether a given title exists on English Wikipedia without doing
    a full fetch.  Returns {exists: true/false, canonical_title: str}.
    """
    normalized = title.strip()
    try:
        params = {
            "action": "query",
            "titles": normalized,
            "prop":   "info",
            "format": "json",
            "redirects": 1,
        }
        resp = requests.get(API_URL, headers=HEADERS, params=params, timeout=8)
        resp.raise_for_status()
        data       = resp.json()
        pages_data = data.get("query", {}).get("pages", {})
        if not pages_data:
            return {"exists": False, "canonical_title": normalized}
        page_key  = list(pages_data.keys())[0]
        page_info = pages_data[page_key]
        if "missing" in page_info:
            return {"exists": False, "canonical_title": normalized}
        canonical = page_info.get("title", normalized)
        return {"exists": True, "canonical_title": canonical}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Wikipedia API unreachable: {str(e)}")


def _background_track_fallback(title: str):
    """
    Fallback used when Redis is unavailable: run the track job synchronously
    inside a FastAPI BackgroundTask.
    """
    run_track_job(title)


@router.post("/track", response_model=TrackResponse)
def track_new_page(payload: TrackRequest, background_tasks: BackgroundTasks):
    """
    Starts tracking a new Wikipedia article.

    When Redis is available: job is enqueued in the RQ 'tremor_track' queue
    and a job_id is returned for status polling.

    When Redis is unavailable: falls back to FastAPI BackgroundTasks (same
    behaviour as Phase 3) — the fetch runs in-process and no job_id is returned.

    The endpoint never crashes due to Redis being down.
    """
    title    = payload.title.strip()
    redis_ok = is_redis_available()
    job_id: Optional[str] = None

    if redis_ok:
        job_id = enqueue_track_job(title)

    if job_id:
        logger.info(f"[Track] Enqueued RQ job {job_id} for '{title}'")
        return TrackResponse(
            message=f"Tracking job queued for '{title}'.",
            job_id=job_id,
            queued=True,
            redis_available=True,
        )
    else:
        # Fallback: in-process background task (no concurrency guarantee but robust)
        background_tasks.add_task(_background_track_fallback, title)
        logger.info(f"[Track] BackgroundTask fallback for '{title}' (redis_ok={redis_ok})")
        return TrackResponse(
            message=f"Started background tracking for '{title}'.",
            job_id=None,
            queued=False,
            redis_available=redis_ok,
        )


@router.get("/track/status/{job_id}")
def track_job_status(job_id: str):
    """
    Returns the status of an on-demand tracking job.
    Statuses: queued | started | finished | failed | unavailable | error.
    Only meaningful when Redis is available.
    """
    return get_job_status(job_id)


# ── Load More / Buffer Endpoints ──────────────────────────────────────────────

class LoadMoreResponse(BaseModel):
    message: str
    job_id: Optional[str] = None
    queued: bool = False
    redis_available: bool = False
    titles: List[str]


def fetch_recent_wiki_titles(limit: int) -> List[str]:
    """
    Directly query the Wikipedia API's recentchanges list namespace 0
    to get naturally surfaced candidate article titles when Redis is offline
    or the buffer is exhausted.
    """
    try:
        # Request slightly more to allow filtering out duplicates / main namespace
        api_limit = min(500, max(10, limit * 2))
        params = {
            "action": "query",
            "list": "recentchanges",
            "rcnamespace": 0,
            "rclimit": api_limit,
            "format": "json",
        }
        resp = requests.get(API_URL, headers=HEADERS, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        rc_list = data.get("query", {}).get("recentchanges", [])
        titles = []
        for rc in rc_list:
            title = rc.get("title")
            if title and title not in titles:
                titles.append(title)
        return titles
    except Exception as e:
        logger.error(f"[WikiRecentChanges] Failed to fetch recent changes: {e!r}")
        return []


@router.get("/buffer-info")
def get_buffer_info(db: Session = Depends(get_db)):
    """
    Returns candidate buffer statistics and DB cap constraints.
    Used by the frontend to decide button text, state, and cap warnings.
    """
    return {
        "buffer_size": get_candidate_buffer_size() if is_redis_available() else 0,
        "total_tracked": db.query(Page).count(),
        "cap": 8000,
        "conflict_count": db.query(Page).filter(Page.anomaly_score > 1.5).count(),
        "redis_available": is_redis_available()
    }


@router.post("/load-more", response_model=LoadMoreResponse)
def load_more_articles(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Triggers ingestion of up to 100 new articles.
    Checks and enforces the 8,000 tracked articles cap.
    Pulls from the Redis candidate buffer, falling back to a direct live
    Wikipedia fetch if Redis is down or empty.
    """
    current_count = db.query(Page).count()
    if current_count >= 8000:
        raise HTTPException(status_code=400, detail="Tracking cap reached (8,000 articles)")

    batch_size = min(100, 8000 - current_count)
    if batch_size <= 0:
        raise HTTPException(status_code=400, detail="Tracking cap reached (8,000 articles)")

    redis_ok = is_redis_available()
    titles = []
    
    # 1. Pull candidates from Redis list if available
    if redis_ok:
        titles = pop_candidates_from_buffer(batch_size)

    # 2. Fallback / supplementary: Fetch direct from Wikipedia RecentChanges
    needed = batch_size - len(titles)
    if needed > 0:
        logger.info(f"[LoadMore] Pulling {needed} titles from Wikipedia RecentChanges API (Redis ok={redis_ok})")
        wiki_titles = fetch_recent_wiki_titles(needed)
        # Filter against already tracked titles in DB and titles in current list
        existing_titles = set(r[0].lower() for r in db.query(Page.title).all())
        for t in wiki_titles:
            if len(titles) >= batch_size:
                break
            if t.lower() not in existing_titles and t not in titles:
                titles.append(t)

    if not titles:
        raise HTTPException(
            status_code=400,
            detail="No new candidate articles found from Wikipedia stream. Try again shortly."
        )

    # 3. Schedule execution
    job_id: Optional[str] = None
    if redis_ok:
        try:
            # Enqueue to RQ queue
            from app.queue import _rq_queue
            if _rq_queue is not None:
                job = _rq_queue.enqueue(
                    run_load_more_batch_job,
                    titles,
                    job_timeout=600,
                    result_ttl=600
                )
                job_id = job.id
        except Exception as exc:
            logger.error(f"[LoadMore] Failed to enqueue RQ job: {exc!r}")
            job_id = None

    if job_id:
        logger.info(f"[LoadMore] Enqueued batch job {job_id} for {len(titles)} articles")
        return LoadMoreResponse(
            message=f"Load more job queued for {len(titles)} articles.",
            job_id=job_id,
            queued=True,
            redis_available=True,
            titles=titles
        )
    else:
        # Fallback to FastAPI synchronous BackgroundTasks
        background_tasks.add_task(run_load_more_batch_job, titles)
        logger.info(f"[LoadMore] BackgroundTask fallback scheduled for {len(titles)} articles")
        return LoadMoreResponse(
            message=f"Started background loading for {len(titles)} articles.",
            job_id=None,
            queued=False,
            redis_available=redis_ok,
            titles=titles
        )


# ── Parametric routes (MUST come after all specific static routes above) ─────

@router.get("/{page_id}", response_model=PageDetailResponse)
def get_page_detail(page_id: int, db: Session = Depends(get_db)):
    """Returns detail for a single page, including its latest 50 revisions."""
    page = db.query(Page).filter_by(id=page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    revisions = (
        db.query(Revision)
          .filter_by(page_id=page_id)
          .order_by(Revision.timestamp.desc())
          .limit(50)
          .all()
    )
    return {"page": page, "recent_revisions": revisions}


@router.get("/{page_id}/timeline", response_model=TimelineResponse)
def get_page_timeline(page_id: int, window_days: Optional[int] = None, db: Session = Depends(get_db)):
    """Aggregates edit and revert counts using an adaptive time window (72h -> 7d -> 30d -> all time)."""
    page = db.query(Page).filter_by(id=page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    now = datetime.now(timezone.utc)
    selected_window: int = 3
    selected_label: str = "Last 72 hours"

    if window_days is not None and window_days > 0:
        selected_window = window_days
        selected_label = "Last 72 hours" if window_days == 3 else f"Last {window_days} days"
    else:
        # Adaptive tier selection:
        # Tier 1: Last 72 hours (3 days)
        cutoff_3d = now - timedelta(days=3)
        has_3d = db.query(Revision.id).filter(Revision.page_id == page_id, Revision.timestamp >= cutoff_3d).first() is not None
        if has_3d:
            selected_window = 3
            selected_label = "Last 72 hours"
        else:
            # Tier 2: Last 7 days
            cutoff_7d = now - timedelta(days=7)
            has_7d = db.query(Revision.id).filter(Revision.page_id == page_id, Revision.timestamp >= cutoff_7d).first() is not None
            if has_7d:
                selected_window = 7
                selected_label = "Last 7 days"
            else:
                # Tier 3: Last 30 days
                cutoff_30d = now - timedelta(days=30)
                has_30d = db.query(Revision.id).filter(Revision.page_id == page_id, Revision.timestamp >= cutoff_30d).first() is not None
                if has_30d:
                    selected_window = 30
                    selected_label = "Last 30 days"
                else:
                    # Tier 4: All time
                    has_any = db.query(Revision.id).filter(Revision.page_id == page_id).first() is not None
                    if has_any:
                        selected_window = 0
                        selected_label = "All time"
                    else:
                        return TimelineResponse(window_label="All time", window_days=0, data=[])

    # Fetch revisions and build continuous timeline slots
    timeline_dict: dict = {}

    if selected_window in (3, 7):
        cutoff = now - timedelta(days=selected_window)
        revisions = db.query(Revision.timestamp, Revision.is_revert).filter(
            Revision.page_id == page_id,
            Revision.timestamp >= cutoff,
        ).order_by(Revision.timestamp.asc()).all()

        start_time = cutoff.replace(minute=0, second=0, microsecond=0)
        current_time = start_time
        while current_time <= now:
            timeline_dict[current_time.strftime("%Y-%m-%d %H:00")] = {"edits": 0, "reverts": 0}
            current_time += timedelta(hours=1)

        for ts, is_revert in revisions:
            if ts.tzinfo is not None:
                ts = ts.astimezone(timezone.utc)
            time_str = ts.strftime("%Y-%m-%d %H:00")
            if time_str in timeline_dict:
                timeline_dict[time_str]["edits"] += 1
                if is_revert:
                    timeline_dict[time_str]["reverts"] += 1

    elif selected_window == 30:
        cutoff = now - timedelta(days=30)
        revisions = db.query(Revision.timestamp, Revision.is_revert).filter(
            Revision.page_id == page_id,
            Revision.timestamp >= cutoff,
        ).order_by(Revision.timestamp.asc()).all()

        start_time = cutoff.replace(hour=0, minute=0, second=0, microsecond=0)
        current_time = start_time
        while current_time <= now:
            timeline_dict[current_time.strftime("%Y-%m-%d")] = {"edits": 0, "reverts": 0}
            current_time += timedelta(days=1)

        for ts, is_revert in revisions:
            if ts.tzinfo is not None:
                ts = ts.astimezone(timezone.utc)
            time_str = ts.strftime("%Y-%m-%d")
            if time_str in timeline_dict:
                timeline_dict[time_str]["edits"] += 1
                if is_revert:
                    timeline_dict[time_str]["reverts"] += 1

    else:
        # All time (selected_window == 0)
        revisions = db.query(Revision.timestamp, Revision.is_revert).filter(
            Revision.page_id == page_id
        ).order_by(Revision.timestamp.asc()).all()

        if not revisions:
            return TimelineResponse(window_label="All time", window_days=0, data=[])

        earliest = revisions[0][0]
        if earliest.tzinfo is not None:
            earliest = earliest.astimezone(timezone.utc)

        span_days = (now - earliest).days
        if span_days <= 7:
            start_time = earliest.replace(minute=0, second=0, microsecond=0)
            current_time = start_time
            while current_time <= now:
                timeline_dict[current_time.strftime("%Y-%m-%d %H:00")] = {"edits": 0, "reverts": 0}
                current_time += timedelta(hours=1)
            fmt = "%Y-%m-%d %H:00"
        else:
            start_time = earliest.replace(hour=0, minute=0, second=0, microsecond=0)
            current_time = start_time
            while current_time <= now:
                timeline_dict[current_time.strftime("%Y-%m-%d")] = {"edits": 0, "reverts": 0}
                current_time += timedelta(days=1)
            fmt = "%Y-%m-%d"

        for ts, is_revert in revisions:
            if ts.tzinfo is not None:
                ts = ts.astimezone(timezone.utc)
            time_str = ts.strftime(fmt)
            if time_str in timeline_dict:
                timeline_dict[time_str]["edits"] += 1
                if is_revert:
                    timeline_dict[time_str]["reverts"] += 1

    data = [
        TimelinePoint(time=k, edits=v["edits"], reverts=v["reverts"])
        for k, v in sorted(timeline_dict.items())
    ]
    return TimelineResponse(window_label=selected_label, window_days=selected_window, data=data)


@router.get("/{page_id}/summary")
def get_page_summary(page_id: int, db: Session = Depends(get_db)):
    """Returns an LLM plain-English summary of the dispute for the given page."""
    page = db.query(Page).filter_by(id=page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    if page.summary:
        return {"summary": page.summary}

    revisions = (
        db.query(Revision)
          .filter_by(page_id=page_id)
          .order_by(Revision.timestamp.desc())
          .limit(100)
          .all()
    )
    summary = generate_dispute_summary(page, revisions)
    
    page.summary = summary
    db.commit()
    
    return {"summary": summary}



