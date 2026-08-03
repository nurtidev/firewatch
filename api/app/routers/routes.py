import re
import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import (
    enforce_building_scope,
    has_citywide_data_access,
    has_full_access,
    linked_inspector,
    resolve_inspector,
)
from app.config import settings
from app.db import get_db
from app.routers.auth import current_user, require_roles
from app.routers.buildings import TYPE_LABELS

# Roles that plan and carry out inspections. Leadership only reads dashboards.
FIELD_ROLES = require_roles("inspector", "supervisor", "admin")
# Live execution overview is a supervisory/leadership read, not a field action.
OVERSIGHT_ROLES = require_roles("supervisor", "leadership", "admin")

# Router-level auth requires an authenticated user; per-endpoint guards below
# narrow each route to its allowed roles (including GET /routes/visit/photo/{id},
# whose evidence is internal-only now that external owners exist).
router = APIRouter(tags=["inspections"], dependencies=[Depends(current_user)])

# Inspection-visit evidence is internal-only: external owners must never see the
# proof photos of an inspection. Dispatcher/responder are internal боевой roles —
# they view photos of field reports (which live in the visit_* pool) about
# blocked access BEFORE arriving on scene.
PHOTO_VIEW_ROLES = require_roles(
    "inspector", "supervisor", "leadership", "admin", "dispatcher", "responder"
)
# Фото-пул общий для визитов и донесений: dispatcher/responder грузят
# доказательства донесений сюда же, поэтому upload разрешён шире FIELD_ROLES.
PHOTO_UPLOAD_ROLES = require_roles(
    "inspector", "supervisor", "admin", "dispatcher", "responder"
)

# Evidence photos accepted for an inspection visit.
PHOTO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_EXT_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}
# Generated names only: visit_<32 hex>.<ext> — guards the serve route against
# path traversal / reading arbitrary files from the uploads dir.
_PHOTO_NAME = re.compile(r"^visit_[0-9a-f]{32}\.(png|jpg|webp)$")

# Working-day slots (lunch 12:30–14:00 skipped), up to 6 stops.
SLOTS = ["08:30", "10:00", "11:30", "14:00", "15:30", "17:00"]

