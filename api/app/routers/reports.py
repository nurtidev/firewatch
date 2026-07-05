import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import enforce_building_scope, has_citywide_data_access
from app.audit import audit, client_ip
from app.db import get_db
from app.routers.auth import current_user, require_roles
from app.routers.routes import _PHOTO_NAME

# Field-report categories / statuses — the frontend uses the same keys.
CATEGORIES = {"blocked_access", "parking_barrier", "hydrant_defect", "blocked_exit", "other"}
STATUSES = {"open", "in_progress", "resolved", "dismissed"}
# Statuses a supervisor can move a report into via POST /{id}/status. "open" is
# the initial state only — a report is never manually reopened here.
TRANSITION_STATUSES = {"in_progress", "resolved", "dismissed"}

# Recording an obstacle is a field action (same crew as inspection visits/cards);
# leadership only reads dashboards. Dispatcher/responder also file reports — a
# донесение со слов караула / с места выезда — and see the whole city (below).
FIELD_ROLES = require_roles("inspector", "supervisor", "admin", "dispatcher", "responder")
# Triaging the queue is a supervisory decision.
REVIEW_ROLES = require_roles("supervisor", "admin")

# Router-level auth: any authenticated role can read the queue (GET below is not
# further narrowed); mutating endpoints layer their own role guard.
router = APIRouter(prefix="/reports", tags=["field-reports"], dependencies=[Depends(current_user)])


class ReportCreate(BaseModel):
    category: str
    description: str | None = Field(None, max_length=2000)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    building_id: int | None = None
    # A report without photographic evidence has no operational value — at
    # least one is required, mirroring the evidence rule for visit violations.
    photos: list[str] = Field(..., min_length=1)

    @field_validator("category")
    @classmethod
    def _known_category(cls, v: str) -> str:
        if v not in CATEGORIES:
            raise ValueError(f"неизвестная категория: {v}")
        return v

    @field_validator("photos")
    @classmethod
    def _valid_photo_ids(cls, v: list[str]) -> list[str]:
        # Same generated-name pattern as GET /routes/visit/photo/{id} — rejects
        # anything that isn't one of our own uploaded evidence files (no
        # path traversal / arbitrary filenames).
        for photo_id in v:
            if not _PHOTO_NAME.match(photo_id):
                raise ValueError(f"некорректный id фото: {photo_id}")
        return v


class ReportStatusUpdate(BaseModel):
    status: str
    resolution_note: str | None = Field(None, max_length=2000)

    @field_validator("status")
    @classmethod
    def _known_transition(cls, v: str) -> str:
        if v not in TRANSITION_STATUSES:
            raise ValueError(f"неизвестный статус: {v}")
        return v


@router.post("")
def create_report(
    body: ReportCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(FIELD_ROLES),
) -> dict:
    """Record an obstacle to firefighting access found outside a planned visit."""
    if body.building_id is not None:
        building = db.execute(
            text("SELECT id, district FROM buildings WHERE id = :id"),
            {"id": body.building_id},
        ).mappings().first()
        if building is None:
            raise HTTPException(404, "Здание не найдено")
        # Fail closed: a scoped role reporting against a building outside its
        # district gets 404 (not 403), same as building_detail — existence in
        # another district isn't leaked. Citywide roles (incl. dispatcher/
        # responder) may reference any object in the city.
        if not has_citywide_data_access(user) and building["district"] != user.get("district"):
            raise HTTPException(404, "Здание не найдено")
        district = building["district"]
    else:
        # No linked building: fall back to the reporter's own district. Full
        # access roles may have none (NULL) — that's expected, not an error.
        district = user.get("district")

    row = db.execute(
        text(
            """
            INSERT INTO field_reports
                (category, description, geom, building_id, district, photos,
                 created_by, created_role)
            VALUES
                (:category, :description,
                 ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                 :building_id, :district, CAST(:photos AS JSONB),
                 :created_by, :created_role)
            RETURNING id, category, description, status, building_id, district,
                      photos, created_by, created_role, created_at
            """
        ),
        {
            "category": body.category,
            "description": body.description,
            "lng": body.lng,
            "lat": body.lat,
            "building_id": body.building_id,
            "district": district,
            "photos": json.dumps(body.photos, ensure_ascii=False),
            "created_by": user.get("username"),
            "created_role": user.get("role"),
        },
    ).mappings().first()
    db.commit()

    audit(
        action="report.created",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path="/reports",
        status_code=200,
        ip=client_ip(request),
        detail={"report_id": row["id"], "category": row["category"]},
    )

    return {
        "id": row["id"],
        "category": row["category"],
        "description": row["description"],
        "status": row["status"],
        "lat": body.lat,
        "lng": body.lng,
        "building_id": row["building_id"],
        "district": row["district"],
        "photos": row["photos"],
        "created_by": row["created_by"],
        "created_role": row["created_role"],
        "created_at": row["created_at"].isoformat(),
    }


