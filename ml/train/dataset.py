"""Training dataset for the fire-risk model.

Two sources, one schema (FEATURE_ORDER + binary `fire_next_12m` label):

1. synthetic()  — DEFAULT until ДЧС shares historical incident data. Buildings
   are sampled from realistic Astana-like distributions and labelled by a fixed
   *ground-truth* process (a hand-specified log-odds function + Bernoulli noise).
   The label is NOT a copy of any feature, so the model has to *learn* the
   relationship — metrics (ROC-AUC ~0.85, imperfect calibration) are therefore
   meaningful, not trivially 1.0. Everything is seeded → fully reproducible.

2. from_incidents() — the REAL pipeline. For each building it builds the same
   feature vector from ДЧС/OSM data and labels it 1 if an incident is recorded
   in the target horizon. Documented here and wired to the `incidents` table;
   swap synthetic→real by setting FW_TRAIN_SOURCE=incidents once data exists.

The feature CONTRACT (ml.app.features.FEATURE_ORDER) is identical for both, so
the served model and the whole API surface stay unchanged across the swap.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.features import FEATURE_ORDER

SEED = 20260627
N_SAMPLES = 12000

# Ground-truth log-odds coefficients used to GENERATE labels for the synthetic
# set. The model never sees these — it estimates them from data. Chosen to echo
# established fire-risk drivers (age, combustible structure, incident history,
# missing detection systems, density, winter, hydrant distance).
# Target base rate of the event (fires are rare). The linear part below is
# mean-centred and shifted to logit(_BASE_RATE) so the prevalence is realistic
# regardless of feature scaling, while relative effect sizes are preserved.
_BASE_RATE = 0.10
_GT = {
    "age_years": 0.030,
    "floors_excess": 0.055,          # applied to max(floors-5, 0)
    "wooden_floors": 1.15,
    "no_fire_alarm": 1.05,           # applied to (1 - has_fire_alarm)
    "incidents_300m_3y": 0.55,
    "block_density": 1.40,
    "winter_season": 0.65,
    "hydrant_excess": 0.0020,        # applied to max(hydrant_m-50, 0)
    "capital_repair_recent": -0.55,
    "wooden_x_old": 0.65,            # interaction: wooden AND age>50
}
_NOISE_SD = 0.40


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def synthetic(n: int = N_SAMPLES, seed: int = SEED) -> tuple[pd.DataFrame, np.ndarray]:
    rng = np.random.default_rng(seed)

    year_built = rng.integers(1955, 2021, n)
    age_years = (2026 - year_built).astype(float)
    floors = np.clip(rng.gamma(3.0, 2.2, n).round(), 1, 25).astype(float)

    # Older stock is more likely to have wooden floors and to lack АПС/АУПТ.
    p_wood = np.where(age_years > 50, 0.45, 0.10)
    wooden_floors = (rng.random(n) < p_wood).astype(float)
    p_alarm = np.where(year_built >= 1995, 0.85, 0.40)
    has_fire_alarm = (rng.random(n) < p_alarm).astype(float)

    incidents_300m_3y = rng.poisson(0.5 + age_years * 0.006).astype(float)
    block_density = rng.beta(2.0, 2.5, n)
    winter_season = (rng.random(n) < 0.5).astype(float)
    nearest_hydrant_m = np.clip(rng.gamma(2.2, 60, n), 15, 400).round().astype(float)
    capital_repair_recent = (rng.random(n) < 0.15).astype(float)

    df = pd.DataFrame(
        {
            "age_years": age_years,
            "floors": floors,
            "wooden_floors": wooden_floors,
            "has_fire_alarm": has_fire_alarm,
            "incidents_300m_3y": incidents_300m_3y,
            "block_density": block_density,
            "winter_season": winter_season,
            "nearest_hydrant_m": nearest_hydrant_m,
            "capital_repair_recent": capital_repair_recent,
        }
    )[FEATURE_ORDER]

    linear = (
        _GT["age_years"] * df.age_years
        + _GT["floors_excess"] * np.maximum(df.floors - 5, 0)
        + _GT["wooden_floors"] * df.wooden_floors
        + _GT["no_fire_alarm"] * (1 - df.has_fire_alarm)
        + _GT["incidents_300m_3y"] * df.incidents_300m_3y
        + _GT["block_density"] * df.block_density
        + _GT["winter_season"] * df.winter_season
        + _GT["hydrant_excess"] * np.maximum(df.nearest_hydrant_m - 50, 0)
        + _GT["capital_repair_recent"] * df.capital_repair_recent
        + _GT["wooden_x_old"] * (df.wooden_floors * (df.age_years > 50))
    ).to_numpy()

    logit_base = np.log(_BASE_RATE / (1.0 - _BASE_RATE))
    z = (linear - linear.mean()) + logit_base + rng.normal(0.0, _NOISE_SD, n)
    y = (rng.random(n) < _sigmoid(z)).astype(int)
    return df, y


def from_incidents(engine, horizon_months: int = 12) -> tuple[pd.DataFrame, np.ndarray]:
    """REAL pipeline (used once ДЧС incident history is loaded).

    Labels each building 1 if it has an incident within `horizon_months` after
    the feature snapshot. Feature columns mirror scripts/compute_risk so the
    train-time and serve-time feature distributions match. Raises if there are
    too few positives to train a credible model.
    """
    from sqlalchemy import text

    sql = text(
        """
        SELECT
            COALESCE(b.year_built, 1980)                              AS year_built,
            COALESCE(b.floors, 5)                                     AS floors,
            b.id,
            (SELECT count(*) FROM incidents i
               WHERE i.building_id = b.id
                 AND i.occurred_at < now() - make_interval(months => :h)) AS prior_incidents,
            (SELECT count(*) FROM incidents i
               WHERE i.building_id = b.id
                 AND i.occurred_at >= now() - make_interval(months => :h)) AS recent_incidents
        FROM buildings b
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql, {"h": horizon_months}).mappings().all()
    if not rows:
        raise RuntimeError("No buildings — load OSM/ДЧС data before training on incidents")

    # NOTE: the non-OSM features (wooden_floors, has_fire_alarm, hydrant distance,
    # block_density) come from the ДЧС object passport; until that feed is wired
    # this branch is intentionally a documented skeleton, not the default path.
    raise NotImplementedError(
        "from_incidents requires the ДЧС object-passport feed; using synthetic() until then"
    )