# On-site checklist, grouped by topic and tied to РК fire-safety norms. `code` is
# the violation code an inspector cites if the item fails — it makes a recorded
# "violation" legally attributable to a specific requirement (Правила пожарной
# безопасности РК, ПП РК №1102; Техрегламент ПП РК №1077), instead of a bare flag.
# `ref` names the normative area; precise article numbers are confirmed against
# the current redaction at protocol time (kept area-level here, not fabricated).
CHECKLIST = [
    # — Эвакуация —
    {"key": "exit_free", "label": "Эвакуационные выходы свободны, открываются изнутри без ключа", "code": "ЭВ-01", "ref": "ППБ РК · эвакуация", "group": "Эвакуация"},
    {"key": "exit_count", "label": "Количество и ширина эвакуационных выходов соответствуют нормам", "code": "ЭВ-02", "ref": "Техрегламент · эвакуация", "group": "Эвакуация"},
    {"key": "evac_plan", "label": "Планы эвакуации вывешены, актуальны", "code": "ЭВ-03", "ref": "ППБ РК · эвакуация", "group": "Эвакуация"},
    {"key": "evac_light", "label": "Эвакуационное (аварийное) освещение исправно", "code": "ЭВ-04", "ref": "ППБ РК · эвакуация", "group": "Эвакуация"},
    # — Противопожарные системы —
    {"key": "alarm", "label": "АПС/АУПТ исправны, на ТО, журнал ведётся", "code": "ПС-01", "ref": "ППБ РК · АПС/АУПТ", "group": "Системы ПБ"},
    {"key": "smoke", "label": "Система противодымной защиты работоспособна", "code": "ПС-02", "ref": "Техрегламент · дымоудаление", "group": "Системы ПБ"},
    {"key": "fire_doors", "label": "Противопожарные двери/преграды исправны, не заклинены", "code": "ПС-03", "ref": "ППБ РК · преграды", "group": "Системы ПБ"},
    # — Водоснабжение —
    {"key": "hydrant", "label": "Наружный гидрант доступен, исправен, обозначен", "code": "ВС-01", "ref": "ППБ РК · водоснабжение", "group": "Водоснабжение"},
    {"key": "internal_water", "label": "Внутренний пожарный водопровод укомплектован, под давлением", "code": "ВС-02", "ref": "ППБ РК · ВПВ", "group": "Водоснабжение"},
    # — Первичные средства —
    {"key": "extinguishers", "label": "Огнетушители в наличии, заряжены, в срок поверки", "code": "ПСр-01", "ref": "ППБ РК · первичные средства", "group": "Первичные средства"},
    {"key": "fire_panel", "label": "Пожарный щит/инвентарь укомплектован", "code": "ПСр-02", "ref": "ППБ РК · первичные средства", "group": "Первичные средства"},
    # — Электробезопасность —
    {"key": "electrical", "label": "Электроустановки без нарушений (нет временной проводки, перегрузок)", "code": "ЭЛ-01", "ref": "ППБ РК · электробезопасность", "group": "Электробезопасность"},
    # — Содержание и проезды —
    {"key": "access_roads", "label": "Проезды и подъезды для пожтехники свободны", "code": "СТ-01", "ref": "ППБ РК · проезды", "group": "Содержание"},
    {"key": "basement", "label": "Подвалы/чердаки/склады закрыты, без горючего хлама", "code": "СТ-02", "ref": "ППБ РК · содержание", "group": "Содержание"},
    {"key": "storage", "label": "Хранение горючих материалов соответствует нормам", "code": "СТ-03", "ref": "ППБ РК · хранение", "group": "Содержание"},
    # — Организационные —
    {"key": "instructed", "label": "Проведён противопожарный инструктаж персонала", "code": "ОР-01", "ref": "ППБ РК · организационные", "group": "Организационные"},
    {"key": "responsible", "label": "Назначен ответственный за пожарную безопасность (приказ)", "code": "ОР-02", "ref": "ППБ РК · организационные", "group": "Организационные"},
]


@router.get("/inspectors")
def list_inspectors(
    db: Session = Depends(get_db),
    user: dict = Depends(FIELD_ROLES),
) -> list[dict]:
    """Реестр инспекторов в границах видимости роли.

    Скоуп тот же, что у `GET /routes/progress`: supervisor — свой район, admin —
    весь город. Инспектор видит только собственную запись: список нужен ему лишь
    для выбора своего маршрута, а чужие ФИО с районами — уже чужие данные.
    """
    if user.get("role") == "inspector":
        own = linked_inspector(db, user)
        return [dict(own)] if own is not None else []

    params: dict = {}
    where = ""
    if not has_citywide_data_access(user):
        district = user.get("district")
        if district is None:  # scoped-роль без района не видит никого (fail closed)
            return []
        where = "WHERE district IS NOT DISTINCT FROM :d"
        params["d"] = district
    rows = db.execute(
        text(f"SELECT id, name, district FROM inspectors {where} ORDER BY id"),
        params,
    ).mappings()
    return [dict(r) for r in rows]


@router.get("/routes/checklist")
def checklist(_user: dict = Depends(FIELD_ROLES)) -> list[dict]:
    return CHECKLIST


# Нормативная периодичность плановых проверок по риск-категории (дней).
# В духе риск-ориентированного надзора РК: высокий риск проверяется чаще.
def _normative_interval_days(score: int) -> int:
    if score >= 71:    # высокий / критический риск
        return 365
    if score >= 36:    # средний риск
        return 730
    return 1095        # низкий риск (≈ 3 года)


