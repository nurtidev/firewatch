import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import routing
from app.audit import audit, client_ip
from app.config import settings
from app.db import get_db
from app.routers.auth import require_roles

router = APIRouter(
    prefix="/infra",
    tags=["infrastructure"],
    # Hydrants and stations are the боевой roles' bread and butter — dispatcher
    # and responder read the whole city's infrastructure.
    dependencies=[
        Depends(require_roles("supervisor", "leadership", "admin", "dispatcher", "responder"))
    ],
)

# Marking a hydrant serviceable/broken is a field/ops action: the боевой roles
# and supervisor/admin, but not leadership (reads dashboards) or inspector.
HYDRANT_STATUS_ROLES = require_roles("dispatcher", "responder", "supervisor", "admin")


class HydrantStatusUpdate(BaseModel):
    status: str  # "ok" | "broken"
    note: str | None = Field(None, max_length=500)

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in ("ok", "broken"):
            raise ValueError("status должен быть 'ok' или 'broken'")
        return v


def _fc(rows, geom_key: str, props) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": json.loads(r[geom_key]),
                "properties": props(r),
            }
            for r in rows
        ],
    }


@router.get("/stations")
def stations(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        text(
            "SELECT name, vehicles, ST_AsGeoJSON(geom) AS geom FROM fire_stations"
        )
    ).mappings().all()
    return _fc(rows, "geom", lambda r: {"name": r["name"], "vehicles": r["vehicles"]})


@router.get("/hydrants")
def hydrants(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        text(
            # id обязателен: по нему гидрант адресуется с карты (пометка
            # неисправности). Без него слой рисовался, но каждая точка была
            # безымянной — действие над ней выполнить было нельзя.
            "SELECT id, status, last_check, pressure_bar, diameter_mm, hydrant_type, "
            "ST_AsGeoJSON(geom) AS geom FROM hydrants"
        )
    ).mappings().all()
    return _fc(
        rows,
        "geom",
        lambda r: {
            "id": r["id"],
            "status": r["status"],
            "last_check": r["last_check"].isoformat() if r["last_check"] else None,
            # Operational specs (NULL until the water-utility feed is wired) — let
            # the dispatcher judge whether the hydrant sustains the required flow.
            "pressure_bar": r["pressure_bar"],
            "diameter_mm": r["diameter_mm"],
            "hydrant_type": r["hydrant_type"],
        },
    )


def _normative_seconds() -> int:
    return settings.arrival_normative_min * 60


def _has_isochrones(db: Session) -> bool:
    """Есть ли рассчитанные зоны по дорогам под текущий норматив (хотя бы одна)."""
    return bool(
        db.execute(
            text("SELECT 1 FROM station_isochrones WHERE seconds = :s LIMIT 1"),
            {"s": _normative_seconds()},
        ).scalar()
    )


def _stations_missing_isochrones(db: Session, seconds: int) -> list[dict]:
    """Части без текущей изохроны — новые, или у которых пересчёт не удался.

    Их зона не должна тихо превращаться в «слепую»: вызывающий обязан
    подставить для них буфер и честно поднять `approximate`.
    """
    return db.execute(
        text(
            """
            SELECT s.id, s.name, ST_Y(s.geom) AS lat, ST_X(s.geom) AS lng
              FROM fire_stations s
             WHERE NOT EXISTS (
                 SELECT 1 FROM station_isochrones i
                  WHERE i.station_id = s.id AND i.seconds = :sec
             )
            """
        ),
        {"sec": seconds},
    ).mappings().all()


def _stations_total(db: Session) -> int:
    return db.execute(text("SELECT count(*) FROM fire_stations")).scalar() or 0


