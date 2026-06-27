"""ML model + pipeline unit tests."""

import numpy as np

from app import scorer
from app.features import FEATURE_ORDER, to_vector
from app.schemas import BuildingFeatures
from train.metrics import calibration_bins, lift_at

HIGH = BuildingFeatures(
    age_years=68, floors=9, wooden_floors=True, has_fire_alarm=False,
    incidents_300m_3y=3, block_density=0.85, winter_season=True,
    nearest_hydrant_m=240, capital_repair_recent=False,
)
LOW = BuildingFeatures(
    age_years=4, floors=3, wooden_floors=False, has_fire_alarm=True,
    incidents_300m_3y=0, block_density=0.2, winter_season=False,
    nearest_hydrant_m=30, capital_repair_recent=True,
)


def test_score_bounds():
    for f in (HIGH, LOW):
        p = scorer.score(f)
        assert 0 <= p.score <= 100


def test_high_risk_scores_above_low_risk():
    assert scorer.score(HIGH).score > scorer.score(LOW).score


def test_explanation_is_signed_and_sorted():
    p = scorer.score(HIGH)
    assert p.explanation, "expected non-empty SHAP explanation"
    mags = [abs(c.value) for c in p.explanation]
    assert mags == sorted(mags, reverse=True)


def test_to_vector_matches_feature_order():
    v = to_vector(HIGH)
    assert len(v) == len(FEATURE_ORDER)
    # booleans encoded as 0/1
    assert v[FEATURE_ORDER.index("wooden_floors")] == 1.0
    assert v[FEATURE_ORDER.index("has_fire_alarm")] == 0.0


def test_lift_at_rewards_good_ranking():
    y = np.array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1])
    proba = np.array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9, 0.95])
    res = lift_at(y, proba, 0.2)  # top-2 are exactly the positives
    assert res["lift"] > 1.0
    assert res["recall_captured"] == 1.0


def test_calibration_bins_partition_counts():
    y = np.array([0, 1, 0, 1, 1])
    proba = np.array([0.05, 0.15, 0.25, 0.85, 0.95])
    bins = calibration_bins(y, proba, n_bins=10)
    assert sum(b["count"] for b in bins) == len(y)