def _list_filters(
    status: str | None, category: str | None, user: dict, alias: str
) -> tuple[list[str], dict]:
    if status is not None and status not in STATUSES:
        raise HTTPException(422, "Неизвестный статус")
    if category is not None and category not in CATEGORIES:
        raise HTTPException(422, "Неизвестная категория")

    clauses: list[str] = []
    params: dict = {}
    if status:
        clauses.append(f"{alias}.status = :status")
        params["status"] = status
    if category:
        clauses.append(f"{alias}.category = :category")
        params["category"] = category
    # Server-side district confinement for scoped roles (same helper used for
    # buildings — field_reports carries its own district column).
    enforce_building_scope(clauses, params, user, alias=alias)
    return clauses, params


@router.get("")
def list_reports(
    status: str | None = None,
    category: str | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[dict]:
    clauses, params = _list_filters(status, category, user, "fr")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    rows = db.execute(
        text(
            f"""
            SELECT
                fr.id, fr.category, fr.description, fr.status,
                ST_Y(fr.geom) AS lat, ST_X(fr.geom) AS lng,
                fr.building_id, b.address AS building_address, fr.district,
                fr.photos, fr.created_by, fr.created_at,
                fr.resolved_by, fr.resolved_at, fr.resolution_note
            FROM field_reports fr
            LEFT JOIN buildings b ON b.id = fr.building_id
            {where}
            ORDER BY (fr.status = 'open') DESC, fr.created_at DESC
            """
        ),
        params,
    ).mappings().all()

    return [
        {
            "id": r["id"],
            "category": r["category"],
            "description": r["description"],
            "status": r["status"],
            "lat": r["lat"],
            "lng": r["lng"],
            "building_id": r["building_id"],
            "address": r["building_address"],
            "district": r["district"],
            "photos": r["photos"],
            "created_by": r["created_by"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "resolved_by": r["resolved_by"],
            "resolved_at": r["resolved_at"].isoformat() if r["resolved_at"] else None,
            "resolution_note": r["resolution_note"],
        }
        for r in rows
    ]


@router.get("/geojson")
def reports_geojson(
    status: str | None = None,
    category: str | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict:
    """Point layer of field reports for the map (id/category/status only)."""
    clauses, params = _list_filters(status, category, user, "fr")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    rows = db.execute(
        text(
            f"""
            SELECT fr.id, fr.category, fr.status, ST_AsGeoJSON(fr.geom) AS geometry
            FROM field_reports fr
            {where}
            """
        ),
        params,
    ).mappings().all()

    features = [
        {
            "type": "Feature",
            "geometry": json.loads(r["geometry"]),
            "properties": {"id": r["id"], "category": r["category"], "status": r["status"]},
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.post("/{report_id}/status")
def update_report_status(
    report_id: int,
    body: ReportStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(REVIEW_ROLES),
) -> dict:
    """Triage a report: move it into in_progress / resolved / dismissed.

    Scoped supervisors can only act on reports in their own district — a report
    outside it 404s (fail closed), the same as buildings/cards scoping.
    """
    clauses = ["field_reports.id = :id"]
    params: dict = {"id": report_id}
    enforce_building_scope(clauses, params, user, alias="field_reports")
    where = " AND ".join(clauses)

    resolving = body.status in ("resolved", "dismissed")
    updated = db.execute(
        text(
            f"""
            UPDATE field_reports
               SET status = :status,
                   resolved_by = CASE WHEN :resolving THEN :resolved_by ELSE NULL END,
                   resolved_at = CASE WHEN :resolving THEN now() ELSE NULL END,
                   resolution_note = CASE WHEN :resolving THEN :resolution_note ELSE NULL END
             WHERE {where}
            RETURNING id, category, status, resolved_by, resolved_at, resolution_note
            """
        ),
        {
            **params,
            "status": body.status,
            "resolving": resolving,
            "resolved_by": user.get("username"),
            "resolution_note": body.resolution_note,
        },
    ).mappings().first()
    if updated is None:
        raise HTTPException(404, "Донесение не найдено")
    db.commit()

    audit(
        action="report.status",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/reports/{report_id}/status",
        status_code=200,
        ip=client_ip(request),
        detail={"id": report_id, "status": body.status},
    )

    return {
        "id": updated["id"],
        "category": updated["category"],
        "status": updated["status"],
        "resolved_by": updated["resolved_by"],
        "resolved_at": updated["resolved_at"].isoformat() if updated["resolved_at"] else None,
        "resolution_note": updated["resolution_note"],
    }