@router.get("/coverage")
def coverage(db: Session = Depends(get_db)) -> dict:
    """Зона прибытия каждой части под норматив (10 минут в городе).

    Два источника, и разница между ними принципиальная:

    • Рассчитанная изохрона по дорожному графу (`approximate: false`) — то,
      куда караул реально доезжает: за рекой Есиль зона обрывается там, где
      кончается мост, а не там, где кончается радиус.
    • Прямолинейный буфер (`approximate: true`) — запасной вариант, пока
      роутер не поднят или изохроны не пересчитаны. Он игнорирует реку,
      железную дорогу и закрытые кварталы, то есть систематически завышает
      покрытие. На таком слое нельзя строить вывод «район прикрыт», и ответ
      об этом говорит прямо.

    Смешанный случай — у части частей изохрона есть, у части нет (новая
    часть, или последний пересчёт для неё не удался) — тоже помечается
    `approximate: true`, а недостающие части рисуются буфером поверх слоя
    изохрон; `stations_missing_isochrones` называет их число.
    """
    seconds = _normative_seconds()
    if _has_isochrones(db):
        rows = db.execute(
            text(
                """
                SELECT s.name, i.computed_at, i.points, i.source,
                       ST_AsGeoJSON(i.geom) AS geom
                  FROM station_isochrones i
                  JOIN fire_stations s ON s.id = i.station_id
                 WHERE i.seconds = :sec
                """
            ),
            {"sec": seconds},
        ).mappings().all()
        fc = _fc(
            rows,
            "geom",
            lambda r: {
                "name": r["name"],
                "computed_at": r["computed_at"].isoformat() if r["computed_at"] else None,
                "points": r["points"],
                "source": r["source"],
            },
        )

        # Часть без текущей изохроны (новая, или пересчёт для неё не удался)
        # не должна пропадать с карты и не должна тихо читаться как «зона
        # недостижима»: подставляем для неё прямолинейный буфер и признаём
        # покрытие приблизительным в целом.
        missing = _stations_missing_isochrones(db, seconds)
        if missing:
            buffer_rows = db.execute(
                text(
                    "SELECT name, "
                    "ST_AsGeoJSON(ST_Buffer(geom::geography, :r)::geometry) AS geom "
                    "FROM fire_stations WHERE id = ANY(:ids)"
                ),
                {"r": settings.coverage_radius_m, "ids": [s["id"] for s in missing]},
            ).mappings().all()
            fc["features"].extend(
                _fc(buffer_rows, "geom", lambda r: {"name": r["name"], "source": "buffer"})[
                    "features"
                ]
            )

        fc["approximate"] = bool(missing)
        fc["stations_missing_isochrones"] = len(missing)
        fc["normative_sec"] = seconds
        # Роутер считает по свободному потоку: заторы, гололёд и разъезд во
        # дворе в это время не входят. Зона по дорогам точнее круга по форме
        # (река и мосты учтены), но по-прежнему верхняя оценка — пока в
        # FW_ROUTING_TIME_FACTOR не внесена поправка по своей статистике
        # (см. /infra/routing/calibration).
        fc["traffic_unaccounted"] = settings.routing_time_factor <= 1.0
        fc["time_factor"] = settings.routing_time_factor
        return fc

    rows = db.execute(
        text(
            "SELECT name, "
            "ST_AsGeoJSON(ST_Buffer(geom::geography, :r)::geometry) AS geom "
            "FROM fire_stations"
        ),
        {"r": settings.coverage_radius_m},
    ).mappings().all()
    fc = _fc(rows, "geom", lambda r: {"name": r["name"], "source": "buffer"})
    fc["approximate"] = True  # straight-line buffer, not a road isochrone
    fc["stations_missing_isochrones"] = _stations_total(db)
    fc["normative_sec"] = seconds
    return fc


@router.get("/routing/health")
def routing_health() -> dict:
    """Состояние дорожного роутера — видно, на чём считается покрытие."""
    return {**routing.health(), "time_factor": settings.routing_time_factor}


