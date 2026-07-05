import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

class PrescriptionReview(BaseModel):
    status: str  # "approved" | "rejected"

from app.audit import audit, client_ip
from app.config import settings
from app.db import get_db
from app.extraction import extract_card
from app.routers.auth import current_user, require_roles

# Router-level auth: every card endpoint — including GET /{id}/file, which
# serves the original uploaded document with extracted ПДн (contacts, phones) —
# requires the operational roles. Leadership only reads dashboards; the officer
# who works with cards / signs off on an administrative act (a prescription) is
# the inspector/supervisor. Without this, files were downloadable unauthenticated
# by enumerating card_id. District-scoping is not yet possible: operational_cards
# has no building/district FK (see _card_detail); add that link to scope per-role.
router = APIRouter(
    prefix="/cards",
    tags=["cards"],
    dependencies=[Depends(require_roles("inspector", "supervisor", "admin"))],
)

ALLOWED = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}


def _save(data: bytes, media_type: str) -> tuple[str, Path]:
    Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ALLOWED[media_type]}"
    path = Path(settings.uploads_dir) / name
    path.write_bytes(data)
    return name, path


@router.post("")
async def upload_card(
    file: UploadFile,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict:
    if file.content_type not in ALLOWED:
        raise HTTPException(415, "Поддерживаются PDF, PNG, JPEG")
    data = await file.read()

    _, path = _save(data, file.content_type)

    try:
        extracted = extract_card(data, file.content_type)
    except Exception as err:  # noqa: BLE001 - surface extraction failure to client
        raise HTTPException(502, f"Ошибка извлечения: {err}") from err

    prescriptions = extracted.pop("prescriptions", []) or []

    card_id = db.execute(
        text(
            """
            INSERT INTO operational_cards
                (filename, media_type, file_path, status, extracted)
            VALUES (:fn, :mt, :fp, 'extracted', CAST(:ex AS JSONB))
            RETURNING id
            """
        ),
        {
            "fn": file.filename,
            "mt": file.content_type,
            "fp": str(path),
            "ex": _json(extracted),
        },
    ).scalar()

    for p in prescriptions:
        db.execute(
            text(
                """
                INSERT INTO prescriptions
                    (card_id, issue, recommendation, deadline_days, severity)
                VALUES (:cid, :issue, :rec, :dl, :sev)
                """
            ),
            {
                "cid": card_id,
                "issue": p.get("issue"),
                "rec": p.get("recommendation", ""),
                "dl": p.get("deadline_days"),
                "sev": p.get("severity"),
            },
        )
    db.commit()
    return _card_detail(card_id, db)


@router.get("")
def list_cards(
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT c.id, c.filename, c.created_at,
                   COALESCE(
                       c.extracted->'object'->>'name',
                       c.extracted->>'address',
                       c.extracted->'object'->>'address'
                   ) AS address,
                   count(p.id) AS prescriptions
            FROM operational_cards c
            LEFT JOIN prescriptions p ON p.card_id = c.id
            GROUP BY c.id
            ORDER BY c.created_at DESC
            """
        )
    ).mappings()
    return [dict(r) | {"created_at": r["created_at"].isoformat()} for r in rows]


@router.get("/{card_id}")
def get_card(
    card_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict:
    detail = _card_detail(card_id, db)
    # Operational cards hold ПДн (contacts) — reads must be auditable, not just
    # state changes (gov-contour requirement).
    audit(
        action="read.card",
        username=user.get("username"),
        role=user.get("role"),
        method="GET",
        path=f"/cards/{card_id}",
        status_code=200,
        ip=client_ip(request),
        detail={"card_id": card_id},
    )
    return detail


def _card_detail(card_id: int, db: Session) -> dict:
    card = db.execute(
        text("SELECT * FROM operational_cards WHERE id = :id"), {"id": card_id}
    ).mappings().first()
    if card is None:
        raise HTTPException(404, "Карточка не найдена")

    presc = db.execute(
        text(
            "SELECT id, issue, recommendation, deadline_days, severity, "
            "       status, reviewed_by, reviewed_at "
            "FROM prescriptions WHERE card_id = :id ORDER BY id"
        ),
        {"id": card_id},
    ).mappings().all()

    # Tell the client whether the original document is actually retrievable, so it
    # can render a placeholder instead of an iframe pointing at a 404.
    file_path = card["file_path"]
    has_file = bool(file_path) and Path(file_path).exists()

    return {
        "id": card["id"],
        "filename": card["filename"],
        "media_type": card["media_type"],
        "status": card["status"],
        "created_at": card["created_at"].isoformat(),
        "extracted": card["extracted"],
        "prescriptions": [
            dict(p)
            | {"reviewed_at": p["reviewed_at"].isoformat() if p["reviewed_at"] else None}
            for p in presc
        ],
        "has_file": has_file,
    }


@router.get("/{card_id}/file")
def get_card_file(
    card_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> FileResponse:
    row = db.execute(
        text("SELECT file_path, media_type FROM operational_cards WHERE id = :id"),
        {"id": card_id},
    ).mappings().first()
    # file_path is NULL for JSON-seeded cards, and the path may be missing if the
    # stored file was never persisted (e.g. uploaded before a volume was mounted).
    if row is None or not row["file_path"] or not Path(row["file_path"]).exists():
        raise HTTPException(404, "Файл не найден")
    audit(
        action="read.card_file",
        username=user.get("username"),
        role=user.get("role"),
        method="GET",
        path=f"/cards/{card_id}/file",
        status_code=200,
        ip=client_ip(request),
        detail={"card_id": card_id},
    )
    return FileResponse(row["file_path"], media_type=row["media_type"])


@router.delete("/{card_id}")
def delete_card(
    card_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict:
    row = db.execute(
        text("SELECT file_path FROM operational_cards WHERE id = :id"),
        {"id": card_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Карточка не найдена")

    # prescriptions has no ON DELETE CASCADE — remove children first, then the card.
    db.execute(text("DELETE FROM prescriptions WHERE card_id = :id"), {"id": card_id})
    db.execute(text("DELETE FROM operational_cards WHERE id = :id"), {"id": card_id})
    db.commit()

    # Best-effort cleanup of the stored original on the uploads volume.
    if row["file_path"]:
        Path(row["file_path"]).unlink(missing_ok=True)

    # Card holds ПДн (contacts) — deletion must be auditable.
    audit(
        action="delete.card",
        username=user.get("username"),
        role=user.get("role"),
        method="DELETE",
        path=f"/cards/{card_id}",
        status_code=200,
        ip=client_ip(request),
        detail={"card_id": card_id},
    )
    return {"ok": True, "deleted": card_id}


@router.post("/{card_id}/prescriptions/{prescription_id}/review")
def review_prescription(
    card_id: int,
    prescription_id: int,
    body: PrescriptionReview,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
) -> dict:
    """Confirm or reject an AI-generated prescription before it is acted on.

    A prescription is an administrative act — it must not leave 'pending' without
    a responsible officer's decision, which is recorded for audit.
    """
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "status должен быть 'approved' или 'rejected'")
    # Role is enforced router-wide (inspector/supervisor/admin) — leadership,
    # which never signs off an administrative act, is already excluded here.

    updated = db.execute(
        text(
            """
            UPDATE prescriptions
               SET status = :st, reviewed_by = :by, reviewed_at = now()
             WHERE id = :pid AND card_id = :cid
            RETURNING id
            """
        ),
        {"st": body.status, "by": user.get("username"), "pid": prescription_id, "cid": card_id},
    ).scalar()
    if updated is None:
        raise HTTPException(404, "Предписание не найдено")
    db.commit()

    audit(
        action="review.prescription",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/cards/{card_id}/prescriptions/{prescription_id}/review",
        status_code=200,
        ip=client_ip(request),
        detail={"card_id": card_id, "prescription_id": prescription_id, "status": body.status},
    )
    return _card_detail(card_id, db)


def _json(obj: dict) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
