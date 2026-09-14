"""Районы Астаны из OpenStreetMap → таблица `districts` и район каждого здания.

Run:  docker compose exec api python -m scripts.seed_districts

Зачем. `buildings.district` раньше назначался хешем osm_id (seed_ops.py):
скоупинг инспектора резал город по случайной мозаике, а любая цифра «по
районам» была выдумкой. Здесь район — административная граница из OSM
(api/data/astana_districts.geojson, лицензия ODbL — «© OpenStreetMap
contributors» обязательно на карте и в отчёте).

Что делает (одной транзакцией):
  1. upsert пяти полигонов в `districts` — сопоставление по `name` в написании
     проекта («Байконырский»), OSM-строки («район Байконур») не используются;
  2. район здания — полигон, в который попадает ST_PointOnSurface контура;
     вне всех полигонов — ближайший район (правило одно на всё приложение,
     app/districts.py);
  3. денормализованные копии района, производные от здания:
       • `field_reports.district` — скоупинг донесений читает его напрямую
         (reports.py), поэтому пересчитывается: район привязанного здания, а
         у донесения без здания — район его точки;
       • `operational_cards.district` — район привязанного здания (у
         загруженного PDF без здания район остаётся зафиксированным при
         загрузке).
     callouts / inspection_visits / owner_buildings / маршруты джойнят
     `buildings.district` вживую — переносить нечего.

Идемпотентно: каждый UPDATE трогает только строки, где значение меняется, и
повторный прогон печатает нули. Запускается в preDeploy сразу после миграций
(api/railway.json) и из seed_ops — для зданий нового импорта.
"""

import json
from pathlib import Path

from sqlalchemy import text

from app.db import engine
from app.districts import district_of

DATA = Path(__file__).resolve().parent.parent / "data" / "astana_districts.geojson"

_NO_DISTRICT = "— без района"


def load_features(path: Path = DATA) -> list[dict]:
    """Районы из GeoJSON как параметры upsert (без обращения к БД)."""
    fc = json.loads(path.read_text(encoding="utf-8"))
    features = []
    for feature in fc["features"]:
        props = feature["properties"]
        features.append(
            {
                "name": props["name"],
                "name_kk": props.get("name_kk"),
                "name_en": props.get("name_en"),
                "osm_relation_id": props.get("osm_relation_id"),
                "area_km2": props.get("area_km2"),
                "geometry": json.dumps(feature["geometry"]),
            }
        )
    return features


def upsert_districts(conn, features: list[dict]) -> int:
    """Вставить/обновить полигоны районов. Возвращает число изменённых строк."""
    changed = 0
    for feature in features:
        changed += conn.execute(
            text(
                """
                INSERT INTO districts (name, name_kk, name_en, osm_relation_id, area_km2, geom)
                VALUES (
                    :name, :name_kk, :name_en, :osm_relation_id, :area_km2,
                    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326))
                )
                ON CONFLICT (name) DO UPDATE
                   SET name_kk = EXCLUDED.name_kk,
                       name_en = EXCLUDED.name_en,
                       osm_relation_id = EXCLUDED.osm_relation_id,
                       area_km2 = EXCLUDED.area_km2,
                       geom = EXCLUDED.geom
                 -- Без изменений строка не переписывается: повторный прогон
                 -- даёт rowcount 0, а не «обновлено 5».
                 WHERE (districts.name_kk, districts.name_en,
                        districts.osm_relation_id, districts.area_km2)
                       IS DISTINCT FROM
                       (EXCLUDED.name_kk, EXCLUDED.name_en,
                        EXCLUDED.osm_relation_id, EXCLUDED.area_km2)
                    OR ST_AsBinary(districts.geom) IS DISTINCT FROM ST_AsBinary(EXCLUDED.geom)
                """
            ),
            feature,
        ).rowcount
    return changed


