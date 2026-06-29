"""
app/queue.py — Redis / RQ job queue setup with graceful degradation.

Connection is lazy: Redis is not contacted until the first actual call to
enqueue_track_job(), cache_get(), etc. This avoids blocking uvicorn's import
phase with a 2-second socket timeout on every hot-reload.

If Redis is reachable (REDIS_URL env var or default localhost:6379), on-demand
article tracking is handled by RQ workers for robust concurrent processing.

If Redis is NOT reachable, the module's public API degrades gracefully:
  - enqueue_track_job() returns None  → caller falls back to BackgroundTasks
  - get_job_status()   returns {"status": "unavailable", "redis": False}
  - cache_get/set/delete are no-ops

Environment variables:
  REDIS_URL  — Redis connection URL (default: redis://localhost:6379/0)
"""

import os
import json
import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Cache TTL (seconds) for sidebar list and cluster map responses
CACHE_TTL_SECONDS = 60

# ── Lazy connection state ────────────────────────────────────────────────────
# These are populated on first use (not at import time).

_lock         = threading.Lock()
_initialised  = False   # whether we've attempted a connection
_redis_client = None
_rq_queue     = None
_redis_ok     = False


def _ensure_connected() -> bool:
    """
    Connect to Redis on first call.  Thread-safe.
    Returns True if the connection succeeded, False otherwise.
    """
    global _initialised, _redis_client, _rq_queue, _redis_ok

    if _initialised:
        return _redis_ok

    with _lock:
        # Double-check inside the lock
        if _initialised:
            return _redis_ok

        try:
            import redis as redis_lib  # type: ignore
            import rq as rq_lib  # type: ignore

            client = redis_lib.from_url(
                REDIS_URL,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            client.ping()           # raises ConnectionError / TimeoutError if down
            queue = rq_lib.Queue("tremor_track", connection=client)

            _redis_client = client
            _rq_queue     = queue
            _redis_ok     = True
            logger.info(f"[Queue] Redis connected at {REDIS_URL}")

        except ImportError:
            logger.warning(
                "[Queue] 'redis' / 'rq' packages not installed. "
                "Install them with: pip install redis rq"
            )
        except Exception as exc:
            logger.warning(
                f"[Queue] Redis unavailable ({type(exc).__name__}). "
                "On-demand fetch will fall back to FastAPI BackgroundTasks. "
                "Response caching disabled."
            )

        _initialised = True

    return _redis_ok


# ── Public API ───────────────────────────────────────────────────────────────

def is_redis_available() -> bool:
    """Return True if Redis is reachable and the RQ queue is ready."""
    return _ensure_connected()


def enqueue_track_job(title: str) -> Optional[str]:
    """
    Enqueue an on-demand article-tracking job via RQ.

    Returns the job ID (str) if successfully enqueued, or None if Redis is
    unavailable (caller should fall back to BackgroundTasks).
    """
    if not _ensure_connected() or _rq_queue is None:
        return None
    try:
        import hashlib
        import rq as rq_lib  # type: ignore
        
        # Use a deterministic, URL-safe job ID based on MD5 of the page title
        title_hash = hashlib.md5(title.encode("utf-8")).hexdigest()
        job_id = f"track:{title_hash}"
        
        # Check if job is already queued, active, or deferred to prevent duplicates
        try:
            existing_job = rq_lib.job.Job.fetch(job_id, connection=_redis_client)
            status = existing_job.get_status()
            if status in ("queued", "started", "deferred"):
                logger.info(f"[Queue] Job for '{title}' already exists with status '{status}' (ID: {job_id}). Skipping enqueue.")
                return existing_job.id
            else:
                # Delete finished/failed/canceled job to avoid duplicate job ID collision on re-enqueue
                existing_job.delete()
        except Exception:
            pass

        from app.workers.track_worker import run_track_job
        job = _rq_queue.enqueue(
            run_track_job,
            title,
            job_id=job_id,
            job_timeout=120,    # max 2 min per fetch
            result_ttl=300,     # keep result for 5 min so frontend can poll
        )
        logger.info(f"[Queue] Enqueued track job {job.id} for '{title}'")
        return job.id
    except Exception as exc:
        logger.error(f"[Queue] Failed to enqueue job for '{title}': {exc!r}")
        return None


def get_job_status(job_id: str) -> dict:
    """
    Return the current status of an RQ job.

    Possible status values: queued, started, finished, failed, unavailable.
    """
    if not _ensure_connected() or _redis_client is None:
        return {"status": "unavailable", "redis": False}
    try:
        import rq as rq_lib  # type: ignore
        job    = rq_lib.job.Job.fetch(job_id, connection=_redis_client)
        status = job.get_status()
        result = {"status": str(status), "redis": True}
        if status == "finished" and job.result is not None:
            result["result"] = job.result
        if status == "failed":
            result["error"] = str(job.exc_info or "Unknown error")
        return result
    except Exception as exc:
        logger.error(f"[Queue] get_job_status({job_id}) failed: {exc!r}")
        return {"status": "error", "redis": True, "error": str(exc)}


# ── Response caching helpers ─────────────────────────────────────────────────

def cache_set(key: str, value: object, ttl: int = CACHE_TTL_SECONDS) -> None:
    """Store a JSON-serialisable value in Redis with a TTL. No-op if Redis is down."""
    if not _ensure_connected() or _redis_client is None:
        return
    try:
        _redis_client.setex(key, ttl, json.dumps(value))
    except Exception as exc:
        logger.debug(f"[Cache] cache_set({key}) failed: {exc!r}")


def cache_get(key: str) -> Optional[object]:
    """Retrieve and deserialise a cached value. Returns None on miss or error."""
    if not _ensure_connected() or _redis_client is None:
        return None
    try:
        raw = _redis_client.get(key)
        return json.loads(raw) if raw is not None else None
    except Exception as exc:
        logger.debug(f"[Cache] cache_get({key}) failed: {exc!r}")
        return None


def cache_delete(key: str) -> None:
    """Delete a cached key. No-op if Redis is down."""
    if not _ensure_connected() or _redis_client is None:
        return
    try:
        _redis_client.delete(key)
    except Exception as exc:
        logger.debug(f"[Cache] cache_delete({key}) failed: {exc!r}")


def invalidate_page_caches() -> None:
    """
    Invalidate response caches affected by score updates.
    Executed after scores are recalculated. Uses explicit key deletion
    instead of expensive 'KEYS' scans to conserve Redis commands.
    """
    if not _ensure_connected() or _redis_client is None:
        return
    try:
        # Specific known cache keys to avoid expensive wildcard KEYS scanning
        keys_to_delete = [
            "tremor:pages_list:250",
            "tremor:pages_list:300",
            "tremor:pages_list:400",
            "tremor:pages_list:500",
            "tremor:pages_list:600",
            "tremor:pages_list:700",
            "tremor:pages_list:800",
            "tremor:pages_list:900",
            "tremor:pages_list:1000",
            "tremor:clusters_list:200",
            "tremor:clusters_list:1000"
        ]
        _redis_client.delete(*keys_to_delete)
        logger.info("[Cache] Invalidated specific page and cluster caches.")
    except Exception as exc:
        logger.debug(f"[Cache] invalidate_page_caches failed: {exc!r}")


def push_candidate_to_buffer(title: str, max_buffer_size: int = 150, elevated: bool = False) -> bool:
    """
    Appends a page title to the candidate buffer if Redis is available.
    Deduplicates against tremor:candidate_set.
    If elevated is True, uses LPUSH to put it at the head of the queue (priority).
    """
    if not _ensure_connected() or _redis_client is None:
        return False
    try:
        # Check if already in buffer
        if _redis_client.sismember("tremor:candidate_set", title):
            return False
            
        # Check current buffer size
        current_len = _redis_client.llen("tremor:candidate_buffer")
        if current_len >= max_buffer_size:
            return False
            
        # Add to set and list inside a pipeline
        pipe = _redis_client.pipeline()
        pipe.sadd("tremor:candidate_set", title)
        if elevated:
            pipe.lpush("tremor:candidate_buffer", title)
        else:
            pipe.rpush("tremor:candidate_buffer", title)
        pipe.execute()
        return True
    except Exception as exc:
        logger.debug(f"[Queue] push_candidate_to_buffer failed: {exc!r}")
        return False


def pop_candidates_from_buffer(count: int) -> list[str]:
    """
    Pops up to 'count' page titles from the candidate buffer.
    Removes them from tremor:candidate_set.
    """
    if not _ensure_connected() or _redis_client is None:
        return []
    try:
        # Pop multiple items from the list using LPOP with count (Redis 6.2+)
        # Fallback to loop if count is not supported by the client/server
        titles = []
        pipe = _redis_client.pipeline()
        for _ in range(count):
            pipe.lpop("tremor:candidate_buffer")
        popped = pipe.execute()
        
        for val in popped:
            if val is not None:
                title_str = val if isinstance(val, str) else val.decode("utf-8")
                titles.append(title_str)
                
        if titles:
            _redis_client.srem("tremor:candidate_set", *titles)
            
        return titles
    except Exception as exc:
        logger.error(f"[Queue] pop_candidates_from_buffer failed: {exc!r}")
        return []


def get_candidate_buffer_size() -> int:
    """Returns the size of the candidate buffer, or 0 if Redis is down."""
    if not _ensure_connected() or _redis_client is None:
        return 0
    try:
        return _redis_client.llen("tremor:candidate_buffer")
    except Exception as exc:
        logger.debug(f"[Queue] get_candidate_buffer_size failed: {exc!r}")
        return 0
