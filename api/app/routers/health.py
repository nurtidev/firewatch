import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Liveness + DB/PostGIS reachability + ML degraded-status.

    DB failure flips status to "error" (api can't serve). The ML service is a
    soft dependency: if it is down or running on the heuristic fallback, we
    report it as degraded but keep api healthy so Railway doesn't restart api
    for an ML problem.
    """
    db_ok = False
    postgis = None
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
        postgis = db.execute(text("SELECT postgis_version()")).scalar()
    except Exception:  # noqa: BLE001 - health must never raise
        db_ok = False

    ml_ok = False
    ml_model_loaded = None
    try:
        r = httpx.get(f"{settings.ml_url}/health", timeout=2.0)
        body = r.json()
        ml_model_loaded = body.get("model_loaded")
        ml_ok = r.status_code == 200 and ml_model_loaded is not False
    except Exception:  # noqa: BLE001 - ML is a soft dependency
        ml_ok = False

    return {
        "status": "ok" if db_ok else "error",
        "service": "api",
        "db": db_ok,
        "postgis": postgis,
        "ml": ml_ok,
        "ml_model_loaded": ml_model_loaded,
    }