@router.get("/routing/calibration")
def routing_calibration(
    days: int = 180,
    db: Session = Depends(get_db),
    _user: dict = Depends(require_roles("supervisor", "leadership", "admin")),
) -> dict:
    """Насколько расчёт по дорогам расходится с фактическими выездами.

    Роутер считает по свободному потоку: ни заторов, ни гололёда, ни разъезда
    во дворе. Поэтому зона прибытия «по дорогам» — верхняя оценка, и без
    поправки она выглядит оптимистичнее прямолинейного круга, а не точнее его.

    Поправку не надо выдумывать: у гарнизона есть собственная статистика.
    Здесь для каждого закрытого выезда с отметками «выезд» и «прибытие»
    берётся фактическое время хода и сравнивается с расчётным по тому же
    маршруту. Медиана отношения и есть кандидат в `FW_ROUTING_TIME_FACTOR`.

    Система его не применяет сама — показывает и объясняет, на скольких
    выездах он посчитан. Коэффициент меняет картину покрытия целого города:
    такое решение принимает человек, а не автоподстановка.
    """
    if not routing.is_configured():
        raise HTTPException(503, "Дорожный роутер не настроен (FW_ROUTING_URL)")

    rows = db.execute(
        text(
            """
            SELECT ST_Y(s.geom) AS s_lat, ST_X(s.geom) AS s_lng,
                   ST_Y(c.geom) AS c_lat, ST_X(c.geom) AS c_lng,
                   EXTRACT(EPOCH FROM (c.arrived_at - c.dispatched_at)) AS travel_sec
              FROM callouts c
              JOIN fire_stations s ON s.id = c.station_id
             WHERE c.arrived_at IS NOT NULL
               AND c.dispatched_at IS NOT NULL
               AND c.arrived_at > c.dispatched_at
               AND c.created_at > now() - make_interval(days => :days)
             ORDER BY c.created_at DESC
             LIMIT 200
            """
        ),
        {"days": max(1, days)},
    ).mappings().all()

    samples = [
        (
            routing.Point(lng=r["s_lng"], lat=r["s_lat"]),
            routing.Point(lng=r["c_lng"], lat=r["c_lat"]),
            float(r["travel_sec"]),
        )
        for r in rows
    ]
    result = routing.calibration(samples)
    result["days"] = days
    # Меньше десяти выездов — это не статистика, а несколько случаев;
    # предлагать по ним коэффициент для всего города нельзя.
    result["enough_data"] = result["samples"] >= 10
    return result


@router.post("/coverage/rebuild")
def rebuild_coverage(
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(require_roles("admin")),
) -> dict:
    """Пересчитать зоны прибытия по дорожному графу.

    Тяжёлая операция (матрица времён на сетке точек для каждой части),
    поэтому она явная и редкая: сеть дорог меняется раз в месяц, а карту
    открывают десятки раз в день. Результат ложится в `station_isochrones`,
    и с этого момента карта, «слепые зоны» и сводка считаются по дорогам.

    Зона собирается не выпуклой оболочкой достижимых точек, а объединением
    кружков вокруг них. Оболочка «залила» бы дыры — например, закрытый
    квартал внутри зоны выглядел бы прикрытым; объединение кружков оставляет
    дыру дырой, а форму — рваной ровно там, где рваная дорожная сеть.
    """
    if not routing.is_configured():
        raise HTTPException(503, "Дорожный роутер не настроен (FW_ROUTING_URL)")

    seconds = _normative_seconds()
    # Радиус сетки с запасом: по дорогам путь всегда длиннее прямой, но не в
    # разы — полуторный радиус покрывает объезды, не раздувая матрицу.
    grid_radius_m = int(settings.coverage_radius_m * 1.5)
    step = max(100, settings.routing_grid_step_m)

    stations = db.execute(
        text("SELECT id, name, ST_Y(geom) AS lat, ST_X(geom) AS lng FROM fire_stations")
    ).mappings().all()

    built, failed = 0, []
    for st in stations:
        points = routing.reachable_points(
            routing.Point(lng=st["lng"], lat=st["lat"]),
            seconds=seconds,
            radius_m=grid_radius_m,
        )
        if not points:
            failed.append(st["name"])
            # Не оставляем прошлую изохрону висеть как будто актуальную:
            # /coverage, /blind-zones и /stats отличают «зона посчитана» от
            # «нет строки» и сами подставляют буфер для второго случая —
            # это тот же честный фолбэк, что и для новой части, у которой
            # изохроны никогда не было. Простое удаление (а не новый флаг
            # is_stale в схеме) переиспользует этот путь, а не добавляет
            # второй источник правды о свежести данных.
            db.execute(
                text(
                    "DELETE FROM station_isochrones WHERE station_id = :sid AND seconds = :sec"
                ),
                {"sid": st["id"], "sec": seconds},
            )
            continue

        wkt = "MULTIPOINT(" + ",".join(f"{p.lng} {p.lat}" for p in points) + ")"
        db.execute(
            text(
                """
                INSERT INTO station_isochrones (station_id, seconds, geom, source, points)
                VALUES (
                    :sid, :sec,
                    -- Буфер мультиточки уже возвращает объединение кружков:
                    -- отдельный ST_Union не нужен (и в VALUES недопустим).
                    ST_Multi(
                        ST_SimplifyPreserveTopology(
                            ST_Buffer(
                                ST_SetSRID(ST_GeomFromText(:wkt), 4326)::geography,
                                :radius
                            )::geometry,
                            0.0002
                        )
                    ),
                    'osrm', :n
                )
                ON CONFLICT (station_id, seconds) DO UPDATE
                   SET geom = EXCLUDED.geom,
                       source = EXCLUDED.source,
                       points = EXCLUDED.points,
                       computed_at = now()
                """
            ),
            # Кружок чуть больше половины шага сетки: соседние точки смыкаются
            # в сплошную зону, но зона не расползается за пределы посчитанного.
            {"sid": st["id"], "sec": seconds, "wkt": wkt, "radius": step * 0.75,
             "n": len(points)},
        )
        built += 1

    db.commit()

    audit(
        action="infra.coverage_rebuilt",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path="/infra/coverage/rebuild",
        status_code=200,
        ip=client_ip(request),
        detail={"stations": built, "failed": failed, "seconds": seconds,
                "grid_step_m": step},
    )
    return {"built": built, "failed": failed, "seconds": seconds}


