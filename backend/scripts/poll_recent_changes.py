import os
import sys
import time
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

def wikipedia_api_request(url, params, headers, timeout=15, max_retries=5, initial_backoff=5.0, max_backoff=60.0):
    """
    Sends a GET request to the Wikipedia API, with retries and exponential backoff
    for HTTP 429 Rate Limit responses and connection errors.
    """
    backoff = initial_backoff
    for attempt in range(max_retries + 1):
        try:
            res = requests.get(url, params=params, headers=headers, timeout=timeout)
            
            # Handle HTTP 429 Rate Limit
            if res.status_code == 429:
                retry_after_header = res.headers.get("Retry-After")
                retry_seconds = backoff
                if retry_after_header:
                    try:
                        retry_seconds = float(retry_after_header)
                    except ValueError:
                        pass
                print(f"[Wikipedia API] Hit 429 Rate Limit. Retrying in {retry_seconds:.1f} seconds (attempt {attempt + 1}/{max_retries})...")
                time.sleep(retry_seconds)
                backoff = min(backoff * 2, max_backoff)
                continue
            
            res.raise_for_status()
            return res.json()
        except requests.exceptions.RequestException as e:
            if attempt == max_retries:
                print(f"ERROR: Max retries ({max_retries}) exhausted for Wikipedia API request: {e!r}")
                raise
            
            print(f"[Wikipedia API] Request error: {e!r}. Retrying in {backoff:.1f} seconds (attempt {attempt + 1}/{max_retries})...")
            time.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)
    
    raise requests.exceptions.RequestException("Max retries exceeded")

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
    
    # Defensive limit: bound the maximum catch-up window per run to 6 hours.
    # If the gap since the last checkpoint exceeds this threshold, we log a warning
    # and only process up to start_ts + 6 hours, advancing the checkpoint partially.
    MAX_CATCHUP_GAP = timedelta(hours=6)
    current_window_end = now
    if now - start_ts > MAX_CATCHUP_GAP:
        current_window_end = start_ts + MAX_CATCHUP_GAP
        print(f"WARNING: The gap since the last poll ({now - start_ts}) exceeds the maximum catch-up window of {MAX_CATCHUP_GAP}. "
              f"To prevent an excessive or rate-limited run, we will cap the end time to {current_window_end.strftime('%Y-%m-%dT%H:%M:%SZ')} in this run.")

    start_iso = start_ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    end_iso = current_window_end.strftime("%Y-%m-%dT%H:%M:%SZ")
    
    print(f"Polling Wikipedia recent changes: {start_iso} to {end_iso} (current UTC: {now.strftime('%Y-%m-%dT%H:%M:%SZ')})")

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
        "rcend": end_iso,
        "format": "json"
    }

    revisions_added_count = 0
    updated_pages = set()
    buffered_candidates_count = 0

    has_more = True
    rccontinue = None
    batch_count = 0
    MAX_BATCHES = 15  # Defensive limit: maximum 15 batches per run to prevent runaway tasks
    
    last_processed_change_ts = None
    run_fully_completed = False

    while has_more:
        if rccontinue:
            params["rccontinue"] = rccontinue

        # Proactive delay between batch requests (1.5 seconds) to avoid rate limits
        if batch_count > 0:
            print("Proactive rate-limit avoidance: sleeping for 1.5 seconds before next request...")
            time.sleep(1.5)

        print(f"Fetching batch {batch_count + 1}...")
        try:
            data = wikipedia_api_request(API_URL, params=params, headers=HEADERS, timeout=15)
        except Exception as e:
            print(f"ERROR: Failed to connect to Wikipedia API: {e!r}")
            # Exit loop but retain graceful behavior (saving checkpoint of successfully committed batches)
            break

        query = data.get("query", {})
        recentchanges = query.get("recentchanges", [])
        batch_count += 1

        print(f"Received batch {batch_count} of {len(recentchanges)} recent changes.")

        if not recentchanges:
            # Check if there is still a continue parameter, or if we have finished
            if "continue" in data:
                rccontinue = data.get("continue", {}).get("rccontinue")
                continue
            else:
                has_more = False
                run_fully_completed = True
                break

        batch_revisions_added = 0
        batch_updated_pages = set()

        for change in recentchanges:
            if change.get("type") != "edit":
                continue

            title = change.get("title")
            if not title:
                continue

            # Record timestamp of last processed change
            ts_str = change.get("timestamp")
            if ts_str:
                try:
                    last_processed_change_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                except ValueError:
                    pass

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
                dt = last_processed_change_ts or datetime.fromisoformat(ts_str.replace("Z", "+00:00"))

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
                    batch_revisions_added += 1
                    batch_updated_pages.add(page)
                    print(f" [INGEST] '{title}' | Rev {rev_id} | Revert={is_revert} | Bot={is_bot}")
            else:
                # Buffer untracked popular changes as candidates
                if redis_client:
                    added = push_candidate_to_buffer(title)
                    if added:
                        buffered_candidates_count += 1

        # Commit batch changes and calculate anomaly scores incrementally
        if batch_revisions_added > 0:
            try:
                db.commit()
                print(f"Batch {batch_count}: Persisted {batch_revisions_added} new revisions.")

                # Trigger anomaly scoring only for updated pages in this batch
                print(f"Batch {batch_count}: Recalculating anomaly scores for {len(batch_updated_pages)} updated pages...")
                for page in batch_updated_pages:
                    score = compute_page_anomaly_score(db, page)
                    page.anomaly_score = score
                    page.last_checked = now
                    db.add(page)
                    print(f" [SCORE] '{page.title}' updated to {score}")
                
                db.commit()
                print(f"Batch {batch_count}: Anomaly scores updated successfully.")

                # Invalidate cache
                try:
                    invalidate_page_caches()
                    print("Redis cache invalidated.")
                except Exception as cache_err:
                    print(f"WARNING: Cache invalidation failed: {cache_err!r}")

                revisions_added_count += batch_revisions_added
                updated_pages.update(batch_updated_pages)
            except Exception as db_err:
                print(f"ERROR: DB error while committing batch {batch_count}: {db_err!r}")
                db.rollback()
                # Break out of loop to keep database and Redis checkpoints synchronized
                break

        # Save Redis checkpoint incrementally after each successfully completed batch
        if redis_client and last_processed_change_ts:
            save_last_poll_timestamp(redis_client, last_processed_change_ts)

        # Check for paginated continue
        if "continue" in data:
            rccontinue = data.get("continue", {}).get("rccontinue")
        else:
            has_more = False
            run_fully_completed = True

        # Check batch limit
        if batch_count >= MAX_BATCHES:
            print(f"INFO: Reached the maximum number of batches ({MAX_BATCHES}) for this run. "
                  f"Capping processing to avoid rate limits. Checkpoint will resume from: "
                  f"{last_processed_change_ts.isoformat() if last_processed_change_ts else 'N/A'}")
            break

    # If the run successfully queried the entire window, advance checkpoint to the window end
    if run_fully_completed:
        save_last_poll_timestamp(redis_client, current_window_end)
    elif not run_fully_completed and last_processed_change_ts:
        print(f"Partial run completed. Checkpoint is at last processed change timestamp: {last_processed_change_ts.isoformat()}")
    else:
        print("No changes were processed, and query did not complete successfully. Checkpoint not updated.")
    
    print(f"Polling run completed. Revisions added: {revisions_added_count}, Candidates buffered: {buffered_candidates_count}")
    db.close()

if __name__ == "__main__":
    poll_changes()
