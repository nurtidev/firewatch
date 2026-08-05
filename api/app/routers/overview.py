from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import has_full_access
from app.db import get_db
from app.routers.auth import require_roles
from app.routers.buildings import RISK_BANDS

router = APIRouter(tags=["overview"])

# Dashboard risk bands. `key` here is literally the `risk=` query value
# accepted by GET /buildings, and the SQL is buildings.RISK_BANDS[key] itself
# (imported, not copied) — so `risk_bands[i].count` is GUARANTEED to equal
# `len(GET /buildings?risk=<key>)` under the same token. That identity is the
# whole point of this endpoint: see CLAUDE.md P0 "высокий риск — два разных
# числа". `lo`/`hi` are for display only (the dashboard renders "40–59" etc.
# straight off this response instead of hardcoding its own copy).
#
# Canonical thresholds (≥60 critical, ≥40 high, ≥20 elevated) are duplicated in
# four other places per CLAUDE.md: buildings.RISK_BANDS, lib/risk.ts
# scoreSeverity, chat SCHEMA_DOC, map legend/filter. This is the fifth — if the
# thresholds ever change, update RISK_BANDS in buildings.py (source of truth
# for the SQL) and the `lo`/`hi` pairs below together.
_RISK_BANDS_DISPLAY = [
    ("critical", 60, None),
    ("high", 40, 59),
    ("mid", 20, 39),
    ("low", 0, 19),
]


@router.get("/overview")
def overview(
    db: Session = Depends(get_db),
    user: dict = Depends(require_roles("supervisor", "leadership", "admin")),
) -> dict:
    """Headline counts for the dashboard.

    For supervisor the building- and inspector-derived counts are limited to
    the user's district; city infrastructure (stations, hydrants) stays global.

    `risk_bands` is the same four-band canonical split used by the map
    (critical/high/mid/low, i.e. `?risk=` values) — see `_RISK_BANDS_DISPLAY`
    above.
    """
    params: dict = {}
    if has_full_access(user):
        b_filter = ""          # buildings b ...
        insp_filter = ""
    else:
        params["d"] = user.get("district")
        b_filter = "WHERE b.district IS NOT DISTINCT FROM :d"
        insp_filter = "WHERE district IS NOT DISTINCT FROM :d"

    band_join = b_filter + (" AND" if b_filter else "WHERE")
    band_select = ",\n".join(
        f"(SELECT count(*) FROM risk_scores r\n"
        f"   JOIN buildings b ON b.id = r.building_id\n"
        f"   {band_join} {RISK_BANDS[key]}) AS risk_{key}"
        for key, _, _ in _RISK_BANDS_DISPLAY
    )

    row = db.execute(
        text(
            f"""
            SELECT
                (SELECT count(*) FROM buildings b {b_filter}) AS buildings,
                {band_select},
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

    result = dict(row)
    result["risk_bands"] = [
        {"key": key, "min": lo, "max": hi, "count": result.pop(f"risk_{key}")}
        for key, lo, hi in _RISK_BANDS_DISPLAY
    ]
    return result