# Здание вне норматива, если оно не попадает ни в одну изохрону, И не
# попадает в буфер ни одной части, у которой изохроны нет (новая часть, или
# пересчёт для неё не удался). Вторая часть условия — это и есть «буферный
# фолбэк только для недостающих частей»: часть с посчитанной изохроной здесь
# не участвует, так что уже покрытая по дорогам территория буфером не
# перекрывается и не подменяется более грубой оценкой.
#
# Формула автоматически схлопывается до прежних частных случаев: если
# изохрон вообще нет, первое условие истинно всегда и здание слепо ровно
# тогда, когда оно вне буфера любой части (старое поведение без роутера);
# если изохроны есть у всех частей, второе условие истинно всегда (нет
# «недостающих» частей) и здание слепо ровно тогда, когда оно вне всех
# изохрон (старое поведение с полным роутером).
_BLIND_ZONE_CLAUSE = """
    NOT EXISTS (
        SELECT 1 FROM station_isochrones i
        WHERE i.seconds = :sec AND ST_Intersects(i.geom, b.geom)
    )
    AND NOT EXISTS (
        SELECT 1 FROM fire_stations s
        WHERE ST_DWithin(b.geom::geography, s.geom::geography, :r)
          AND NOT EXISTS (
              SELECT 1 FROM station_isochrones i2
              WHERE i2.station_id = s.id AND i2.seconds = :sec
          )
    )
"""


@router.get("/blind-zones")
def blind_zones(db: Session = Depends(get_db)) -> dict:
    """Здания, до которых караул не успевает за норматив.

    Считается по дорожным изохронам там, где они рассчитаны; для частей без
    текущей изохроны (новых или с неудавшимся пересчётом) — по прямолинейному
    буферу, а не «здание недостижимо», раз мы просто не знаем зону этой
    части. Если изохрон нет вообще ни у одной части, это совпадает с прежним
    поведением на чистом буфере.
    """
    seconds = _normative_seconds()
    missing = _stations_missing_isochrones(db, seconds)
    rows = db.execute(
        text(
            f"""
            SELECT b.id, b.address, r.score,
                   ST_AsGeoJSON(ST_Centroid(b.geom)) AS geom
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            WHERE {_BLIND_ZONE_CLAUSE}
            LIMIT 4000
            """
        ),
        {"sec": seconds, "r": settings.coverage_radius_m},
    ).mappings().all()
    fc = _fc(
        rows,
        "geom",
        lambda r: {"id": r["id"], "address": r["address"], "score": r["score"]},
    )
    fc["approximate"] = bool(missing)
    fc["stations_missing_isochrones"] = len(missing)
    return fc


