import os
import sys

# Ensure backend root is in PYTHONPATH
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal
from app.models import Page, Revision

def audit():
    db = SessionLocal()
    try:
        total_pages = db.query(Page).count()
        null_scores = db.query(Page).filter(Page.anomaly_score.is_(None)).count()
        
        print("=== DATABASE QUICK AUDIT ===")
        print(f"Total tracked pages: {total_pages}")
        print(f"Pages with anomaly_score IS NULL: {null_scores}")
        
        print("\n=== TOP 5 PAGES BY SCORE ===")
        top_pages = db.query(Page).order_by(Page.anomaly_score.desc().nullslast()).limit(5).all()
        for i, p in enumerate(top_pages, 1):
            print(f"{i}. Title: {p.title} | Score: {p.anomaly_score} | Last Checked: {p.last_checked}")
            
    finally:
        db.close()

if __name__ == "__main__":
    audit()
