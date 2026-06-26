"""Compute a risk score for every building and upsert into risk_scores.

Run:  docker compose exec api python -m scripts.compute_risk

Features come from real OSM tags where present (type, floors, year). The rest
(wooden floors, fire-alarm presence, nearby incidents, block density, hydrant
distance) are DETERMINISTICALLY SYNTHESIZED from osm_id so the demo map is
varied and reproducible. Replace this derivation with real ДЧС data in the
pilot — the ML contract (BuildingFeatures) stays the same.
"""

import hashlib
import json
import os

import httpx
from sqlalchemy import text

from app.config import settings
from app.db import engine

CURRENT_YEAR = 2026
WINTER = os.getenv("FW_SEASON_WINTER", "false").lower() == "true"
CHUNK = 500


def rng(osm_id: int, salt: str) -> float:
    """Deterministic pseudo-random in [0, 1) seeded by (osm_id, salt)."""
    h = hashlib.md5(f"{osm_id}:{salt}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def default_floors(osm_id: int, btype: str) -> int:
    r = rng(osm_id, "floors")
    if btype == "residential":
        return 1 + int(r * 16)
    if btype == "public":
        return 1 + int(r * 5)
    if btype == "industrial":
        return 1 + int(r * 3)
    return 1 + int(r * 9)


def features_for(b: dict) -> dict:
    osm_id = b["osm_id"] or b["id"]
    btype = b["building_type"]

    year = b["year_built"] or (1955 + int(rng(osm_id, "year") * 65))
    age = max(0, CURRENT_YEAR - year)
    floors = b["floors"] or default_floors(osm_id, btype)

    incident_p = min(0.05 + age * 0.002, 0.4)
    incidents = sum(1 for k in ("i1", "i2", "i3") if rng(osm_id, k) < incident_p)

    return {
        "age_years": age,
        "floors": floors,
        "wooden_floors": rng(osm_id, "wood") < (0.5 if age > 50 else 0.1),
        "has_fire_alarm": rng(osm_id, "aps") < (0.85 if year >= 1995 else 0.4),
        "incidents_300m_3y": incidents,
        "block_density": round(rng(osm_id, "dens"), 3),
        "winter_season": WINTER,
        "nearest_hydrant_m": 20 + int(rng(osm_id, "hyd") * 280),
        "capital_repair_recent": rng(osm_id, "repair") < 0.15,
    }


def main() -> None:
    with engine.begin() as conn:
        buildings = (
            conn.execute(
                text(
                    "SELECT id, osm_id, building_type, year_built, floors "
                    "FROM buildings"
                )
            )
            .mappings()
            .all()
        )
    print(f"scoring {len(buildings)} buildings (winter_season={WINTER}) ...")

    upsert = text(
        """
        INSERT INTO risk_scores (building_id, score, model_version, explanation)
        VALUES (:bid, :score, :ver, CAST(:expl AS JSONB))
        ON CONFLICT (building_id) DO UPDATE
        SET score = EXCLUDED.score,
            model_version = EXCLUDED.model_version,
            explanation = EXCLUDED.explanation,
            computed_at = now()
        """
    )

    done = 0
    with httpx.Client(base_url=settings.ml_url, timeout=120) as client:
        for start in range(0, len(buildings), CHUNK):
            batch = buildings[start : start + CHUNK]
            payload = [features_for(dict(b)) for b in batch]
            preds = client.post("/predict/batch", json=payload).json()

            rows = [
                {
                    "bid": b["id"],
                    "score": p["score"],
                    "ver": p["model_version"],
                    "expl": json.dumps(p["explanation"], ensure_ascii=False),
                }
                for b, p in zip(batch, preds, strict=True)
            ]
            with engine.begin() as conn:
                conn.execute(upsert, rows)
            done += len(rows)
            print(f"  {done}/{len(buildings)}")

    print("risk computation complete")


if __name__ == "__main__":
    main()
