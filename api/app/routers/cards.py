import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session


class PrescriptionReview(BaseModel):
    status: str  # "approved" | "rejected"


class RemediationReview(BaseModel):
    status: str  # "accepted" | "declined"
    note: str | None = Field(None, max_length=2000)

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in ("accepted", "declined"):
            raise ValueError("status должен быть 'accepted' или 'declined'")
        return v

from app.access import has_citywide_data_access
from app.audit import audit, client_ip
from app.config import settings
from app.db import get_db
from app.extraction import extract_card, mask_contacts_field
from app.routers.auth import current_user, require_roles

# Router-level auth is just "authenticated"; each endpoint layers its own role
# guard. Reads (list, detail, and GET /{id}/file — which serves the original
# document with extracted ПДн) also let the боевой roles in: the караул needs
# the ПТП on the way to a callout. Writes and the sign-off actions (upload,
# delete, prescription/remediation review) stay with the officers who issue
# administrative acts (inspector/supervisor/admin); leadership only reads
# dashboards. Without any guard, files were downloadable unauthenticated by
# enumerating card_id.
#
# Поверх ролей работает район-скоупинг (`_card_scope_sql`): inspector/supervisor
# видят только карточки своего района. Раньше здесь стояла пометка «скоупинг
# невозможен, нет связи со зданием» — она устарела: `operational_cards.building_id`
# существует и заполняется сидами, а для загруженных вручную PDF без привязки
# район фиксируется в `operational_cards.district` при загрузке
# (миграция 0013_scoping_links).
CARD_READ = require_roles(
    "inspector", "supervisor", "admin", "dispatcher", "responder"
)
CARD_WRITE = require_roles("inspector", "supervisor", "admin")


def _card_scope_sql(user: dict, params: dict) -> str:
    """SQL-условие видимости оперкарточки для роли (алиасы `c` и `b`).

    Район карточки — район привязанного здания, а для загруженного PDF без
    привязки — район, зафиксированный при загрузке. Общегородские роли
    (dispatcher/responder — боевой модуль, им нужен ПТП любого объекта города по
    пути на вызов) и leadership/admin видят всё. Scoped-роль без района не видит
    ничего (fail closed), карточка без района — тоже: ПТП содержит ПДн и планы
    эвакуации, поэтому «неизвестно чьё» не показывается никому, кроме
    общегородских ролей.
    """
    if has_citywide_data_access(user):
        return "TRUE"
    district = user.get("district")
    if district is None:
        return "FALSE"
    params["scope_district"] = district
    return "COALESCE(b.district, c.district) IS NOT DISTINCT FROM :scope_district"


def _assert_card_in_scope(card_id: int, db: Session, user: dict) -> None:
    """404, если карточка вне района вызывающего.

    Именно 404, а не 403: существование карточки соседнего района — уже
    информация, а для клиента случай неотличим от удалённой карточки.
    """
    params: dict = {"id": card_id}
    scope = _card_scope_sql(user, params)
    found = db.execute(
        text(
            "SELECT 1 FROM operational_cards c "
            "LEFT JOIN buildings b ON b.id = c.building_id "
            f"WHERE c.id = :id AND {scope}"
        ),
        params,
    ).scalar()
    if found is None:
        raise HTTPException(404, "Карточка не найдена")


