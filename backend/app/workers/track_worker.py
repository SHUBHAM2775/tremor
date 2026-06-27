"""
app/workers/track_worker.py — RQ job function for on-demand article tracking.

This module is imported by both:
  - The FastAPI app (to pass the function reference to rq.Queue.enqueue)
  - The RQ worker process (to execute the job)

Run an RQ worker with:
    rq worker tremor_track --url redis://localhost:6379/0

The worker must have PYTHONPATH set to the backend root so that 'app.*'
imports resolve correctly.
"""

import logging
from datetime import datetime, timezone

from app.db import SessionLocal
from app.ingest.history_fetcher import fetch_and_store_history
from app.ml.anomaly import compute_page_anomaly_score
from app.models import Page

logger = logging.getLogger(__name__)


def evict_pages_to_make_room(db, count_needed: int):
    """
    Evicts up to count_needed least-relevant pages to make room.
    Least-relevant: lowest anomaly score, then oldest last_checked timestamp.
    Does not evict high-conflict pages (anomaly_score > 2.0).
    """
    if count_needed <= 0:
        return
        
    from sqlalchemy import or_
    candidates = (
        db.query(Page)
        .filter(or_(Page.anomaly_score.is_(None), Page.anomaly_score <= 2.0))
        .order_by(
            Page.anomaly_score.asc().nullsfirst(),
            Page.last_checked.asc().nullsfirst()
        )
        .all()
    )
    
    evicted_titles = []
    to_delete = candidates[:count_needed]
    for page in to_delete:
        evicted_titles.append(page.title)
        db.delete(page)
        
    if evicted_titles:
        db.commit()
        logger.info(f"[EVICTION] Evicted {len(evicted_titles)} pages: {evicted_titles}")


def run_track_job(title: str) -> dict:
    """
    RQ job: fetch Wikipedia revision history for *title*, compute its anomaly
    score, and persist both to the database.

    Returns a dict with the outcome:
      {"status": "ok",    "title": ..., "score": ..., "revisions_added": ...}
      {"status": "error", "title": ..., "error": ...}

    This function is safe to call directly (bypassing RQ) for the graceful
    fallback path in the FastAPI BackgroundTasks flow.
    """
    db = SessionLocal()
    try:
        logger.info(f"[Worker] Starting track job for '{title}'")
        revisions_added = fetch_and_store_history(db, title, limit=150)

        page = db.query(Page).filter_by(title=title).first()
        if not page:
            return {"status": "error", "title": title, "error": "Page not found after fetch"}

        score = compute_page_anomaly_score(db, page)
        page.anomaly_score = score
        page.last_checked  = datetime.now(timezone.utc)
        
        # Explicit coordinates init
        if page.x is None:
            page.x = 0.0
        if page.y is None:
            page.y = 0.0
        if page.cluster_id is None:
            page.cluster_id = -1
            
        db.add(page)
        db.commit()

        # Enforce cap (1,000 articles)
        current_count = db.query(Page).count()
        if current_count > 1000:
            logger.info(f"[Worker] Page count ({current_count}) exceeds 1000 cap. Evicting pages to make room...")
            evict_pages_to_make_room(db, current_count - 1000)

        # Invalidate response caches so the next API call sees fresh data
        try:
            from app.queue import invalidate_page_caches
            invalidate_page_caches()
        except Exception:
            pass  # cache invalidation failure is non-fatal

        logger.info(
            f"[Worker] Finished '{title}': "
            f"score={score}, revisions_added={revisions_added}"
        )
        return {
            "status":          "ok",
            "title":           title,
            "score":           score,
            "revisions_added": revisions_added,
        }

    except Exception as exc:
        logger.error(f"[Worker] Failed track job for '{title}': {exc!r}")
        try:
            db.rollback()
        except Exception:
            pass
        return {"status": "error", "title": title, "error": str(exc)}
    finally:
        db.close()


def run_load_more_batch_job(titles: list[str]) -> dict:
    """
    RQ job: fetch history, score, and default coordinates for a batch of titles.
    Runs eviction if adding this batch would exceed the 1000 article cap.
    """
    db = SessionLocal()
    try:
        logger.info(f"[Worker] Starting batch track job for {len(titles)} pages")
        
        # Enforce cap & eviction
        current_count = db.query(Page).count()
        excess = (current_count + len(titles)) - 1000
        if excess > 0:
            logger.info(f"[Worker] Batch size would exceed 1000 cap. Evicting {excess} pages first...")
            evict_pages_to_make_room(db, excess)
            
        success_count = 0
        revisions_added_total = 0
        
        for title in titles:
            try:
                # 1. Fetch Wikipedia history (10-20 revisions range)
                revisions_added = fetch_and_store_history(db, title, limit=15)
                
                # 2. Get the page record
                page = db.query(Page).filter_by(title=title).first()
                if not page:
                    continue
                    
                # 3. Calculate anomaly score
                score = compute_page_anomaly_score(db, page)
                page.anomaly_score = score
                page.last_checked  = datetime.now(timezone.utc)
                
                # Initialize coordinates so the page shows up immediately on the map
                if page.x is None:
                    page.x = 0.0
                if page.y is None:
                    page.y = 0.0
                if page.cluster_id is None:
                    page.cluster_id = -1
                    
                db.add(page)
                db.commit()
                
                success_count += 1
                revisions_added_total += revisions_added
                logger.info(f"[Worker] Batch tracking: added '{title}' (revisions={revisions_added}, score={score})")
            except Exception as e:
                logger.error(f"[Worker] Failed tracking '{title}' in batch: {e!r}")
                db.rollback()
                
        # Invalidate response caches so frontend sees the fresh batch
        try:
            from app.queue import invalidate_page_caches
            invalidate_page_caches()
        except Exception:
            pass
            
        logger.info(f"[Worker] Finished batch job. Added {success_count}/{len(titles)} pages, total revisions={revisions_added_total}")
        return {
            "status": "ok",
            "added_count": success_count,
            "revisions_added": revisions_added_total
        }
    except Exception as exc:
        logger.error(f"[Worker] Batch job failed: {exc!r}")
        try:
            db.rollback()
        except Exception:
            pass
        return {"status": "error", "error": str(exc)}
    finally:
        db.close()
