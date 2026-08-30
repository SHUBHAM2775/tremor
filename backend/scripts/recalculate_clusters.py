import os
import sys
import time
from datetime import datetime, timezone

# Set sys.path to backend root directory so we can import from app.*
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import SessionLocal, init_db
from app.ml.clustering import perform_clustering

def safe_print(msg: str):
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"))

def main():
    safe_print(f"[{datetime.now(timezone.utc).isoformat()}] Starting standalone cluster recalculation...")
    
    # Ensure database schema is up-to-date
    init_db()

    start_time = time.time()
    db = SessionLocal()
    try:
        perform_clustering(db)
    finally:
        try:
            db.close()
        except Exception:
            pass

    # Note: perform_clustering() already calls update_cluster_recalculated_timestamp()
    # and invalidate_page_caches() internally — no need to repeat here.

    elapsed = time.time() - start_time
    safe_print(f"[{datetime.now(timezone.utc).isoformat()}] Cluster recalculation completed successfully in {elapsed:.2f}s.")

if __name__ == "__main__":
    main()
