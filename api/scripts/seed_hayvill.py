"""Seed the ЖК «Хайвилл-Астана» operational plan (ПТП) as the first real object.

Run:  docker compose exec api python -m scripts.seed_hayvill

Takes the structured card extracted from the real ДЧС ПТП
(scripts/seed_data/hayvill.json) and:
  * attaches it to a representative building on ул. Сарайшык (the complex's area),
  * sets that building's domain fire-hazard features from the plan (детсад →
    vulnerable_occupancy, торговые помещения → mass_occupancy, gas, occupancy),
  * inserts the 6 ring-main hydrants (ПГ-1…ПГ-6, Ø150) around it with specs,
  * inserts the operational_card with the extracted JSON.

Idempotent. Re-run after `import_osm`/`seed_ops`; run `compute_risk` afterwards to
rescore the building with its real features. Demo data — replace at pilot.
"""

import json
import math
from pathlib import Path

from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.extraction import mask_contacts_field

DATA = Path(__file__).resolve().parent / "seed_data" / "hayvill.json"
# Preferred building to represent the complex (high-rise on Сарайшык, Сарыаркинский
# district — same scope as the demo inspector). Falls back to the tallest
# residential building in that district if the exact address isn't present.
PREFERRED_ADDRESS = "%Сарайшық%7/1%"
HYDRANT_OSM_BASE = -9000  # sentinel ids so re-runs upsert instead of duplicating


def _target_building(conn) -> dict:
    row = conn.execute(
        text("SELECT id, address, district FROM buildings WHERE address ILIKE :a LIMIT 1"),
        {"a": PREFERRED_ADDRESS},
    ).mappings().first()
    if row:
        return dict(row)
    row = conn.execute(
        text(
            "SELECT id, address, district FROM buildings "
            "WHERE building_type = 'residential' AND district = 'Сарыаркинский' "
            "ORDER BY floors DESC NULLS LAST LIMIT 1"
        )
    ).mappings().first()
    if not row:
        raise RuntimeError("No buildings — run import_osm/seed_ops first")
    return dict(row)


def main() -> None:
    card = json.loads(DATA.read_text(encoding="utf-8"))
    # Belt-and-suspenders (see api/app/extraction.py): the seed JSON is hand-edited,
    # so re-mask ПДн in structured contacts here rather than trust the file — a
    # future edit that reopens a personal phone still gets caught on import.
    if settings.mask_pii and "contacts" in card:
        card["contacts"] = mask_contacts_field(card["contacts"])
    water = [w for w in card.get("water_sources", []) if w.get("distance_m")]

    with engine.begin() as conn:
        b = _target_building(conn)
        bid = b["id"]
        print(f"target building: #{bid} {b['address']} ({b['district']})")

        # 1) Domain fire-hazard features from the real plan.
        conn.execute(
            text(
                """
                UPDATE buildings SET
                    mass_occupancy = TRUE,         -- торговые помещения / массовое пребывание
                    vulnerable_occupancy = TRUE,   -- детский сад в составе комплекса
                    has_gas = TRUE,
                    hazard_category = 0,           -- не производственный объект
                    occupancy_capacity = 3000
                WHERE id = :id
                """
            ),
            {"id": bid},
        )

        # 2) Operational card with the extracted ПТП JSON (idempotent by filename).
        conn.execute(
            text("DELETE FROM operational_cards WHERE filename = 'hayvill_ptp.json'")
        )
        conn.execute(
            text(
                """
                INSERT INTO operational_cards
                    (building_id, filename, media_type, file_path, status, extracted)
                VALUES (:bid, 'hayvill_ptp.json', 'application/json', NULL,
                        'extracted', CAST(:ex AS JSONB))
                """
            ),
            {"bid": bid, "ex": json.dumps(card, ensure_ascii=False)},
        )

        # 3) Ring-main hydrants (Ø150) placed around the building by their plan
        #    distances, spread evenly by azimuth. Upsert on sentinel osm_id.
        n = max(len(water), 1)
        for i, w in enumerate(water):
            osm_id = HYDRANT_OSM_BASE - i
            azimuth = (360.0 / n) * i  # degrees, spread around the object
            conn.execute(
                text(
                    """
                    INSERT INTO hydrants
                        (osm_id, status, last_check, pressure_bar, diameter_mm,
                         hydrant_type, geom)
                    VALUES (
                        :osm_id, 'ok', CURRENT_DATE, 4.0, 150, 'подземный',
                        ST_Project(
                            ST_Centroid((SELECT geom FROM buildings WHERE id = :bid))::geography,
                            :dist, radians(:az)
                        )::geometry
                    )
                    ON CONFLICT (osm_id) DO UPDATE SET
                        status = EXCLUDED.status,
                        last_check = EXCLUDED.last_check,
                        pressure_bar = EXCLUDED.pressure_bar,
                        diameter_mm = EXCLUDED.diameter_mm,
                        hydrant_type = EXCLUDED.hydrant_type,
                        geom = EXCLUDED.geom
                    """
                ),
                {"osm_id": osm_id, "bid": bid, "dist": float(w["distance_m"]), "az": azimuth},
            )

    print(
        f"seeded: card '{card['object']['name']}' -> building #{bid}, "
        f"{len(water)} hydrants (Ø150). Run compute_risk to rescore."
    )


if __name__ == "__main__":
    main()
