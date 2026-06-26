from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Liveness + DB/PostGIS reachability."""
    db_ok = False
    postgis = None
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
        postgis = db.execute(text("SELECT postgis_version()")).scalar()
    except Exception:  # noqa: BLE001 - health must never raise
        db_ok = False

    return {
        "status": "ok",
        "service": "api",
        "db": db_ok,
        "postgis": postgis,
    }
