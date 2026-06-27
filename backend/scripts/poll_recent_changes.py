import os
import sys
import requests
from datetime import datetime, timezone, timedelta
from sqlalchemy import func

# Set sys.path to backend root directory so we can import from app.*
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import SessionLocal
from app.models import Page, Revision
from app.ml.revert_detect import is_revert_edit
from app.ml.anomaly import compute_page_anomaly_score
from app.queue import is_redis_available, push_candidate_to_buffer, invalidate_page_caches

API_URL = "https://en.wikipedia.org/w/api.php"
HEADERS = {
    "User-Agent": "TremorPollBot/1.0 (https://github.com/username/tremor; contact: dev@example.com)"
}

def get_last_poll_timestamp(db, redis_client) -> datetime:
    """Determine the start timestamp for recent changes polling."""
    # 1. Try to get from Redis
    if redis_client:
        try:
            val = redis_client.get("tremor:last_poll_timestamp")
            if val:
                # Expecting float timestamp
                return datetime.fromtimestamp(float(val), tz=timezone.utc)
        except Exception as e:
            print(f"[Redis] Error reading last_poll_timestamp: {e!r}")

    # 2. Try to get from the latest revision in the database
    try:
        max_ts = db.query(func.max(Revision.timestamp)).scalar()
        if max_ts:
            # Add tzinfo if naive, and subtract a safety buffer of 5 minutes
            if max_ts.tzinfo is None:
                max_ts = max_ts.replace(tzinfo=timezone.utc)
            else:
                max_ts = max_ts.astimezone(timezone.utc)
            # 5 minutes safety buffer to handle delayed writes or API latency
            return max_ts - timedelta(minutes=5)
    except Exception as e:
        print(f"[DB] Error querying latest revision timestamp: {e!r}")

    # 3. Default to 1 hour ago
    return datetime.now(timezone.utc) - timedelta(hours=1)

def save_last_poll_timestamp(redis_client, ts: datetime):
    """Save the poll timestamp back to Redis."""
    if redis_client:
        try:
            redis_client.set("tremor:last_poll_timestamp", str(ts.timestamp()))
            print(f"[Redis] Saved last poll timestamp: {ts.isoformat()}")
        except Exception as e:
            print(f"[Redis] Error saving last_poll_timestamp: {e!r}")

def poll_changes():
    db = SessionLocal()
    
    # Check Redis availability and get client
    redis_client = None
    if is_redis_available():
        try:
            from app.queue import _redis_client
            redis_client = _redis_client
        except Exception:
            pass

    now = datetime.now(timezone.utc)
    start_ts = get_last_poll_timestamp(db, redis_client)
    # MediaWiki API requires YYYY-MM-DDTHH:MM:SSZ format
    start_iso = start_ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    
    print(f"Polling Wikipedia recent changes starting from: {start_iso} (current UTC: {now.strftime('%Y-%m-%dT%H:%M:%SZ')})")

    # Load all tracked page titles into a set for fast lookup
    tracked_titles = {p.title for p in db.query(Page.title).all()}
    print(f"Loaded {len(tracked_titles)} tracked pages from the database.")

    params = {
        "action": "query",
        "list": "recentchanges",
        "rcnamespace": 0,
        "rcprop": "title|ids|sizes|flags|user|timestamp|comment|tags",
        "rclimit": 500,
        "rcdir": "newer",
        "rcstart": start_iso,
        "format": "json"
    }

    revisions_added_count = 0
    updated_pages = set()
    buffered_candidates_count = 0

    has_more = True
    rccontinue = None

    while has_more:
        if rccontinue:
            params["rccontinue"] = rccontinue

        try:
            res = requests.get(API_URL, params=params, headers=HEADERS, timeout=15)
            res.raise_for_status()
            data = res.json()
        except Exception as e:
            print(f"ERROR: Failed to connect to Wikipedia API: {e!r}")
            sys.exit(1)

        query = data.get("query", {})
        recentchanges = query.get("recentchanges", [])

        print(f"Received batch of {len(recentchanges)} recent changes.")

        for change in recentchanges:
            if change.get("type") != "edit":
                continue

            title = change.get("title")
            if not title:
                continue

            # Check if this is an article we are currently tracking
            if title in tracked_titles:
                rev_id = change.get("revid")
                if not rev_id:
                    continue

                # Deduplicate: skip if revision exists
                existing = db.query(Revision).filter_by(revision_id=rev_id).first()
                if existing:
                    continue

                # Ingest revision
                comment = change.get("comment", "")
                tags = change.get("tags", [])
                is_revert = is_revert_edit(comment, tags)
                is_bot = "bot" in change or any("bot" == t.lower() for t in tags)

                # Parse timestamp
                ts_str = change.get("timestamp")
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))

                # Resolve Page object
                page = db.query(Page).filter_by(title=title).first()
                if page:
                    revision = Revision(
                        revision_id=rev_id,
                        page_id=page.id,
                        editor=change.get("user", "Unknown"),
                        timestamp=dt,
                        byte_change=change.get("newlen", 0) - change.get("oldlen", 0),
                        comment=comment,
                        is_revert=is_revert,
                        is_bot=is_bot,
                    )
                    db.add(revision)
                    revisions_added_count += 1
                    updated_pages.add(page)
                    print(f" [INGEST] '{title}' | Rev {rev_id} | Revert={is_revert} | Bot={is_bot}")
            else:
                # Buffer untracked popular changes as candidates
                if redis_client:
                    added = push_candidate_to_buffer(title)
                    if added:
                        buffered_candidates_count += 1

        # Check for paginated continue
        if "continue" in data:
            rccontinue = data.get("continue", {}).get("rccontinue")
        else:
            has_more = False

    # Commit any changes so scoring has access to new revisions
    if revisions_added_count > 0:
        db.commit()
        print(f"Persisted {revisions_added_count} new revisions.")

        # Trigger anomaly scoring only for updated pages
        print(f"Recalculating anomaly scores for {len(updated_pages)} updated pages...")
        for page in updated_pages:
            score = compute_page_anomaly_score(db, page)
            page.anomaly_score = score
            page.last_checked = now
            db.add(page)
            print(f" [SCORE] '{page.title}' updated to {score}")
        
        db.commit()
        print("Anomaly scores updated successfully.")

        # Invalidate cache
        try:
            invalidate_page_caches()
            print("Redis cache invalidated.")
        except Exception:
            pass
    else:
        print("No new revisions found for tracked pages in this window.")

    # Save timestamp of this run to pick up next time
    save_last_poll_timestamp(redis_client, now)
    
    print(f"Polling run completed. Revisions added: {revisions_added_count}, Candidates buffered: {buffered_candidates_count}")
    db.close()

if __name__ == "__main__":
    poll_changes()
