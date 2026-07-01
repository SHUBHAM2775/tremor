import requests
import time
from datetime import datetime, timezone
import argparse
from app.db import SessionLocal
from app.models import Page, Revision

API_URL = "https://en.wikipedia.org/w/api.php"
HEADERS = {
    "User-Agent": "Tremor/1.0 (https://github.com/username/tremor; contact: dev@example.com)"
}

def wikipedia_api_request(url, params, headers, timeout=20, max_retries=5, initial_backoff=5.0, max_backoff=60.0):
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


def _get_or_create_page(db, title: str) -> Page:
    """
    Fetch or create a Page row, handling the race condition where the live
    stream listener may have already inserted this page between our SELECT
    and INSERT.  Uses flush() inside a try/except so the unique constraint
    prevents duplicates rather than crashing.
    """
    page = db.query(Page).filter_by(title=title).first()
    if not page:
        try:
            page = Page(title=title, wiki="enwiki")
            db.add(page)
            db.flush()       # raises IntegrityError if another writer inserted first
            db.refresh(page)
            print(f"Created new Page record: {page}")
        except Exception:
            db.rollback()
            page = db.query(Page).filter_by(title=title).first()
            if page is None:
                raise
            print(f"Found existing Page record (concurrent insert): {page}")
    else:
        print(f"Found existing Page record: {page}")
    return page


def fetch_and_store_history(db, title: str, limit: int = 100) -> int:
    """
    Fetches historical revisions for a given Wikipedia page title and stores
    them in the database.  Returns the number of new revisions inserted.

    Raises on Wikipedia API error.  Rolls back on DB write failure to avoid
    partial data being silently committed.
    """
    print(f"Fetching history for page: '{title}' (limit: {limit})...")

    # 1. Get or create Page in DB (race-condition safe)
    page = _get_or_create_page(db, title)

    # 2. Call MediaWiki Action API
    params = {
        "action": "query",
        "prop":   "revisions",
        "titles": title,
        "rvlimit": limit,
        "rvprop": "ids|timestamp|user|size|comment|tags|flags",
        "format": "json",
    }

    try:
        data = wikipedia_api_request(API_URL, params, HEADERS, timeout=20)
    except Exception as e:
        print(f"Error querying Wikipedia API: {e!r}")
        raise

    # Extract pages and revisions from the response
    pages_data = data.get("query", {}).get("pages", {})
    if not pages_data:
        print("No page found in API response.")
        return 0

    page_key  = list(pages_data.keys())[0]
    page_info = pages_data[page_key]

    if "missing" in page_info:
        print(f"Page '{title}' does not exist on English Wikipedia.")
        return 0

    revisions_list = page_info.get("revisions", [])
    if not revisions_list:
        print(f"No revisions found for page '{title}'.")
        return 0

    print(f"Fetched {len(revisions_list)} revisions from API. Processing...")

    new_revisions_count = 0

    try:
        # Batch query existing revision IDs to avoid N roundtrips
        rev_ids = [rev_data.get("revid") for rev_data in revisions_list if rev_data.get("revid")]
        existing_ids = set()
        if rev_ids:
            existing_rows = db.query(Revision.revision_id).filter(Revision.revision_id.in_(rev_ids)).all()
            existing_ids = {r.revision_id for r in existing_rows}

        # The API returns revisions sorted from newest to oldest.
        for i, rev_data in enumerate(revisions_list):
            rev_id = rev_data.get("revid")
            if not rev_id or rev_id in existing_ids:
                continue

            # Parse timestamp — MediaWiki format: "2026-06-22T12:34:56Z"
            ts_str = rev_data.get("timestamp")
            dt = (
                datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if ts_str
                else datetime.now(timezone.utc)
            )

            # Byte change: this revision vs. the older one (index i+1)
            current_size = rev_data.get("size", 0)
            if i + 1 < len(revisions_list):
                byte_change = current_size - revisions_list[i + 1].get("size", 0)
            else:
                byte_change = 0  # oldest revision in batch — no parent size available

            # Revert detection via comment keywords and tags
            comment      = rev_data.get("comment", "")
            tags         = rev_data.get("tags", [])
            comment_lower = comment.lower()
            is_revert = any(
                kw in comment_lower
                for kw in ("revert", "undid", "rv ", "rvv", "restored")
            ) or any("revert" in tag.lower() for tag in tags)

            # Bot detection via "bot" flag or tag
            is_bot = "bot" in rev_data or any("bot" == t.lower() for t in tags)

            revision = Revision(
                revision_id=rev_id,
                page_id=page.id,
                editor=rev_data.get("user", "Unknown"),
                timestamp=dt,
                byte_change=byte_change,
                comment=comment,
                is_revert=is_revert,
                is_bot=is_bot,
            )
            db.add(revision)
            new_revisions_count += 1

        if new_revisions_count > 0:
            page.summary = None

        db.commit()
        print(f"Successfully added {new_revisions_count} new revisions to database.")
        return new_revisions_count

    except Exception as exc:
        # Rollback the entire batch on any DB error — do not commit partial data
        print(f"DB write error, rolling back: {exc!r}")
        db.rollback()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch and store historical revisions for a Wikipedia page."
    )
    parser.add_argument("title", type=str, help="Title of the Wikipedia page")
    parser.add_argument("--limit", type=int, default=100, help="Number of revisions (max 500)")

    args = parser.parse_args()

    db_session = SessionLocal()
    try:
        fetch_and_store_history(db_session, args.title, args.limit)
    finally:
        db_session.close()
