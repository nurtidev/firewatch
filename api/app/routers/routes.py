from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.routers.auth import current_user
from app.routers.buildings import TYPE_LABELS

router = APIRouter(tags=["inspections"], dependencies=[Depends(current_user)])

# Working-day slots (lunch 12:30–14:00 skipped), up to 6 stops.
SLOTS = ["08:30", "10:00", "11:30", "14:00", "15:30", "17:00"]

# Fixed on-site checklist (inspector marks each item).
CHECKLIST = [
    {"key": "exits", "label": "Эвакуационные выходы свободны"},
    {"key": "alarm", "label": "АПС/АУПТ исправны"},
    {"key": "hydrant", "label": "Гидрант доступен и исправен"},
    {"key": "basement", "label": "Подвалы/склады без нарушений"},
]


@router.get("/inspectors")
def list_inspectors(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        text("SELECT id, name, district FROM inspectors ORDER BY id")
    ).mappings()
    return [dict(r) for r in rows]


@router.get("/routes/checklist")
def checklist() -> list[dict]:
    return CHECKLIST


def _priority(score: int, days_since: int) -> float:
    return score + min(days_since / 15.0, 20.0)


def _nearest_neighbor(stops: list[dict]) -> list[dict]:
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


def _build_route(db: Session, district: str, size: int) -> list[dict]:
    """Ordered list of stops (without visit status) for a district."""
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
        {"district": district},
    ).mappings().all()

    ranked = sorted(
        (dict(c) for c in candidates),
        key=lambda c: _priority(c["score"], c["days_since"] or 0),
        reverse=True,
    )[:size]
    return _nearest_neighbor(ranked)


def _visit_status(db: Session, inspector_id: int, building_ids: list[int]) -> dict:
    if not building_ids:
        return {}
    rows = db.execute(
        text(
            "SELECT building_id, status FROM inspection_visits "
            "WHERE inspector_id = :iid AND visit_date = CURRENT_DATE "
            "AND building_id = ANY(:ids)"
        ),
        {"iid": inspector_id, "ids": building_ids},
    ).mappings()
    return {r["building_id"]: r["status"] for r in rows}


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
    ordered = _build_route(db, inspector["district"], size)
    status_map = _visit_status(db, inspector_id, [s["id"] for s in ordered])

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
            "note": s["top_factor"],
            "status": status_map.get(s["id"], "pending"),
        }
        for i, s in enumerate(ordered)
    ]
    done = sum(1 for s in stops if s["status"] != "pending")

    return {
        "inspector": dict(inspector),
        "date": date.today().isoformat(),
        "district": inspector["district"],
        "stops": stops,
        "done": done,
        "total": len(stops),
    }


class VisitRequest(BaseModel):
    inspector_id: int
    building_id: int
    status: str = Field(..., pattern="^(done|violation)$")
    checklist: dict | None = None
    note: str | None = None


@router.post("/routes/visit")
def record_visit(body: VisitRequest, db: Session = Depends(get_db)) -> dict:
    import json

    db.execute(
        text(
            """
            INSERT INTO inspection_visits
                (inspector_id, building_id, visit_date, status, checklist, note)
            VALUES (:iid, :bid, CURRENT_DATE, :st, CAST(:cl AS JSONB), :note)
            ON CONFLICT (inspector_id, building_id, visit_date) DO UPDATE
            SET status = EXCLUDED.status,
                checklist = EXCLUDED.checklist,
                note = EXCLUDED.note,
                updated_at = now()
            """
        ),
        {
            "iid": body.inspector_id,
            "bid": body.building_id,
            "st": body.status,
            "cl": json.dumps(body.checklist, ensure_ascii=False) if body.checklist else None,
            "note": body.note,
        },
    )
    db.commit()
    return {"ok": True, "status": body.status}


@router.get("/routes/progress")
def progress(size: int = 6, db: Session = Depends(get_db)) -> list[dict]:
    """Live execution status across all inspectors (supervisor view)."""
    inspectors = db.execute(
        text("SELECT id, name, district FROM inspectors ORDER BY id")
    ).mappings().all()

    result = []
    for ins in inspectors:
        ordered = _build_route(db, ins["district"], size)
        ids = [s["id"] for s in ordered]
        status_map = _visit_status(db, ins["id"], ids)
        stops = [
            {
                "building_id": s["id"],
                "address": s["address"] or f"Объект {s['id']}",
                "score": s["score"],
                "status": status_map.get(s["id"], "pending"),
            }
            for s in ordered
        ]
        done = sum(1 for s in stops if s["status"] != "pending")
        violations = sum(1 for s in stops if s["status"] == "violation")
        result.append(
            {
                "inspector": dict(ins),
                "total": len(stops),
                "done": done,
                "violations": violations,
                "stops": stops,
            }
        )
    return result
