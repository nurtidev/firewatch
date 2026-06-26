import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.extraction import extract_card

router = APIRouter(prefix="/cards", tags=["cards"])

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
async def upload_card(file: UploadFile, db: Session = Depends(get_db)) -> dict:
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
    return get_card(card_id, db)


@router.get("")
def list_cards(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT c.id, c.filename, c.created_at,
                   c.extracted->>'address' AS address,
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
def get_card(card_id: int, db: Session = Depends(get_db)) -> dict:
    card = db.execute(
        text("SELECT * FROM operational_cards WHERE id = :id"), {"id": card_id}
    ).mappings().first()
    if card is None:
        raise HTTPException(404, "Карточка не найдена")

    presc = db.execute(
        text(
            "SELECT issue, recommendation, deadline_days, severity "
            "FROM prescriptions WHERE card_id = :id ORDER BY id"
        ),
        {"id": card_id},
    ).mappings().all()

    return {
        "id": card["id"],
        "filename": card["filename"],
        "media_type": card["media_type"],
        "status": card["status"],
        "created_at": card["created_at"].isoformat(),
        "extracted": card["extracted"],
        "prescriptions": [dict(p) for p in presc],
    }


@router.get("/{card_id}/file")
def get_card_file(card_id: int, db: Session = Depends(get_db)) -> FileResponse:
    row = db.execute(
        text("SELECT file_path, media_type FROM operational_cards WHERE id = :id"),
        {"id": card_id},
    ).mappings().first()
    if row is None or not Path(row["file_path"]).exists():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(row["file_path"], media_type=row["media_type"])


def _json(obj: dict) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
