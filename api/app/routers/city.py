"""Городской трек — картина пожарной безопасности города для акимата и руководства.

Три ответа, только чтение и без персональных данных (адреса зданий ПДн не
являются; ФИО, телефоны, авторы донесений и ПТП сюда не попадают):

  • GET /city/summary — итог по городу и по каждому району: здания и полосы
    оценки уязвимости, «слепые зоны» прибытия, здания без исправного гидранта
    рядом, инфраструктура, открытые предписания, выезды. Суммы по районам
    сходятся с итогом города: здание относится к району по `buildings.district`
    (scripts/seed_districts.py), точечные объекты — по полигону района
    (app/districts.py, то же правило).
  • GET /city/districts.geojson — упрощённые полигоны районов для хороплета.
  • GET /city/priorities — ячейки 500×500 м, где сосредоточены здания высокого
    риска без гидранта или вне зоны прибытия. Это эвристика-ориентир для
    обследования, а не оптимизация размещения, и ответ говорит об этом в
    `method`.

Слепая зона считается тем же SQL, что и /infra (app/coverage.py), полосы
оценки — тем же RISK_BANDS, что и /buildings и /overview: цифры акимата и ДЧС
по одному городу не расходятся.

Данные пилота — синтетические и из OSM, пока ДЧС не передал реальные, поэтому
каждый ответ несёт `demo_data: true`, и экраны обязаны это показывать.
"""

import json
import math
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import coverage
from app.config import settings
from app.db import get_db
from app.districts import district_of
from app.routers.auth import require_roles
from app.routers.buildings import RISK_BANDS

# Кто читает /city: акимат и руководство ведомства; admin — сопровождение.
# Скоупленные роли ДЧС (inspector/supervisor) и боевые роли сюда не входят: у
# них свои экраны. Не путать с auth.CITY_ROLES — это назначаемые роли
# городского трека (только akimat).
CITY_API_ROLES = ("akimat", "leadership", "admin")

router = APIRouter(
    prefix="/city",
    tags=["city"],
    dependencies=[Depends(require_roles(*CITY_API_ROLES))],
)

# Данные пилота демонстрационные, пока ДЧС не передал реальные.
DEMO_DATA = True
# Лицензия ODbL границ районов: атрибуция обязательна на карте и в отчёте.
ATTRIBUTION = "© OpenStreetMap contributors"

CELL_M = 500
# UTM 42N: метрическая сетка для Астаны (≈71.4° в. д. — зона 42, 66–72° в. д.).
GRID_SRID = 32642
CALLOUT_WINDOW_DAYS = 90
PRIORITIES_MAX = 50

# Полосы ответа /city ↔ ключи RISK_BANDS (в /buildings средняя полоса — `mid`).
BAND_KEYS = (("critical", "critical"), ("high", "high"), ("elevated", "mid"), ("low", "low"))
# «Высокий риск и выше» — объединение двух полос RISK_BANDS, а не своё число.
HIGH_OR_ABOVE_SQL = f"(({RISK_BANDS['high']}) OR ({RISK_BANDS['critical']}))"
def _band_lower_bound(sql_clause: str) -> int:
    """Первое число в SQL-условии полосы — её нижняя граница.

    Работает и для "r.score BETWEEN 40 AND 59" (→ 40), и для "r.score >= 60"
    (→ 60): у RISK_BANDS ("mid"/"high"/"critical") первое число в выражении
    всегда и есть нижняя граница. Так HIGH_MIN_SCORE берётся из RISK_BANDS, а
    не дублируется литералом, который мог бы разойтись при следующей правке
    порогов (см. web/src/lib/risk.ts — тот же порог 40 там).
    """
    match = re.search(r"\d+", sql_clause)
    if not match:
        raise ValueError(f"cannot parse a lower bound out of: {sql_clause!r}")
    return int(match.group())


# Нижняя граница полосы high — из RISK_BANDS (единственный источник), только
# для текста методики; SQL-запросы сами используют RISK_BANDS напрямую.
HIGH_MIN_SCORE = _band_lower_bound(RISK_BANDS["high"])

