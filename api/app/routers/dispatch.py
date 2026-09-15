"""Боевой модуль — dispatch of callouts and the боевой пакет.

Two roles drive this module:
  • dispatcher (ЦОУ/112) — registers a callout (выезд), assigns a station and
    hands the караул a боевой пакет.
  • responder (начальник караула / РТП) — reads the pack and works the scene.

Geo work is done in PostGIS (geography casts → metres). Callouts are stored in
their own table, never in `incidents` (which feeds the ML risk model). All
data reads here are citywide — dispatcher/responder are not district-scoped.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.audit import audit, client_ip
from app.coverage import HYDRANT_RADIUS_M
from app.db import get_db
from app.routers.auth import current_user, require_roles
from app.routers.forces import PRESETS
from app.telematics import get_provider, match_positions

# Registering / closing a callout is a dispatcher action (admin may operate too).
DISPATCH_ROLES = require_roles("dispatcher", "admin")
# Reading callouts / the pack: the боевой roles plus oversight.
VIEW_ROLES = require_roles(
    "dispatcher", "responder", "supervisor", "leadership", "admin"
)
# Боевые отметки (таймлайн, наряд, расход) ставит тот, кто на месте, — РТП;
# диспетчер дублирует их с пульта, когда РТП докладывает по радио.
OPS_ROLES = require_roles("dispatcher", "responder", "admin")

router = APIRouter(prefix="/dispatch", tags=["dispatch"], dependencies=[Depends(current_user)])

CALLOUT_TYPES = {"fire", "smoke", "alarm", "other"}

# Номенклатура оперативного модуля. Дублирует CHECK-констрейнты миграции
# 0017 — при изменении править оба места (иначе вставка упадёт на уровне БД).
VEHICLE_TYPES = ("ac", "al", "akp", "anr", "asa", "other")
VEHICLE_STATUSES = ("in_service", "on_callout", "repair", "reserve")
# Расход средств: 7 позиций, которые реально считают в частях. Расширять
# номенклатуру дороже, чем кажется — незаполненная форма хуже отсутствующей.
RESOURCE_ITEMS = ("hose", "barrel", "foam", "water", "fuel", "ladder", "scba")

# Хронология боевых действий. Порядок в кортеже — порядок в реальном выезде,
# на нём же строится проверка монотонности отметок.
TIMELINE_FIELDS = (
    "dispatched_at",
    "arrived_at",
    "first_jet_at",
    "localized_at",
    "extinguished_at",
)

# План развёртывания. Дублирует CHECK-констрейнты миграции 0019 — при
# изменении править оба места. Стволы на тушение и на защиту разделены не для
# красоты: расчёт по методике даёт для них разные величины (Qт и Qз), и
# сверять факт с планом можно только раздельно.
POSITION_KINDS = (
    "barrel_ext",
    "barrel_def",
    "vehicle",
    "checkpoint",
    "hq",
    "ladder",
    "other",
)
POSITION_PHASES = ("localization", "extinguishing")

# Nearest hydrants / access reports around the callout point (metres).
REPORTS_RADIUS_M = 400
HYDRANT_LIMIT = 5

_PRESET_LABEL = {p["key"]: p["label"] for p in PRESETS}
# Minimal building_type → forces preset mapping. building_type is a coarse OSM
# class (residential/public/industrial/other); the named school/hospital/mall
# keys are here for when a finer type is available on the object.
_TYPE_TO_PRESET = {
    "residential": "residential",
    "school": "education",
    "hospital": "medical",
    "mall": "public_mass",
    "public": "public",
    "industrial": "industrial",
    # `other` — свалка OSM: в ней и склад, и ЖК «Аланда» (гостиница, медцентр,
    # торговля, бомбоубежище в одном 24-этажном здании). Раньше тип не
    # разбирался и подсказка не выдавалась вовсе — РТП уходил в калькулятор с
    # дефолтом «жилое» (Jтр 0,06) и получал ранг ниже фактического. Для
    # неизвестного типа берётся самый требовательный «мирный» пресет: ошибка в
    # сторону избытка сил исправляется на месте, ошибка в сторону недостатка —
    # нет. Подсказка при этом помечается как черновая (source="preset").
    "other": "public_mass",
}
# Тип не заполнен вовсе (NULL в реестре) — та же логика, что и у `other`.
_FALLBACK_PRESET = "public_mass"
# Catches preset-key drift (forces.py renaming/removing a preset) at import
# time — in tests and on boot — instead of a 500 on a live callout.
assert set(_TYPE_TO_PRESET.values()) | {_FALLBACK_PRESET} <= set(_PRESET_LABEL), (
    "_TYPE_TO_PRESET ссылается на пресет, которого нет в forces.PRESETS"
)

# --- нормализация адреса -----------------------------------------------------

# Свёртка казахских букв к базовым кириллическим: диспетчер печатает с русской
# раскладки, где нет `ә ғ қ ң ө ұ ү һ і`. Таблица обязана совпадать с SQL-функцией
# `fw_norm_addr` (миграция 0016) — адрес нормализуется в БД, запрос здесь.
_FOLD_FROM = "әғқңөұүһіыё"
_FOLD_TO = "агкноуухиие"
_FOLD = str.maketrans(_FOLD_FROM, _FOLD_TO)

# Похожие на цифры буквы — опечатка в номере дома («Тәуелсіздік 3З» вместо 33)
# при быстром наборе. Применяется ТОЛЬКО к токену, где уже есть хотя бы одна
# цифра (то есть к номеру дома), и только к запросу: в реестре номер записан
# цифрами. Вариант ищется дополнительно к исходному токену, поэтому «7б»
# (корпус) не теряется.
_DIGIT_LOOKALIKE = str.maketrans({"з": "3", "о": "0", "б": "6", "ч": "4", "o": "0", "i": "1", "l": "1"})


def norm_addr(s: str) -> str:
    """Нормализация адреса: регистр + казахская диакритика (см. fw_norm_addr)."""
    return s.lower().translate(_FOLD)


def _like_escape(s: str) -> str:
    """Экранирование спецсимволов LIKE, чтобы «%» из запроса не совпал со всем."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _digit_variant(token: str) -> str | None:
    """Вариант токена-номера с буквами, замененными на похожие цифры."""
    if not any(ch.isdigit() for ch in token):
        return None
    variant = token.translate(_DIGIT_LOOKALIKE)
    return variant if variant != token else None


