import os
import sys
import time
from redis import Redis
from rq import SimpleWorker

# Ensure backend root is in PYTHONPATH
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.queue import REDIS_URL

# Record script start time
START_TIME = time.time()

# Configurable timeout budget in minutes (defaults to matching GitHub action's 40m timeout)
WORKER_TIMEOUT_MINUTES = float(os.getenv("WORKER_TIMEOUT_MINUTES", "40"))
WORKER_SAFETY_MARGIN_MINUTES = float(os.getenv("WORKER_SAFETY_MARGIN_MINUTES", "5"))

class BudgetAwareSimpleWorker(SimpleWorker):
    """
    Subclass of SimpleWorker that checks elapsed execution time before fetching
    the next job. If the remaining time budget is insufficient, it exits cleanly.
    """
    def dequeue_job_and_maintain_ttl(self, timeout, max_idle_time=None):
        elapsed = time.time() - START_TIME
        budget = (WORKER_TIMEOUT_MINUTES - WORKER_SAFETY_MARGIN_MINUTES) * 60
        if elapsed >= budget:
            self.log.info(
                f"[TIME BUDGET] Time budget exceeded ({elapsed:.1f}s >= {budget:.1f}s). "
                "Stopping job consumption and shutting down worker cleanly."
            )
            return None
        return super().dequeue_job_and_maintain_ttl(timeout, max_idle_time)

def run_worker():
    print(f"Connecting to Redis at: {REDIS_URL}")
    conn = Redis.from_url(REDIS_URL)
    
    # Pre-check queue length to avoid expensive worker startup command overhead on empty runs
    try:
        from rq import Queue
        queue = Queue("tremor_track", connection=conn)
        queue_len = queue.count
        print(f"Current queue length for tremor_track: {queue_len}")
        if queue_len == 0:
            print("Queue is empty. Exiting worker immediately to conserve Redis commands.")
            print("[REDIS BUDGET] This worker run consumed approximately 1 Redis command.")
            return
    except Exception as e:
        print(f"Error checking queue length: {e!r}. Proceeding to start worker anyway.")
        queue_len = 0

    print("Starting BudgetAwareSimpleWorker on queue: tremor_track...")
    worker = BudgetAwareSimpleWorker(['tremor_track'], connection=conn)
    worker.work(burst=True)
    print("SimpleWorker finished processing all jobs in burst mode.")
    
    approx_commands = 19 + (10 * queue_len)
    print(f"[REDIS BUDGET] This worker run consumed approximately {approx_commands} Redis commands.")

if __name__ == '__main__':
    run_worker()