router = APIRouter(
    prefix="/cards",
    tags=["cards"],
    dependencies=[Depends(current_user)],
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
    user: dict = Depends(CARD_WRITE),
) -> dict:
    if file.content_type not in ALLOWED:
        raise HTTPException(415, "Поддерживаются PDF, PNG, JPEG")
    data = await file.read()
    # Real ДЧС scans run 19–26 МБ; extraction.py re-compresses oversized PDFs, but
    # anything past this is almost certainly not a scanned ПТП — reject upfront
    # rather than tying up the event loop on a doomed extraction.
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, "Файл больше 50 МБ")

    _, path = _save(data, file.content_type)

    try:
        # extract_card is a blocking PyMuPDF/HTTP call — offload it so it doesn't
        # stall the event loop for other requests while it runs.
        extracted = await asyncio.to_thread(extract_card, data, file.content_type)
    except ValueError as err:  # PDF still too large after best-effort compression
        raise HTTPException(413, str(err)) from err
    except Exception as err:  # noqa: BLE001 - surface extraction failure to client
        raise HTTPException(502, f"Ошибка извлечения: {err}") from err

    prescriptions = extracted.pop("prescriptions", []) or []

    card_id = db.execute(
        text(
            """
            INSERT INTO operational_cards
                (filename, media_type, file_path, status, extracted, district)
            VALUES (:fn, :mt, :fp, 'extracted', CAST(:ex AS JSONB), :district)
            RETURNING id
            """
        ),
        {
            "fn": file.filename,
            "mt": file.content_type,
            "fp": str(path),
            "ex": _json(extracted),
            # Загруженный PDF не привязан к зданию — район фиксируем по
            # загрузившему, иначе карточку нельзя отнести ни к одному району.
            "district": user.get("district"),
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
    return _card_detail(card_id, db, user)


@router.get("")
def list_cards(
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_READ),
) -> list[dict]:
    params: dict = {}
    scope = _card_scope_sql(user, params)
    rows = db.execute(
        text(
            f"""
            SELECT c.id, c.filename, c.created_at,
                   COALESCE(
                       c.extracted->'object'->>'name',
                       c.extracted->>'address',
                       c.extracted->'object'->>'address'
                   ) AS address,
                   count(p.id) AS prescriptions
            FROM operational_cards c
            LEFT JOIN buildings b ON b.id = c.building_id
            LEFT JOIN prescriptions p ON p.card_id = c.id
            WHERE {scope}
            GROUP BY c.id
            ORDER BY c.created_at DESC
            """
        ),
        params,
    ).mappings()
    return [dict(r) | {"created_at": r["created_at"].isoformat()} for r in rows]


@router.get("/{card_id}")
def get_card(
    card_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_READ),
) -> dict:
    detail = _card_detail(card_id, db, user)
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


def _prescription_row(p: dict) -> dict:
    """Shape a prescription row (with its latest remediation, if any) for the API."""
    last_remediation = None
    if p["rem_id"] is not None:
        last_remediation = {
            "id": p["rem_id"],
            "note": p["rem_note"],
            "photos": p["rem_photos"],
            "status": p["rem_status"],
            "created_at": p["rem_created_at"].isoformat() if p["rem_created_at"] else None,
            "reviewed_by": p["rem_reviewed_by"],
            "review_note": p["rem_review_note"],
        }
    return {
        "id": p["id"],
        "issue": p["issue"],
        "recommendation": p["recommendation"],
        "deadline_days": p["deadline_days"],
        "severity": p["severity"],
        "status": p["status"],
        "reviewed_by": p["reviewed_by"],
        "reviewed_at": p["reviewed_at"].isoformat() if p["reviewed_at"] else None,
        "last_remediation": last_remediation,
    }


