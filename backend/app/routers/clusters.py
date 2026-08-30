import os
import requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from app.db import get_db
from app.models import Page
from app.ml.clustering import get_cluster_recalculated_timestamp
from app.queue import cache_get, cache_set

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

class ClusterStatusResponse(BaseModel):
    last_recalculated_at: Optional[str] = None

class RecalculateResponse(BaseModel):
    message: str
    last_recalculated_at: Optional[str] = None


@router.get("", response_model=List[ClusterPageResponse])
def get_clusters(limit: int = 200, db: Session = Depends(get_db)):
    """
    Returns coordinate and clustering data for top pages that have coordinates
    calculated.  Response is cached in Redis for 10 minutes when available.
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


@router.get("/status", response_model=ClusterStatusResponse)
def get_cluster_status(db: Session = Depends(get_db)):
    """
    Returns cluster recalculation metadata timestamp.
    """
    return {"last_recalculated_at": get_cluster_recalculated_timestamp(db)}


@router.post("/recalculate", response_model=RecalculateResponse)
def recalculate_clusters(db: Session = Depends(get_db)):
    """
    Triggers UMAP & HDBSCAN recalculation of clusters by dispatching
    a GitHub Actions workflow, offloading heavy ML memory consumption off the web service.
    """
    github_token = os.getenv("GITHUB_TOKEN")
    repo_owner = os.getenv("GITHUB_REPO_OWNER")
    repo_name = os.getenv("GITHUB_REPO_NAME")
    ref = os.getenv("GITHUB_REF", "main")

    current_recalculated_at = get_cluster_recalculated_timestamp(db)

    if not github_token or not repo_owner or not repo_name:
        raise HTTPException(
            status_code=503,
            detail=(
                "GitHub Actions integration is not configured on the server. "
                "Ensure GITHUB_TOKEN, GITHUB_REPO_OWNER, and GITHUB_REPO_NAME environment variables are set."
            ),
        )

    url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/actions/workflows/recalculate-clusters.yml/dispatches"
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Tremor-Backend",
    }
    payload = {"ref": ref}

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        if resp.status_code == 204:
            return {
                "message": "Cluster recalculation workflow dispatched successfully to GitHub Actions.",
                "last_recalculated_at": current_recalculated_at,
            }
        else:
            error_body = resp.text
            raise HTTPException(
                status_code=resp.status_code if resp.status_code in [400, 401, 403, 404] else 502,
                detail=f"GitHub Actions API returned error ({resp.status_code}): {error_body}",
            )
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to communicate with GitHub API: {str(e)}",
        )