@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    seconds = _normative_seconds()
    missing = _stations_missing_isochrones(db, seconds)
    road = _has_isochrones(db)
    row = db.execute(
        text(
            f"""
            SELECT
                (SELECT count(*) FROM fire_stations) AS stations,
                (SELECT count(*) FROM hydrants) AS hydrants,
                (SELECT count(*) FROM hydrants WHERE status = 'broken') AS broken,
                (SELECT count(*) FROM buildings) AS total_buildings,
                (SELECT count(*) FROM buildings b WHERE {_BLIND_ZONE_CLAUSE}) AS blind
            """
        ),
        {"sec": seconds, "r": settings.coverage_radius_m},
    ).mappings().first()

    total = row["total_buildings"] or 1
    computed_at = (
        db.execute(
            text("SELECT max(computed_at) FROM station_isochrones WHERE seconds = :s"),
            {"s": _normative_seconds()},
        ).scalar()
        if road
        else None
    )
    return {
        "stations": row["stations"],
        "hydrants": row["hydrants"],
        "broken_hydrants": row["broken"],
        "blind_zone_buildings": row["blind"],
        "blind_pct": round(100.0 * row["blind"] / total, 1),
        "coverage_radius_m": settings.coverage_radius_m,
        "normative_min": settings.arrival_normative_min,
        # Приблизительно, если изохрон нет вообще (круг завышает покрытие —
        # см. /coverage) ИЛИ они есть не у всех частей: тогда часть слепых
        # зданий на самом деле лишь «не посчитаны», а не «недостижимы».
        "approximate": (not road) or bool(missing),
        "stations_missing_isochrones": len(missing),
        "coverage_source": "osrm" if road else "buffer",
        "coverage_computed_at": computed_at.isoformat() if computed_at else None,
        # Оба источника завышают покрытие, но по-разному: круг — потому что
        # не знает реки и закрытых кварталов, изохрона — потому что не знает
        # заторов. Поэтому признак остаётся и у дорожного расчёта.
        "traffic_unaccounted": road and settings.routing_time_factor <= 1.0,
        "time_factor": settings.routing_time_factor if road else None,
    }


@router.post("/hydrants/{hydrant_id}/status")
def set_hydrant_status(
    hydrant_id: int,
    body: HydrantStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(HYDRANT_STATUS_ROLES),
) -> dict:
    """Record a hydrant's actual state from the field (караул на выезде).

    A responder/dispatcher marks a hydrant ok/broken and stamps last_check —
    the боевой пакет and the map then reflect reality, not the last feed import.
    """
    row = db.execute(
        text(
            """
            UPDATE hydrants
               SET status = :st, last_check = now()
             WHERE id = :id
            RETURNING id, status, last_check, pressure_bar, diameter_mm,
                      hydrant_type, ST_Y(geom) AS lat, ST_X(geom) AS lng
            """
        ),
        {"st": body.status, "id": hydrant_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Гидрант не найден")
    db.commit()

    audit(
        action="hydrant.status",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/infra/hydrants/{hydrant_id}/status",
        status_code=200,
        ip=client_ip(request),
        detail={"id": hydrant_id, "status": body.status, "note": body.note},
    )

    return {
        "id": row["id"],
        "status": row["status"],
        "last_check": row["last_check"].isoformat() if row["last_check"] else None,
        "pressure_bar": row["pressure_bar"],
        "diameter_mm": row["diameter_mm"],
        "hydrant_type": row["hydrant_type"],
        "lat": row["lat"],
        "lng": row["lng"],
    }
