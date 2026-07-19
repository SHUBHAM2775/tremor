from fastapi import APIRouter

router = APIRouter(tags=["health"])

@router.get("/health")
@router.get("/api/health")
def health_check():
    """
    Lightweight health check endpoint for cold-start monitoring.
    Does NOT touch the database or trigger heavy processing.
    """
    return {"status": "ok"}
