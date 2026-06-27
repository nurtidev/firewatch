from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import has_full_access
from app.db import get_db
from app.routers.auth import current_user

router = APIRouter(tags=["overview"], dependencies=[Depends(current_user)])


@router.get("/overview")
def overview(db: Session = Depends(get_db), user: dict = Depends(current_user)) -> dict:
    """Headline counts for the dashboard.

    For scoped roles (inspector/supervisor) the building- and inspector-derived
    counts are limited to the user's district; city infrastructure (stations,
    hydrants) stays global.
    """
    params: dict = {}
    if has_full_access(user):
        b_filter = ""          # buildings b ...
        insp_filter = ""
    else:
        params["d"] = user.get("district")
        b_filter = "WHERE b.district IS NOT DISTINCT FROM :d"
        insp_filter = "WHERE district IS NOT DISTINCT FROM :d"

    row = db.execute(
        text(
            f"""
            SELECT
                (SELECT count(*) FROM buildings b {b_filter}) AS buildings,
                (SELECT count(*) FROM risk_scores r
                   JOIN buildings b ON b.id = r.building_id
                   {b_filter + (' AND' if b_filter else 'WHERE')} r.score > 70) AS high_risk,
                (SELECT count(*) FROM risk_scores r
                   JOIN buildings b ON b.id = r.building_id
                   {b_filter + (' AND' if b_filter else 'WHERE')}
                   r.score BETWEEN 36 AND 70) AS mid_risk,
                (SELECT round(avg(r.score))::int FROM risk_scores r
                   JOIN buildings b ON b.id = r.building_id {b_filter}) AS avg_score,
                (SELECT count(*) FROM fire_stations) AS stations,
                (SELECT count(*) FROM hydrants WHERE status = 'broken') AS broken_hydrants,
                (SELECT count(*) FROM operational_cards) AS cards,
                (SELECT count(*) FROM prescriptions) AS prescriptions,
                (SELECT count(*) FROM inspectors {insp_filter}) AS inspectors
            """
        ),
        params,
    ).mappings().first()
    return dict(row)
