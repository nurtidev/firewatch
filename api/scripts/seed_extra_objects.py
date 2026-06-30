"""Seed дополнительных реальных объектов (ЖК «Аланда», «Евразия-3») как оперкарточки.

Run:  docker compose exec api python -m scripts.seed_extra_objects

Берёт структурированные ПТП (scripts/seed_data/alanda.json, evraziya.json) и для
каждого:
  * подбирает представительное здание (по адресу; иначе — самое высокое жилое
    здание без уже привязанной оперкарточки, чтобы не коллизить с Хайвиллом);
  * вставляет operational_card с extracted JSON (идемпотентно по filename);
  * добавляет гидранты из water_sources, если у них есть расстояние.

Демо-данные пилота. Идемпотентно. Запускать после import_osm/seed_ops/seed_hayvill.
Схемы ДЧС этих объектов уже на фронте (web/public/schemes/{alanda,evraziya}).
"""

import json
import math
from pathlib import Path

from sqlalchemy import text

from app.db import engine

SEED_DIR = Path(__file__).resolve().parent / "seed_data"

# (json-файл, filename оперкарточки, паттерны адреса, базовый sentinel для гидрантов)
OBJECTS = [
    {
        "json": "alanda.json",
        "filename": "alanda_ptp.json",
        "address_patterns": ["%Тәуелсіздік%33%", "%Тауельсизд%33%", "%Аланда%"],
        "hydrant_base": -9100,
    },
    {
        "json": "evraziya.json",
        "filename": "evraziya_ptp.json",
        "address_patterns": ["%Петров%", "%Сәтпаев%", "%Сатпаев%", "%Евразия%"],
        "hydrant_base": -9200,
    },
]


def _target_building(conn, patterns: list[str]) -> dict | None:
    # 1) по конкретному адресу
    for p in patterns:
        row = conn.execute(
            text("SELECT id, address, district FROM buildings WHERE address ILIKE :a LIMIT 1"),
            {"a": p},
        ).mappings().first()
        if row:
            return dict(row)
    # 2) фолбэк: самое высокое жилое здание БЕЗ оперкарточки (чтобы не пересечься
    #    с уже занятыми зданиями — Хайвилл и др.)
    row = conn.execute(
        text(
            "SELECT b.id, b.address, b.district FROM buildings b "
            "WHERE b.building_type = 'residential' "
            "AND NOT EXISTS (SELECT 1 FROM operational_cards oc WHERE oc.building_id = b.id) "
            "ORDER BY b.floors DESC NULLS LAST LIMIT 1"
        )
    ).mappings().first()
    return dict(row) if row else None


def _seed_one(conn, spec: dict) -> None:
    path = SEED_DIR / spec["json"]
    if not path.exists():
        print(f"SKIP {spec['filename']}: нет файла {path.name}")
        return
    card = json.loads(path.read_text(encoding="utf-8"))
    name = (card.get("object") or {}).get("name") or spec["filename"]

    b = _target_building(conn, spec["address_patterns"])
    if not b:
        print(f"SKIP {name}: не нашёл свободное здание (запусти import_osm/seed_ops)")
        return
    bid = b["id"]

    conn.execute(
        text("DELETE FROM operational_cards WHERE filename = :f"),
        {"f": spec["filename"]},
    )
    conn.execute(
        text(
            """
            INSERT INTO operational_cards
                (building_id, filename, media_type, file_path, status, extracted)
            VALUES (:bid, :f, 'application/json', NULL, 'extracted', CAST(:ex AS JSONB))
            """
        ),
        {"bid": bid, "f": spec["filename"], "ex": json.dumps(card, ensure_ascii=False)},
    )

    water = [w for w in card.get("water_sources", []) if w.get("distance_m")]
    n = max(len(water), 1)
    for i, w in enumerate(water):
        osm_id = spec["hydrant_base"] - i
        azimuth = (360.0 / n) * i
        conn.execute(
            text(
                """
                INSERT INTO hydrants
                    (osm_id, status, last_check, pressure_bar, diameter_mm, hydrant_type, geom)
                VALUES (
                    :osm_id, 'ok', CURRENT_DATE, 4.0, 150, 'подземный',
                    ST_Project(
                        ST_Centroid((SELECT geom FROM buildings WHERE id = :bid))::geography,
                        :dist, radians(:az)
                    )::geometry
                )
                ON CONFLICT (osm_id) DO UPDATE SET
                    status = EXCLUDED.status, last_check = EXCLUDED.last_check,
                    pressure_bar = EXCLUDED.pressure_bar, diameter_mm = EXCLUDED.diameter_mm,
                    hydrant_type = EXCLUDED.hydrant_type, geom = EXCLUDED.geom
                """
            ),
            {"osm_id": osm_id, "bid": bid, "dist": float(w["distance_m"]), "az": azimuth},
        )

    print(f"seeded: '{name}' -> building #{bid} {b['address']}, {len(water)} hydrants")


def main() -> None:
    with engine.begin() as conn:
        for spec in OBJECTS:
            _seed_one(conn, spec)


if __name__ == "__main__":
    main()
