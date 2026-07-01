from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import enforce_building_scope, has_full_access
from app.audit import audit, client_ip
from app.db import get_db
from app.routers.auth import current_user

router = APIRouter(
    prefix="/buildings",
    tags=["buildings"],
    dependencies=[Depends(current_user)],
)

TYPE_LABELS = {
    "residential": "Жилое",
    "public": "Общественное",
    "industrial": "Производственное",
    "other": "Прочее",
}


# Risk-band SQL filters — kept in sync with lib/risk.ts scoreSeverity thresholds
# (4 bands: low <20, mid 20–39, high 40–59, critical 60+). The map legend and the
# filter dropdown MUST expose the same four bands, or "Высокий" silently includes
# critical objects and reads as a broken filter.
RISK_BANDS = {
    "low": "r.score < 20",
    "mid": "r.score BETWEEN 20 AND 39",
    "high": "r.score BETWEEN 40 AND 59",
    "critical": "r.score >= 60",
}


@router.get("")
def list_buildings(
    bbox: str | None = None,
    type: str | None = None,
    district: str | None = None,
    risk: str | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict:
    """Buildings (footprint polygons) with risk scores as a FeatureCollection.

    `bbox` = "minLon,minLat,maxLon,maxLat" limits to the visible map area.
    Optional filters: `type` (building_type), `district`, `risk` (low/mid/high).
    Scoped roles are server-side confined to their own district.
    """
    has_table = db.execute(
        text("SELECT to_regclass('public.buildings')")
    ).scalar()
    if not has_table:
        return {"type": "FeatureCollection", "features": []}

    clauses: list[str] = []
    params: dict = {}
    if bbox:
        min_lon, min_lat, max_lon, max_lat = (float(x) for x in bbox.split(","))
        clauses.append(
            "b.geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)"
        )
        params |= {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
        }
    if type:
        clauses.append("b.building_type = :type")
        params["type"] = type
    if district:
        clauses.append("b.district = :district")
        params["district"] = district
    if risk in RISK_BANDS:
        clauses.append(RISK_BANDS[risk])

    # Server-side district confinement for scoped roles (cannot be bypassed by
    # the client-supplied `district` filter above).
    enforce_building_scope(clauses, params, user)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    rows = db.execute(
        text(
            f"""
            SELECT
                b.id,
                b.address,
                b.building_type,
                b.floors,
                r.score,
                ST_AsGeoJSON(b.geom) AS geometry
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            {where}
            LIMIT 8000
            """
        ),
        params,
    ).mappings()

    import json

    features = [
        {
            "type": "Feature",
            "geometry": json.loads(row["geometry"]),
            "properties": {
                "id": row["id"],
                "address": row["address"],
                "type": row["building_type"],
                "score": row["score"],
                "floors": row["floors"],
            },
        }
        for row in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/{building_id}")
def building_detail(
    building_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict:
    """Full operational card for one building: attributes, risk, SHAP factors.

    District-scoped: an inspector/supervisor can only open buildings in their own
    district. Returns 404 (not 403) for out-of-scope objects so existence in
    another district isn't leaked.
    """
    row = db.execute(
        text(
            """
            SELECT
                b.id, b.osm_id, b.address, b.building_type, b.osm_tag,
                b.year_built, b.floors, b.district,
                r.score, r.model_version, r.explanation, r.computed_at
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            WHERE b.id = :id
            """
        ),
        {"id": building_id},
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="building not found")

    if not has_full_access(user) and row["district"] != user.get("district"):
        raise HTTPException(status_code=404, detail="building not found")

    card = _building_card(building_id, db)

    audit(
        action="read.building",
        username=user.get("username"),
        role=user.get("role"),
        method="GET",
        path=f"/buildings/{building_id}",
        status_code=200,
        ip=client_ip(request),
        detail={"building_id": building_id},
    )

    return {
        "id": row["id"],
        "osm_id": row["osm_id"],
        "address": row["address"] or "Адрес не указан",
        "building_type": row["building_type"],
        "type_label": TYPE_LABELS.get(row["building_type"], row["building_type"]),
        "osm_tag": row["osm_tag"],
        "year_built": row["year_built"],
        "floors": row["floors"],
        "score": row["score"],
        "model_version": row["model_version"],
        "explanation": row["explanation"] or [],
        "computed_at": row["computed_at"].isoformat() if row["computed_at"] else None,
        "card": card,
    }


def _building_card(building_id: int, db: Session) -> dict | None:
    """Compact summary of the operational card (ПТП) linked to a building, for the
    detail panel. Returns None if the building has no card. Tolerates both the
    AI-extracted shape and the structured ПТП shape."""
    row = db.execute(
        text(
            "SELECT id, filename, extracted FROM operational_cards "
            "WHERE building_id = :id ORDER BY created_at DESC LIMIT 1"
        ),
        {"id": building_id},
    ).mappings().first()
    if row is None:
        return None
    ex = row["extracted"] or {}
    obj = ex.get("object") or {}
    resp = ex.get("response") or {}
    water = ex.get("water_sources") or []
    return {
        "id": row["id"],
        "filename": row["filename"],
        "object_name": obj.get("name") or ex.get("address"),
        "nearest_station": resp.get("nearest_station"),
        "distance_km": resp.get("distance_km"),
        "arrival_min": resp.get("arrival_min"),
        "rank": resp.get("preassigned_rank"),
        "water_sources": len(water) or None,
    }