def _priority(score: int, days_since: int) -> float:
    """Маршрут ведёт нормативная периодичность, не только балл риска.

    Объекты, у которых подошёл/просрочен нормативный срок плановой проверки,
    идут впереди всех (offset 1000) — отсортированы по степени просрочки и
    риску. Объекты, чей срок ещё не наступил, остаются ниже, чтобы инспектора
    не гоняли на недавно проверенные и не пропускали просроченные.
    """
    interval = _normative_interval_days(score)
    ratio = (days_since or 0) / interval
    if ratio >= 1.0:
        return 1000 + score + min((ratio - 1.0) * 200, 300)
    return ratio * score


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
    inspector_id: int | None = None,
    size: int = 6,
    db: Session = Depends(get_db),
    user: dict = Depends(FIELD_ROLES),
) -> dict:
    # `inspector_id` приходит от клиента и потому не является подтверждением
    # личности: маршрут (чужие адреса с нарушениями) отдаётся только после
    # проверки связи учётной записи с реестром и района.
    inspector = resolve_inspector(db, user, inspector_id)

    size = max(1, min(size, len(SLOTS)))
    ordered = _build_route(db, inspector["district"], size)
    status_map = _visit_status(db, inspector["id"], [s["id"] for s in ordered])

    stops = []
    for i, s in enumerate(ordered):
        days_since = s["days_since"] or 0
        interval = _normative_interval_days(s["score"])
        overdue = bool(s["last_inspected"]) and days_since >= interval
        never_inspected = not s["last_inspected"]
        stops.append(
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
                # Нормативный статус плановой проверки.
                "normative_interval_days": interval,
                "days_since_inspection": days_since if s["last_inspected"] else None,
                "overdue": overdue or never_inspected,
                "overdue_label": (
                    "Ранее не проверялся"
                    if never_inspected
                    else f"Плановый срок проверки просрочен на {days_since - interval} дн."
                    if overdue
                    else "В пределах норматива"
                ),
            }
        )
    done = sum(1 for s in stops if s["status"] != "pending")

    return {
        "inspector": dict(inspector),
        "date": date.today().isoformat(),
        "district": inspector["district"],
        "stops": stops,
        "done": done,
        "total": len(stops),
    }


class Violation(BaseModel):
    code: str = Field(..., min_length=1, max_length=16)  # CHECKLIST item code
    note: str | None = Field(None, max_length=500)
    deadline_days: int | None = Field(None, ge=1, le=365)  # срок устранения


class VisitRequest(BaseModel):
    # Необязателен: для инспектора авторство берётся из его учётной записи, а
    # присланное чужое значение отклоняется (см. resolve_inspector).
    inspector_id: int | None = None
    building_id: int
    status: str = Field(..., pattern="^(done|violation)$")
    # Планов/внеплан — основание выхода на объект (для юридической силы протокола).
    inspection_type: str = Field("planned", pattern="^(planned|unplanned)$")
    checklist: dict | None = None
    violations: list[Violation] | None = None
    evidence_photos: list[str] | None = None  # photo ids from /routes/visit/photo
    note: str | None = None


@router.post("/routes/visit/photo")
async def upload_visit_photo(
    file: UploadFile,
    _user: dict = Depends(PHOTO_UPLOAD_ROLES),
) -> dict:
    """Upload one evidence photo; returns its id for inclusion in the visit."""
    if file.content_type not in PHOTO_TYPES:
        raise HTTPException(415, "Поддерживаются PNG, JPEG, WebP")
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Файл больше 15 МБ")
    Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
    name = f"visit_{uuid.uuid4().hex}{PHOTO_TYPES[file.content_type]}"
    (Path(settings.uploads_dir) / name).write_bytes(data)
    return {"id": name}


@router.get("/routes/visit/photo/{photo_id}")
def get_visit_photo(
    photo_id: str,
    _user: dict = Depends(PHOTO_VIEW_ROLES),
) -> FileResponse:
    """Serve an inspection-visit evidence photo to internal roles only. External
    owners are excluded — they must not see inspection proof. The name pattern
    blocks path traversal and limits reads to generated photo files."""
    if not _PHOTO_NAME.match(photo_id):
        raise HTTPException(404, "Файл не найден")
    path = Path(settings.uploads_dir) / photo_id
    if not path.exists():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, media_type=_EXT_MEDIA[path.suffix])


