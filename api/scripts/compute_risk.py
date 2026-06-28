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

# Postgres advisory-lock key — guards against two scoring runs overlapping (cron
# fires while a slow previous run is still going, or an admin runs it by hand).
SCORING_LOCK_KEY = 911_220_626


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

    # Domain features: prefer real ДЧС passport columns when present (added in
    # migration 0003), otherwise synthesize deterministically from osm_id+type so
    # the demo map is varied. `.get` tolerates pre-migration rows in dev.
    mass = b.get("mass_occupancy")
    if mass is None:
        mass = btype == "public" and rng(osm_id, "mass") < 0.5
    vulnerable = b.get("vulnerable_occupancy")
    if vulnerable is None:
        vulnerable = btype == "public" and rng(osm_id, "vuln") < 0.2
    hazard = b.get("hazard_category")
    if hazard is None:
        hazard = 1 + int(rng(osm_id, "haz") * 5) if btype == "industrial" else 0
    gas = b.get("has_gas")
    if gas is None:
        gas = rng(osm_id, "gas") < (0.7 if (btype == "residential" and year < 2000) else 0.3)

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
        "mass_occupancy": bool(mass),
        "vulnerable_occupancy": bool(vulnerable),
        "hazard_category": int(hazard),
        "has_gas": bool(gas),
    }


def _score_chunk(client: httpx.Client, upsert, batch: list[dict], payload: list[dict]) -> int:
    """Score one chunk and upsert it. Retries once on transient ML/DB errors;
    raises if it still fails so the caller can record the failed range."""
    last_err: Exception | None = None
    for attempt in (1, 2):
        try:
            resp = client.post("/predict/batch", json=payload)
            resp.raise_for_status()
            preds = resp.json()
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
            return len(rows)
        except Exception as err:  # noqa: BLE001 - retry once, then surface
            last_err = err
            print(f"  ! chunk failed (attempt {attempt}): {err}")
    raise RuntimeError(f"chunk failed after retries: {last_err}")


def main() -> None:
    # Single-flight: bail out if another scoring run holds the lock. The lock is
    # session-scoped, so we keep this connection open for the whole run.
    with engine.connect() as lock_conn:
        locked = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": SCORING_LOCK_KEY}
        ).scalar()
        if not locked:
            print("another scoring run is in progress — exiting")
            return
        try:
            _run(lock_conn)
        finally:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"), {"k": SCORING_LOCK_KEY}
            )
            lock_conn.commit()


def _run(_lock_conn) -> None:
    with engine.begin() as conn:
        buildings = (
            conn.execute(
                text(
                    "SELECT id, osm_id, building_type, year_built, floors, "
                    "mass_occupancy, vulnerable_occupancy, hazard_category, has_gas "
                    "FROM buildings"
                )
            )
            .mappings()
            .all()
        )
    total = len(buildings)
    print(f"scoring {total} buildings (winter_season={WINTER}) ...")

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
    failed_ranges: list[tuple[int, int]] = []
    feature_sums: dict[str, float] = {}
    scored = 0
    with httpx.Client(base_url=settings.ml_url, timeout=120) as client:
        baseline = _fetch_baseline(client)
        for start in range(0, total, CHUNK):
            batch = buildings[start : start + CHUNK]
            payload = [features_for(dict(b)) for b in batch]
            for feats in payload:  # accumulate live feature means for drift check
                for k, v in feats.items():
                    feature_sums[k] = feature_sums.get(k, 0.0) + float(v)
            scored += len(payload)
            try:
                done += _score_chunk(client, upsert, batch, payload)
            except Exception as err:  # noqa: BLE001 - keep going, report at end
                failed_ranges.append((start, start + len(batch)))
                print(f"  ! skipping buildings [{start}:{start + len(batch)}]: {err}")
                continue
            print(f"  {done}/{total}")

    _log_score_distribution()
    if baseline and scored:
        _log_feature_drift({k: v / scored for k, v in feature_sums.items()}, baseline)

    if failed_ranges:
        skipped = sum(b - a for a, b in failed_ranges)
        print(
            f"risk computation finished WITH ERRORS: {done}/{total} updated, "
            f"{skipped} skipped in ranges {failed_ranges}"
        )
        raise SystemExit(1)
    print(f"risk computation complete: {done}/{total} updated")


def _fetch_baseline(client: httpx.Client) -> dict | None:
    """Training-set feature reference (mean/std) from the ML service, for drift."""
    try:
        resp = client.get("/model")
        resp.raise_for_status()
        return resp.json().get("feature_baseline")
    except Exception as err:  # noqa: BLE001 - drift check is best-effort
        print(f"[drift] baseline unavailable: {err}")
        return None


def _log_feature_drift(live_means: dict[str, float], baseline: dict) -> None:
    """Compare this run's feature means to the training baseline in σ-units.

    A large shift means the live inputs diverged from what the model was trained
    on — retrain/investigate before trusting scores. |z|>1 is flagged.
    """
    flagged = []
    for name, ref in baseline.items():
        if name not in live_means:
            continue
        z = (live_means[name] - ref["mean"]) / ref["std"]
        if abs(z) > 1.0:
            flagged.append(f"{name} z={z:+.2f}")
    if flagged:
        print(f"[drift] FEATURE SHIFT vs baseline: {', '.join(flagged)} — проверьте данные/переобучение")
    else:
        print("[drift] features within 1σ of training baseline")


def _log_score_distribution() -> None:
    """Emit a score-distribution snapshot so drift is visible run-to-run.

    A sudden shift in mean/percentiles or band counts is the earliest signal that
    inputs changed (new data source, feature pipeline regression, model swap).
    """
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    count(*) AS n,
                    round(avg(score)::numeric, 1) AS mean,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY score) AS p50,
                    percentile_cont(0.95) WITHIN GROUP (ORDER BY score) AS p95,
                    max(score) AS max,
                    count(*) FILTER (WHERE score >= 60) AS critical,
                    count(*) FILTER (WHERE score >= 40 AND score < 60) AS high,
                    count(*) FILTER (WHERE score >= 20 AND score < 40) AS elevated,
                    count(*) FILTER (WHERE score < 20) AS normal
                FROM risk_scores
                """
            )
        ).mappings().first()
    if row and row["n"]:
        print(
            "[drift] scores n={n} mean={mean} p50={p50} p95={p95} max={max} | "
            "bands critical={critical} high={high} elevated={elevated} "
            "normal={normal}".format(**row)
        )


if __name__ == "__main__":
    main()
