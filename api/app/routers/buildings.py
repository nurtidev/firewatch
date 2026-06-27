from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

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


RISK_BANDS = {
    "low": "r.score <= 35",
    "mid": "r.score BETWEEN 36 AND 70",
    "high": "r.score > 70",
}


@router.get("")
def list_buildings(
    bbox: str | None = None,
    type: str | None = None,
    district: str | None = None,
    risk: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """Buildings (footprint polygons) with risk scores as a FeatureCollection.

    `bbox` = "minLon,minLat,maxLon,maxLat" limits to the visible map area.
    Optional filters: `type` (building_type), `district`, `risk` (low/mid/high).
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

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    rows = db.execute(
        text(
            f"""
            SELECT
                b.id,
                b.address,
                b.building_type,
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
            },
        }
        for row in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/{building_id}")
def building_detail(building_id: int, db: Session = Depends(get_db)) -> dict:
    """Full operational card for one building: attributes, risk, SHAP factors."""
    row = db.execute(
        text(
            """
            SELECT
                b.id, b.osm_id, b.address, b.building_type, b.osm_tag,
                b.year_built, b.floors,
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
    }
