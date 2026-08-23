from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from app.db import get_db, SessionLocal
from app.models import Page
from app.ml.clustering import perform_clustering
from app.queue import cache_get, cache_set, invalidate_page_caches

router = APIRouter(prefix="/api/clusters", tags=["clusters"])

class ClusterPageResponse(BaseModel):
    id: int
    title: str
    anomaly_score: Optional[float] = None
    cluster_id: Optional[int] = None
    x: Optional[float] = None
    y: Optional[float] = None
    conflict_type: Optional[str] = None
    conflict_type_confidence: Optional[float] = None

    class Config:
        from_attributes = True

@router.get("", response_model=List[ClusterPageResponse])
def get_clusters(limit: int = 200, db: Session = Depends(get_db)):
    """
    Returns coordinate and clustering data for top pages that have coordinates
    calculated.  Response is cached in Redis for 30 s when available.
    """
    cache_key = f"tremor:clusters_list:{limit}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    rows = db.query(
        Page.id,
        Page.title,
        Page.anomaly_score,
        Page.cluster_id,
        Page.x,
        Page.y,
        Page.conflict_type,
        Page.conflict_type_confidence,
    ).filter(
        Page.x.isnot(None),
        Page.y.isnot(None),
    ).order_by(
        Page.anomaly_score.desc().nullslast()
    ).limit(limit).all()

    result = [
        {
            "id": r.id,
            "title": r.title,
            "anomaly_score": r.anomaly_score,
            "cluster_id": r.cluster_id,
            "x": r.x,
            "y": r.y,
            "conflict_type": r.conflict_type,
            "conflict_type_confidence": r.conflict_type_confidence,
        }
        for r in rows
    ]
    cache_set(cache_key, result, ttl=600)
    return result


def background_recluster_task():
    db = SessionLocal()
    try:
        perform_clustering(db)
        # Invalidate caches after reclustering so next fetch is fresh
        invalidate_page_caches()
    finally:
        db.close()


@router.post("/recalculate")
def recalculate_clusters(background_tasks: BackgroundTasks):
    """Triggers UMAP & HDBSCAN recalculation of clusters in the background."""
    background_tasks.add_task(background_recluster_task)
    return {"message": "Started background recalculation of page topic clusters."}