SUMMARY_METHOD = (
    f"Внимание = здания с оценкой ≥{HIGH_MIN_SCORE} в слепой зоне прибытия "
    f"ИЛИ без исправного гидранта в {coverage.HYDRANT_RADIUS_M} м"
)
# Два разных времени — и оба нужны: норматив прибытия (normative_min, 10 мин)
# отсчитывается от приёма вызова, поэтому сравнивать с ним можно только
# `median_response_min`; `median_travel_min` — чистый ход машины, он сопоставим
# с зоной прибытия по дорогам. Определение времени реагирования совпадает с
# /dispatch/stats (регистрация → прибытие), окно — городское, 90 дней.
RESPONSE_METHOD = (
    "Медиана времени реагирования: от регистрации вызова до отметки «прибытие» "
    f"по выездам за {CALLOUT_WINDOW_DAYS} дней — сравнима с нормативом прибытия; "
    "без отметок — нет данных"
)
TRAVEL_METHOD = (
    "Медиана времени хода: от отметки «выезд» до отметки «прибытие» по выездам "
    f"за {CALLOUT_WINDOW_DAYS} дней — без сбора и приёма вызова; без отметок — нет данных"
)
PRIORITIES_METHOD = (
    f"Оценка по плотности зданий высокого риска в ячейках {CELL_M}×{CELL_M} м — "
    "ориентир для обследования, не оптимальная точка размещения"
)

_COUNT_FIELDS = (
    "buildings_total",
    "attention_buildings",
    "blind_zone_buildings",
    "hydrant_gap_buildings",
    "hydrants_total",
    "hydrants_broken",
    "stations_total",
    "open_prescriptions",
    "callouts_90d",
)
_BUILDING_FIELDS = (
    "buildings_total",
    "attention_buildings",
    "blind_zone_buildings",
    "hydrant_gap_buildings",
)
_POINT_FIELDS = ("stations_total", "hydrants_total", "hydrants_broken", "callouts_90d")


# --- чистые функции (без БД) --------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def round_half_up(value: float | None) -> int | None:
    """Округление «как в школе» (и как SQL round) — не банковское Python round."""
    return None if value is None else math.floor(value + 0.5)


def cell_id(x: float, y: float, cell_m: int = CELL_M) -> str:
    """Идентификатор ячейки по узлу ST_SnapToGrid в метрах UTM 42N."""
    return f"utm42n-{cell_m}-{round(x / cell_m)}-{round(y / cell_m)}"


def _blank() -> dict:
    return {
        **{k: 0 for k in _COUNT_FIELDS},
        "scored": 0,
        "score_sum": 0,
        "bands": {k: 0 for k, _ in BAND_KEYS},
        "median_response_sec": None,
        "median_travel_sec": None,
    }


def _minutes(seconds: float | None) -> float | None:
    return round(seconds / 60.0, 1) if seconds is not None else None


def _merge_buildings(acc: dict, row: dict) -> None:
    for key in _BUILDING_FIELDS:
        acc[key] += int(row[key])
    acc["scored"] += int(row["scored"])
    acc["score_sum"] += int(row["score_sum"])
    for key, _ in BAND_KEYS:
        acc["bands"][key] += int(row[key])


def _finalize(acc: dict) -> tuple[dict, float | None]:
    total = acc["buildings_total"]
    avg = acc["score_sum"] / acc["scored"] if acc["scored"] else None
    metrics = {
        "buildings_total": total,
        "avg_score": round_half_up(avg),
        "bands": dict(acc["bands"]),
        "attention_buildings": acc["attention_buildings"],
        "blind_zone_buildings": acc["blind_zone_buildings"],
        "blind_pct": round(100.0 * acc["blind_zone_buildings"] / total, 1) if total else 0.0,
        "hydrant_gap_buildings": acc["hydrant_gap_buildings"],
        "hydrants_total": acc["hydrants_total"],
        "hydrants_broken": acc["hydrants_broken"],
        "stations_total": acc["stations_total"],
        "open_prescriptions": acc["open_prescriptions"],
        "callouts_90d": acc["callouts_90d"],
        # Регистрация вызова → прибытие (сравнимо с нормативом, см. RESPONSE_METHOD).
        "median_response_min": _minutes(acc["median_response_sec"]),
        # Выезд → прибытие, чистый ход (см. TRAVEL_METHOD).
        "median_travel_min": _minutes(acc["median_travel_sec"]),
    }
    return metrics, avg