class CalloutCreate(BaseModel):
    building_id: int | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    address: str | None = Field(None, max_length=500)
    callout_type: str
    note: str | None = Field(None, max_length=2000)
    station_id: int | None = None

    @field_validator("callout_type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in CALLOUT_TYPES:
            raise ValueError(f"неизвестный тип вызова: {v}")
        return v

    @model_validator(mode="after")
    def _require_location(self) -> "CalloutCreate":
        # Need a point: either an object (centroid) or an explicit lat+lng.
        if self.building_id is None and (self.lat is None or self.lng is None):
            raise ValueError("укажите building_id либо пару координат lat+lng")
        return self


class CalloutPatch(BaseModel):
    """Переназначение действующего выезда: объект и/или часть."""

    building_id: int | None = None
    station_id: int | None = None

    @model_validator(mode="after")
    def _require_change(self) -> "CalloutPatch":
        if self.building_id is None and self.station_id is None:
            raise ValueError("укажите building_id либо station_id")
        return self


class CalloutClose(BaseModel):
    close_note: str | None = Field(None, max_length=2000)


# --- callout shaping ---------------------------------------------------------

# One row shape for both the list and the pack's `callout`. district/station name
# come from joins (callouts stores neither).
_CALLOUT_SELECT = """
    SELECT c.id, c.building_id, b.district, c.address, c.callout_type, c.note,
           c.status, ST_Y(c.geom) AS lat, ST_X(c.geom) AS lng,
           c.station_id, s.name AS station_name,
           c.created_by, c.created_at, c.closed_by, c.closed_at, c.close_note,
           c.dispatched_at, c.arrived_at, c.first_jet_at, c.localized_at,
           c.extinguished_at, c.rank_declared,
           late.positions AS late_sync_positions, late.removed AS late_sync_removed,
           late.last_at AS late_sync_last_at
    FROM callouts c
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN fire_stations s ON s.id = c.station_id
    -- Позиции, досинхронизированные с планшета уже после закрытия выезда, и
    -- надгробия снятых после закрытия (миграция 0024): пульт должен видеть,
    -- что закрытый выезд получил данные. Оба счёта — по индексу callout_id.
    LEFT JOIN LATERAL (
        SELECT pos.n AS positions, rem.n AS removed,
               GREATEST(pos.last_at, rem.last_at) AS last_at
          FROM (SELECT count(*) AS n, max(p.synced_after_close_at) AS last_at
                  FROM deployment_positions p
                 WHERE p.callout_id = c.id AND p.synced_after_close_at IS NOT NULL) pos,
               (SELECT count(*) AS n, max(r.synced_at) AS last_at
                  FROM deployment_late_removals r
                 WHERE r.callout_id = c.id) rem
    ) late ON true
"""


def _iso(v: object) -> str | None:
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else None


def _timeline_dict(r: dict) -> dict:
    """Хронология выезда плюс производные интервалы в секундах.

    Интервалы считаются на сервере, а не на клиенте: они же уходят в
    статистику по частям, и расхождение в округлении между экраном и сводкой
    читалось бы как ошибка данных.
    """
    marks = {f: _iso(r.get(f)) for f in TIMELINE_FIELDS}
    created, arrived = r.get("created_at"), r.get("arrived_at")
    dispatched, extinguished = r.get("dispatched_at"), r.get("extinguished_at")

    def _delta(a: object, b: object) -> int | None:
        if a is None or b is None:
            return None
        return max(0, round((b - a).total_seconds()))

    return {
        **marks,
        "reported_at": _iso(created),
        "rank_declared": r.get("rank_declared"),
        # Норматив прибытия отсчитывается от сообщения о пожаре, а сбор караула
        # (сообщение → выезд) — отдельная метрика: это разные зоны влияния.
        "response_sec": _delta(created, arrived),
        "turnout_sec": _delta(created, dispatched),
        "travel_sec": _delta(dispatched, arrived),
        "total_sec": _delta(created, extinguished),
    }


def _callout_dict(r: dict) -> dict:
    return {
        "id": r["id"],
        "address": r["address"],
        "district": r["district"],
        "callout_type": r["callout_type"],
        "note": r["note"],
        "status": r["status"],
        "lat": r["lat"],
        "lng": r["lng"],
        "station": {"id": r["station_id"], "name": r["station_name"]}
        if r["station_id"] is not None
        else None,
        "building_id": r["building_id"],
        "created_by": r["created_by"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "closed_by": r["closed_by"],
        "closed_at": r["closed_at"].isoformat() if r["closed_at"] else None,
        "close_note": r["close_note"],
        "timeline": _timeline_dict(r),
        # Расстановка, дошедшая с планшета после закрытия: сколько позиций
        # записано или помечено, сколько снято и когда пришло последнее.
        # None — после закрытия ничего не приходило.
        "late_sync": {
            "positions": r.get("late_sync_positions") or 0,
            "removed": r.get("late_sync_removed") or 0,
            "last_synced_at": _iso(r.get("late_sync_last_at")),
        }
        if r.get("late_sync_positions") or r.get("late_sync_removed")
        else None,
    }


def _fetch_callout(db: Session, callout_id: int) -> dict:
    row = db.execute(
        text(_CALLOUT_SELECT + " WHERE c.id = :id"), {"id": callout_id}
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Выезд не найден")
    return dict(row)


# --- данные карточки ПТП -----------------------------------------------------
#
# Карточка ПТП — расчёт по конкретному объекту, сделанный человеком по реальному
# документу. Она главнее и грубого реестра OSM (этажность), и эвристики по типу
# здания (силы и средства): для ЖК «Аланда» реестр даёт 20 этажей и пресет по
# типу, документ — 24 этажа и ранг №3 с 4+2 стволами. Отсюда всё, что карточка
# знает, побеждает.

_FLOORS_RE = re.compile(r"(\d{1,3})\s*(?:эт|қабат)", re.IGNORECASE)
_RANK_RE = re.compile(r"ранг(?:\s+пожара)?\s*[№#]?\s*(\d+)", re.IGNORECASE)

# Ключи `force_calc` различаются между оцифровками (Аланда — кириллица вперемешку
# с латиницей, Хайвилл — транслит), поэтому канонические поля собираются по
# списку алиасов. Значение бывает числом (`"Nотд": 7`) либо строкой
# («"Nотд = 26/4 = 7 отделений"») — во втором случае берётся число перед
# единицей измерения.
_FC_NUM_FIELDS = {
    "q_req_l_s": ("Qобщ_тр_l_s", "Qtr_total_l_s"),
    "q_req_ext_l_s": ("Qт_тр_l_s", "Qtr_tushenie_l_s"),
    "q_req_def_l_s": ("Qз_тр_l_s", "Qtr_zashchita_l_s"),
    "q_act_l_s": ("Qобщ_ф_l_s", "Qf_fakticheskiy_l_s"),
    "s_fire_m2": ("Sп_m2", "S_pozhara_m2"),
    "s_ext_m2": ("Sт_m2", "S_tusheniya_m2"),
}
_FC_COUNT_FIELDS = {
    "barrels_ext": (("Nств_тушение", "Nstv_tushenie"), ("ствол",)),
    "barrels_def": (("Nств_защита", "Nstv_zashchita"), ("ствол",)),
    "squads": (("Nотд", "otdeleniy"), ("отделен",)),
    "personnel": (("Nлс_чел", "lichnyy_sostav"), ("чел",)),
    "trucks": (("Nм_АЦ", "pozharnyh_mashin"), ("АЦ", "машин")),
}


def _as_number(v: object) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _count_from(v: object, keywords: tuple[str, ...]) -> int | None:
    """Число из значения: как есть, либо перед единицей («7 отделений» → 7).

    Строки в ПТП пишут выкладкой целиком («Nотд = 26/4 = 7 отделений»), поэтому
    брать первое число нельзя — нужно то, что стоит перед единицей измерения.
    """
    n = _as_number(v)
    if n is not None:
        return int(n)
    if not isinstance(v, str):
        return None
    for kw in keywords:
        found = re.findall(r"(\d+)\s*" + re.escape(kw), v, re.IGNORECASE)
        if found:
            return int(found[-1])
    return None


def _card_floors(extracted: object) -> int | None:
    """Этажность по документу ПТП — максимум по блокам («24 эт.», «A-1 (24 эт.)»)."""
    obj = extracted.get("object") if isinstance(extracted, dict) else None
    if not isinstance(obj, dict):
        return None
    best: int | None = None
    for block in obj.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        raw = block.get("floors")
        candidates: list[int] = []
        if isinstance(raw, int) and not isinstance(raw, bool):
            candidates = [raw]
        elif isinstance(raw, str):
            candidates = [int(m) for m in _FLOORS_RE.findall(raw)]
        for c in candidates:
            if 0 < c <= 200 and (best is None or c > best):
                best = c
    return best


def _card_forces(extracted: object) -> dict | None:
    """Расчёт сил из карточки ПТП, приведённый к каноническим полям."""
    fc = extracted.get("force_calc") if isinstance(extracted, dict) else None
    if not isinstance(fc, dict) or not fc:
        return None

    out: dict = {}
    for field, aliases in _FC_NUM_FIELDS.items():
        out[field] = next(
            (n for a in aliases if (n := _as_number(fc.get(a))) is not None), None
        )
    for field, (aliases, keywords) in _FC_COUNT_FIELDS.items():
        out[field] = next(
            (n for a in aliases if (n := _count_from(fc.get(a), keywords)) is not None),
            None,
        )

    # Ранг пишут словами в выводе расчёта («Ранг пожара №3»), отдельного поля нет.
    # Если в документе его не написали — не выдумываем: показывать будет нечего.
    rank = None
    for value in fc.values():
        if isinstance(value, str) and (m := _RANK_RE.search(value)):
            rank = f"№{m.group(1)}"
            break
    out["rank"] = rank
    out["scenario"] = fc.get("scenario") if isinstance(fc.get("scenario"), str) else None

    # Пустая выжимка (ни одной цифры) бесполезна — тогда честнее эвристика.
    if not any(v is not None for k, v in out.items() if k != "scenario"):
        return None
    return out


# --- боевой пакет ------------------------------------------------------------


def _build_pack(db: Session, callout_id: int) -> dict:
    row = _fetch_callout(db, callout_id)
    lng, lat = row["lng"], row["lat"]
    pt_params = {"lng": lng, "lat": lat}
    pt = "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography"

    # Building block (only for object-linked callouts).
    building = None
    card: dict | None = None
    if row["building_id"] is not None:
        b = db.execute(
            text(
                """
                SELECT b.id, b.address, b.district, b.building_type, b.floors,
                       b.year_built, r.score AS risk_score
                FROM buildings b
                LEFT JOIN risk_scores r ON r.building_id = b.id
                WHERE b.id = :id
                """
            ),
            {"id": row["building_id"]},
        ).mappings().first()
        if b is not None:
            c = db.execute(
                text(
                    """
                    SELECT id, extracted FROM operational_cards
                    WHERE building_id = :id ORDER BY id DESC LIMIT 1
                    """
                ),
                {"id": b["id"]},
            ).mappings().first()
            card = dict(c) if c is not None else None

            # Этажность: реестр OSM против документа ПТП. Пакет показывает ту
            # цифру, по которой РТП выбирает автолестницу, поэтому карточка
            # выигрывает, а расхождение остаётся видимым (floors_registry).
            floors_card = _card_floors(card["extracted"]) if card else None
            building = {
                "id": b["id"],
                "address": b["address"],
                "district": b["district"],
                "building_type": b["building_type"],
                "floors": floors_card if floors_card is not None else b["floors"],
                "floors_source": "card" if floors_card is not None else "registry",
                "floors_registry": b["floors"],
                "year_built": b["year_built"],
                "risk_score": b["risk_score"],
                "card_id": card["id"] if card else None,
            }

    # Nearest hydrants within HYDRANT_RADIUS_M.
    hydrants = db.execute(
        text(
            f"""
            SELECT id, status, hydrant_type, pressure_bar, diameter_mm,
                   ST_Y(geom) AS lat, ST_X(geom) AS lng,
                   ST_Distance(geom::geography, {pt}) AS dist
            FROM hydrants
            WHERE ST_DWithin(geom::geography, {pt}, :radius)
            ORDER BY dist
            LIMIT :lim
            """
        ),
        {**pt_params, "radius": HYDRANT_RADIUS_M, "lim": HYDRANT_LIMIT},
    ).mappings().all()

    # Assigned station with its distance from the callout.
    station = None
    if row["station_id"] is not None:
        s = db.execute(
            text(
                f"""
                SELECT id, name, vehicles,
                       ST_Distance(geom::geography, {pt}) AS dist
                FROM fire_stations WHERE id = :id
                """
            ),
            {**pt_params, "id": row["station_id"]},
        ).mappings().first()
        if s is not None:
            station = {
                "id": s["id"],
                "name": s["name"],
                "vehicles": s["vehicles"],
                "distance_m": round(s["dist"]),
            }

    # Active access reports the crew should know about before arrival.
    reports = db.execute(
        text(
            f"""
            SELECT id, category, status, description, photos,
                   ST_Distance(geom::geography, {pt}) AS dist
            FROM field_reports
            WHERE status IN ('open', 'in_progress')
              AND ST_DWithin(geom::geography, {pt}, :radius)
            ORDER BY dist
            """
        ),
        {**pt_params, "radius": REPORTS_RADIUS_M},
    ).mappings().all()

    # Силы и средства. Два принципиально разных источника, и пакет обязан
    # называть их разными именами:
    #   source="card"   — расчёт по ПТП объекта (человек, реальный документ);
    #   source="preset" — черновая прикидка по типу здания (эвристика).
    # Пресет считается всегда — он же параметризует ссылку на калькулятор.
    forces_hint = None
    if building is not None:
        preset_key = _TYPE_TO_PRESET.get(building["building_type"] or "", _FALLBACK_PRESET)
        forces_hint = {
            "source": "preset",
            "preset_key": preset_key,
            "label": _PRESET_LABEL[preset_key],
            "card_id": building["card_id"],
            "rank": None,
            "barrels_ext": None,
            "barrels_def": None,
            "squads": None,
            "personnel": None,
            "trucks": None,
            "q_req_l_s": None,
            "q_req_ext_l_s": None,
            "q_req_def_l_s": None,
            "q_act_l_s": None,
            "s_fire_m2": None,
            "s_ext_m2": None,
            "scenario": None,
        }
        card_forces = _card_forces(card["extracted"]) if card else None
        if card_forces is not None:
            forces_hint.update(card_forces, source="card")

    return {
        "callout": _callout_dict(row),
        "building": building,
        "hydrants": [
            {
                "id": h["id"],
                "status": h["status"],
                "hydrant_type": h["hydrant_type"],
                "pressure_bar": h["pressure_bar"],
                "diameter_mm": h["diameter_mm"],
                "distance_m": round(h["dist"]),
                "lat": h["lat"],
                "lng": h["lng"],
            }
            for h in hydrants
        ],
        "station": station,
        "reports": [
            {
                "id": r["id"],
                "category": r["category"],
                "status": r["status"],
                "description": r["description"],
                "distance_m": round(r["dist"]),
                "photos": r["photos"],
            }
            for r in reports
        ],
        "forces_hint": forces_hint,
        # Наряд и расход живут в пакете, а не отдельным запросом: планшет РТП
        # открывается один раз и должен показать всё состояние выезда сразу.
        "vehicles": _callout_vehicles(db, callout_id),
        "resources": _callout_resources(db, callout_id),
        "deployment": _deployment(db, callout_id),
    }


# --- endpoints ---------------------------------------------------------------


@router.get("/search")
def search_buildings(
    q: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(DISPATCH_ROLES),
) -> list[dict]:
    """Token search over building addresses (for picking a callout object).

    Each whitespace-separated token must match somewhere in the address, so a
    dispatcher can type «Сарайшық 7» the way a caller says it — the street
    word and the house number don't have to be adjacent («… көшесі 7/1»).

    Ищется по `buildings.search_norm` (миграция 0016) — свёрнутая пара «адрес +
    алиас»: казахская диакритика убрана с обеих сторон сравнения, поэтому
    «тауелсиздик 33» с русской раскладки находит «Тәуелсіздік даңғылы 33», а
    «Хайвилл» — «Сарайшық көшесі 7/1». Названия улиц не переводятся (перевода
    «независимости» в реестре нет и быть не может) — чинится именно раскладка.
    """
    tokens = [t for t in q.split() if t][:5]
    if not tokens:
        return []

    clauses: list[str] = []
    params: dict = {}
    for i, token in enumerate(tokens):
        normalized = norm_addr(token)
        params[f"q{i}"] = f"%{_like_escape(normalized)}%"
        variant = _digit_variant(normalized)
        if variant is None:
            clauses.append(f"b.search_norm LIKE :q{i}")
        else:
            # Опечатка в номере дома: «3З» → ещё и «33», не теряя «7б».
            params[f"d{i}"] = f"%{_like_escape(variant)}%"
            clauses.append(f"(b.search_norm LIKE :q{i} OR b.search_norm LIKE :d{i})")
    params["raw"] = norm_addr(tokens[0])

    rows = db.execute(
        text(
            f"""
            SELECT b.id, b.address, b.alias, b.district, b.building_type, b.floors,
                   r.score AS risk_score
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            WHERE {" AND ".join(clauses)}
            -- Natural ordering: earlier first-token position, then the house
            -- number numerically (7/1 before 11 — plain ORDER BY address hides
            -- low house numbers behind lexicographic 1x/1xx neighbours).
            ORDER BY POSITION(:raw IN b.search_norm),
                     COALESCE(substring(b.address FROM '[0-9]+')::int, 999999),
                     b.address
            LIMIT 10
            """
        ),
        params,
    ).mappings().all()
    return [
        {
            "id": r["id"],
            "address": r["address"],
            "alias": r["alias"],
            "district": r["district"],
            "building_type": r["building_type"],
            "floors": r["floors"],
            "risk_score": r["risk_score"],
        }
        for r in rows
    ]


def _building_point(db: Session, building_id: int) -> dict:
    """Центроид и адрес объекта — точка выезда (404, если здания нет)."""
    b = db.execute(
        text(
            """
            SELECT id, address,
                   ST_X(ST_Centroid(geom)) AS lng,
                   ST_Y(ST_Centroid(geom)) AS lat
            FROM buildings WHERE id = :id
            """
        ),
        {"id": building_id},
    ).mappings().first()
    if b is None:
        raise HTTPException(404, "Здание не найдено")
    return dict(b)


def _resolve_station(db: Session, station_id: int | None, lng: float, lat: float) -> int | None:
    """Явная часть (должна существовать) либо ближайшая по геометрии."""
    if station_id is not None:
        exists = db.execute(
            text("SELECT 1 FROM fire_stations WHERE id = :id"), {"id": station_id}
        ).scalar()
        if not exists:
            raise HTTPException(404, "Пожарная часть не найдена")
        return station_id
    return db.execute(
        text(
            """
            SELECT id FROM fire_stations
            ORDER BY geom::geography <->
                     ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
            LIMIT 1
            """
        ),
        {"lng": lng, "lat": lat},
    ).scalar()


@router.post("")
def create_callout(
    body: CalloutCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(DISPATCH_ROLES),
) -> dict:
    """Register a callout and return it together with its боевой пакет."""
    address = body.address
    # Resolve the callout point: object centroid or explicit coordinates.
    if body.building_id is not None:
        b = _building_point(db, body.building_id)
        lng, lat = b["lng"], b["lat"]
        if address is None:
            address = b["address"]
    else:
        lng, lat = body.lng, body.lat

    # Station: explicit (must exist) or the nearest one, recorded automatically.
    station_id = _resolve_station(db, body.station_id, lng, lat)

    new_id = db.execute(
        text(
            """
            INSERT INTO callouts
                (building_id, address, geom, callout_type, note, station_id, created_by)
            VALUES
                (:building_id, :address,
                 ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                 :callout_type, :note, :station_id, :created_by)
            RETURNING id
            """
        ),
        {
            "building_id": body.building_id,
            "address": address,
            "lng": lng,
            "lat": lat,
            "callout_type": body.callout_type,
            "note": body.note,
            "station_id": station_id,
            "created_by": user.get("username"),
        },
    ).scalar()
    db.commit()

    audit(
        action="callout.created",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path="/dispatch",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": new_id, "callout_type": body.callout_type,
                "building_id": body.building_id, "station_id": station_id},
    )

    return _build_pack(db, new_id)


@router.get("")
def list_callouts(
    status: str = "active",
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> list[dict]:
    """Callouts, newest first. `status`: active (default) | closed | all."""
    if status not in ("active", "closed", "all"):
        raise HTTPException(422, "status должен быть active, closed или all")
    clause = "" if status == "all" else "WHERE c.status = :status"
    params = {} if status == "all" else {"status": status}
    rows = db.execute(
        text(_CALLOUT_SELECT + f" {clause} ORDER BY c.created_at DESC LIMIT 100"),
        params,
    ).mappings().all()
    return [_callout_dict(dict(r)) for r in rows]


# Верхняя граница страницы архива — печатная форма и пакет открываются по
# одному выезду за раз, большая страница только замедлила бы список.
ARCHIVE_LIMIT_MAX = 100
# Верхняя граница OFFSET — без неё ILIKE-скан по всей таблице плюс огромный
# OFFSET на явно бессмысленной странице (сотни тысяч) — лишняя нагрузка ради
# запроса, который всё равно вернёт пустую страницу; страница архива листает
# кнопками «вперёд/назад», а не произвольным прыжком, столько не нужно.
ARCHIVE_OFFSET_MAX = 100_000
# Текст адреса — то, что диспетчер печатает руками; длиннее реального адреса
# запрос быть не может, а без ограничения ILIKE '%...%' на несуразной строке
# бессмысленно нагружает сканом.
ARCHIVE_Q_MAX_LEN = 100
ARCHIVE_DAYS = (7, 30, 90)

# Строка архива — минимум, который реально показывает /callout/archive
# (дата, адрес/район, тип, ранг, время прибытия, статус) плюс id для ссылок
# «Донесение»/«Пакет». Архив открыт supervisor/leadership по всему городу и
# ищется текстом — в отличие от `_callout_dict` (боевой пакет одного
# конкретного выезда, который открывает тот, кто на него уже попал), здесь
# незачем отдавать текст сообщения о пожаре, комментарий закрытия и логины
# диспетчера/закрывшего — это не читается со страницы и не нужно для ссылок.
_ARCHIVE_SELECT = """
    SELECT c.id, b.district, c.address, c.callout_type, c.status,
           ST_Y(c.geom) AS lat, ST_X(c.geom) AS lng,
           c.created_at, c.arrived_at, c.rank_declared
    FROM callouts c
    LEFT JOIN buildings b ON b.id = c.building_id
"""


def _archive_dict(r: dict) -> dict:
    created, arrived = r.get("created_at"), r.get("arrived_at")
    response_sec = (
        max(0, round((arrived - created).total_seconds()))
        if created is not None and arrived is not None
        else None
    )
    return {
        "id": r["id"],
        "address": r["address"],
        "district": r["district"],
        "callout_type": r["callout_type"],
        "status": r["status"],
        "lat": r["lat"],
        "lng": r["lng"],
        "created_at": _iso(created),
        "rank_declared": r["rank_declared"],
        "response_sec": response_sec,
    }


@router.get("/archive")
def list_callouts_archive(
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
    status: str = "closed",
    station_id: int | None = None,
    callout_type: str | None = None,
    q: str | None = Query(None, max_length=ARCHIVE_Q_MAX_LEN),
    days: int | None = None,
    limit: int = Query(20, ge=1, le=ARCHIVE_LIMIT_MAX),
    offset: int = Query(0, ge=0, le=ARCHIVE_OFFSET_MAX),
) -> dict:
    """Архив выездов — постранично, с фильтрами, для печатных донесений и
    пакетов по уже закрытым выездам («Донесения о пожарах», /callout/archive).

    Отдельный эндпоинт, а не расширение `list_callouts`: тот отдаёт плоский
    список без пагинации, и на этой форме ответа уже стоят /dispatch (пульт
    ЦОУ) и /callout (планшет РТП) — менять её ради архива значило бы чинить
    их заодно без нужды. Скоупинг тот же, что у `list_callouts`: выезды —
    общегородская сущность, районного среза для боевого модуля нет (см.
    докстринг модуля). Строка ответа — минимизированная (`_archive_dict`),
    не полный `_callout_dict`: архив читается по всему городу и ищется
    текстом, поэтому отдаёт только то, что страница показывает.
    """
    if status not in ("active", "closed", "all"):
        raise HTTPException(422, "status должен быть active, closed или all")
    if callout_type is not None and callout_type not in CALLOUT_TYPES:
        raise HTTPException(422, f"неизвестный тип вызова: {callout_type}")
    if days is not None and days not in ARCHIVE_DAYS:
        raise HTTPException(422, f"days должен быть одним из {ARCHIVE_DAYS}")

    clauses: list[str] = []
    params: dict = {}
    if status != "all":
        clauses.append("c.status = :status")
        params["status"] = status
    if station_id is not None:
        clauses.append("c.station_id = :station_id")
        params["station_id"] = station_id
    if callout_type is not None:
        clauses.append("c.callout_type = :callout_type")
        params["callout_type"] = callout_type
    if q:
        # Простое совпадение по адресу (без свёртки казахской диакритики —
        # у callouts, в отличие от buildings, нет колонки search_norm; адрес
        # вызова — свободный текст диспетчера, не привязанный к реестру).
        clauses.append("c.address ILIKE :q")
        params["q"] = f"%{_like_escape(q)}%"
    if days is not None:
        clauses.append("c.created_at >= now() - make_interval(days => :days)")
        params["days"] = days
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    matched = db.execute(text(f"SELECT count(*) FROM callouts c {where}"), params).scalar()

    rows = db.execute(
        text(
            _ARCHIVE_SELECT
            # id — тай-брейкер: у демо-сидов и у выездов, заведённых скопом,
            # created_at может совпадать до микросекунды — без второго ключа
            # LIMIT/OFFSET между страницами дублирует и пропускает строки.
            + f" {where} ORDER BY c.created_at DESC, c.id DESC LIMIT :limit OFFSET :offset"
        ),
        {**params, "limit": limit, "offset": offset},
    ).mappings().all()

    return {
        "matched": matched,
        "offset": offset,
        "limit": limit,
        "callouts": [_archive_dict(dict(r)) for r in rows],
    }


@router.get("/{callout_id}/pack")
def callout_pack(
    callout_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> dict:
    """Боевой пакет for a callout — everything the караул needs on arrival."""
    return _build_pack(db, callout_id)


@router.patch("/{callout_id}")
def update_callout(
    callout_id: int,
    body: CalloutPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(DISPATCH_ROLES),
) -> dict:
    """Переназначить действующий выезд на другой объект и/или другую часть.

    Промах мимо строки в выпадающем списке при быстром вводе — обычная ошибка
    диспетчера. Раньше единственным способом её исправить было закрыть выезд и
    завести заново: до закрытия ошибочно назначенная часть числилась выехавшей
    не по тому адресу. Здесь объект меняется на месте — точка, адрес и (если
    часть не задана явно) ближайшая часть пересчитываются от нового объекта.
    """
    current = _fetch_callout(db, callout_id)
    if current["status"] != "active":
        raise HTTPException(409, "Выезд закрыт — переназначение недоступно")

    lng, lat = current["lng"], current["lat"]
    building_id = current["building_id"]
    address = current["address"]
    if body.building_id is not None:
        b = _building_point(db, body.building_id)
        building_id, lng, lat, address = body.building_id, b["lng"], b["lat"], b["address"]

    # Часть: явная — как указано; иначе при смене объекта пересчитывается
    # ближайшая (то же правило, что при регистрации), без смены объекта — прежняя.
    if body.station_id is not None:
        station_id = _resolve_station(db, body.station_id, lng, lat)
    elif body.building_id is not None:
        station_id = _resolve_station(db, None, lng, lat)
    else:
        station_id = current["station_id"]

    db.execute(
        text(
            """
            UPDATE callouts
               SET building_id = :building_id,
                   address = :address,
                   geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                   station_id = :station_id
             WHERE id = :id AND status = 'active'
            """
        ),
        {
            "building_id": building_id,
            "address": address,
            "lng": lng,
            "lat": lat,
            "station_id": station_id,
            "id": callout_id,
        },
    )
    db.commit()

    audit(
        action="callout.reassigned",
        username=user.get("username"),
        role=user.get("role"),
        method="PATCH",
        path=f"/dispatch/{callout_id}",
        status_code=200,
        ip=client_ip(request),
        detail={
            "callout_id": callout_id,
            "from": {
                "building_id": current["building_id"],
                "station_id": current["station_id"],
                "address": current["address"],
            },
            "to": {
                "building_id": building_id,
                "station_id": station_id,
                "address": address,
            },
        },
    )

    return _build_pack(db, callout_id)


@router.post("/{callout_id}/close")
def close_callout(
    callout_id: int,
    body: CalloutClose,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(DISPATCH_ROLES),
) -> dict:
    """Close an active callout (404 if unknown, 409 if already closed)."""
    updated = db.execute(
        text(
            """
            UPDATE callouts
               SET status = 'closed', closed_by = :by, closed_at = now(),
                   close_note = :note
             WHERE id = :id AND status = 'active'
            RETURNING id
            """
        ),
        {"by": user.get("username"), "note": body.close_note, "id": callout_id},
    ).scalar()
    if updated is None:
        exists = db.execute(
            text("SELECT 1 FROM callouts WHERE id = :id"), {"id": callout_id}
        ).scalar()
        if not exists:
            raise HTTPException(404, "Выезд не найден")
        raise HTTPException(409, "Выезд уже закрыт")
    db.commit()

    audit(
        action="callout.closed",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/dispatch/{callout_id}/close",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id},
    )

    return _callout_dict(_fetch_callout(db, callout_id))


# --- оперативный модуль: таймлайн, техника, наряд, расход ---------------------
#
# Разделение ответственности здесь важнее удобства: система *предлагает* расчёт
# по методике, а решение и отметки ставит человек. Поэтому ни одна отметка
# таймлайна не выставляется автоматически — даже когда её можно было бы вывести
# (например, «прибытие» по геометке машины). Автоматика появится там, где
# появится доверенный источник — телематика из системы мониторинга.


class TimelineUpdate(BaseModel):
    """Отметки боевых действий. Любое подмножество, null снимает отметку."""

    dispatched_at: str | None = None
    arrived_at: str | None = None
    first_jet_at: str | None = None
    localized_at: str | None = None
    extinguished_at: str | None = None
    rank_declared: str | None = Field(None, max_length=16)

    @model_validator(mode="after")
    def _require_change(self) -> "TimelineUpdate":
        if not self.model_fields_set:
            raise ValueError("укажите хотя бы одну отметку")
        return self


class VehicleCreate(BaseModel):
    callsign: str = Field(..., min_length=1, max_length=32)
    vehicle_type: str
    water_l: int | None = Field(None, ge=0, le=100_000)
    note: str | None = Field(None, max_length=500)

    @field_validator("vehicle_type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in VEHICLE_TYPES:
            raise ValueError(f"неизвестный тип техники: {v}")
        return v


class VehiclePatch(BaseModel):
    status: str | None = None
    water_l: int | None = Field(None, ge=0, le=100_000)
    note: str | None = Field(None, max_length=500)

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str | None) -> str | None:
        if v is not None and v not in VEHICLE_STATUSES:
            raise ValueError(f"неизвестный статус: {v}")
        return v

    @model_validator(mode="after")
    def _require_change(self) -> "VehiclePatch":
        if not self.model_fields_set:
            raise ValueError("укажите хотя бы одно поле")
        return self


class VehicleAssign(BaseModel):
    vehicle_ids: list[int] = Field(..., min_length=1, max_length=50)


class ResourceLine(BaseModel):
    item_key: str
    qty: float = Field(..., ge=0, le=1_000_000)

    @field_validator("item_key")
    @classmethod
    def _known_item(cls, v: str) -> str:
        if v not in RESOURCE_ITEMS:
            raise ValueError(f"неизвестная позиция: {v}")
        return v


class ResourcesPut(BaseModel):
    """Полный список расхода по выезду — перезаписывает предыдущий."""

    items: list[ResourceLine] = Field(default_factory=list, max_length=len(RESOURCE_ITEMS))

    @model_validator(mode="after")
    def _no_duplicates(self) -> "ResourcesPut":
        keys = [i.item_key for i in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("позиция указана дважды")
        return self


def _user_station(db: Session, user: dict) -> int | None:
    """Часть пользователя. Резолвится из БД, а не из токена: привязка меняется
    администратором, и старый токен не должен давать доступ к прежней части."""
    return db.execute(
        text("SELECT station_id FROM users WHERE username = :u"),
        {"u": user.get("username")},
    ).scalar()


def _assert_station_access(db: Session, user: dict, station_id: int) -> None:
    """Начальник караула ведёт технику только своей части.

    Диспетчер и админ работают по всему городу — им нужен полный обзор для
    распределения сил. Responder без привязки к части (не заполнено
    `users.station_id`) не может менять ничего: молча пускать его на любую
    часть опаснее, чем потребовать явную привязку.
    """
    if user.get("role") in ("dispatcher", "admin"):
        return
    own = _user_station(db, user)
    if own is None:
        raise HTTPException(403, "Учётная запись не привязана к пожарной части")
    if own != station_id:
        raise HTTPException(403, "Доступна только техника своей части")


def _vehicle_row(r: dict) -> dict:
    return {
        "id": r["id"],
        "station_id": r["station_id"],
        "station_name": r.get("station_name"),
        "callsign": r["callsign"],
        "vehicle_type": r["vehicle_type"],
        "status": r["status"],
        "water_l": r["water_l"],
        "note": r["note"],
        "updated_at": _iso(r.get("updated_at")),
    }


def _callout_vehicles(db: Session, callout_id: int) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT v.id, v.station_id, s.name AS station_name, v.callsign,
                   v.vehicle_type, v.status, v.water_l, v.note, v.updated_at,
                   cv.assigned_at, cv.released_at
              FROM callout_vehicles cv
              JOIN station_vehicles v ON v.id = cv.vehicle_id
              LEFT JOIN fire_stations s ON s.id = v.station_id
             WHERE cv.callout_id = :id AND cv.released_at IS NULL
             ORDER BY s.name, v.callsign
            """
        ),
        {"id": callout_id},
    ).mappings().all()
    return [
        {**_vehicle_row(dict(r)), "assigned_at": _iso(r["assigned_at"])} for r in rows
    ]


def _callout_resources(db: Session, callout_id: int) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT item_key, qty, recorded_by, recorded_at FROM callout_resources "
            "WHERE callout_id = :id ORDER BY item_key"
        ),
        {"id": callout_id},
    ).mappings().all()
    return [
        {
            "item_key": r["item_key"],
            "qty": float(r["qty"]),
            "recorded_by": r["recorded_by"],
            "recorded_at": _iso(r["recorded_at"]),
        }
        for r in rows
    ]


@router.patch("/{callout_id}/timeline")
def update_timeline(
    callout_id: int,
    body: TimelineUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> dict:
    """Проставить отметки боевых действий.

    Проверяется только монотонность фактически заполненных отметок: реальный
    выезд часто не имеет полного набора (ложный вызов закрывается без подачи
    ствола), и требовать все отметки значило бы заставлять РТП выдумывать их.
    """
    row = _fetch_callout(db, callout_id)
    patch = body.model_dump(exclude_unset=True)

    # Итоговое состояние = текущее + патч; порядок проверяется по нему целиком,
    # иначе отметку можно было бы «просунуть» между уже стоящими.
    merged: dict = {f: row.get(f) for f in TIMELINE_FIELDS}
    for field in TIMELINE_FIELDS:
        if field in patch:
            raw = patch[field]
            if raw is None:
                merged[field] = None
                continue
            try:
                merged[field] = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(422, f"{field}: ожидается дата в формате ISO 8601")

    created = row["created_at"]
    ordered = [(f, merged[f]) for f in TIMELINE_FIELDS if merged[f] is not None]
    for field, value in ordered:
        if created is not None and value < created:
            raise HTTPException(422, f"{field}: раньше времени регистрации вызова")
    for (prev_f, prev_v), (next_f, next_v) in zip(ordered, ordered[1:]):
        if next_v < prev_v:
            raise HTTPException(422, f"{next_f} не может быть раньше {prev_f}")

    sets = [f"{f} = :{f}" for f in TIMELINE_FIELDS if f in patch]
    params: dict = {f: merged[f] for f in TIMELINE_FIELDS if f in patch}
    if "rank_declared" in patch:
        sets.append("rank_declared = :rank_declared")
        params["rank_declared"] = patch["rank_declared"]
    if sets:
        params["id"] = callout_id
        db.execute(
            text(f"UPDATE callouts SET {', '.join(sets)} WHERE id = :id"), params
        )
        db.commit()

    audit(
        action="callout.timeline",
        username=user.get("username"),
        role=user.get("role"),
        method="PATCH",
        path=f"/dispatch/{callout_id}/timeline",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id, "fields": sorted(patch)},
    )
    return _callout_dict(_fetch_callout(db, callout_id))


@router.get("/vehicles")
def list_vehicles(
    station_id: int | None = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> dict:
    """Техника частей со сводкой доступности.

    Сводка — то, чего не хватало расчёту сил: он предлагает N отделений, не
    зная, есть ли они в строю. `available` считается по всему городу, чтобы
    диспетчер видел, откуда добирать силы, если своя часть исчерпана.
    """
    clause = "WHERE v.station_id = :sid" if station_id is not None else ""
    params = {"sid": station_id} if station_id is not None else {}
    rows = db.execute(
        text(
            f"""
            SELECT v.id, v.station_id, s.name AS station_name, v.callsign,
                   v.vehicle_type, v.status, v.water_l, v.note, v.updated_at
              FROM station_vehicles v
              LEFT JOIN fire_stations s ON s.id = v.station_id
              {clause}
             ORDER BY s.name, v.callsign
            """
        ),
        params,
    ).mappings().all()

    vehicles = [_vehicle_row(dict(r)) for r in rows]

    # Сводка строится от списка ЧАСТЕЙ, а не от списка машин: часть без техники
    # обязана остаться видимой. Иначе она исчезает из интерфейса вместе с
    # последней машиной — и поставить технику обратно становится некуда, а
    # диспетчер не видит, что часть пуста (это ровно тот случай, ради которого
    # учёт и заводился).
    station_clause = "WHERE s.id = :sid" if station_id is not None else ""
    stations = db.execute(
        text(f"SELECT s.id, s.name FROM fire_stations s {station_clause} ORDER BY s.name"),
        params,
    ).mappings().all()

    by_station: dict[int, dict] = {
        s["id"]: {
            "station_id": s["id"],
            "station_name": s["name"],
            "total": 0,
            **{st: 0 for st in VEHICLE_STATUSES},
        }
        for s in stations
    }
    for v in vehicles:
        entry = by_station.get(v["station_id"])
        if entry is None:  # часть удалена гонкой — машина осиротела
            continue
        entry["total"] += 1
        entry[v["status"]] += 1

    return {
        "vehicles": vehicles,
        "by_station": sorted(by_station.values(), key=lambda e: e["station_name"] or ""),
        "types": list(VEHICLE_TYPES),
        "statuses": list(VEHICLE_STATUSES),
    }


@router.post("/stations/{station_id}/vehicles")
def create_vehicle(
    station_id: int,
    body: VehicleCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> dict:
    """Поставить машину на учёт в части."""
    exists = db.execute(
        text("SELECT 1 FROM fire_stations WHERE id = :id"), {"id": station_id}
    ).scalar()
    if not exists:
        raise HTTPException(404, "Пожарная часть не найдена")
    _assert_station_access(db, user, station_id)

    dup = db.execute(
        text(
            "SELECT 1 FROM station_vehicles "
            "WHERE station_id = :sid AND lower(callsign) = lower(:cs)"
        ),
        {"sid": station_id, "cs": body.callsign},
    ).scalar()
    if dup:
        raise HTTPException(409, "Позывной уже занят в этой части")

    new_id = db.execute(
        text(
            """
            INSERT INTO station_vehicles
                (station_id, callsign, vehicle_type, water_l, note, updated_by)
            VALUES (:sid, :cs, :vt, :water, :note, :by)
            RETURNING id
            """
        ),
        {
            "sid": station_id,
            "cs": body.callsign.strip(),
            "vt": body.vehicle_type,
            "water": body.water_l,
            "note": body.note,
            "by": user.get("username"),
        },
    ).scalar()
    db.commit()

    audit(
        action="vehicle.created",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/dispatch/stations/{station_id}/vehicles",
        status_code=200,
        ip=client_ip(request),
        detail={"vehicle_id": new_id, "station_id": station_id,
                "callsign": body.callsign},
    )
    return {"id": new_id}


@router.patch("/vehicles/{vehicle_id}")
def update_vehicle(
    vehicle_id: int,
    body: VehiclePatch,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> dict:
    """Изменить состояние машины (в строю / на выезде / ремонт / резерв)."""
    row = db.execute(
        text("SELECT id, station_id FROM station_vehicles WHERE id = :id"),
        {"id": vehicle_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Машина не найдена")
    _assert_station_access(db, user, row["station_id"])

    patch = body.model_dump(exclude_unset=True)
    sets = ", ".join(f"{k} = :{k}" for k in patch)
    db.execute(
        text(
            f"UPDATE station_vehicles SET {sets}, updated_by = :by, "
            "updated_at = now() WHERE id = :id"
        ),
        {**patch, "by": user.get("username"), "id": vehicle_id},
    )
    db.commit()

    audit(
        action="vehicle.updated",
        username=user.get("username"),
        role=user.get("role"),
        method="PATCH",
        path=f"/dispatch/vehicles/{vehicle_id}",
        status_code=200,
        ip=client_ip(request),
        detail={"vehicle_id": vehicle_id, "changes": patch},
    )
    return {"id": vehicle_id, **patch}


@router.delete("/vehicles/{vehicle_id}")
def delete_vehicle(
    vehicle_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> dict:
    """Снять машину с учёта. Назначения на прошлые выезды уходят каскадом."""
    row = db.execute(
        text("SELECT id, station_id, callsign FROM station_vehicles WHERE id = :id"),
        {"id": vehicle_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Машина не найдена")
    _assert_station_access(db, user, row["station_id"])

    db.execute(text("DELETE FROM station_vehicles WHERE id = :id"), {"id": vehicle_id})
    db.commit()

    audit(
        action="vehicle.deleted",
        username=user.get("username"),
        role=user.get("role"),
        method="DELETE",
        path=f"/dispatch/vehicles/{vehicle_id}",
        status_code=200,
        ip=client_ip(request),
        detail={"vehicle_id": vehicle_id, "callsign": row["callsign"]},
    )
    return {"deleted": vehicle_id}


@router.post("/{callout_id}/vehicles")
def assign_vehicles(
    callout_id: int,
    body: VehicleAssign,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> list[dict]:
    """Назначить машины на выезд и перевести их в статус «на выезде».

    Повторное назначение уже назначенной машины не ошибка, а обычная гонка
    двух диспетчеров — оно просто игнорируется (частичный уникальный индекс
    `callout_vehicles_active_key` гарантирует одно действующее назначение).
    """
    row = _fetch_callout(db, callout_id)
    if row["status"] != "active":
        raise HTTPException(409, "Выезд закрыт — наряд не меняется")

    found = db.execute(
        text("SELECT id FROM station_vehicles WHERE id = ANY(:ids)"),
        {"ids": body.vehicle_ids},
    ).scalars().all()
    missing = set(body.vehicle_ids) - set(found)
    if missing:
        raise HTTPException(404, f"Машины не найдены: {sorted(missing)}")

    db.execute(
        text(
            """
            INSERT INTO callout_vehicles (callout_id, vehicle_id, assigned_by)
            SELECT :cid, unnest(CAST(:ids AS bigint[])), :by
            ON CONFLICT DO NOTHING
            """
        ),
        {"cid": callout_id, "ids": body.vehicle_ids, "by": user.get("username")},
    )
    db.execute(
        text(
            "UPDATE station_vehicles SET status = 'on_callout', updated_at = now() "
            "WHERE id = ANY(:ids) AND status = 'in_service'"
        ),
        {"ids": body.vehicle_ids},
    )
    db.commit()

    audit(
        action="callout.vehicles_assigned",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/dispatch/{callout_id}/vehicles",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id, "vehicle_ids": body.vehicle_ids},
    )
    return _callout_vehicles(db, callout_id)


@router.delete("/{callout_id}/vehicles/{vehicle_id}")
def release_vehicle(
    callout_id: int,
    vehicle_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> list[dict]:
    """Снять машину с выезда и вернуть её в строй."""
    released = db.execute(
        text(
            "UPDATE callout_vehicles SET released_at = now() "
            "WHERE callout_id = :cid AND vehicle_id = :vid AND released_at IS NULL "
            "RETURNING id"
        ),
        {"cid": callout_id, "vid": vehicle_id},
    ).scalar()
    if released is None:
        raise HTTPException(404, "Машина не числится в наряде этого выезда")
    # Из ремонта/резерва машину в строй не возвращаем — её статус сменили руками.
    db.execute(
        text(
            "UPDATE station_vehicles SET status = 'in_service', updated_at = now() "
            "WHERE id = :vid AND status = 'on_callout'"
        ),
        {"vid": vehicle_id},
    )
    db.commit()

    audit(
        action="callout.vehicle_released",
        username=user.get("username"),
        role=user.get("role"),
        method="DELETE",
        path=f"/dispatch/{callout_id}/vehicles/{vehicle_id}",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id, "vehicle_id": vehicle_id},
    )
    return _callout_vehicles(db, callout_id)


@router.put("/{callout_id}/resources")
def put_resources(
    callout_id: int,
    body: ResourcesPut,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> list[dict]:
    """Записать расход средств по выезду (полная перезапись списка)."""
    _fetch_callout(db, callout_id)

    db.execute(
        text("DELETE FROM callout_resources WHERE callout_id = :id"),
        {"id": callout_id},
    )
    for line in body.items:
        db.execute(
            text(
                "INSERT INTO callout_resources (callout_id, item_key, qty, recorded_by) "
                "VALUES (:cid, :key, :qty, :by)"
            ),
            {
                "cid": callout_id,
                "key": line.item_key,
                "qty": line.qty,
                "by": user.get("username"),
            },
        )
    db.commit()

    audit(
        action="callout.resources",
        username=user.get("username"),
        role=user.get("role"),
        method="PUT",
        path=f"/dispatch/{callout_id}/resources",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id,
                "items": {i.item_key: i.qty for i in body.items}},
    )
    return _callout_resources(db, callout_id)


# --- план развёртывания ------------------------------------------------------
#
# Расстановка сил по боевым участкам. Позиции стволов сопоставимы с расчётом
# (`forces_hint`): система показывает «подано 3 из 4 по расчёту» — то же
# сравнение факта с методикой, что и у наряда техники.
#
# Расстановка на локализации и на ликвидации хранится раздельно: это разные
# этапы боевых действий, и затирать первую второй нельзя — по ним разбирают
# выезд.


class PositionCreate(BaseModel):
    kind: str
    phase: str = "localization"
    sector: str | None = Field(None, max_length=120)
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    note: str | None = Field(None, max_length=500)
    vehicle_id: int | None = None
    # Идентификатор, выданный устройством (миграция 0021). Нужен позициям,
    # поставленным без связи: по нему повтор доставки узнаётся как тот же
    # ствол, а не как второй, и по нему же клиент находит свою позицию в
    # ответе, чтобы дальше двигать её уже по серверному id.
    client_uid: str | None = Field(None, min_length=1, max_length=64)
    # Время постановки по часам устройства. Отличается от created_at только
    # там, где связь пропадала: «ствол подан в 14:32, запись в 14:51».
    placed_at: datetime | None = None
    # Часы устройства в момент отправки запроса. По разнице с часами сервера
    # время постановки поправляется на сбитые часы планшета (см.
    # `_reconcile_placed_at`). У батча синхронизации — поле самого батча.
    sent_at: datetime | None = None
    # Расстановка внутри здания. Координаты — доля от габарита плана (0..1),
    # а не пиксели: план рисуется в разном масштабе (планшет, десктоп,
    # экспорт в донесение), и пиксельная координата «поехала» бы при первом
    # изменении размера.
    floor: str | None = Field(None, max_length=40)
    plan_x: float | None = Field(None, ge=0, le=1)
    plan_y: float | None = Field(None, ge=0, le=1)
    # Направление работы ствола, градусы (0 = север, по часовой).
    heading: int | None = Field(None, ge=0, le=359)

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, v: str) -> str:
        if v not in POSITION_KINDS:
            raise ValueError(f"неизвестный тип позиции: {v}")
        return v

    @field_validator("phase")
    @classmethod
    def _known_phase(cls, v: str) -> str:
        if v not in POSITION_PHASES:
            raise ValueError(f"неизвестный этап: {v}")
        return v

    @model_validator(mode="after")
    def _coords_together(self) -> "PositionCreate":
        # Половина координаты бесполезна и на карте выглядит как позиция в
        # нулевой точке — требуем пару целиком либо ничего.
        if (self.lat is None) != (self.lng is None):
            raise ValueError("координаты указываются парой lat+lng")
        if (self.plan_x is None) != (self.plan_y is None):
            raise ValueError("координаты на плане указываются парой plan_x+plan_y")
        return self


class PositionPatch(BaseModel):
    """Правка позиции: перетаскивание на плане, поворот, смена участка.

    Существует ради интерактивной расстановки: перетащить маркер — это
    изменить координаты, а не удалить и создать заново (иначе в истории
    выезда каждая корректировка выглядела бы как новая позиция).
    """

    sector: str | None = Field(None, max_length=120)
    note: str | None = Field(None, max_length=500)
    phase: str | None = None
    floor: str | None = Field(None, max_length=40)
    plan_x: float | None = Field(None, ge=0, le=1)
    plan_y: float | None = Field(None, ge=0, le=1)
    heading: int | None = Field(None, ge=0, le=359)
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)

    @field_validator("phase")
    @classmethod
    def _known_phase(cls, v: str | None) -> str | None:
        if v is not None and v not in POSITION_PHASES:
            raise ValueError(f"неизвестный этап: {v}")
        return v

    @model_validator(mode="after")
    def _require_change(self) -> "PositionPatch":
        if not self.model_fields_set:
            raise ValueError("укажите хотя бы одно поле")
        sent = self.model_fields_set
        if ("plan_x" in sent) != ("plan_y" in sent):
            raise ValueError("координаты на плане меняются парой plan_x+plan_y")
        if ("lat" in sent) != ("lng" in sent):
            raise ValueError("координаты на карте меняются парой lat+lng")
        return self


def _deployment(db: Session, callout_id: int) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT p.id, p.kind, p.phase, p.sector, p.note, p.vehicle_id,
                   p.floor, p.plan_x, p.plan_y, p.heading,
                   p.client_uid, p.placed_at, p.synced_after_close_at,
                   v.callsign AS vehicle_callsign,
                   ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
                   p.created_by, p.created_at
              FROM deployment_positions p
              LEFT JOIN station_vehicles v ON v.id = p.vehicle_id
             WHERE p.callout_id = :id
             ORDER BY p.phase, p.id
            """
        ),
        {"id": callout_id},
    ).mappings().all()
    return [
        {
            "id": r["id"],
            "kind": r["kind"],
            "phase": r["phase"],
            "sector": r["sector"],
            "note": r["note"],
            "floor": r["floor"],
            "plan_x": r["plan_x"],
            "plan_y": r["plan_y"],
            "heading": r["heading"],
            "vehicle_id": r["vehicle_id"],
            "vehicle_callsign": r["vehicle_callsign"],
            "lat": r["lat"],
            "lng": r["lng"],
            "client_uid": r["client_uid"],
            "placed_at": _iso(r["placed_at"]),
            # Не NULL — позиция дошла из очереди планшета уже после закрытия
            # выезда (см. `_late_sync_problem`); донесение помечает такие строки.
            "synced_after_close_at": _iso(r["synced_after_close_at"]),
            "created_by": r["created_by"],
            "created_at": _iso(r["created_at"]),
        }
        for r in rows
    ]


@router.get("/{callout_id}/deployment")
def get_deployment(
    callout_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> dict:
    """Расстановка сил по выезду со сверкой стволов против расчёта."""
    _fetch_callout(db, callout_id)
    positions = _deployment(db, callout_id)
    return {
        "positions": positions,
        "kinds": list(POSITION_KINDS),
        "phases": list(POSITION_PHASES),
    }


# Расхождение часов устройства и сервера, которое не поправляется. Разница
# «сервер − момент отправки» складывается из сбитых часов и времени в пути
# запроса; в пределах минуты второе сравнимо с первым, и поправка сдвинула бы
# точное время исправного планшета на задержку канала.
CLOCK_SKEW_TOLERANCE = timedelta(seconds=60)

# Допуск окна выезда: время в пределах [регистрация − 5 мин, сейчас + 5 мин]
# пишется как пришло (так было и до поправки часов — ранее принятое время
# старых клиентов не меняется). Время за его пределами — сбитые часы, и оно
# прижимается уже к жёстким границам выезда: «ствол подан за пять минут до
# вызова» в донесении хуже, чем «в момент регистрации».
PLACED_AT_SKEW = timedelta(minutes=5)


def _aware(v: datetime) -> bool:
    return v.tzinfo is not None and v.utcoffset() is not None


@dataclass(frozen=True)
class PlacedAt:
    """Время постановки после сверки с часами сервера.

    `problem` — причина не записывать позицию; `clock` — что пришлось сделать
    со временем (для журнала): None, если время записано как пришло.
    `early` — время оказалось раньше регистрации выезда и прижато к ней:
    в открытом выезде это безвредно, а закрытому (`_late_time_problem`) такое
    время ничего не доказывает.
    """

    value: datetime | None
    problem: str | None = None
    clock: dict | None = None
    early: bool = False


def _reconcile_placed_at(
    placed_at: datetime | None,
    sent_at: datetime | None,
    callout_created_at: datetime | None,
    now: datetime,
) -> PlacedAt:
    """Свести время постановки с часов устройства к часам сервера.

    Время приходит с наименее проверяемой стороны, а уходит в донесение как
    факт боевых действий («ствол подан в 14:32»). Раньше неправдоподобное
    время отвергало позицию — и планшет, у которого часы спешат на десять
    минут, терял каждый поставленный ствол даже при живой связи: маркер
    уходил в «не принято» посреди расстановки. Отказ из-за часов хуже любой
    неточности времени, поэтому время здесь **поправляется, а не отвергается**:

      1. `sent_at` — часы устройства в момент отправки. Разница с часами
         сервера и есть сбой часов планшета; на неё сдвигается время
         постановки (за пределами допуска, см. CLOCK_SKEW_TOLERANCE).
      2. Результат за пределами окна выезда (с допуском PLACED_AT_SKEW)
         прижимается к его границам: не раньше регистрации вызова и не позже
         «сейчас». Старый клиент без `sent_at` получает только это.

    Отвергается одно — время без часового пояса: какие это 14:32, узнать
    неоткуда. `Date.prototype.toISOString()` пояс даёт всегда (`Z`).
    """
    if placed_at is None:
        return PlacedAt(None)
    if not _aware(placed_at):
        return PlacedAt(None, problem="Время постановки без часового пояса — позиция не записана")

    skew = now - sent_at if sent_at is not None and _aware(sent_at) else None
    corrected = skew is not None and abs(skew) > CLOCK_SKEW_TOLERANCE
    value = placed_at
    if corrected:
        try:
            value = placed_at + skew
        except OverflowError:
            # Время постановки и время отправки противоречат друг другу
            # (одно у нулевого года, другое у десятитысячного) — поправлять
            # не по чему, остаётся прижать к выезду.
            value = placed_at

    low = None
    if callout_created_at is not None:
        low = (
            callout_created_at
            if _aware(callout_created_at)
            else callout_created_at.replace(tzinfo=timezone.utc)
        )
    too_early = low is not None and value < low - PLACED_AT_SKEW
    too_late = value > now + PLACED_AT_SKEW
    bounded = value
    if too_early:
        bounded = low
    elif too_late:
        bounded = now if low is None else max(now, low)
    clamped = too_early or too_late

    clock = None
    if corrected or clamped:
        clock = {
            "device_placed_at": _iso(placed_at),
            "sent_at": _iso(sent_at),
            "clock_skew_sec": round(skew.total_seconds()) if skew is not None else None,
            "clamped": clamped,
        }
    return PlacedAt(bounded, clock=clock, early=too_early)


# --- досинхронизация после закрытия выезда ------------------------------------
#
# РТП работал без связи, диспетчер тем временем закрыл выезд. Раньше очередь
# планшета получала 409 на весь батч и откладывала расстановку в «Не принято»:
# до донесения и разбора она не доходила никогда. Но расстановка — факт боевых
# действий, и то, что поставлено до закрытия, обязано попасть в дело.
#
# Правило (отказ — поимённый, отказ одной позиции не отменяет остальные):
#   • окно — не дольше LATE_SYNC_WINDOW после закрытия (очередь живёт 48 ч,
#     настоящие данные в него всегда укладываются);
#   • кто — только начальник караула (responder) части, участвовавшей в
#     выезде: назначенной на выезд или приславшей машину в наряд
#     (`_late_crew_problem`). Диспетчер, админ, караулы других частей и
#     responder без привязки к части в закрытый выезд не пишут ничего;
#   • постановка — если её время, сведённое к часам сервера
#     (`_reconcile_placed_at`), не позже закрытия + LATE_SYNC_TOLERANCE.
#     Время, прижатое к регистрации выезда, и отсутствующее время — отказ:
#     постановку до закрытия они не доказывают;
#   • правка и снятие — только своих позиций с плана (client_uid есть, автор —
#     тот же пользователь) и только с временем жеста (`gesture_at`), которое
#     после поправки часов не позже закрытия + допуск. Без времени жеста
#     (старый клиент) — отказ, а не молчаливое принятие;
#   • принятое помечается `synced_after_close_at`, снятое оставляет надгробие
#     `deployment_late_removals`, всё пишется в журнал с `after_close: true`.

# Допуск к моменту закрытия: РТП ставил ствол, пока диспетчер нажимал
# «Закрыть», а часы планшета после поправки точны до канала связи.
LATE_SYNC_TOLERANCE = timedelta(minutes=5)
# Сколько после закрытия выезд ещё принимает очередь.
LATE_SYNC_WINDOW = timedelta(days=7)

LATE_CLOSED = "Выезд закрыт — расстановка не меняется"
LATE_TOO_OLD = "Выезд закрыт более 7 дней назад — позиция не записана"
LATE_AFTER_CLOSE = "Позиция поставлена после закрытия выезда — не записана"
LATE_NO_TIME = "Время постановки неизвестно — после закрытия выезда позиция не записана"
LATE_NOT_OWN = (
    "Выезд закрыт — после закрытия принимаются только свои позиции, поставленные на плане"
)
LATE_NOT_CREW = "Досинхронизация после закрытия — только расчёт части, участвовавшей в выезде"
LATE_MOVE_NO_TIME = "Время перемещения неизвестно — после закрытия выезда правка не записана"
LATE_MOVED_AFTER_CLOSE = "Позиция перемещена после закрытия выезда — правка не записана"
LATE_REMOVE_NO_TIME = "Время снятия неизвестно — после закрытия выезда позиция не снята"
LATE_REMOVED_AFTER_CLOSE = "Позиция снята после закрытия выезда — снятие не записано"


def _late_sync_window_problem(closed_at: datetime | None, now: datetime) -> str | None:
    """Принимает ли закрытый выезд очередь вообще: None — да, иначе причина.

    Закрытый выезд без отметки закрытия (правка базой вручную) не принимает
    ничего: сверять время постановки не с чем.
    """
    if closed_at is None:
        return LATE_CLOSED
    closed = closed_at if _aware(closed_at) else closed_at.replace(tzinfo=timezone.utc)
    if now - closed > LATE_SYNC_WINDOW:
        return LATE_TOO_OLD
    return None


def _late_sync_problem(
    placed_at: datetime | None,
    closed_at: datetime | None,
    now: datetime,
    *,
    no_time: str = LATE_NO_TIME,
    after_close: str = LATE_AFTER_CLOSE,
) -> str | None:
    """Можно ли записать позицию в уже закрытый выезд: None — можно.

    `placed_at` — уже сведённое к часам сервера время постановки (или жеста —
    тогда причины отказа передаются своими). Время без пояса или без значения
    не доказывает, что действие было до закрытия, поэтому не записывается.
    """
    window = _late_sync_window_problem(closed_at, now)
    if window:
        return window
    assert closed_at is not None  # проверено окном
    closed = closed_at if _aware(closed_at) else closed_at.replace(tzinfo=timezone.utc)
    if placed_at is None or not _aware(placed_at):
        return no_time
    if placed_at > closed + LATE_SYNC_TOLERANCE:
        return after_close
    return None


def _late_time_problem(
    fix: PlacedAt,
    closed_at: datetime | None,
    now: datetime,
    *,
    no_time: str = LATE_NO_TIME,
    after_close: str = LATE_AFTER_CLOSE,
) -> str | None:
    """Время, уже сведённое `_reconcile_placed_at`, против закрытия выезда.

    Прижатое к регистрации время (часы отставали, поправить не по чему) в
    открытом выезде — безвредная неточность, а в закрытом превращало бы
    недоказуемое время в принятое «в момент регистрации». Здесь это отказ.
    """
    if fix.problem or fix.early:
        return _late_sync_window_problem(closed_at, now) or no_time
    return _late_sync_problem(
        fix.value, closed_at, now, no_time=no_time, after_close=after_close
    )


def _late_crew_problem(
    role: str | None, own_station: int | None, crew_stations: set[int]
) -> str | None:
    """Кто досинхронизирует расстановку в закрытый выезд: None — можно.

    Только начальник караула (`responder`) части, участвовавшей в выезде:
    назначенной на выезд (`callouts.station_id`) либо приславшей машину в наряд
    (`callout_vehicles`, в том числе уже снятую с выезда). Досинхронизация —
    доставка того, что расчёт делал на пожаре без связи, а не второй вход в
    закрытый выезд. Диспетчер и админ на пожаре позиций не ставят, караулы
    других частей в выезде не участвовали, а у responder без привязки к части
    (`users.station_id` пуст) участие не проверить — всем им отказ.
    Правило одно для новых постановок, повторов, правок и снятий своих позиций.
    """
    if role != "responder" or own_station is None:
        return LATE_NOT_CREW
    return None if own_station in crew_stations else LATE_NOT_CREW


def _callout_crew_stations(db: Session, callout_id: int, station_id: int | None) -> set[int]:
    """Части, участвовавшие в выезде: назначенная и приславшие машины."""
    stations = set(
        db.execute(
            text(
                "SELECT DISTINCT v.station_id FROM callout_vehicles cv "
                "JOIN station_vehicles v ON v.id = cv.vehicle_id WHERE cv.callout_id = :cid"
            ),
            {"cid": callout_id},
        ).scalars().all()
    )
    if station_id is not None:
        stations.add(station_id)
    return stations


def _late_target_problem(
    target: dict, username: str | None, closed_at: datetime | None, now: datetime
) -> str | None:
    """Правка или снятие позиции в закрытом выезде: None — можно.

    `target` — строка позиции: client_uid, created_by и placed_at (время
    постановки, а для позиций без него — время записи).
    """
    if target.get("client_uid") is None or target.get("created_by") != username:
        return LATE_NOT_OWN
    return _late_sync_problem(target.get("placed_at"), closed_at, now)


def _late_target(
    db: Session, callout_id: int, position_id: int | None, client_uid: str | None = None
) -> dict | None:
    """Позиция, которую очередь правит или снимает в закрытом выезде.

    FOR UPDATE: между проверкой автора и записью позицию не тронут.
    """
    if position_id is not None:
        where, params = "id = :pid", {"cid": callout_id, "pid": position_id}
    else:
        where, params = "client_uid = :uid", {"cid": callout_id, "uid": client_uid}
    row = db.execute(
        text(
            "SELECT id, client_uid, created_by, COALESCE(placed_at, created_at) AS placed_at "
            f"FROM deployment_positions WHERE callout_id = :cid AND {where} FOR UPDATE"
        ),
        params,
    ).mappings().first()
    return dict(row) if row is not None else None


def _remove_position(
    db: Session,
    callout_id: int,
    position_id: int | None,
    client_uid: str | None,
    *,
    late: dict | None = None,
) -> int | None:
    """Снять позицию по id либо по client_uid: id снятой, None — её не было.

    `late` — снятие пришло в закрытый выезд (`removed_at`, `removed_by`,
    `synced_at`): вместе со строкой в той же операции пишется надгробие
    `deployment_late_removals`. Без него снятие после закрытия осталось бы
    только в журнале, и ни донесение, ни пульт его бы не увидели.
    """
    if position_id is not None:
        where, params = "id = :pid", {"cid": callout_id, "pid": position_id}
    else:
        where, params = "client_uid = :uid", {"cid": callout_id, "uid": client_uid}
    if late is None:
        return db.execute(
            text(
                f"DELETE FROM deployment_positions WHERE callout_id = :cid AND {where} "
                "RETURNING id"
            ),
            params,
        ).scalar()
    return db.execute(
        text(
            f"""
            WITH gone AS (
                DELETE FROM deployment_positions WHERE callout_id = :cid AND {where}
                RETURNING id, callout_id, client_uid, kind, phase, floor, sector,
                          COALESCE(placed_at, created_at) AS placed_at, created_by
            )
            INSERT INTO deployment_late_removals
                (callout_id, position_id, client_uid, kind, phase, floor, sector,
                 placed_at, created_by, removed_at, removed_by, synced_at)
            SELECT callout_id, id, client_uid, kind, phase, floor, sector,
                   placed_at, created_by, :removed_at, :removed_by, :synced_at
              FROM gone
            RETURNING position_id
            """
        ),
        {**params, **late},
    ).scalar()


# Поля, которые повтор постановки может обновить (см. `_upsert_position`).
_UPSERT_FIELDS = ("phase", "floor", "plan_x", "plan_y", "heading", "sector", "note")


def _upsert_position(
    db: Session,
    callout_id: int,
    body: PositionCreate,
    username: str | None,
    *,
    after_close_at: datetime | None = None,
) -> tuple[int, str, list[str]]:
    """Записать позицию: `(id, "inserted" | "updated" | "unchanged", поля)`.

    Третий элемент — поля, которые повтор действительно изменил: в журнал
    перемещения попадает то, что сдвинулось, а не весь список полей схемы.

    Доставка очереди расстановки — at-least-once: POST мог закоммититься и не
    донести ответ (в поле это обычный случай, а не редкость). Повтор с тем же
    client_uid обязан быть безвредным, иначе после каждого разрыва связи на
    плане появлялся бы второй ствол в той же точке.

    Но «безвредный» не значит «игнорируемый». Очередь шлёт не первоначальную
    постановку, а конечное состояние позиции: ответ на первую отправку
    потерялся, РТП тем временем передвинул ствол — и повтор приходит уже с
    новыми координатами. DO NOTHING молча выбросил бы перемещение, а клиент,
    получив «принято», убрал бы его из очереди: ствол остался бы в старой
    точке и на сервере, и в напечатанном донесении. Поэтому конфликт
    обновляет поля, которыми распоряжается схема (этап, этаж, точка,
    направление). Участок и примечание — только если устройство их прислало:
    их могли уточнить с пульта, и пустое значение из очереди не должно их
    стирать. Тип позиции, машина и авторство не меняются: это другая позиция,
    а не правка этой.

    `after_close_at` — выезд уже закрыт, запись идёт по правилу досинхронизации
    (`_late_sync_problem`): вставка или реальное изменение помечаются этим
    временем, а позицию другого автора с тем же client_uid повтор не трогает.
    """
    if body.vehicle_id is not None:
        exists = db.execute(
            text("SELECT 1 FROM station_vehicles WHERE id = :id"), {"id": body.vehicle_id}
        ).scalar()
        if not exists:
            raise HTTPException(404, "Машина не найдена")

    # Прежнее состояние позиции — чтобы назвать в журнале изменённые поля.
    # FOR UPDATE: между чтением и записью позицию не подвинут с пульта.
    prev = None
    if body.client_uid is not None:
        prev = db.execute(
            text(
                "SELECT phase, floor, plan_x, plan_y, heading, sector, note, created_by "
                "FROM deployment_positions WHERE callout_id = :cid AND client_uid = :uid "
                "FOR UPDATE"
            ),
            {"cid": callout_id, "uid": body.client_uid},
        ).mappings().first()
    if after_close_at is not None and prev is not None and prev["created_by"] != username:
        raise HTTPException(409, LATE_NOT_OWN)

    geom = (
        "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)"
        if body.lat is not None
        else "NULL"
    )
    row = db.execute(
        text(
            f"""
            INSERT INTO deployment_positions AS p
                (callout_id, kind, phase, sector, geom, note, vehicle_id,
                 floor, plan_x, plan_y, heading, client_uid, placed_at, created_by,
                 synced_after_close_at)
            VALUES (:cid, :kind, :phase, :sector, {geom}, :note, :vid,
                    :floor, :plan_x, :plan_y, :heading, :uid, :placed_at, :by,
                    :late)
            -- Предикат обязателен: индекс частичный (позиции с пульта
            -- client_uid не имеют, и их NULL'ы не конфликтуют между собой).
            ON CONFLICT (callout_id, client_uid) WHERE client_uid IS NOT NULL
            DO UPDATE SET
                phase   = EXCLUDED.phase,
                floor   = EXCLUDED.floor,
                plan_x  = EXCLUDED.plan_x,
                plan_y  = EXCLUDED.plan_y,
                heading = EXCLUDED.heading,
                sector  = COALESCE(EXCLUDED.sector, p.sector),
                note    = COALESCE(EXCLUDED.note, p.note),
                -- Пометка «после закрытия» ставится только тем, что пришло
                -- после закрытия, и не снимается повтором из открытого выезда.
                synced_after_close_at =
                    COALESCE(EXCLUDED.synced_after_close_at, p.synced_after_close_at)
            -- Чистый повтор (ничего не изменилось) строку не трогает: иначе
            -- каждый разрыв связи писал бы в журнал перемещение, которого не было.
            WHERE (p.phase, p.floor, p.plan_x, p.plan_y, p.heading,
                   p.sector, p.note)
                  IS DISTINCT FROM
                  (EXCLUDED.phase, EXCLUDED.floor, EXCLUDED.plan_x, EXCLUDED.plan_y,
                   EXCLUDED.heading, COALESCE(EXCLUDED.sector, p.sector),
                   COALESCE(EXCLUDED.note, p.note))
            -- xmax = 0 только у только что вставленной строки: так один
            -- запрос отличает постановку от правки повтором.
            RETURNING id, (xmax = 0) AS inserted
            """
        ),
        {
            "cid": callout_id,
            "kind": body.kind,
            "phase": body.phase,
            "sector": body.sector,
            "lat": body.lat,
            "lng": body.lng,
            "note": body.note,
            "vid": body.vehicle_id,
            "floor": body.floor,
            "plan_x": body.plan_x,
            "plan_y": body.plan_y,
            "heading": body.heading,
            "uid": body.client_uid,
            "placed_at": body.placed_at,
            "by": username,
            "late": after_close_at,
        },
    ).mappings().first()
    if row is not None and row["inserted"]:
        return row["id"], "inserted", []
    if row is not None:
        if prev is None:
            # Позицию вставил параллельный запрос между чтением и записью —
            # прежнего состояния нет, называем все поля, которые мог тронуть повтор.
            return row["id"], "updated", sorted(_UPSERT_FIELDS)
        # Колонки — double precision / smallint / text: значение из запроса
        # возвращается базой бит в бит, и сравнение в Python совпадает с
        # IS DISTINCT FROM в самом запросе.
        after = {
            "phase": body.phase, "floor": body.floor, "plan_x": body.plan_x,
            "plan_y": body.plan_y, "heading": body.heading,
            "sector": body.sector if body.sector is not None else prev["sector"],
            "note": body.note if body.note is not None else prev["note"],
        }
        return row["id"], "updated", sorted(f for f in _UPSERT_FIELDS if after[f] != prev[f])
    # Конфликт был, но менять нечего — возвращаем уже записанную позицию.
    existing = db.execute(
        text(
            "SELECT id FROM deployment_positions "
            "WHERE callout_id = :cid AND client_uid = :uid"
        ),
        {"cid": callout_id, "uid": body.client_uid},
    ).scalar()
    return existing, "unchanged", []


@router.post("/{callout_id}/deployment")
def add_position(
    callout_id: int,
    body: PositionCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> list[dict]:
    """Поставить позицию в план развёртывания."""
    row = _fetch_callout(db, callout_id)
    if row["status"] != "active":
        raise HTTPException(409, "Выезд закрыт — расстановка не меняется")
    placed = _reconcile_placed_at(
        body.placed_at, body.sent_at, row["created_at"], datetime.now(timezone.utc)
    )
    if placed.problem:
        raise HTTPException(422, placed.problem)

    item = body.model_copy(update={"placed_at": placed.value})
    new_id, state, changed = _upsert_position(db, callout_id, item, user.get("username"))
    db.commit()

    # Повтор с тем же client_uid — не вторая постановка: иначе в журнале
    # выезда один ствол выглядел бы двумя.
    if state == "inserted":
        action = "callout.deployment_added"
        detail = {"callout_id": callout_id, "position_id": new_id,
                  "kind": body.kind, "phase": body.phase}
        if body.client_uid is not None:
            detail["client_uid"] = body.client_uid
        if placed.value is not None:
            detail["placed_at"] = _iso(placed.value)
        if placed.clock:
            detail.update(placed.clock)
    elif state == "updated" and changed:
        action = "callout.deployment_moved"
        detail = {"callout_id": callout_id, "position_id": new_id,
                  "client_uid": body.client_uid, "replay": True, "fields": changed}
    else:
        return _deployment(db, callout_id)

    audit(
        action=action,
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/dispatch/{callout_id}/deployment",
        status_code=200,
        ip=client_ip(request),
        detail=detail,
    )
    return _deployment(db, callout_id)


def _update_position_row(
    db: Session,
    callout_id: int,
    position_id: int,
    body: "PositionPatch",
    *,
    after_close_at: datetime | None = None,
) -> list[str] | None:
    """Применить правку к позиции: поля, которые изменились; None — позиции нет.

    «Нет» здесь не ошибка клиента: пока РТП был без связи, диспетчер мог
    снять эту позицию с пульта. Решение, что с этим делать, принимает
    вызывающий: одиночный PATCH отвечает 404, синхронизация очереди —
    откладывает позицию в отвергнутые и продолжает с остальными.

    Пустой список — правка ничего не меняет (повтор доставки): строка не
    трогается, и в журнал писать нечего.

    `after_close_at` — правка пришла из очереди в закрытый выезд: реальное
    изменение помечается этим временем (см. `_late_sync_problem`).
    """
    prev = db.execute(
        text(
            "SELECT sector, note, phase, floor, plan_x, plan_y, heading, "
            "       ST_Y(geom) AS lat, ST_X(geom) AS lng "
            "FROM deployment_positions WHERE id = :pid AND callout_id = :cid FOR UPDATE"
        ),
        {"pid": position_id, "cid": callout_id},
    ).mappings().first()
    if prev is None:
        return None

    # `id` и `client_uid` приходят в теле только у батча синхронизации — это
    # адрес строки, а не изменяемые поля.
    patch = body.model_dump(exclude_unset=True)
    patch.pop("id", None)
    patch.pop("client_uid", None)
    # Колонки — double precision / smallint / text, точка хранится парой
    # double: сравнение в Python точное, округления не вмешиваются.
    changed = sorted(k for k, v in patch.items() if prev[k] != v)
    if not changed:
        return []

    sets: list[str] = []
    params: dict = {"pid": position_id}
    # Географическая точка собирается из пары координат, остальное — как есть.
    lat, lng = patch.pop("lat", None), patch.pop("lng", None)
    if "lat" in changed or "lng" in changed:
        if lat is None:
            sets.append("geom = NULL")
        else:
            sets.append("geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)")
            params.update(lat=lat, lng=lng)
    for key, value in patch.items():
        if key in changed:
            sets.append(f"{key} = :{key}")
            params[key] = value
    if after_close_at is not None:
        sets.append("synced_after_close_at = :late")
        params["late"] = after_close_at

    db.execute(
        text(f"UPDATE deployment_positions SET {', '.join(sets)} WHERE id = :pid"),
        params,
    )
    return changed


@router.patch("/{callout_id}/deployment/{position_id}")
def update_position(
    callout_id: int,
    position_id: int,
    body: PositionPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> list[dict]:
    """Подвинуть позицию, повернуть ствол, сменить участок или этаж.

    Перетаскивание маркера — это правка координат, а не «удалить и создать
    заново»: иначе каждая корректировка расстановки выглядела бы в истории
    выезда как новая позиция, и разобрать по ней ход тушения было бы нельзя.
    """
    row = _fetch_callout(db, callout_id)
    if row["status"] != "active":
        raise HTTPException(409, "Выезд закрыт — расстановка не меняется")

    changed = _update_position_row(db, callout_id, position_id, body)
    if changed is None:
        raise HTTPException(404, "Позиция не найдена")
    db.commit()

    if changed:
        audit(
            action="callout.deployment_moved",
            username=user.get("username"),
            role=user.get("role"),
            method="PATCH",
            path=f"/dispatch/{callout_id}/deployment/{position_id}",
            status_code=200,
            ip=client_ip(request),
            detail={"callout_id": callout_id, "position_id": position_id,
                    "fields": changed},
        )
    return _deployment(db, callout_id)


@router.delete("/{callout_id}/deployment/{position_id}")
def delete_position(
    callout_id: int,
    position_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> list[dict]:
    """Снять позицию с плана развёртывания.

    На закрытом выезде — 409, как у постановки и правки: расстановка закрытого
    выезда — документ разбора, и снимать с него позиции с пульта нельзя.
    Досинхронизация своих позиций с планшета идёт через `/deployment/sync`.
    """
    row = _fetch_callout(db, callout_id)
    if row["status"] != "active":
        raise HTTPException(409, "Выезд закрыт — расстановка не меняется")
    deleted = db.execute(
        text(
            "DELETE FROM deployment_positions WHERE id = :pid AND callout_id = :cid "
            "RETURNING id"
        ),
        {"pid": position_id, "cid": callout_id},
    ).scalar()
    if deleted is None:
        raise HTTPException(404, "Позиция не найдена")
    db.commit()

    audit(
        action="callout.deployment_removed",
        username=user.get("username"),
        role=user.get("role"),
        method="DELETE",
        path=f"/dispatch/{callout_id}/deployment/{position_id}",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id, "position_id": position_id},
    )
    return _deployment(db, callout_id)


class SyncCreate(PositionCreate):
    """Постановка позиции из очереди устройства.

    Отличие от обычной — client_uid обязателен: без него повторную доставку
    той же позиции не отличить от второго ствола, поставленного рядом.
    """

    client_uid: str = Field(min_length=1, max_length=64)


class SyncPatch(PositionPatch):
    """Правка позиции из очереди: та же, что и одиночная, плюс адрес строки.

    Адрес — серверный id или client_uid. Позицию, поставленную на плане,
    устройство знает по client_uid с первой секунды, а серверный id может так
    и не узнать: ответ на постановку потерялся. Если пришли оба, строку
    находит id, а client_uid служит ключом ответа (см. `_sync_key`).
    """

    id: int | None = None
    client_uid: str | None = Field(None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def _beside_id(self) -> "SyncPatch":
        if self.id is None and self.client_uid is None:
            raise ValueError("укажите id или client_uid позиции")
        if not (self.model_fields_set - {"id", "client_uid"}):
            raise ValueError("укажите хотя бы одно поле кроме адреса позиции")
        return self


def _sync_key(client_uid: str | None, position_id: int | None) -> str:
    """Ключ операции в ответе синхронизации — тот же, что у очереди устройства.

    Очередь ключует позицию так же, как рисует: `client_uid ?? "srv:<id>"`
    (`mergePositions` в web/src/lib/deploymentQueue.ts). Отказ по правке под
    ключом `srv:<id>` для позиции с client_uid клиент у себя не находил и
    убирал правку как принятую — перемещение пропадало молча.
    """
    return client_uid if client_uid else f"srv:{position_id}"


def _resolve_position(
    db: Session, callout_id: int, position_id: int | None, client_uid: str | None
) -> int | None:
    """id позиции этого выезда по id либо по client_uid; None — такой нет."""
    if position_id is not None:
        return db.execute(
            text("SELECT id FROM deployment_positions WHERE id = :pid AND callout_id = :cid"),
            {"pid": position_id, "cid": callout_id},
        ).scalar()
    return db.execute(
        text(
            "SELECT id FROM deployment_positions "
            "WHERE callout_id = :cid AND client_uid = :uid"
        ),
        {"cid": callout_id, "uid": client_uid},
    ).scalar()


# Потолок батча. Расстановка на крупном пожаре — это десятки позиций; двести
# с запасом покрывают долгий перерыв связи и при этом не дают одному запросу
# занять плохой канал на минуту.
SYNC_MAX_ITEMS = 200

SyncUid = Annotated[str, Field(min_length=1, max_length=64)]
# Ключ ответа синхронизации: client_uid (до 64) или `srv:<id>`.
SyncKey = Annotated[str, Field(min_length=1, max_length=80)]


class DeploymentSync(BaseModel):
    """Очередь расстановки, накопленная устройством без связи.

    Клиент присылает не журнал жестов, а конечное состояние: позиция,
    поставленная и пять раз подвинутая без связи, приходит одним `create` с
    итоговыми координатами. Поэтому здесь нет порядка операций — только
    независимые списки.

    Снятие — двумя списками: `deletes` по серверному id (позиции с пульта) и
    `delete_uids` по client_uid (позиции с плана). Второй нужен позиции, которую
    сняли, пока её постановка была в полёте: серверного id у устройства нет, а
    без адреса снятие висело бы в очереди вечно, пока сервер хранит позицию.
    """

    creates: list[SyncCreate] = Field(default_factory=list)
    patches: list[SyncPatch] = Field(default_factory=list)
    deletes: list[int] = Field(default_factory=list)
    delete_uids: list[SyncUid] = Field(default_factory=list)
    # Часы устройства в момент отправки батча (см. `_reconcile_placed_at`).
    # Старые клиенты его не шлют — их время только прижимается к выезду.
    sent_at: datetime | None = None
    # Время жеста по часам устройства для правок и снятий, по ключу ответа
    # (`_sync_key`: client_uid или `srv:<id>`). Нужно закрытому выезду:
    # перемещение и снятие, сделанные уже после закрытия, не записываются, а
    # без времени их не отличить (`_late_time_problem`). Отдельной картой, а не
    # полем в элементах `deletes` (это список id): такой батч старый API отверг
    # бы 422, а 422 в очереди окончательный. Неизвестное поле верхнего уровня
    # старый API просто не читает.
    gesture_at: dict[SyncKey, datetime] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _bounded(self) -> "DeploymentSync":
        total = (
            len(self.creates) + len(self.patches) + len(self.deletes) + len(self.delete_uids)
        )
        if total == 0:
            raise ValueError("пустая синхронизация")
        if total > SYNC_MAX_ITEMS:
            raise ValueError(f"за один раз не больше {SYNC_MAX_ITEMS} операций")
        if len(self.gesture_at) > SYNC_MAX_ITEMS:
            raise ValueError(f"времён жестов не больше {SYNC_MAX_ITEMS}")
        return self


@router.post("/{callout_id}/deployment/sync")
def sync_deployment(
    callout_id: int,
    body: DeploymentSync,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(OPS_ROLES),
) -> dict:
    """Принять расстановку, накопленную устройством без связи.

    Один запрос вместо N поштучных — не ради экономии трафика: связь на
    пожаре появляется на секунды, и очередь из пятнадцати запросов успевает
    уйти наполовину, оставив расстановку в состоянии, которого не было ни на
    плане РТП, ни в замысле.

    Каждая позиция применяется в своём savepoint: одна отвергнутая (её сняли
    с пульта, пока связи не было) не должна утянуть за собой остальные.
    Клиент получает поимённый разбор — что принято, что нет и почему, — и
    показывает отвергнутое РТП, а не молча теряет.

    Закрытый выезд не отвергается целиком. Раньше здесь был 409 на весь батч,
    и расстановка, поставленная без связи ещё до закрытия, навсегда оставалась
    на планшете в «Не принято». Теперь она принимается поштучно по правилу
    досинхронизации (`_late_sync_problem`): поставленное не позже закрытия
    (+ допуск) записывается и помечается `synced_after_close_at`, поставленное
    позже, чужое или пришедшее спустя LATE_SYNC_WINDOW — отвергается с
    причиной. Поштучные POST/PATCH/DELETE с пульта на закрытом выезде по-
    прежнему получают 409.

    Ключи ответа — те же, что у очереди устройства (`_sync_key`): client_uid у
    позиций с плана, `srv:<id>` у позиций с пульта. Время постановки
    сводится к часам сервера поштучно (`_reconcile_placed_at`): сбитые часы
    планшета поправляются, а не отвергают позицию; отвергается только время
    без часового пояса — и тоже поштучно, а не батч.
    """
    # Часы сервера для поправки часов планшета — до блокировки: ожидание
    # закрытия, которое держит строку выезда, не должно попасть в разницу
    # «сервер − sent_at» и сдвинуть время постановки.
    now = datetime.now(timezone.utc)
    # Пока идёт синхронизация, выезд не закроют: UPDATE в `close_callout` ждёт
    # этой блокировки. Иначе позиция могла бы лечь в только что закрытый выезд
    # без пометки «после закрытия».
    db.execute(text("SELECT 1 FROM callouts WHERE id = :id FOR SHARE"), {"id": callout_id})
    row = _fetch_callout(db, callout_id)
    # Отметка закрытия — `callouts.closed_at` (миграция 0012), её ставит
    # `close_callout` вместе со status = 'closed'.
    closed = row["status"] != "active"
    closed_at = row["closed_at"] if closed else None
    # Пометка и журнал — моментом записи, уже после блокировки: досинхронизация,
    # дождавшаяся закрытия, не может быть помечена раньше него.
    synced_at = datetime.now(timezone.utc)

    username = user.get("username")
    role = user.get("role")
    ip = client_ip(request)
    path = f"/dispatch/{callout_id}/deployment/sync"
    after_close_at = synced_at if closed else None
    # Окно и участие в выезде решаются один раз на батч, но отказ получает
    # каждая позиция поимённо — очередь планшета разбирает ответ по ключам.
    batch_problem = None
    if closed:
        batch_problem = _late_sync_window_problem(closed_at, now) or _late_crew_problem(
            role,
            _user_station(db, user),
            _callout_crew_stations(db, callout_id, row["station_id"]),
        )
    applied: list[str] = []
    rejected: list[dict] = []
    # Только принятое и только aware — иначе min() ниже падает уже после коммита.
    placed: list[datetime] = []
    # Аудит пишется своим соединением, поэтому события копятся и уходят после
    # коммита: запись о позиции, которую откатили, хуже отсутствия записи.
    events: list[tuple[str, dict]] = []

    def after_close(placed_at: object, key: str | None = None, gesture: PlacedAt | None = None) -> dict:
        """Поля журнала для записи в закрытый выезд; для открытого — ничего."""
        if not closed:
            return {}
        out = {"after_close": True, "closed_at": _iso(closed_at),
               "placed_at": _iso(placed_at), "synced_at": _iso(synced_at),
               "username": username}
        if gesture is not None:
            out["gesture_at"] = _iso(gesture.value)
            out["device_gesture_at"] = _iso(body.gesture_at.get(key or ""))
        return out

    def gesture_problem(key: str, no_time: str, after: str) -> tuple[str | None, PlacedAt | None]:
        """Время жеста правки/снятия в закрытом выезде: (причина отказа, время)."""
        raw = body.gesture_at.get(key)
        if raw is None:
            return no_time, None
        fix = _reconcile_placed_at(raw, body.sent_at, row["created_at"], now)
        return _late_time_problem(fix, closed_at, now, no_time=no_time, after_close=after), fix

    for item in body.creates:
        if batch_problem:
            rejected.append({"key": item.client_uid, "reason": batch_problem})
            continue
        sent_at = body.sent_at if body.sent_at is not None else item.sent_at
        fix = _reconcile_placed_at(item.placed_at, sent_at, row["created_at"], now)
        if fix.problem:
            rejected.append({"key": item.client_uid, "reason": fix.problem})
            continue
        if closed:
            late = _late_time_problem(fix, closed_at, now)
            if late:
                rejected.append({"key": item.client_uid, "reason": late})
                continue
        item = item.model_copy(update={"placed_at": fix.value})
        try:
            with db.begin_nested():
                position_id, state, changed = _upsert_position(
                    db, callout_id, item, username, after_close_at=after_close_at
                )
        except HTTPException as err:
            rejected.append({"key": item.client_uid, "reason": str(err.detail)})
            continue
        except SQLAlchemyError:
            rejected.append({"key": item.client_uid, "reason": "Позиция не записана"})
            continue
        applied.append(item.client_uid)
        if item.placed_at is not None:
            placed.append(item.placed_at)
        if state == "inserted":
            detail = {"callout_id": callout_id, "position_id": position_id, "kind": item.kind,
                      "phase": item.phase, "via": "sync", "client_uid": item.client_uid,
                      "placed_at": _iso(item.placed_at)}
            if fix.clock:
                detail.update(fix.clock)
            detail.update(after_close(item.placed_at))
            events.append(("callout.deployment_added", detail))
        elif state == "updated" and changed:
            # Повтор постановки с другой точкой: ответ на первую отправку
            # потерялся, а позицию успели передвинуть. Для разбора выезда это
            # перемещение, а не вторая постановка.
            events.append((
                "callout.deployment_moved",
                {"callout_id": callout_id, "position_id": position_id, "via": "sync",
                 "client_uid": item.client_uid, "replay": True, "fields": changed,
                 **after_close(item.placed_at)},
            ))
        # "unchanged" — позицию уже приняли в прошлый раз, запись о ней в
        # журнале есть; второй раз она выглядела бы как второй ствол.

    for patch in body.patches:
        key = _sync_key(patch.client_uid, patch.id)
        if batch_problem:
            rejected.append({"key": key, "reason": batch_problem})
            continue
        target = None
        late = None
        gesture = None
        changed = None
        try:
            with db.begin_nested():
                position_id = _resolve_position(db, callout_id, patch.id, patch.client_uid)
                # Закрытый выезд: править можно только свою позицию с плана,
                # поставленную до закрытия, и только перемещение, сделанное до
                # закрытия (время жеста). Позиции с пульта не меняются.
                if closed and position_id is not None:
                    target = _late_target(db, callout_id, position_id)
                    if target is not None:
                        late = _late_target_problem(target, username, closed_at, now)
                        if late is None:
                            late, gesture = gesture_problem(
                                key, LATE_MOVE_NO_TIME, LATE_MOVED_AFTER_CLOSE
                            )
                if position_id is not None and late is None:
                    changed = _update_position_row(
                        db, callout_id, position_id, patch, after_close_at=after_close_at
                    )
        except SQLAlchemyError:
            rejected.append({"key": key, "reason": "Правка не применена"})
            continue
        if late:
            rejected.append({"key": key, "reason": late})
            continue
        if changed is None:
            rejected.append({"key": key, "reason": "Позиция снята — правка не применена"})
            continue
        applied.append(key)
        # Повтор той же правки ничего не меняет — и в журнал не идёт.
        if changed:
            events.append((
                "callout.deployment_moved",
                {"callout_id": callout_id, "position_id": position_id, "via": "sync",
                 "client_uid": patch.client_uid, "fields": changed,
                 **after_close(target["placed_at"] if target else None, key, gesture)},
            ))

    # Снятие: `deletes` по серверному id, затем `delete_uids` по client_uid —
    # порядок ключей в ответе прежний.
    removals = [(f"srv:{pid}", pid, None) for pid in body.deletes] + [
        (uid, None, uid) for uid in body.delete_uids
    ]
    for key, position_id, uid in removals:
        if batch_problem:
            rejected.append({"key": key, "reason": batch_problem})
            continue
        target = None
        late = None
        gesture = None
        deleted = None
        try:
            with db.begin_nested():
                if closed:
                    target = _late_target(db, callout_id, position_id, uid)
                    if target is not None:
                        late = _late_target_problem(target, username, closed_at, now)
                        if late is None:
                            late, gesture = gesture_problem(
                                key, LATE_REMOVE_NO_TIME, LATE_REMOVED_AFTER_CLOSE
                            )
                if late is None:
                    tombstone = (
                        {"removed_at": gesture.value, "removed_by": username,
                         "synced_at": synced_at}
                        if closed and gesture is not None
                        else None
                    )
                    deleted = _remove_position(
                        db, callout_id, position_id, uid, late=tombstone
                    )
        except SQLAlchemyError:
            rejected.append({"key": key, "reason": "Позиция не снята"})
            continue
        if late:
            rejected.append({"key": key, "reason": late})
            continue
        # Позиции уже нет (сняли раньше или постановка до сервера так и не
        # дошла) — цель снятия достигнута, повторять нечего.
        applied.append(key)
        if deleted is not None:
            detail = {"callout_id": callout_id, "position_id": deleted, "via": "sync"}
            if uid is not None:
                detail["client_uid"] = uid
            detail.update(after_close(target["placed_at"] if target else None, key, gesture))
            events.append(("callout.deployment_removed", detail))

    db.commit()

    for action, detail in events:
        audit(
            action=action,
            username=username,
            role=role,
            method="POST",
            path=path,
            status_code=200,
            ip=ip,
            detail=detail,
        )
    # Сводка отдельной записью: по ней в разборе видно, сколько времени
    # расстановка велась вслепую и что из неё не дошло.
    audit(
        action="callout.deployment_synced",
        username=username,
        role=role,
        method="POST",
        path=path,
        status_code=200,
        ip=ip,
        detail={
            "callout_id": callout_id,
            "applied": len(applied),
            "rejected": len(rejected),
            "oldest_placed_at": _iso(min(placed)) if placed else None,
            **({"after_close": True, "closed_at": _iso(closed_at)} if closed else {}),
        },
    )

    return {
        "positions": _deployment(db, callout_id),
        "applied": applied,
        "rejected": rejected,
    }


@router.post("/{callout_id}/report/export")
def export_report(
    callout_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(VIEW_ROLES),
) -> dict:
    """Отметить выгрузку донесения о пожаре в журнале.

    Сам документ собирается на клиенте: схема расстановки рисуется той же
    геометрией плана, что и на планшете РТП, и печатается через браузер —
    вектором, а не скриншотом. Сервер в этом не участвует, но знать о факте
    выгрузки обязан: донесение уходит в дело, и «кто и когда его выгрузил»
    разбирают наравне с содержанием.

    Выезд не обязан быть закрытым: штабу схема нужна по ходу тушения, и такой
    документ печатается с пометкой «предварительно». Отметка в журнале
    сохраняет этот статус — по ней видно, что выгружали незавершённое.
    """
    row = _fetch_callout(db, callout_id)

    audit(
        action="callout.report_exported",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/dispatch/{callout_id}/report/export",
        status_code=200,
        ip=client_ip(request),
        detail={
            "callout_id": callout_id,
            "callout_status": row["status"],
            "preliminary": row["status"] == "active",
        },
    )
    return {"ok": True, "preliminary": row["status"] == "active"}


@router.get("/live")
def live_positions(
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> dict:
    """Позиции техники из системы мониторинга ДЧС.

    Читаем существующую платформу как потребитель — своего трекинга не заводим
    и к трекерам напрямую не подключаемся (см. app/telematics.py). Пока доступ
    к API не выдан, ответ честно говорит `configured: false`: пустой список
    без этого признака был бы неотличим от «вся техника в гараже».
    """
    snapshot = get_provider().fetch()
    if not snapshot.configured or snapshot.error:
        return snapshot.as_dict()

    rows = db.execute(
        text("SELECT id, lower(callsign) AS cs FROM station_vehicles")
    ).mappings().all()
    matched, unmatched = match_positions(snapshot, {r["cs"]: r["id"] for r in rows})

    out = snapshot.as_dict()
    out["positions"] = matched
    out["unmatched"] = unmatched
    return out


@router.get("/stats")
def dispatch_stats(
    days: int = 30,
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> dict:
    """Сводка по частям: выезды, время реагирования, расход.

    Медиана, а не среднее: одна буксировка по перекрытой дороге сдвигает
    среднее так, что сводка перестаёт описывать типичный выезд.
    """
    if not 1 <= days <= 365:
        raise HTTPException(422, "days должен быть в диапазоне 1..365")

    by_station = db.execute(
        text(
            """
            SELECT s.id AS station_id, s.name AS station_name,
                   COUNT(c.id) AS callouts,
                   COUNT(c.arrived_at) AS with_arrival,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (c.arrived_at - c.created_at))
                   ) FILTER (WHERE c.arrived_at IS NOT NULL) AS median_response_sec,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (c.dispatched_at - c.created_at))
                   ) FILTER (WHERE c.dispatched_at IS NOT NULL) AS median_turnout_sec
              FROM fire_stations s
              LEFT JOIN callouts c
                ON c.station_id = s.id
               AND c.created_at >= now() - make_interval(days => :days)
             GROUP BY s.id, s.name
             ORDER BY callouts DESC, s.name
            """
        ),
        {"days": days},
    ).mappings().all()

    by_type = db.execute(
        text(
            """
            SELECT callout_type, COUNT(*) AS n FROM callouts
             WHERE created_at >= now() - make_interval(days => :days)
             GROUP BY callout_type ORDER BY n DESC
            """
        ),
        {"days": days},
    ).mappings().all()

    resources = db.execute(
        text(
            """
            SELECT r.item_key, SUM(r.qty) AS total
              FROM callout_resources r
              JOIN callouts c ON c.id = r.callout_id
             WHERE c.created_at >= now() - make_interval(days => :days)
             GROUP BY r.item_key ORDER BY r.item_key
            """
        ),
        {"days": days},
    ).mappings().all()

    return {
        "days": days,
        "by_station": [
            {
                "station_id": r["station_id"],
                "station_name": r["station_name"],
                "callouts": r["callouts"],
                "with_arrival": r["with_arrival"],
                "median_response_sec": round(r["median_response_sec"])
                if r["median_response_sec"] is not None
                else None,
                "median_turnout_sec": round(r["median_turnout_sec"])
                if r["median_turnout_sec"] is not None
                else None,
            }
            for r in by_station
        ],
        "by_type": [{"callout_type": r["callout_type"], "count": r["n"]} for r in by_type],
        "resources": [
            {"item_key": r["item_key"], "total": float(r["total"])} for r in resources
        ],
    }
