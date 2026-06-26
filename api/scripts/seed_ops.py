"""Seed inspection-planning data (Module 04).

Run:  docker compose exec api python -m scripts.seed_ops

Assigns each building a district and a last-inspected date (deterministically
synthesized from osm_id — replace with real ДЧС inspection history at pilot),
and creates a few inspectors. Idempotent.
"""

import hashlib
from datetime import date, timedelta

from sqlalchemy import text

from app.db import engine

TODAY = date(2026, 6, 26)

DISTRICTS = [
    "Сарыаркинский",
    "Алматинский",
    "Есильский",
    "Байконырский",
    "Нуринский",
]

INSPECTORS = [
    ("Ахметов Д.К.", "Сарыаркинский"),
    ("Сулейменова А.Б.", "Алматинский"),
    ("Жунусов Е.М.", "Есильский"),
]


def rng(osm_id: int, salt: str) -> float:
    h = hashlib.md5(f"{osm_id}:{salt}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def main() -> None:
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id, osm_id FROM buildings")
        ).mappings().all()

        for b in rows:
            osm_id = b["osm_id"] or b["id"]
            district = DISTRICTS[int(rng(osm_id, "district") * len(DISTRICTS))]
            days_ago = 10 + int(rng(osm_id, "lastcheck") * 420)
            last = TODAY - timedelta(days=days_ago)
            conn.execute(
                text(
                    "UPDATE buildings SET district = :d, last_inspected = :l "
                    "WHERE id = :id"
                ),
                {"d": district, "l": last, "id": b["id"]},
            )

        existing = conn.execute(text("SELECT count(*) FROM inspectors")).scalar()
        if not existing:
            for name, district in INSPECTORS:
                conn.execute(
                    text("INSERT INTO inspectors (name, district) VALUES (:n, :d)"),
                    {"n": name, "d": district},
                )

    print(f"seeded districts/last_inspected for {len(rows)} buildings, "
          f"{len(INSPECTORS)} inspectors")


if __name__ == "__main__":
    main()