def rank_districts(items: list[dict]) -> list[dict]:
    """Сортировка районов: больше «зданий внимания» выше, при равенстве — выше средняя оценка.

    Ожидает во входных словарях сырое среднее `_avg` (до округления), чтобы
    равные после округления средние не решали порядок случайно; имя района —
    последний, детерминированный ключ. Проставляет `rank` 1..n.
    """
    ordered = sorted(
        items,
        key=lambda d: (
            -d["attention_buildings"],
            -(d["_avg"] if d["_avg"] is not None else -1.0),
            d["name"],
        ),
    )
    result = []
    for rank, item in enumerate(ordered, start=1):
        public = {k: v for k, v in item.items() if k != "_avg"}
        public["rank"] = rank
        result.append(public)
    return result


def assemble_summary(
    districts: list[dict],
    building_rows: list[dict],
    point_rows: list[dict],
    prescription_rows: list[dict],
) -> dict:
    """Итог города и районов из агрегатов SQL.

    Итог города включает всё: здания с районом вне таблицы `districts`
    (например, импорт без seed_districts) и предписания по карточкам без района
    попадают в город и в `unassigned`, а не молча пропадают. Точечные объекты
    всегда получают район (правило «ближайший район»), итог по ним берётся из
    строки GROUPING SETS `()`.
    """
    names = {d["name"] for d in districts}
    acc = {name: _blank() for name in names}
    city = _blank()
    unassigned = {"buildings": 0, "open_prescriptions": 0}

    for row in building_rows:
        _merge_buildings(city, row)
        if row["district"] in acc:
            _merge_buildings(acc[row["district"]], row)
        else:
            unassigned["buildings"] += int(row["buildings_total"])

    for row in point_rows:
        if row["is_total"]:
            target = city
        elif row["district"] in acc:
            target = acc[row["district"]]
        else:
            continue
        for key in _POINT_FIELDS:
            target[key] += int(row[key])
        target["median_response_sec"] = row["median_response_sec"]
        target["median_travel_sec"] = row["median_travel_sec"]

    for row in prescription_rows:
        count = int(row["open_prescriptions"])
        city["open_prescriptions"] += count
        if row["district"] in acc:
            acc[row["district"]]["open_prescriptions"] += count
        else:
            unassigned["open_prescriptions"] += count

    items = []
    for d in districts:
        metrics, avg = _finalize(acc[d["name"]])
        items.append(
            {
                "name": d["name"],
                "name_kk": d["name_kk"],
                "name_en": d["name_en"],
                "area_km2": d["area_km2"],
                **metrics,
                "_avg": avg,
            }
        )
    city_metrics, _ = _finalize(city)
    return {"city": city_metrics, "districts": rank_districts(items), "unassigned": unassigned}


def rank_hydrant_gaps(cells: list[dict], limit: int) -> list[dict]:
    """Ячейки без гидранта: больше зданий × выше средняя оценка — выше."""
    return sorted(
        cells,
        key=lambda c: (
            -(c["buildings"] * (c["avg_score"] or 0.0)),
            -(c["max_score"] or 0),
            c["cell_id"],
        ),
    )[:limit]


def rank_station_gaps(cells: list[dict], limit: int) -> list[dict]:
    """Ячейки вне зоны прибытия: больше зданий высокого риска × средняя оценка, затем всего слепых."""
    return sorted(
        cells,
        key=lambda c: (
            -(c["high_risk_blind"] * (c["avg_score"] or 0.0)),
            -c["blind_buildings"],
            c["cell_id"],
        ),
    )[:limit]


# --- запросы ------------------------------------------------------------------


def _coverage_params() -> dict:
    return {
        "sec": coverage.normative_seconds(),
        "r": settings.coverage_radius_m,
        "hydrant_r": coverage.HYDRANT_RADIUS_M,
    }


def _envelope(db: Session) -> dict:
    seconds = coverage.normative_seconds()
    missing = len(coverage.stations_missing_isochrones(db, seconds))
    stale = len(coverage.stations_stale_isochrones(db, seconds))
    # Тот же резолвер, что у /infra/stats, /coverage и /blind-zones: значения
    # "osrm" | "buffer" | "mixed" у акимата и у ДЧС не расходятся.
    source = coverage.resolve_coverage_source(coverage.stations_total(db), missing, stale)
    return {
        "computed_at": now_iso(),
        "demo_data": DEMO_DATA,
        "coverage_source": source,
        # Как у /infra: приблизительно всё, что не «у каждой части свежая
        # изохрона по дорогам».
        "approximate": source != "osrm",
        "stations_missing_isochrones": missing,
        "stations_stale_isochrones": stale,
    }


