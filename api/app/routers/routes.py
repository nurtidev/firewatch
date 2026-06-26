from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.routers.buildings import TYPE_LABELS

router = APIRouter(tags=["inspections"])

# Working-day slots (lunch 12:30–14:00 skipped), up to 6 stops.
SLOTS = ["08:30", "10:00", "11:30", "14:00", "15:30", "17:00"]


@router.get("/inspectors")
def list_inspectors(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        text("SELECT id, name, district FROM inspectors ORDER BY id")
    ).mappings()
    return [dict(r) for r in rows]


def _priority(score: int, days_since: int) -> float:
    """Risk dominates; staleness adds a bounded bonus."""
    return score + min(days_since / 15.0, 20.0)


def _nearest_neighbor(stops: list[dict]) -> list[dict]:
    """Order stops for travel efficiency, starting from highest priority."""
    if not stops:
        return []
    remaining = stops[1:]
    ordered = [stops[0]]
    while remaining:
        last = ordered[-1]
        nxt = min(
            remaining,
            key=lambda s: (s["lon"] - last["lon"]) ** 2 + (s["lat"] - last["lat"]) ** 2,
        )
        ordered.append(nxt)
        remaining.remove(nxt)
    return ordered


@router.get("/routes/today")
def route_today(
    inspector_id: int,
    size: int = 6,
    db: Session = Depends(get_db),
) -> dict:
    inspector = db.execute(
        text("SELECT id, name, district FROM inspectors WHERE id = :id"),
        {"id": inspector_id},
    ).mappings().first()
    if inspector is None:
        raise HTTPException(404, "Инспектор не найден")

    size = max(1, min(size, len(SLOTS)))

    candidates = db.execute(
        text(
            """
            SELECT
                b.id, b.address, b.building_type, b.year_built, b.last_inspected,
                r.score,
                r.explanation->0->>'feature' AS top_factor,
                ST_X(ST_Centroid(b.geom)) AS lon,
                ST_Y(ST_Centroid(b.geom)) AS lat,
                (CURRENT_DATE - b.last_inspected) AS days_since
            FROM buildings b
            JOIN risk_scores r ON r.building_id = b.id
            WHERE b.district = :district
            """
        ),
        {"district": inspector["district"]},
    ).mappings().all()

    ranked = sorted(
        (dict(c) for c in candidates),
        key=lambda c: _priority(c["score"], c["days_since"] or 0),
        reverse=True,
    )[:size]

    ordered = _nearest_neighbor(ranked)

    stops = [
        {
            "order": i + 1,
            "time": SLOTS[i],
            "building_id": s["id"],
            "address": s["address"] or f"Объект {s['id']}",
            "type_label": TYPE_LABELS.get(s["building_type"], s["building_type"]),
            "year_built": s["year_built"],
            "score": s["score"],
            "last_inspected": s["last_inspected"].isoformat()
            if s["last_inspected"]
            else None,
            "days_since": s["days_since"],
            "note": s["top_factor"],
        }
        for i, s in enumerate(ordered)
    ]

    return {
        "inspector": dict(inspector),
        "date": date.today().isoformat(),
        "district": inspector["district"],
        "stops": stops,
    }