def _card_detail(card_id: int, db: Session, user: dict) -> dict:
    params: dict = {"id": card_id}
    scope = _card_scope_sql(user, params)
    card = db.execute(
        text(
            "SELECT c.* FROM operational_cards c "
            "LEFT JOIN buildings b ON b.id = c.building_id "
            f"WHERE c.id = :id AND {scope}"
        ),
        params,
    ).mappings().first()
    if card is None:
        raise HTTPException(404, "Карточка не найдена")

    presc = db.execute(
        text(
            """
            SELECT p.id, p.issue, p.recommendation, p.deadline_days, p.severity,
                   p.status, p.reviewed_by, p.reviewed_at,
                   lr.id AS rem_id, lr.note AS rem_note, lr.photos AS rem_photos,
                   lr.status AS rem_status, lr.created_at AS rem_created_at,
                   lr.reviewed_by AS rem_reviewed_by, lr.review_note AS rem_review_note
            FROM prescriptions p
            LEFT JOIN LATERAL (
                SELECT * FROM remediations r
                WHERE r.prescription_id = p.id
                ORDER BY r.created_at DESC, r.id DESC
                LIMIT 1
            ) lr ON TRUE
            WHERE p.card_id = :id
            ORDER BY p.id
            """
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
        "prescriptions": [_prescription_row(p) for p in presc],
        "has_file": has_file,
        # Согласование и авторство правки: караул должен видеть, утверждён ли
        # документ, по которому он работает, и когда его меняли в последний раз.
        "review_status": card["review_status"],
        "updated_by": card["updated_by"],
        "updated_at": card["updated_at"].isoformat() if card["updated_at"] else None,
        "approved_by": card["approved_by"],
        "approved_at": card["approved_at"].isoformat() if card["approved_at"] else None,
        "editable_fields": list(EDITABLE_CARD_FIELDS),
    }


@router.get("/{card_id}/file")
def get_card_file(
    card_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_READ),
) -> FileResponse:
    params: dict = {"id": card_id}
    scope = _card_scope_sql(user, params)
    row = db.execute(
        text(
            "SELECT c.file_path, c.media_type FROM operational_cards c "
            "LEFT JOIN buildings b ON b.id = c.building_id "
            f"WHERE c.id = :id AND {scope}"
        ),
        params,
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
    user: dict = Depends(CARD_WRITE),
) -> dict:
    params: dict = {"id": card_id}
    scope = _card_scope_sql(user, params)
    row = db.execute(
        text(
            "SELECT c.file_path FROM operational_cards c "
            "LEFT JOIN buildings b ON b.id = c.building_id "
            f"WHERE c.id = :id AND {scope}"
        ),
        params,
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


# --- редактор оперкарточки: правка, история, согласование --------------------
#
# До этого карточка была снимком распознавания: исправить опечатку модели или
# внести изменение по объекту (сменили насосную, заложили проезд) можно было
# только перезагрузкой документа — с потерей предписаний.
#
# Три правила, определяющие устройство редактора:
#   1. Снимок пишется ДО изменения. Откат = взять снимок ревизии целиком, а не
#      проигрывать историю с начала.
#   2. Маскирование ПДн действует и на ручной ввод. Иначе редактор становится
#      дырой в обход `_mask_contacts`: телефоны ответственных попали бы в базу
#      в открытом виде через форму.
#   3. Правка утверждённой карточки снимает утверждение. Карточка — документ,
#      по которому караул работает на пожаре; изменение не должно попадать в
#      боевой пакет молча.

# Поля, доступные для ручной правки. Набор совпадает с EXTRACT_TOOL, кроме
# `prescriptions` (у них свой жизненный цикл с проверкой исполнения) и
# вложенных структур `object`/`force_calc` структурных карточек: их правка —
# это правка расчёта, а не текста, и делается пересчётом через /forces.
EDITABLE_CARD_FIELDS = (
    "object_name",
    "address",
    "object_type",
    "category",
    "fire_resistance",
    "floors",
    "year_built",
    "construction",
    "fire_systems",
    "water_source",
    "nearest_station",
    "distance_to_station",
    "arrival_time",
    "fire_rank",
    "contacts",
    "staff_day",
    "staff_night",
    "evacuation",
    "notes",
)

CARD_REVIEW_STATUSES = ("draft", "on_review", "approved")
# Утверждает карточку начальник отдела — то же разделение, что у предписаний:
# инспектор готовит, руководитель подписывает.
CARD_APPROVE = require_roles("supervisor", "admin")


class CardPatch(BaseModel):
    """Частичная правка полей карточки. Передаются только изменяемые поля."""

    fields: dict[str, str | int | None] = Field(default_factory=dict)
    note: str | None = Field(None, max_length=500)

    @field_validator("fields")
    @classmethod
    def _known_fields(cls, v: dict) -> dict:
        unknown = set(v) - set(EDITABLE_CARD_FIELDS)
        if unknown:
            raise ValueError(f"недопустимые поля: {sorted(unknown)}")
        if not v:
            raise ValueError("укажите хотя бы одно поле")
        for key, value in v.items():
            if isinstance(value, str) and len(value) > 4000:
                raise ValueError(f"{key}: слишком длинное значение")
        return v


class CardReview(BaseModel):
    action: str
    note: str | None = Field(None, max_length=500)

    @field_validator("action")
    @classmethod
    def _known_action(cls, v: str) -> str:
        if v not in ("submit", "approve", "reject"):
            raise ValueError("action: submit | approve | reject")
        return v


def _fetch_card_for_edit(card_id: int, db: Session, user: dict) -> dict:
    params: dict = {"id": card_id}
    scope = _card_scope_sql(user, params)
    row = db.execute(
        text(
            "SELECT c.id, c.extracted, c.review_status FROM operational_cards c "
            "LEFT JOIN buildings b ON b.id = c.building_id "
            f"WHERE c.id = :id AND {scope}"
        ),
        params,
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Карточка не найдена")
    return dict(row)


def _write_revision(
    db: Session, card_id: int, before: dict | None, changed: list[str], author: str,
    note: str | None,
) -> None:
    """Снимок состояния ДО изменения."""
    db.execute(
        text(
            "INSERT INTO card_revisions (card_id, extracted, changed_fields, note, author) "
            "VALUES (:cid, CAST(:extracted AS jsonb), CAST(:changed AS jsonb), :note, :author)"
        ),
        {
            "cid": card_id,
            "extracted": _json(before) if before is not None else None,
            "changed": _json(changed),
            "note": note,
            "author": author,
        },
    )


@router.patch("/{card_id}")
def patch_card(
    card_id: int,
    body: CardPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_WRITE),
) -> dict:
    """Отредактировать поля карточки, записав предыдущее состояние в историю."""
    card = _fetch_card_for_edit(card_id, db, user)
    before = card["extracted"] if isinstance(card["extracted"], dict) else {}

    # В структурной карточке те же ключи хранят не текст, а структуру: contacts
    # — это массив {роль, имя, телефон}, а не строка. Плоская форма записала бы
    # туда строку и разрушила документ: экран структурного ПТП ждёт массив и
    # падает на нём. Текстом правится только то, что и так текст.
    structured = sorted(
        k for k in body.fields if isinstance(before.get(k), (dict, list))
    )
    if structured:
        raise HTTPException(
            422,
            "Эти поля хранятся структурой и не правятся текстом: "
            + ", ".join(structured),
        )

    updates = dict(body.fields)
    # Маскирование ПДн действует и здесь — редактор не должен становиться
    # обходом `_mask_contacts` для телефонов ответственных лиц.
    if settings.mask_pii and "contacts" in updates and updates["contacts"]:
        updates["contacts"] = mask_contacts_field(str(updates["contacts"]))

    changed = [k for k, v in updates.items() if before.get(k) != v]
    if not changed:
        return _card_detail(card_id, db, user)

    after = {**before, **updates}
    _write_revision(db, card_id, before, changed, user.get("username", ""), body.note)

    # Правка утверждённой карточки снимает утверждение: караул должен видеть,
    # что документ изменён и ещё не подписан.
    next_status = "draft" if card["review_status"] == "approved" else card["review_status"]
    db.execute(
        text(
            "UPDATE operational_cards SET extracted = CAST(:extracted AS jsonb), "
            "updated_by = :by, updated_at = now(), review_status = :status, "
            "approved_by = NULL, approved_at = NULL WHERE id = :id"
        ),
        {
            "extracted": _json(after),
            "by": user.get("username"),
            "status": next_status,
            "id": card_id,
        },
    )
    db.commit()

    audit(
        action="card.edited",
        username=user.get("username"),
        role=user.get("role"),
        method="PATCH",
        path=f"/cards/{card_id}",
        status_code=200,
        ip=client_ip(request),
        # Значения полей в журнал не пишем: карточка содержит ПДн, а журнал
        # читают роли, которым сама карточка может быть не видна по району.
        detail={"card_id": card_id, "changed_fields": changed},
    )
    return _card_detail(card_id, db, user)


@router.get("/{card_id}/revisions")
def list_revisions(
    card_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_READ),
) -> list[dict]:
    """История правок карточки, новые сверху."""
    _assert_card_in_scope(card_id, db, user)
    rows = db.execute(
        text(
            "SELECT id, changed_fields, note, author, created_at FROM card_revisions "
            "WHERE card_id = :id ORDER BY created_at DESC, id DESC LIMIT 100"
        ),
        {"id": card_id},
    ).mappings().all()
    return [
        {
            "id": r["id"],
            "changed_fields": r["changed_fields"],
            "note": r["note"],
            "author": r["author"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@router.post("/{card_id}/revisions/{revision_id}/restore")
def restore_revision(
    card_id: int,
    revision_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_WRITE),
) -> dict:
    """Откатить карточку к состоянию ревизии.

    Откат сам записывается в историю: иначе состояние, к которому откатились,
    исчезло бы из журнала, и восстановить его после ошибочного отката было бы
    нечем.
    """
    card = _fetch_card_for_edit(card_id, db, user)
    rev = db.execute(
        text(
            "SELECT id, extracted FROM card_revisions WHERE id = :rid AND card_id = :cid"
        ),
        {"rid": revision_id, "cid": card_id},
    ).mappings().first()
    if rev is None:
        raise HTTPException(404, "Ревизия не найдена")

    before = card["extracted"] if isinstance(card["extracted"], dict) else {}
    target = rev["extracted"] if isinstance(rev["extracted"], dict) else {}
    changed = sorted(
        {k for k in set(before) | set(target) if before.get(k) != target.get(k)}
    )

    _write_revision(
        db, card_id, before, changed, user.get("username", ""),
        f"Откат к ревизии #{revision_id}",
    )
    db.execute(
        text(
            "UPDATE operational_cards SET extracted = CAST(:extracted AS jsonb), "
            "updated_by = :by, updated_at = now(), review_status = 'draft', "
            "approved_by = NULL, approved_at = NULL WHERE id = :id"
        ),
        {"extracted": _json(target), "by": user.get("username"), "id": card_id},
    )
    db.commit()

    audit(
        action="card.restored",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/cards/{card_id}/revisions/{revision_id}/restore",
        status_code=200,
        ip=client_ip(request),
        detail={"card_id": card_id, "revision_id": revision_id, "changed_fields": changed},
    )
    return _card_detail(card_id, db, user)


@router.post("/{card_id}/review")
def review_card(
    card_id: int,
    body: CardReview,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_WRITE),
) -> dict:
    """Движение карточки по согласованию: submit → approve / reject.

    `submit` доступен тому, кто правит (инспектор); `approve` и `reject` —
    только начальнику отдела: подписывает документ руководитель, а не автор
    правки.
    """
    card = _fetch_card_for_edit(card_id, db, user)
    status = card["review_status"]

    if body.action == "submit":
        if status == "on_review":
            raise HTTPException(409, "Карточка уже на согласовании")
        new_status, approver = "on_review", None
    else:
        if user.get("role") not in ("supervisor", "admin"):
            raise HTTPException(403, "Утверждение доступно начальнику отдела")
        if status != "on_review":
            raise HTTPException(409, "Карточка не отправлена на согласование")
        new_status = "approved" if body.action == "approve" else "draft"
        approver = user.get("username") if body.action == "approve" else None

    db.execute(
        text(
            "UPDATE operational_cards SET review_status = :status, "
            "approved_by = :approver, "
            "approved_at = CASE WHEN :status = 'approved' THEN now() ELSE NULL END "
            "WHERE id = :id"
        ),
        {"status": new_status, "approver": approver, "id": card_id},
    )
    db.commit()

    audit(
        action=f"card.review.{body.action}",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/cards/{card_id}/review",
        status_code=200,
        ip=client_ip(request),
        detail={"card_id": card_id, "from": status, "to": new_status, "note": body.note},
    )
    return _card_detail(card_id, db, user)


@router.post("/{card_id}/prescriptions/{prescription_id}/review")
def review_prescription(
    card_id: int,
    prescription_id: int,
    body: PrescriptionReview,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_WRITE),
) -> dict:
    """Confirm or reject an AI-generated prescription before it is acted on.

    A prescription is an administrative act — it must not leave 'pending' without
    a responsible officer's decision, which is recorded for audit.
    """
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "status должен быть 'approved' или 'rejected'")
    # CARD_WRITE (inspector/supervisor/admin) — leadership, which never signs off
    # an administrative act, and the боевой roles are already excluded here.
    # Подписать акт можно только по объекту своего района.
    _assert_card_in_scope(card_id, db, user)

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
    return _card_detail(card_id, db, user)