# Нет исправного гидранта в радиусе от контура здания. Выражение
# `h.geom::geography` совпадает с функциональным индексом hydrants_geog_gist
# (миграция 0023) — без него проверка перебирала бы все гидранты на здание.
_HYDRANT_GAP_SQL = """
    NOT EXISTS (
        SELECT 1 FROM hydrants h
         WHERE h.status = 'ok'
           AND ST_DWithin(h.geom::geography, b.geom::geography, :hydrant_r)
    )
"""


def _building_rows(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            f"""
            WITH bld AS (
                SELECT b.district, r.score,
                       ({RISK_BANDS['critical']}) AS critical,
                       ({RISK_BANDS['high']}) AS high,
                       ({RISK_BANDS['mid']}) AS elevated,
                       ({RISK_BANDS['low']}) AS low,
                       ({coverage.BLIND_ZONE_CLAUSE}) AS blind,
                       ({_HYDRANT_GAP_SQL}) AS hydrant_gap
                  FROM buildings b
                  LEFT JOIN risk_scores r ON r.building_id = b.id
            )
            SELECT district,
                   count(*) AS buildings_total,
                   count(score) AS scored,
                   COALESCE(sum(score), 0) AS score_sum,
                   count(*) FILTER (WHERE critical) AS critical,
                   count(*) FILTER (WHERE high) AS high,
                   count(*) FILTER (WHERE elevated) AS elevated,
                   count(*) FILTER (WHERE low) AS low,
                   count(*) FILTER (
                       WHERE (high OR critical) AND (blind OR hydrant_gap)
                   ) AS attention_buildings,
                   count(*) FILTER (WHERE blind) AS blind_zone_buildings,
                   count(*) FILTER (WHERE hydrant_gap) AS hydrant_gap_buildings
              FROM bld
             GROUP BY district
            """
        ),
        _coverage_params(),
    ).mappings().all()
    return [dict(r) for r in rows]


def _point_rows(db: Session) -> list[dict]:
    rows = db.execute(
        text(
            f"""
            WITH pts AS (
                SELECT 'station' AS kind, s.geom, NULL::text AS status,
                       NULL::double precision AS response_sec,
                       NULL::double precision AS travel_sec
                  FROM fire_stations s
                UNION ALL
                SELECT 'hydrant', h.geom, h.status, NULL::double precision,
                       NULL::double precision
                  FROM hydrants h
                UNION ALL
                SELECT 'callout', c.geom, NULL::text,
                       -- Регистрация → прибытие (как median_response_sec в /dispatch/stats).
                       CASE WHEN c.arrived_at > c.created_at
                            THEN EXTRACT(EPOCH FROM (c.arrived_at - c.created_at))::double precision
                       END,
                       -- Выезд → прибытие: чистый ход.
                       CASE WHEN c.dispatched_at IS NOT NULL
                             AND c.arrived_at > c.dispatched_at
                            THEN EXTRACT(EPOCH FROM (c.arrived_at - c.dispatched_at))::double precision
                       END
                  FROM callouts c
                 WHERE c.created_at >= now() - make_interval(days => :days)
            ),
            placed AS (
                SELECT p.kind, p.status, p.response_sec, p.travel_sec,
                       {district_of("p.geom")} AS district
                  FROM pts p
            )
            SELECT district,
                   GROUPING(district) = 1 AS is_total,
                   count(*) FILTER (WHERE kind = 'station') AS stations_total,
                   count(*) FILTER (WHERE kind = 'hydrant') AS hydrants_total,
                   count(*) FILTER (WHERE kind = 'hydrant' AND status = 'broken') AS hydrants_broken,
                   count(*) FILTER (WHERE kind = 'callout') AS callouts_90d,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY response_sec)
                       FILTER (WHERE kind = 'callout') AS median_response_sec,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY travel_sec)
                       FILTER (WHERE kind = 'callout') AS median_travel_sec
              FROM placed
             GROUP BY GROUPING SETS ((district), ())
            """
        ),
        {"days": CALLOUT_WINDOW_DAYS},
    ).mappings().all()
    return [dict(r) for r in rows]