@router.post("/routes/visit")
def record_visit(
    body: VisitRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(FIELD_ROLES),
) -> dict:
    import json

    # A violation must carry at least one coded violation AND photographic
    # evidence — without both it has no legal force as a protocol attachment.
    # Проверка формы акта идёт до обращения к БД (сообщения не зависят от
    # данных и ничего о чужих районах не раскрывают).
    if body.status == "violation":
        if not body.violations:
            raise HTTPException(
                422, "Для статуса «нарушение» укажите хотя бы одно нарушение с кодом"
            )
        if not body.evidence_photos:
            raise HTTPException(
                422, "Для статуса «нарушение» приложите хотя бы одно фото-доказательство"
            )

    # Акт проверки имеет юридическую силу, поэтому автора определяет учётная
    # запись, а не поле запроса: `inspector_id` из тела лишь сверяется с ней.
    inspector = resolve_inspector(db, user, body.inspector_id)

    # Объект тоже должен быть в зоне ответственности вызывающего — иначе визит
    # закрывается по чужому району (для admin/общегородских ролей — no-op).
    scope_clauses: list[str] = []
    scope_params: dict = {"bid": body.building_id}
    enforce_building_scope(scope_clauses, scope_params, user)
    where = " AND ".join(["b.id = :bid", *scope_clauses])
    in_scope = db.execute(
        text(f"SELECT 1 FROM buildings b WHERE {where}"), scope_params
    ).scalar()
    if in_scope is None:
        raise HTTPException(403, "Объект не найден или вне зоны вашей ответственности")

    violations = (
        json.dumps([v.model_dump() for v in body.violations], ensure_ascii=False)
        if body.violations
        else None
    )
    photos = (
        json.dumps(body.evidence_photos, ensure_ascii=False)
        if body.evidence_photos
        else None
    )
    db.execute(
        text(
            """
            INSERT INTO inspection_visits
                (inspector_id, building_id, visit_date, status, inspection_type,
                 checklist, violations, evidence_photos, note)
            VALUES (:iid, :bid, CURRENT_DATE, :st, :itype,
                    CAST(:cl AS JSONB), CAST(:vio AS JSONB), CAST(:ph AS JSONB), :note)
            ON CONFLICT (inspector_id, building_id, visit_date) DO UPDATE
            SET status = EXCLUDED.status,
                inspection_type = EXCLUDED.inspection_type,
                checklist = EXCLUDED.checklist,
                violations = EXCLUDED.violations,
                evidence_photos = EXCLUDED.evidence_photos,
                note = EXCLUDED.note,
                updated_at = now()
            """
        ),
        {
            "iid": inspector["id"],
            "bid": body.building_id,
            "st": body.status,
            "itype": body.inspection_type,
            "cl": json.dumps(body.checklist, ensure_ascii=False) if body.checklist else None,
            "vio": violations,
            "ph": photos,
            "note": body.note,
        },
    )
    db.commit()
    return {"ok": True, "status": body.status}


@router.get("/routes/progress")
def progress(
    size: int = 6,
    db: Session = Depends(get_db),
    user: dict = Depends(OVERSIGHT_ROLES),
) -> list[dict]:
    """Live execution status across all inspectors (supervisor view)."""
    # Role gate is OVERSIGHT_ROLES (supervisor/leadership/admin) at the dependency
    # layer; here only the data scope differs per role.
    # Supervisor is scoped to their own district; leadership/admin see the whole city.
    params: dict = {}
    if has_full_access(user):
        insp_filter = ""
    else:
        params["d"] = user.get("district")
        insp_filter = "WHERE district IS NOT DISTINCT FROM :d"
    inspectors = db.execute(
        text(f"SELECT id, name, district FROM inspectors {insp_filter} ORDER BY id"),
        params,
    ).mappings().all()

    # Inspectors share districts → build each district's route once, not per
    # inspector (was N queries for N inspectors; now ≤ number of districts).
    route_by_district: dict[str, list[dict]] = {}

    result = []
    for ins in inspectors:
        district = ins["district"]
        if district not in route_by_district:
            route_by_district[district] = _build_route(db, district, size)
        ordered = route_by_district[district]
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
