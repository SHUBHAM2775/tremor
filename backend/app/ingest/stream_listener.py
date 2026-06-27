import json
import sys
import threading
import time
from datetime import datetime, timezone

import requests
import sseclient

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


def handle_event(db, event: dict):
    if event.get("type") != "edit":
        return
    if event.get("wiki") != TARGET_WIKI:
        return
    if event.get("namespace") != TARGET_NAMESPACE:
        return

    title = event.get("title")
    rev_id = event.get("revision", {}).get("new")
    if not title or not rev_id:
        return

    # Deduplicate: skip if this revision is already recorded
    existing = db.query(Revision).filter_by(revision_id=rev_id).first()
    if existing:
        return

    try:
        # Only ingest revisions for pages already tracked in the database
        page = db.query(Page).filter_by(title=title).first()
        if page:
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

            safe_log(
                f"[EDIT] {title[:60]} | editor={event.get('user', '')[:20]}"
                f" | diff={revision.byte_change}"
            )
        else:
            # If the page is not in the database, buffer it as a candidate title
            if is_redis_available():
                added = push_candidate_to_buffer(title)
                if added:
                    safe_log(f"[BUFFER] Buffered candidate title: '{title}'")

    except Exception as exc:
        # Do NOT silently swallow — log the failure so we can diagnose.
        safe_log(f"[STREAM] Failed to persist event for '{title}' (rev {rev_id}): {exc!r}")
        try:
            db.rollback()
        except Exception:
            pass


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
                        page.anomaly_score = score
                        page.last_checked  = datetime.now(timezone.utc)
                        db.add(page)
                        updated += 1

                # 2. Reset ineligible pages with stale non-zero scores to 0.0
                ineligible_pages = db.query(Page).filter(
                    (~Page.id.in_(eligible_ids))
                    & (Page.anomaly_score != 0.0)
                    & (Page.anomaly_score.isnot(None))
                ).all()

                for page in ineligible_pages:
                    page.anomaly_score = 0.0
                    page.last_checked  = datetime.now(timezone.utc)
                    db.add(page)
                    updated += 1

                db.commit()
                if updated > 0:
                    safe_log(f"[SCORER] Updated anomaly scores for {updated} pages.")
            finally:
                db.close()
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
            client = sseclient.SSEClient(response)

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
            db.close()


if __name__ == "__main__":
    init_db()
    run()