def _prescription_rows(db: Session) -> list[dict]:
    # «Открытое» — то же определение, что у портала владельца: утверждённое
    # предписание без принятого устранения. Черновики ИИ (pending) ещё не
    # выданы и в картину города не входят.
    rows = db.execute(
        text(
            """
            SELECT COALESCE(b.district, c.district) AS district,
                   count(*) AS open_prescriptions
              FROM prescriptions p
              JOIN operational_cards c ON c.id = p.card_id
              LEFT JOIN buildings b ON b.id = c.building_id
             WHERE p.status = 'approved'
               AND NOT EXISTS (
                   SELECT 1 FROM remediations ra
                    WHERE ra.prescription_id = p.id AND ra.status = 'accepted'
               )
             GROUP BY 1
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]


def _districts(db: Session) -> list[dict]:
    rows = db.execute(
        text("SELECT name, name_kk, name_en, area_km2 FROM districts ORDER BY id")
    ).mappings().all()
    return [dict(r) for r in rows]


def _summary_data(db: Session) -> dict:
    return assemble_summary(
        _districts(db), _building_rows(db), _point_rows(db), _prescription_rows(db)
    )


def _cells(db: Session, sql: str) -> list[dict]:
    rows = db.execute(
        text(
            f"""
            WITH cells AS ({sql})
            SELECT cells.*,
                   ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(x, y), :srid), 4326)) AS lon,
                   ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(x, y), :srid), 4326)) AS lat
              FROM cells
            """
        ),
        {**_coverage_params(), "srid": GRID_SRID, "cell": CELL_M},
    ).mappings().all()
    return [{**dict(r), "cell_id": cell_id(r["x"], r["y"])} for r in rows]


# Узел сетки, к которому привязано здание: точка на его контуре в метрах
# UTM 42N, округлённая до шага сетки. Узел — центр ячейки.
_NODE_SQL = "ST_SnapToGrid(ST_Transform(ST_PointOnSurface(b.geom), :srid), :cell)"
_SAMPLE_ADDRESSES_SQL = (
    "(array_agg(address ORDER BY score DESC NULLS LAST, id) "
    "FILTER (WHERE NULLIF(btrim(address), '') IS NOT NULL))[1:3]"
)


def _hydrant_gap_cells(db: Session) -> list[dict]:
    return _cells(
        db,
        f"""
        SELECT ST_X(node) AS x, ST_Y(node) AS y,
               count(*) AS buildings,
               avg(score)::double precision AS avg_score,
               max(score) AS max_score,
               mode() WITHIN GROUP (ORDER BY district) AS district,
               {_SAMPLE_ADDRESSES_SQL} AS sample_addresses
          FROM (
                SELECT b.id, b.address, b.district, r.score, {_NODE_SQL} AS node
                  FROM buildings b
                  JOIN risk_scores r ON r.building_id = b.id
                 WHERE {HIGH_OR_ABOVE_SQL}
                   AND {_HYDRANT_GAP_SQL}
               ) cand
         GROUP BY ST_X(node), ST_Y(node)
        """,
    )


def _station_gap_cells(db: Session) -> list[dict]:
    return _cells(
        db,
        f"""
        -- Сначала слепые здания (дорогое условие — один раз на здание), потом
        -- оценка по первичному ключу. Без MATERIALIZED планировщик ставил
        -- соединение с risk_scores под антисоединения слепой зоны и перебирал
        -- ~1,7 млн пар «здание × оценка» фильтром соединения.
        WITH blind AS MATERIALIZED (
            SELECT b.id FROM buildings b WHERE ({coverage.BLIND_ZONE_CLAUSE})
        )
        SELECT ST_X(node) AS x, ST_Y(node) AS y,
               count(*) AS blind_buildings,
               count(*) FILTER (WHERE high_risk) AS high_risk_blind,
               avg(score)::double precision AS avg_score,
               mode() WITHIN GROUP (ORDER BY district) AS district,
               {_SAMPLE_ADDRESSES_SQL} AS sample_addresses
          FROM (
                SELECT b.id, b.address, b.district, r.score,
                       COALESCE({HIGH_OR_ABOVE_SQL}, FALSE) AS high_risk,
                       {_NODE_SQL} AS node
                  FROM blind
                  JOIN buildings b ON b.id = blind.id
                  LEFT JOIN risk_scores r ON r.building_id = b.id
               ) cand
         GROUP BY ST_X(node), ST_Y(node)
        """,
    )


def _without_jit(db: Session) -> None:
    """Выключить JIT на время запроса: `SET LOCAL` живёт до конца транзакции сессии.

    Оценки стоимости PostGIS для geography (ST_DWithin) завышены на порядки, и
    планировщик включает JIT-компиляцию для запросов, которые сами исполняются
    за десятки-сотни миллисекунд: на демо-базе компиляция занимала 250–360 мс
    из 380–580 мс запроса. Сессия запроса закрывается в get_db (откат
    транзакции), так что настройка не утекает в пул соединений.
    """
    db.execute(text("SET LOCAL jit = off"))


def _public_cell(cell: dict, fields: tuple[str, ...]) -> dict:
    out = {
        "cell_id": cell["cell_id"],
        "lon": round(cell["lon"], 6),
        "lat": round(cell["lat"], 6),
        "district": cell["district"],
    }
    for field in fields:
        value = cell[field]
        out[field] = round_half_up(value) if field == "avg_score" else int(value)
    out["sample_addresses"] = list(cell["sample_addresses"] or [])
    return out


# --- эндпоинты ----------------------------------------------------------------


@router.get("/summary")
def summary(db: Session = Depends(get_db)) -> dict:
    """Итог по городу и районам (только счётчики — ни адресов, ни имён)."""
    _without_jit(db)
    data = _summary_data(db)
    return {
        **_envelope(db),
        "method": SUMMARY_METHOD,
        "response_method": RESPONSE_METHOD,
        "travel_method": TRAVEL_METHOD,
        "normative_min": settings.arrival_normative_min,
        "hydrant_radius_m": coverage.HYDRANT_RADIUS_M,
        "callout_window_days": CALLOUT_WINDOW_DAYS,
        "attribution": ATTRIBUTION,
        "city": data["city"],
        "districts": data["districts"],
        "unassigned": data["unassigned"],
    }


@router.get("/districts.geojson")
def districts_geojson(db: Session = Depends(get_db)) -> dict:
    """Полигоны районов для хороплета: ранг и «здания внимания» из той же сводки."""
    _without_jit(db)
    by_name = {d["name"]: d for d in _summary_data(db)["districts"]}
    # Без упрощения: ST_SimplifyPreserveTopology упрощает каждый полигон
    # отдельно, и общие границы соседних районов расходятся — на хороплете
    # появляются щели и наложения. Полные контуры пяти районов — десятки КБ;
    # 6 знаков после запятой — ~10 см, точнее не нужно.
    rows = db.execute(
        text(
            "SELECT name, name_kk, name_en, ST_AsGeoJSON(geom, 6) AS geom "
            "FROM districts ORDER BY id"
        )
    ).mappings().all()
    features = [
        {
            "type": "Feature",
            "geometry": json.loads(r["geom"]),
            "properties": {
                "name": r["name"],
                "name_kk": r["name_kk"],
                "name_en": r["name_en"],
                "rank": by_name[r["name"]]["rank"],
                "attention_buildings": by_name[r["name"]]["attention_buildings"],
                "buildings_total": by_name[r["name"]]["buildings_total"],
            },
        }
        for r in rows
    ]
    features.sort(key=lambda f: f["properties"]["rank"])
    return {
        "type": "FeatureCollection",
        **_envelope(db),
        "attribution": ATTRIBUTION,
        "features": features,
    }


@router.get("/priorities")
def priorities(
    limit: int = Query(10, ge=1, le=PRIORITIES_MAX),
    db: Session = Depends(get_db),
) -> dict:
    """Где сосредоточены здания высокого риска без воды и вне зоны прибытия."""
    _without_jit(db)
    hydrant_gaps = rank_hydrant_gaps(_hydrant_gap_cells(db), limit)
    station_gaps = rank_station_gaps(_station_gap_cells(db), limit)
    return {
        **_envelope(db),
        "cell_m": CELL_M,
        "hydrant_radius_m": coverage.HYDRANT_RADIUS_M,
        "method": PRIORITIES_METHOD,
        "hydrant_gaps": [
            _public_cell(c, ("buildings", "avg_score", "max_score")) for c in hydrant_gaps
        ],
        "station_gaps": [
            _public_cell(c, ("blind_buildings", "high_risk_blind", "avg_score"))
            for c in station_gaps
        ],
    }
