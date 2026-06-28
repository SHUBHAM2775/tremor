import os
import sys
from redis import Redis
from rq import SimpleWorker

# Ensure backend root is in PYTHONPATH
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.queue import REDIS_URL

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

    print("Starting SimpleWorker on queue: tremor_track...")
    worker = SimpleWorker(['tremor_track'], connection=conn)
    worker.work(burst=True)
    print("SimpleWorker finished processing all jobs in burst mode.")
    
    approx_commands = 19 + (10 * queue_len)
    print(f"[REDIS BUDGET] This worker run consumed approximately {approx_commands} Redis commands.")

if __name__ == '__main__':
    run_worker()
