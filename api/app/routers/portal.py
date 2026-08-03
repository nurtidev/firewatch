"""Owner portal — external object owners (a proprietor / an ОСИ chairman).

Owners live outside the gov contour: they are linked to buildings via
owner_buildings and may see ONLY the approved prescriptions of those buildings,
and claim remediation (a note + photos) which an inspector/supervisor then
accepts or declines. Everything here is fail-closed — an owner with no linked
buildings sees nothing (empty, not an error), and a prescription outside the
owner's buildings 404s (existence is never leaked).
"""

import re
import uuid
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import audit, client_ip
from app.config import settings
from app.db import get_db
from app.routers.auth import current_user, require_roles
from app.routers.buildings import TYPE_LABELS

# Router-level auth is just "authenticated"; each endpoint layers its own role
# guard. Owner-only endpoints use OWNER_ONLY; the photo-serve route also lets
# internal roles in (an inspector views the photo while reviewing the claim).
OWNER_ONLY = require_roles("owner")
PHOTO_VIEWERS = require_roles("owner", "inspector", "supervisor", "leadership", "admin")

router = APIRouter(prefix="/portal", tags=["owner-portal"], dependencies=[Depends(current_user)])

# Owner evidence photos: PNG/JPEG/WebP, generated names only (owner_<32 hex>.<ext>)
# — the pattern blocks path traversal / reading arbitrary files, mirroring the
# visit-photo rule in routes.py but with an owner_ prefix so the two pools are
# distinct.
PHOTO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_EXT_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}
_OWNER_PHOTO_NAME = re.compile(r"^owner_[0-9a-f]{32}\.(png|jpg|webp)$")


class RemediationCreate(BaseModel):
    note: str = Field(..., min_length=1, max_length=2000)
    # Optional photographic proof of the fix, up to 5 owner-uploaded files.
    photos: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("note")
    @classmethod
    def _note_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("комментарий не может быть пустым")
        return v

    @field_validator("photos")
    @classmethod
    def _valid_photo_ids(cls, v: list[str]) -> list[str]:
        for photo_id in v:
            if not _OWNER_PHOTO_NAME.match(photo_id):
                raise ValueError(f"некорректный id фото: {photo_id}")
        return v


def _owner_building_ids(db: Session, username: str) -> list[int]:
    """Building ids linked to the owner (by username → users.id → owner_buildings).

    Returns [] when the owner is linked to nothing — callers treat that as an
    empty, valid result, never an error.
    """
    rows = db.execute(
        text(
            """
            SELECT ob.building_id
            FROM owner_buildings ob
            JOIN users u ON u.id = ob.user_id
            WHERE u.username = :u
            """
        ),
        {"u": username},
    ).scalars().all()
    return [int(b) for b in rows]


def _remediation_obj(row: dict) -> dict | None:
    """Shape a prescription's latest remediation for the portal, or None."""
    if row.get("rem_id") is None:
        return None
    return {
        "id": row["rem_id"],
        "note": row["rem_note"],
        "photos": row["rem_photos"],
        "status": row["rem_status"],
        "created_at": row["rem_created_at"].isoformat() if row["rem_created_at"] else None,
        "reviewed_by": row["rem_reviewed_by"],
        # Human-readable reviewer name (falls back to the login if the account
        # was since removed) — an owner shouldn't have to decode a username.
        "reviewed_by_name": row.get("rem_reviewed_by_name") or row["rem_reviewed_by"],
        "reviewed_at": row["rem_reviewed_at"].isoformat() if row["rem_reviewed_at"] else None,
        "review_note": row["rem_review_note"],
    }