@router.post(
    "/{card_id}/prescriptions/{prescription_id}/remediations/{remediation_id}/review"
)
def review_remediation(
    card_id: int,
    prescription_id: int,
    remediation_id: int,
    body: RemediationReview,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(CARD_WRITE),
) -> dict:
    """Accept or decline an owner's remediation claim.

    Roles (inspector/supervisor/admin, via CARD_WRITE) are enforced. The full
    card→prescription→remediation chain must exist (404 otherwise) and the claim
    must still be 'pending' (409 otherwise) — a decided claim isn't re-decided.
    Карточка при этом должна быть в районе вызывающего.
    """
    _assert_card_in_scope(card_id, db, user)
    remediation = db.execute(
        text(
            """
            SELECT r.id, r.status
            FROM remediations r
            JOIN prescriptions p ON p.id = r.prescription_id
            WHERE r.id = :rid AND p.id = :pid AND p.card_id = :cid
            """
        ),
        {"rid": remediation_id, "pid": prescription_id, "cid": card_id},
    ).mappings().first()
    if remediation is None:
        raise HTTPException(404, "Заявка об устранении не найдена")
    if remediation["status"] != "pending":
        raise HTTPException(409, "Заявка уже рассмотрена")

    db.execute(
        text(
            """
            UPDATE remediations
               SET status = :st, reviewed_by = :by, reviewed_at = now(),
                   review_note = :note
             WHERE id = :rid
            """
        ),
        {"st": body.status, "by": user.get("username"), "note": body.note, "rid": remediation_id},
    )
    db.commit()

    audit(
        action="remediation.review",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=(
            f"/cards/{card_id}/prescriptions/{prescription_id}"
            f"/remediations/{remediation_id}/review"
        ),
        status_code=200,
        ip=client_ip(request),
        detail={"remediation_id": remediation_id, "status": body.status},
    )
    return _card_detail(card_id, db, user)


def _json(obj: dict) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
