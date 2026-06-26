from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("")
def list_buildings(
    bbox: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """Return buildings with risk scores as GeoJSON FeatureCollection.

    `bbox` = "minLon,minLat,maxLon,maxLat" limits the result to the visible
    map area (essential at ~250K buildings). Returns an empty collection until
    the OSM import job has populated the `buildings` table (Phase 0/1).
    """
    has_table = db.execute(
        text("SELECT to_regclass('public.buildings')")
    ).scalar()
    if not has_table:
        return {"type": "FeatureCollection", "features": []}

    where = ""
    params: dict = {}
    if bbox:
        min_lon, min_lat, max_lon, max_lat = (float(x) for x in bbox.split(","))
        where = (
            "WHERE b.geom && ST_MakeEnvelope("
            ":min_lon, :min_lat, :max_lon, :max_lat, 4326)"
        )
        params = {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
        }

    rows = db.execute(
        text(
            f"""
            SELECT
                b.id,
                b.address,
                b.building_type,
                r.score,
                ST_AsGeoJSON(ST_Centroid(b.geom)) AS geometry
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            {where}
            LIMIT 5000
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