@router.get("/summary")
def summary(
    db: Session = Depends(get_db),
    user: dict = Depends(OWNER_ONLY),
) -> dict:
    """Owner dashboard: their buildings (with latest risk score) and two counts."""
    bids = _owner_building_ids(db, user["username"])
    if not bids:
        return {"buildings": [], "counts": {"prescriptions_active": 0, "remediations_pending": 0}}

    buildings = db.execute(
        text(
            """
            SELECT b.id, b.address, b.district, b.building_type, b.floors,
                   r.score AS risk_score, r.explanation
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            WHERE b.id = ANY(:bids)
            ORDER BY b.id
            """
        ),
        {"bids": bids},
    ).mappings().all()

    # Active = approved prescriptions of the owner's buildings with no accepted
    # remediation yet.
    active = db.execute(
        text(
            """
            SELECT count(*)
            FROM prescriptions p
            JOIN operational_cards c ON c.id = p.card_id
            WHERE p.status = 'approved'
              AND c.building_id = ANY(:bids)
              AND NOT EXISTS (
                  SELECT 1 FROM remediations ra
                  WHERE ra.prescription_id = p.id AND ra.status = 'accepted'
              )
            """
        ),
        {"bids": bids},
    ).scalar()

    pending = db.execute(
        text(
            """
            SELECT count(*)
            FROM remediations rp
            JOIN prescriptions p ON p.id = rp.prescription_id
            JOIN operational_cards c ON c.id = p.card_id
            WHERE rp.status = 'pending'
              AND p.status = 'approved'
              AND c.building_id = ANY(:bids)
            """
        ),
        {"bids": bids},
    ).scalar()

    return {
        "buildings": [
            {
                "id": b["id"],
                "address": b["address"],
                "district": b["district"],
                "building_type": b["building_type"],
                "building_type_label": TYPE_LABELS.get(b["building_type"], b["building_type"]),
                "floors": b["floors"],
                "risk_score": b["risk_score"],
                # Top 1-2 SHAP factors only (feature label + signed p.p. contribution),
                # already sorted by |value| desc and translated by ml/app/features.py.
                # NOT the full /buildings/{id} explanation — that endpoint stays closed
                # to owner (district-scoped, fail-closed); this is a deliberately small,
                # safe subset so an ОСИ chair can answer "why is my building rated X"
                # without exposing the internal risk dashboard.
                "top_factors": [
                    {"feature": f["feature"], "value": f["value"]}
                    for f in (b["explanation"] or [])[:2]
                ],
            }
            for b in buildings
        ],
        "counts": {
            "prescriptions_active": int(active or 0),
            "remediations_pending": int(pending or 0),
        },
    }


@router.get("/prescriptions")
def list_prescriptions(
    db: Session = Depends(get_db),
    user: dict = Depends(OWNER_ONLY),
) -> list[dict]:
    """Approved prescriptions across the owner's buildings, each with its latest
    remediation claim. Sorted overdue → active → resolved, then by due date."""
    bids = _owner_building_ids(db, user["username"])
    if not bids:
        return []

    rows = db.execute(
        text(
            """
            SELECT p.id, p.card_id, c.building_id, b.address,
                   p.issue, p.recommendation, p.deadline_days, p.severity,
                   p.created_at,
                   lr.id AS rem_id, lr.note AS rem_note, lr.photos AS rem_photos,
                   lr.status AS rem_status, lr.created_at AS rem_created_at,
                   lr.reviewed_by AS rem_reviewed_by, lr.reviewed_at AS rem_reviewed_at,
                   lr.review_note AS rem_review_note, ru.name AS rem_reviewed_by_name,
                   EXISTS (
                       SELECT 1 FROM remediations ra
                       WHERE ra.prescription_id = p.id AND ra.status = 'accepted'
                   ) AS has_accepted
            FROM prescriptions p
            JOIN operational_cards c ON c.id = p.card_id
            LEFT JOIN buildings b ON b.id = c.building_id
            LEFT JOIN LATERAL (
                SELECT * FROM remediations r
                WHERE r.prescription_id = p.id
                ORDER BY r.created_at DESC, r.id DESC
                LIMIT 1
            ) lr ON TRUE
            LEFT JOIN users ru ON ru.username = lr.reviewed_by
            WHERE p.status = 'approved'
              AND c.building_id = ANY(:bids)
            """
        ),
        {"bids": bids},
    ).mappings().all()

    today = date.today()
    items = []
    for r in rows:
        created = r["created_at"]
        due_date = None
        if r["deadline_days"] is not None and created is not None:
            due_date = (created.date() + timedelta(days=int(r["deadline_days"])))
        resolved = bool(r["has_accepted"])
        overdue = bool(due_date and due_date < today and not resolved)
        items.append(
            {
                "id": r["id"],
                "card_id": r["card_id"],
                "building_id": r["building_id"],
                "address": r["address"],
                "issue": r["issue"],
                "recommendation": r["recommendation"],
                "deadline_days": r["deadline_days"],
                "severity": r["severity"],
                "created_at": created.isoformat() if created else None,
                "due_date": due_date.isoformat() if due_date else None,
                "overdue": overdue,
                "remediation": _remediation_obj(r),
                # sort helpers (stripped before returning)
                "_group": 0 if overdue else (2 if resolved else 1),
                "_due": due_date or date.max,
            }
        )

    items.sort(key=lambda x: (x["_group"], x["_due"]))
    for x in items:
        del x["_group"]
        del x["_due"]
    return items


