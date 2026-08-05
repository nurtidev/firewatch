import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import audit, client_ip
from app.config import settings
from app.db import get_db
from app.routers.auth import require_roles

router = APIRouter(
    prefix="/infra",
    tags=["infrastructure"],
    # Hydrants and stations are the боевой roles' bread and butter — dispatcher
    # and responder read the whole city's infrastructure.
    dependencies=[
        Depends(require_roles("supervisor", "leadership", "admin", "dispatcher", "responder"))
    ],
)

# Marking a hydrant serviceable/broken is a field/ops action: the боевой roles
# and supervisor/admin, but not leadership (reads dashboards) or inspector.
HYDRANT_STATUS_ROLES = require_roles("dispatcher", "responder", "supervisor", "admin")


class HydrantStatusUpdate(BaseModel):
    status: str  # "ok" | "broken"
    note: str | None = Field(None, max_length=500)

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in ("ok", "broken"):
            raise ValueError("status должен быть 'ok' или 'broken'")
        return v


def _fc(rows, geom_key: str, props) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": json.loads(r[geom_key]),
                "properties": props(r),
            }
            for r in rows
        ],
    }


@router.get("/stations")
def stations(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        text(
            "SELECT name, vehicles, ST_AsGeoJSON(geom) AS geom FROM fire_stations"
        )
    ).mappings().all()
    return _fc(rows, "geom", lambda r: {"name": r["name"], "vehicles": r["vehicles"]})


@router.get("/hydrants")
def hydrants(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        text(
            # id обязателен: по нему гидрант адресуется с карты (пометка
            # неисправности). Без него слой рисовался, но каждая точка была
            # безымянной — действие над ней выполнить было нельзя.
            "SELECT id, status, last_check, pressure_bar, diameter_mm, hydrant_type, "
            "ST_AsGeoJSON(geom) AS geom FROM hydrants"
        )
    ).mappings().all()
    return _fc(
        rows,
        "geom",
        lambda r: {
            "id": r["id"],
            "status": r["status"],
            "last_check": r["last_check"].isoformat() if r["last_check"] else None,
            # Operational specs (NULL until the water-utility feed is wired) — let
            # the dispatcher judge whether the hydrant sustains the required flow.
            "pressure_bar": r["pressure_bar"],
            "diameter_mm": r["diameter_mm"],
            "hydrant_type": r["hydrant_type"],
        },
    )


@router.get("/coverage")
def coverage(db: Session = Depends(get_db)) -> dict:
    """One buffered polygon per station ≈ 10-min reach.

    LIMITATION: straight-line geodesic buffer, NOT a road-network isochrone — it
    ignores rivers (Есиль), railways and closed blocks, so it can over-state
    coverage. Replace with OSRM/2GIS isochrones before relying on blind-zone
    conclusions operationally. The response flags this via `approximate: true`.
    """
    rows = db.execute(
        text(
            "SELECT name, "
            "ST_AsGeoJSON(ST_Buffer(geom::geography, :r)::geometry) AS geom "
            "FROM fire_stations"
        ),
        {"r": settings.coverage_radius_m},
    ).mappings().all()
    fc = _fc(rows, "geom", lambda r: {"name": r["name"]})
    fc["approximate"] = True  # straight-line buffer, not a road isochrone
    return fc


@router.get("/blind-zones")
def blind_zones(db: Session = Depends(get_db)) -> dict:
    """Buildings whose nearest station exceeds the normative reach."""
    rows = db.execute(
        text(
            """
            SELECT b.id, b.address, r.score,
                   ST_AsGeoJSON(ST_Centroid(b.geom)) AS geom
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            WHERE NOT EXISTS (
                SELECT 1 FROM fire_stations s
                WHERE ST_DWithin(b.geom::geography, s.geom::geography, :r)
            )
            LIMIT 4000
            """
        ),
        {"r": settings.coverage_radius_m},
    ).mappings().all()
    return _fc(
        rows,
        "geom",
        lambda r: {"id": r["id"], "address": r["address"], "score": r["score"]},
    )


@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    row = db.execute(
        text(
            """
            SELECT
                (SELECT count(*) FROM fire_stations) AS stations,
                (SELECT count(*) FROM hydrants) AS hydrants,
                (SELECT count(*) FROM hydrants WHERE status = 'broken') AS broken,
                (SELECT count(*) FROM buildings) AS total_buildings,
                (SELECT count(*) FROM buildings b WHERE NOT EXISTS (
                    SELECT 1 FROM fire_stations s
                    WHERE ST_DWithin(b.geom::geography, s.geom::geography, :r)
                )) AS blind
            """
        ),
        {"r": settings.coverage_radius_m},
    ).mappings().first()

    total = row["total_buildings"] or 1
    return {
        "stations": row["stations"],
        "hydrants": row["hydrants"],
        "broken_hydrants": row["broken"],
        "blind_zone_buildings": row["blind"],
        "blind_pct": round(100.0 * row["blind"] / total, 1),
        "coverage_radius_m": settings.coverage_radius_m,
        "normative_min": settings.arrival_normative_min,
        # Blind zones use a straight-line buffer, not road isochrones — treat as
        # an upper bound on coverage (real reach is worse). See /coverage.
        "approximate": True,
    }


@router.post("/hydrants/{hydrant_id}/status")
def set_hydrant_status(
    hydrant_id: int,
    body: HydrantStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(HYDRANT_STATUS_ROLES),
) -> dict:
    """Record a hydrant's actual state from the field (караул на выезде).

    A responder/dispatcher marks a hydrant ok/broken and stamps last_check —
    the боевой пакет and the map then reflect reality, not the last feed import.
    """
    row = db.execute(
        text(
            """
            UPDATE hydrants
               SET status = :st, last_check = now()
             WHERE id = :id
            RETURNING id, status, last_check, pressure_bar, diameter_mm,
                      hydrant_type, ST_Y(geom) AS lat, ST_X(geom) AS lng
            """
        ),
        {"st": body.status, "id": hydrant_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Гидрант не найден")
    db.commit()

    audit(
        action="hydrant.status",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/infra/hydrants/{hydrant_id}/status",
        status_code=200,
        ip=client_ip(request),
        detail={"id": hydrant_id, "status": body.status, "note": body.note},
    )

    return {
        "id": row["id"],
        "status": row["status"],
        "last_check": row["last_check"].isoformat() if row["last_check"] else None,
        "pressure_bar": row["pressure_bar"],
        "diameter_mm": row["diameter_mm"],
        "hydrant_type": row["hydrant_type"],
        "lat": row["lat"],
        "lng": row["lng"],
    }
