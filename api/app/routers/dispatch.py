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
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import audit, client_ip
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
HYDRANT_RADIUS_M = 800
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
           c.extinguished_at, c.rank_declared
    FROM callouts c
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN fire_stations s ON s.id = c.station_id
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
    by_station: dict[int, dict] = {}
    for v in vehicles:
        entry = by_station.setdefault(
            v["station_id"],
            {
                "station_id": v["station_id"],
                "station_name": v["station_name"],
                "total": 0,
                **{s: 0 for s in VEHICLE_STATUSES},
            },
        )
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
        return self


def _deployment(db: Session, callout_id: int) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT p.id, p.kind, p.phase, p.sector, p.note, p.vehicle_id,
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
            "vehicle_id": r["vehicle_id"],
            "vehicle_callsign": r["vehicle_callsign"],
            "lat": r["lat"],
            "lng": r["lng"],
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

    if body.vehicle_id is not None:
        exists = db.execute(
            text("SELECT 1 FROM station_vehicles WHERE id = :id"), {"id": body.vehicle_id}
        ).scalar()
        if not exists:
            raise HTTPException(404, "Машина не найдена")

    geom = (
        "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)"
        if body.lat is not None
        else "NULL"
    )
    new_id = db.execute(
        text(
            f"""
            INSERT INTO deployment_positions
                (callout_id, kind, phase, sector, geom, note, vehicle_id, created_by)
            VALUES (:cid, :kind, :phase, :sector, {geom}, :note, :vid, :by)
            RETURNING id
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
            "by": user.get("username"),
        },
    ).scalar()
    db.commit()

    audit(
        action="callout.deployment_added",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/dispatch/{callout_id}/deployment",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id, "position_id": new_id,
                "kind": body.kind, "phase": body.phase},
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
    """Снять позицию с плана развёртывания."""
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
