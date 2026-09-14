"""Зоны прибытия и «слепые зоны» — общая логика для /infra и /city.

Здесь: условие слепой зоны, части без изохроны и с устаревшей изохроной,
резолвер `coverage_source` ("osrm" | "buffer" | "mixed").

Перенесено из app/routers/infra.py без изменения SQL: городская сводка
(app/routers/city.py) обязана считать слепые зоны ровно так же, как карта
инфраструктуры, иначе /city и /infra покажут акимату и ДЧС разные числа по
одному и тому же городу. infra.py импортирует эти имена под прежними
приватными псевдонимами.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings

# Гидрант «рядом», метры: в этом радиусе боевой пакет выезда показывает
# ближайшие гидранты (dispatch.py), и в нём же городская сводка считает здание
# обеспеченным водой (city.py). Одно число на оба места.
HYDRANT_RADIUS_M = 800


def normative_seconds() -> int:
    return settings.arrival_normative_min * 60


def has_isochrones(db: Session) -> bool:
    """Есть ли рассчитанные зоны по дорогам под текущий норматив (хотя бы одна)."""
    return bool(
        db.execute(
            text("SELECT 1 FROM station_isochrones WHERE seconds = :s LIMIT 1"),
            {"s": normative_seconds()},
        ).scalar()
    )


def stations_missing_isochrones(db: Session, seconds: int) -> list[dict]:
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


def stations_total(db: Session) -> int:
    return db.execute(text("SELECT count(*) FROM fire_stations")).scalar() or 0


# rebuild_coverage считает все части в одной транзакции и коммитит её одним
# разом (см. rebuild_coverage) — `now()` внутри транзакции Postgres не
# продвигается между вызовами, а возвращает момент её начала. Поэтому у ВСЕХ
# частей, успешно пересчитавшихся в одном проходе, `computed_at` — буквально
# одно и то же значение, без разброса в секунды и миллисекунды. Сравнение
# `computed_at < max(computed_at)` уже разделяет «эта часть пересчиталась в
# последнем проходе» (её `computed_at` равен максимуму, строгое неравенство
# ложно) от «эта часть не пересчиталась — осталась на значении прошлого
# прохода» (её `computed_at` меньше) без всякого допуска: два соседних прохода
# запускаются вручную и редко (см. миграцию 0022), то есть отличаются на часы
# или дни, а не на секунды, так что дополнительный запас здесь не нужен.
def stations_stale_isochrones(db: Session, seconds: int) -> list[dict]:
    """Части, чья изохрона заметно отстала от самой свежей в таблице.

    rebuild_coverage больше не удаляет изохрону части при неудачном
    пересчёте (см. rebuild_coverage) — она остаётся как была, и её
    `computed_at` не сдвигается. На фоне частей, обновившихся в этом же
    проходе, такая изохрона выделяется разрывом в `computed_at` — это и есть
    признак «устарела», без отдельного флага в схеме (см. миграцию 0022:
    там только `computed_at`, `source`, `points`).
    """
    return db.execute(
        text(
            """
            SELECT s.id, s.name
              FROM fire_stations s
              JOIN station_isochrones i
                ON i.station_id = s.id AND i.seconds = :sec
             WHERE i.computed_at < (
                 SELECT max(computed_at) FROM station_isochrones WHERE seconds = :sec
             )
            """
        ),
        {"sec": seconds},
    ).mappings().all()


def resolve_coverage_source(total: int, missing: int, stale: int = 0) -> str:
    """Единственный источник значения `coverage_source` для /stats, /coverage
    и /blind-zones — иначе три ручки неизбежно разъедутся в трактовке.

    Чистая функция от счётчиков, без запроса к БД — так её тривиально
    проверить юнит-тестом на все комбинации, не поднимая PostGIS.

    • "buffer" — по дорогам не посчитана НИ ОДНА часть (`missing >= total`,
      включая вырожденный случай `total == 0`): вся карта — прямолинейные
      круги, и это касается всего города одинаково.
    • "osrm" — у каждой части есть изохрона, и ни одна не устарела: вся
      карта — по дорогам.
    • "mixed" — где-то по дорогам, где-то нет (часть частей без изохроны)
      или не свежо (часть — с устаревшей изохроной): единого утверждения
      про весь город сделать нельзя, выдача покрывает оба случая сразу.
    """
    if total <= 0 or missing >= total:
        return "buffer"
    if missing == 0 and stale == 0:
        return "osrm"
    return "mixed"


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
#
# Ожидает алиас `b` для buildings и параметры :sec (норматив, с) и :r (радиус
# буфера, м).
BLIND_ZONE_CLAUSE = """
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
