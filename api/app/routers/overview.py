from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.routers.auth import current_user

router = APIRouter(tags=["overview"], dependencies=[Depends(current_user)])


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    """Headline counts for the dashboard."""
    row = db.execute(
        text(
            """
            SELECT
                (SELECT count(*) FROM buildings) AS buildings,
                (SELECT count(*) FROM risk_scores WHERE score > 70) AS high_risk,
                (SELECT count(*) FROM risk_scores WHERE score BETWEEN 36 AND 70) AS mid_risk,
                (SELECT round(avg(score))::int FROM risk_scores) AS avg_score,
                (SELECT count(*) FROM fire_stations) AS stations,
                (SELECT count(*) FROM hydrants WHERE status = 'broken') AS broken_hydrants,
                (SELECT count(*) FROM operational_cards) AS cards,
                (SELECT count(*) FROM prescriptions) AS prescriptions,
                (SELECT count(*) FROM inspectors) AS inspectors
            """
        )
    ).mappings().first()
    return dict(row)