def assign_buildings(conn) -> int:
    """Район здания по его контуру. Возвращает число зданий, сменивших район."""
    return conn.execute(
        text(
            f"""
            UPDATE buildings b
               SET district = t.district
              FROM (
                    SELECT src.id,
                           {district_of("ST_PointOnSurface(src.geom)")} AS district
                      FROM buildings src
                   ) t
             WHERE b.id = t.id
               AND b.district IS DISTINCT FROM t.district
            """
        )
    ).rowcount


def propagate_field_reports(conn) -> int:
    """Район донесения = район здания; без здания — район точки донесения."""
    return conn.execute(
        text(
            f"""
            UPDATE field_reports fr
               SET district = t.district
              FROM (
                    SELECT src.id,
                           COALESCE(b.district, {district_of("src.geom")}) AS district
                      FROM field_reports src
                      LEFT JOIN buildings b ON b.id = src.building_id
                   ) t
             WHERE fr.id = t.id
               AND fr.district IS DISTINCT FROM t.district
            """
        )
    ).rowcount


def propagate_cards(conn) -> int:
    """Район оперкарточки, привязанной к зданию, = район здания."""
    return conn.execute(
        text(
            """
            UPDATE operational_cards c
               SET district = b.district
              FROM buildings b
             WHERE c.building_id = b.id
               AND c.district IS DISTINCT FROM b.district
            """
        )
    ).rowcount


def _building_counts(conn) -> dict[str, int]:
    rows = conn.execute(
        text("SELECT district, count(*) FROM buildings GROUP BY district")
    ).all()
    return {(d if d is not None else _NO_DISTRICT): int(n) for d, n in rows}


def _outside_polygons(conn) -> int:
    return int(
        conn.execute(
            text(
                """
                SELECT count(*) FROM buildings b
                 WHERE NOT EXISTS (
                     SELECT 1 FROM districts d
                      WHERE ST_Contains(d.geom, ST_PointOnSurface(b.geom))
                 )
                """
            )
        ).scalar()
        or 0
    )


def run(conn, features: list[dict] | None = None) -> dict:
    """Все шаги в переданной транзакции. Возвращает статистику изменений."""
    features = load_features() if features is None else features
    before = _building_counts(conn)

    districts_changed = upsert_districts(conn, features)
    if not conn.execute(text("SELECT count(*) FROM districts")).scalar():
        # Пустая таблица обнулила бы район каждого здания — а с ним и скоупинг.
        raise RuntimeError("таблица districts пуста — назначать здания не по чему")

    stats = {
        "districts_changed": districts_changed,
        "buildings_changed": assign_buildings(conn),
        "field_reports_changed": propagate_field_reports(conn),
        "cards_changed": propagate_cards(conn),
        "outside_polygons": _outside_polygons(conn),
        "before": before,
    }
    stats["after"] = _building_counts(conn)
    return stats


def changed_rows(stats: dict) -> int:
    return sum(
        stats[k]
        for k in ("districts_changed", "buildings_changed", "field_reports_changed", "cards_changed")
    )


def print_report(stats: dict) -> None:
    names = sorted(set(stats["before"]) | set(stats["after"]))
    width = max([len(n) for n in names] + [6])
    print(f"{'район':<{width}}  {'до':>6}  {'после':>6}  {'Δ':>6}")
    for name in names:
        b, a = stats["before"].get(name, 0), stats["after"].get(name, 0)
        print(f"{name:<{width}}  {b:>6}  {a:>6}  {a - b:>+6}")
    print(
        f"районов изменено: {stats['districts_changed']}; "
        f"зданий сменили район: {stats['buildings_changed']} "
        f"(вне всех полигонов, ближайший район: {stats['outside_polygons']}); "
        f"донесений: {stats['field_reports_changed']}; "
        f"оперкарточек: {stats['cards_changed']}"
    )


def main() -> None:
    with engine.begin() as conn:
        stats = run(conn)
    print_report(stats)


if __name__ == "__main__":
    main()
