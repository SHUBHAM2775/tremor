import json
import sys
import threading
import time
from datetime import datetime, timezone

import requests  # type: ignore
import sseclient  # type: ignore

from app.db import SessionLocal, init_db
from app.models import Page, Revision
from app.ml.revert_detect import is_revert_edit
from app.queue import is_redis_available, push_candidate_to_buffer

STREAM_URL = "https://stream.wikimedia.org/v2/stream/recentchange"

TARGET_WIKI = "enwiki"
TARGET_NAMESPACE = 0

# Interval (in seconds) between background scoring sweeps
SCORING_INTERVAL = 90


def safe_log(msg: str):
    """Write to stdout safely, replacing un-encodable chars (Windows terminal fix)."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"))


def get_or_create_page(db, title: str) -> Page:
    """
    Fetch or create a Page row, handling the race condition where two concurrent
    writers (live stream + on-demand fetch) might try to INSERT the same title.
    Uses a flush-and-merge pattern so the unique constraint on Page.title
    prevents duplicate rows rather than raising an unhandled IntegrityError.
    """
    page = db.query(Page).filter_by(title=title).first()
    if page is None:
        try:
            page = Page(title=title, wiki=TARGET_WIKI)
            db.add(page)
            db.flush()          # hit the DB constraint now, inside this try block
            db.refresh(page)    # populate .id
        except Exception:
            # Another writer created the page between our SELECT and INSERT.
            # Roll back the failed flush and re-query.
            db.rollback()
            page = db.query(Page).filter_by(title=title).first()
            if page is None:
                # Something else went wrong — re-raise
                raise
    return page


# Rolling stream metrics
processed_counter = 0
matched_counter = 0
buffered_counter = 0

# Rolling untracked activity state
untracked_activity = {}  # title -> {"edits": [ts, ts, ...], "reverts": [ts, ts, ...]}
last_cleanup_time = time.time()
last_summary_time = time.time()

scanned_edits_count = 0
scanned_reverts_count = 0
flagged_candidates_count = 0


def handle_event(db, event: dict):
    global processed_counter, matched_counter, buffered_counter
    global scanned_edits_count, scanned_reverts_count, flagged_candidates_count
    global last_cleanup_time, last_summary_time

    if event.get("type") != "edit":
        return
    if event.get("wiki") != TARGET_WIKI:
        return
    if event.get("namespace") != TARGET_NAMESPACE:
        return

    processed_counter += 1
    if processed_counter % 1000 == 0:
        safe_log(
            f"[STREAM] Ingesting... Processed {processed_counter} events "
            f"(matched {matched_counter} tracked pages, buffered {buffered_counter} candidates)."
        )

    title = event.get("title")
    rev_id = event.get("revision", {}).get("new")
    if not title or not rev_id:
        return

    # Check if the page is currently tracked in the database
    try:
        page = db.query(Page).filter_by(title=title).first()
    except Exception as e:
        safe_log(f"[STREAM] Database query error: {e!r}")
        return

    if page:
        # Check if this revision is already recorded
        try:
            existing = db.query(Revision).filter_by(revision_id=rev_id).first()
            if existing:
                return

            comment = event.get("comment", "")
            tags    = event.get("tags", [])
            is_revert = is_revert_edit(comment, tags)

            revision = Revision(
                revision_id=rev_id,
                page_id=page.id,
                editor=event.get("user", ""),
                timestamp=datetime.fromtimestamp(event.get("timestamp", 0), tz=timezone.utc),
                byte_change=(
                    event.get("length", {}).get("new", 0)
                    - event.get("length", {}).get("old", 0)
                ),
                comment=comment,
                is_revert=is_revert,
                is_bot=event.get("bot", False),
            )
            db.add(revision)
            db.commit()
            matched_counter += 1

            safe_log(
                f"[EDIT] {title[:60]} | editor={event.get('user', '')[:20]}"
                f" | diff={revision.byte_change}"
            )
        except Exception as exc:
            safe_log(f"[STREAM] Failed to persist event for tracked page '{title}' (rev {rev_id}): {exc!r}")
            try:
                db.rollback()
            except Exception:
                pass
        finally:
            # Evict memory/cache to prevent SQLAlchemy Session bloat
            db.expire_all()
    else:
        # Untracked page: lightweight signal detection in-memory
        now_ts = time.time()
        scanned_edits_count += 1

        comment = event.get("comment", "")
        tags    = event.get("tags", [])
        is_revert = is_revert_edit(comment, tags)
        if is_revert:
            scanned_reverts_count += 1

        if title not in untracked_activity:
            untracked_activity[title] = {"edits": [], "reverts": []}

        # Track timestamp
        untracked_activity[title]["edits"].append(now_ts)
        if is_revert:
            untracked_activity[title]["reverts"].append(now_ts)

        # Filter out timestamps older than 5 minutes (300 seconds)
        cutoff = now_ts - 300
        untracked_activity[title]["edits"] = [t for t in untracked_activity[title]["edits"] if t >= cutoff]
        untracked_activity[title]["reverts"] = [t for t in untracked_activity[title]["reverts"] if t >= cutoff]

        # Check thresholds: e.g. 4 edits OR 2 reverts in 5 minutes
        edit_cnt = len(untracked_activity[title]["edits"])
        revert_cnt = len(untracked_activity[title]["reverts"])

        if edit_cnt >= 4 or revert_cnt >= 2:
            # Promote to tracked page automatically
            try:
                redis_queued = False
                if is_redis_available():
                    from app.queue import enqueue_track_job
                    job_id = enqueue_track_job(title)
                    if job_id:
                        redis_queued = True
                        buffered_counter += 1
                        flagged_candidates_count += 1
                        safe_log(f"[AUTO-PROMOTE] Enqueued RQ track job for '{title}' (edits={edit_cnt}, reverts={revert_cnt})")
                
                if not redis_queued:
                    # Fallback to local background thread
                    from app.workers.track_worker import run_track_job
                    threading.Thread(target=run_track_job, args=(title,), daemon=True).start()
                    buffered_counter += 1
                    flagged_candidates_count += 1
                    safe_log(f"[AUTO-PROMOTE] Started local background thread to track '{title}' (edits={edit_cnt}, reverts={revert_cnt})")
            except Exception as e:
                safe_log(f"[STREAM] Failed to auto-promote candidate '{title}': {e!r}")
            # Clear from active tracking to avoid multiple triggers in quick succession
            if title in untracked_activity:
                del untracked_activity[title]

    # Periodic cleanup and logging (every 60 seconds)
    now_ts = time.time()
    if now_ts - last_summary_time >= 60:
        # Print summary log
        safe_log(
            f"[STREAM] Periodic Summary: Scanned {scanned_edits_count} edits "
            f"({scanned_reverts_count} reverts) across {len(untracked_activity)} active untracked pages. "
            f"Flagged {flagged_candidates_count} new candidates."
        )
        # Reset periodic counters
        scanned_edits_count = 0
        scanned_reverts_count = 0
        flagged_candidates_count = 0
        last_summary_time = now_ts

    if now_ts - last_cleanup_time >= 120:
        # Perform in-memory cleanup of stale entries
        cutoff = now_ts - 300
        to_delete = []
        for t, act in list(untracked_activity.items()):
            act["edits"] = [x for x in act["edits"] if x >= cutoff]
            act["reverts"] = [x for x in act["reverts"] if x >= cutoff]
            if not act["edits"] and not act["reverts"]:
                to_delete.append(t)
        for t in to_delete:
            if t in untracked_activity:
                del untracked_activity[t]
        last_cleanup_time = now_ts



def run_scoring_loop():
    """
    Background thread: every SCORING_INTERVAL seconds, re-score all pages.
    Scoped per-session to avoid SQLite threading issues.
    """
    from app.ml.anomaly import compute_page_anomaly_score
    from sqlalchemy import func

    time.sleep(30)  # Give the main stream loop a head-start before first scoring pass
    while True:
        try:
            db = SessionLocal()
            try:
                # 1. Fetch eligible page IDs (those with >= 5 revisions) in a single fast query
                eligible_ids = [
                    r[0] for r in db.query(Revision.page_id)
                    .group_by(Revision.page_id)
                    .having(func.count(Revision.id) >= 5)
                    .all()
                ]

                eligible_pages = db.query(Page).filter(Page.id.in_(eligible_ids)).all()

                updated = 0
                for page in eligible_pages:
                    score = compute_page_anomaly_score(db, page)
                    if page.anomaly_score != score or page.last_checked is None:
                        page.anomaly_score = score  # type: ignore
                        page.last_checked  = datetime.now(timezone.utc)  # type: ignore
                        db.add(page)
                        updated += 1

                # 2. Reset ineligible pages with stale non-zero scores to 0.0
                ineligible_pages = db.query(Page).filter(
                    (~Page.id.in_(eligible_ids))
                    & (Page.anomaly_score != 0.0)
                    & (Page.anomaly_score.isnot(None))
                ).all()

                for page in ineligible_pages:
                    page.anomaly_score = 0.0  # type: ignore
                    page.last_checked  = datetime.now(timezone.utc)  # type: ignore
                    db.add(page)
                    updated += 1

                db.commit()
                if updated > 0:
                    safe_log(f"[SCORER] Updated anomaly scores for {updated} pages.")
            finally:
                try:
                    db.close()
                except Exception:
                    pass
        except Exception as e:
            safe_log(f"[SCORER] Error during scoring sweep: {e!r}")

        time.sleep(SCORING_INTERVAL)


def run():
    safe_log(f"Connecting to {STREAM_URL} ...")

    # Start the background scoring thread once (daemon exits with main process)
    scorer_thread = threading.Thread(target=run_scoring_loop, daemon=True)
    scorer_thread.start()
    safe_log(f"[SCORER] Background scoring loop started (interval={SCORING_INTERVAL}s).")

    headers = {
        "User-Agent": "Tremor/1.0 (https://github.com/username/tremor; contact: dev@example.com)"
    }

    retry_delay = 5  # seconds, doubles on each failure up to max
    max_delay   = 60

    while True:
        db = SessionLocal()
        try:
            safe_log("[STREAM] Connecting...")
            response = requests.get(STREAM_URL, headers=headers, stream=True, timeout=30)
            client = sseclient.SSEClient(response)  # type: ignore

            retry_delay = 5  # reset backoff on successful connection
            for event in client.events():
                if not event.data:
                    continue
                try:
                    data = json.loads(event.data)
                except json.JSONDecodeError:
                    continue
                handle_event(db, data)

        except KeyboardInterrupt:
            safe_log("\n[STREAM] Stopped by user.")
            break
        except Exception as e:
            safe_log(
                f"[STREAM] Connection lost: {type(e).__name__}. "
                f"Reconnecting in {retry_delay}s..."
            )
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, max_delay)
        finally:
            try:
                db.close()
            except Exception:
                pass


if __name__ == "__main__":
    init_db()
    run()