import os
import sys
import time
import requests  # type: ignore
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

MAX_PROMOTIONS_PER_RUN = 20
MAX_BACKFILL_CLASSIFICATIONS_PER_RUN = 30

def safe_print(msg: str):
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"))

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
    start_run_time = time.time()
    print(f"[TIMING] Starting polling run at {datetime.now(timezone.utc).isoformat()}")

    def log_duration(stage_name, start_time):
        duration = time.time() - start_time
        print(f"[TIMING] {stage_name} took {duration:.2f} seconds.")
        return time.time()

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
    t_start = time.time()
    start_ts = get_last_poll_timestamp(db, redis_client)
    t_start = log_duration("Retrieving last poll timestamp", t_start)
    
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

    # Project only id and title for O(1) lookup without fetching full 9-column Page ORM objects
    t_load = time.time()
    tracked_pages = {p.title: p for p in db.query(Page.id, Page.title).all()}
    tracked_titles = set(tracked_pages.keys())
    print(f"Loaded {len(tracked_titles)} tracked pages from the database.")
    t_load = log_duration("Loading tracked pages", t_load)

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
    untracked_activity = {}

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

        t_batch_start = time.time()
        print(f"Fetching batch {batch_count + 1}...")
        try:
            data = wikipedia_api_request(API_URL, params=params, headers=HEADERS, timeout=15)
        except Exception as e:
            print(f"ERROR: Failed to connect to Wikipedia API: {e!r}")
            # Exit loop but retain graceful behavior (saving checkpoint of successfully committed batches)
            break
        t_batch_fetch = log_duration(f"Fetching batch {batch_count + 1}", t_batch_start)

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
        batch_updated_page_ids = set()

        # Batch-check revision existence using a single SQL query for all revids in this batch
        batch_rev_ids = [
            c.get("revid") for c in recentchanges
            if c.get("type") == "edit" and c.get("revid") and c.get("title") in tracked_titles
        ]
        existing_rev_ids = set()
        if batch_rev_ids:
            existing_rows = db.query(Revision.revision_id).filter(Revision.revision_id.in_(batch_rev_ids)).all()
            existing_rev_ids = {r[0] for r in existing_rows}

        t_process_start = time.time()
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
                if not rev_id or rev_id in existing_rev_ids:
                    continue

                # Ingest revision
                comment = change.get("comment", "")
                tags = change.get("tags", [])
                is_revert = is_revert_edit(comment, tags)
                is_bot = "bot" in change or any("bot" == t.lower() for t in tags)

                # Parse timestamp
                dt = last_processed_change_ts or datetime.fromisoformat(ts_str.replace("Z", "+00:00"))

                # Resolve Page info from projected map
                page_info = tracked_pages.get(title)
                if page_info:
                    revision = Revision(
                        revision_id=rev_id,
                        page_id=page_info.id,
                        editor=change.get("user", "Unknown"),
                        timestamp=dt,
                        byte_change=change.get("newlen", 0) - change.get("oldlen", 0),
                        comment=comment,
                        is_revert=is_revert,
                        is_bot=is_bot,
                    )
                    db.add(revision)
                    batch_revisions_added += 1
                    batch_updated_page_ids.add(page_info.id)
                    existing_rev_ids.add(rev_id)  # Prevent duplicates within same batch
                    safe_print(f" [INGEST] '{title}' | Rev {rev_id} | Revert={is_revert} | Bot={is_bot}")
            else:
                # Track untracked changes in memory first to identify high-conflict pages
                comment = change.get("comment", "")
                tags = change.get("tags", [])
                is_revert = is_revert_edit(comment, tags)
                
                dt = last_processed_change_ts or (datetime.fromisoformat(ts_str.replace("Z", "+00:00")) if ts_str else datetime.now(timezone.utc))
                
                if title not in untracked_activity:
                    untracked_activity[title] = []
                untracked_activity[title].append({
                    "timestamp": dt,
                    "is_revert": is_revert
                })

        t_process = log_duration(f"Processing revisions for batch {batch_count}", t_process_start)

        # Commit batch changes and calculate anomaly scores incrementally
        if batch_revisions_added > 0:
            try:
                t_commit_start = time.time()
                db.commit()
                t_commit_start = log_duration(f"Committing {batch_revisions_added} new revisions for batch {batch_count}", t_commit_start)

                # Fetch full Page ORM objects only for updated pages in this batch
                batch_updated_pages = db.query(Page).filter(Page.id.in_(batch_updated_page_ids)).all() if batch_updated_page_ids else []

                # Trigger anomaly scoring only for updated pages in this batch
                print(f"Batch {batch_count}: Recalculating anomaly scores for {len(batch_updated_pages)} updated pages...")
                t_score_start = time.time()
                for page in batch_updated_pages:
                    score = compute_page_anomaly_score(db, page)
                    page.anomaly_score = score  # type: ignore
                    page.last_checked = now  # type: ignore
                    db.add(page)
                    safe_print(f" [SCORE] '{page.title}' updated to {score}")
                
                db.commit()
                t_score_start = log_duration(f"Recalculating and committing anomaly scores for batch {batch_count}", t_score_start)

                # Batched conflict classification for updated pages in this batch
                if batch_updated_pages:
                    print(f"Batch {batch_count}: Classifying conflict types for {len(batch_updated_pages)} updated pages...")
                    t_classify_start = time.time()
                    from app.ml.embeddings import prepare_text_for_page
                    from app.ml.classifier import classify_batch

                    pages_list = list(batch_updated_pages)
                    texts = [prepare_text_for_page(p, db) for p in pages_list]
                    classifications = classify_batch(texts)

                    for page, (ctype, confidence) in zip(pages_list, classifications):
                        page.conflict_type = ctype  # type: ignore
                        page.conflict_type_confidence = confidence  # type: ignore
                        db.add(page)
                        safe_print(f" [CLASSIFY] '{page.title}' -> {ctype} ({confidence:.2f})")

                    db.commit()
                    t_classify_start = log_duration(f"Classifying and committing conflict types for batch {batch_count}", t_classify_start)

                # Invalidate cache
                try:
                    invalidate_page_caches()
                    print("Redis cache invalidated.")
                except Exception as cache_err:
                    print(f"WARNING: Cache invalidation failed: {cache_err!r}")

                revisions_added_count += batch_revisions_added
                updated_pages.update(batch_updated_pages)
            except Exception as db_err:
                safe_print(f"ERROR: DB error while committing batch {batch_count}: {db_err!r}")
                db.rollback()
                # Break out of loop to keep database and Redis checkpoints synchronized
                break

        # Save Redis checkpoint incrementally after each successfully completed batch
        if redis_client and last_processed_change_ts:
            t_checkpoint_start = time.time()
            save_last_poll_timestamp(redis_client, last_processed_change_ts)
            log_duration(f"Saving incremental checkpoint to Redis", t_checkpoint_start)

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

    # Auto-promote high-conflict untracked pages as candidates
    if untracked_activity:
        t_buffer_start = time.time()
        print("Checking for high-conflict untracked candidates to promote...")
        candidates_checked = 0
        for title, activity_list in untracked_activity.items():
            if buffered_candidates_count >= MAX_PROMOTIONS_PER_RUN:
                print(f"Reached MAX_PROMOTIONS_PER_RUN ({MAX_PROMOTIONS_PER_RUN}). Deferring remaining candidates to subsequent poll cycles.")
                break

            # Check if there's any 5-minute window with >= 4 edits or >= 2 reverts
            activity_list.sort(key=lambda x: x["timestamp"])
            is_high_conflict = False
            matching_edits = 0
            matching_reverts = 0
            
            for i, act in enumerate(activity_list):
                window_start = act["timestamp"]
                edits_in_window = 0
                reverts_in_window = 0
                for j in range(i, len(activity_list)):
                    if activity_list[j]["timestamp"] - window_start <= timedelta(minutes=5):
                        edits_in_window += 1
                        if activity_list[j]["is_revert"]:
                            reverts_in_window += 1
                    else:
                        break
                if edits_in_window >= 4 or reverts_in_window >= 2:
                    is_high_conflict = True
                    matching_edits = edits_in_window
                    matching_reverts = reverts_in_window
                    break

            if is_high_conflict:
                candidates_checked += 1
                redis_queued = False
                if redis_client:
                    try:
                        from app.queue import enqueue_track_job
                        job_id = enqueue_track_job(title)
                        if job_id:
                            redis_queued = True
                            buffered_candidates_count += 1
                            safe_print(f" [AUTO-PROMOTE] Enqueued RQ track job for '{title}' (edits={matching_edits}, reverts={matching_reverts} in 5-min window)")
                    except Exception as e:
                        safe_print(f"ERROR: Failed to enqueue track job in poll script: {e!r}")
                
                if not redis_queued:
                    try:
                        import threading
                        from app.workers.track_worker import run_track_job
                        threading.Thread(target=run_track_job, args=(title,), daemon=True).start()
                        buffered_candidates_count += 1
                        safe_print(f" [AUTO-PROMOTE] Started local background thread to track '{title}' (edits={matching_edits}, reverts={matching_reverts} in 5-min window)")
                    except Exception as e:
                        safe_print(f"ERROR: Failed to start auto-promotion thread in poll script: {e!r}")
        print(f"Finished candidate promotion. Promoted {buffered_candidates_count} candidates out of {candidates_checked} eligible high-conflict pages.")
        log_duration("Promoting candidates", t_buffer_start)

    # Backfill classification pass for tracked pages missing conflict_type
    t_backfill_start = time.time()
    unclassified_pages = (
        db.query(Page)
        .filter(Page.conflict_type.is_(None))
        .limit(MAX_BACKFILL_CLASSIFICATIONS_PER_RUN)
        .all()
    )
    if unclassified_pages:
        print(f"Backfill: Classifying conflict types for {len(unclassified_pages)} unclassified tracked pages...")
        from app.ml.embeddings import prepare_text_for_page
        from app.ml.classifier import classify_batch

        texts = [prepare_text_for_page(p, db) for p in unclassified_pages]
        classifications = classify_batch(texts)

        for page, (ctype, confidence) in zip(unclassified_pages, classifications):
            page.conflict_type = ctype  # type: ignore
            page.conflict_type_confidence = confidence  # type: ignore
            db.add(page)
            safe_print(f" [BACKFILL CLASSIFY] '{page.title}' -> {ctype} ({confidence:.2f})")

        db.commit()
        try:
            invalidate_page_caches()
        except Exception:
            pass
        log_duration(f"Backfilling conflict classifications for {len(unclassified_pages)} pages", t_backfill_start)
    else:
        print("Backfill: No unclassified tracked pages found (all pages have conflict_type).")

    # If the run successfully queried the entire window, advance checkpoint to the window end
    if run_fully_completed:
        save_last_poll_timestamp(redis_client, current_window_end)
    elif not run_fully_completed and last_processed_change_ts:
        print(f"Partial run completed. Checkpoint is at last processed change timestamp: {last_processed_change_ts.isoformat()}")
    else:
        print("No changes were processed, and query did not complete successfully. Checkpoint not updated.")
    
    print(f"Polling run completed. Revisions added: {revisions_added_count}, Candidates buffered: {buffered_candidates_count}")
    
    # Log approximate Redis command usage for budget tracking
    # 1 (get timestamp) + 1 (save timestamp if completed) + 1 (cache invalidation if edits added) + 6 per enqueued candidate
    approx_commands = 1  # get timestamp
    if run_fully_completed or last_processed_change_ts:
        approx_commands += 1  # save timestamp
    if revisions_added_count > 0:
        approx_commands += 1  # cache invalidation
    approx_commands += (6 * buffered_candidates_count)  # enqueues
    print(f"[REDIS BUDGET] This polling run consumed approximately {approx_commands} Redis commands.")
    
    db.close()
    try:
        from app.db import engine
        engine.dispose()
    except Exception:
        pass
    log_duration("Entire polling run", start_run_time)

if __name__ == "__main__":
    poll_changes()