@router.post("/prescriptions/{prescription_id}/remediation")
def submit_remediation(
    prescription_id: int,
    body: RemediationCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OWNER_ONLY),
) -> dict:
    """Owner claims a prescription has been remedied (note + optional photos)."""
    bids = _owner_building_ids(db, user["username"])
    # 404 (not 403) when the prescription isn't an approved one of the owner's
    # buildings — never leak that it exists elsewhere. An owner with no buildings
    # (empty bids) always lands here.
    presc = db.execute(
        text(
            """
            SELECT p.id
            FROM prescriptions p
            JOIN operational_cards c ON c.id = p.card_id
            WHERE p.id = :pid
              AND p.status = 'approved'
              AND c.building_id = ANY(:bids)
            """
        ),
        {"pid": prescription_id, "bids": bids or [-1]},
    ).scalar()
    if presc is None:
        raise HTTPException(404, "Предписание не найдено")

    # One live claim at a time: block a second pending claim, or any claim once
    # the fix is already accepted.
    existing = db.execute(
        text(
            "SELECT status FROM remediations "
            "WHERE prescription_id = :pid AND status IN ('pending', 'accepted') "
            "ORDER BY created_at DESC LIMIT 1"
        ),
        {"pid": prescription_id},
    ).scalar()
    if existing == "accepted":
        raise HTTPException(409, "Устранение уже подтверждено инспектором")
    if existing == "pending":
        raise HTTPException(409, "Заявка об устранении уже на рассмотрении")

    import json

    row = db.execute(
        text(
            """
            INSERT INTO remediations (prescription_id, submitted_by, note, photos)
            VALUES (:pid, :by, :note, CAST(:photos AS JSONB))
            RETURNING id, prescription_id, note, photos, status, created_at
            """
        ),
        {
            "pid": prescription_id,
            "by": user["username"],
            "note": body.note,
            "photos": json.dumps(body.photos, ensure_ascii=False),
        },
    ).mappings().first()
    db.commit()

    audit(
        action="remediation.submitted",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/portal/prescriptions/{prescription_id}/remediation",
        status_code=200,
        ip=client_ip(request),
        detail={"prescription_id": prescription_id, "remediation_id": row["id"]},
    )

    return {
        "id": row["id"],
        "prescription_id": row["prescription_id"],
        "note": row["note"],
        "photos": row["photos"],
        "status": row["status"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@router.post("/photo")
async def upload_photo(
    file: UploadFile,
    _user: dict = Depends(OWNER_ONLY),
) -> dict:
    """Upload one remediation-evidence photo; returns its id for the claim."""
    if file.content_type not in PHOTO_TYPES:
        raise HTTPException(415, "Поддерживаются PNG, JPEG, WebP")
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Файл больше 15 МБ")
    Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
    name = f"owner_{uuid.uuid4().hex}{PHOTO_TYPES[file.content_type]}"
    (Path(settings.uploads_dir) / name).write_bytes(data)
    return {"id": name}


@router.get("/photo/{photo_id}")
def get_photo(
    photo_id: str,
    _user: dict = Depends(PHOTO_VIEWERS),
) -> FileResponse:
    """Serve a remediation photo to the owner or an internal reviewer. The name
    pattern blocks path traversal and limits reads to generated owner files."""
    if not _OWNER_PHOTO_NAME.match(photo_id):
        raise HTTPException(404, "Файл не найден")
    path = Path(settings.uploads_dir) / photo_id
    if not path.exists():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, media_type=_EXT_MEDIA[path.suffix])
