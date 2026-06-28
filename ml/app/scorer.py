"""Risk scorer — serves the trained XGBoost model with TreeSHAP explanations.

Loads ml/artifacts/{model.json,meta.json} at import. Score = calibrated fire
probability × 100. Per-feature explanation = exact TreeSHAP contributions
(`pred_contribs`) converted from log-odds to probability points (≈ Δ percentage
points of risk), so the UI bars read as "this factor adds +6 p.p. of risk".

If artifacts are absent (dev checkout without a build), falls back to the
transparent heuristic so the service still answers.
"""

from __future__ import annotations

import json

import numpy as np
import xgboost as xgb

from app import heuristic
from app.features import (
    FEATURE_LABELS,
    FEATURE_ORDER,
    META_PATH,
    METRICS_PATH,
    MODEL_PATH,
    to_vector,
)
from app.schemas import BuildingFeatures, FeatureContribution, RiskPrediction

_MIN_CONTRIB_PP = 0.1   # hide factors below 0.1 p.p.
_MAX_FACTORS = 8


def _load() -> tuple[xgb.Booster, dict] | None:
    if not (MODEL_PATH.exists() and META_PATH.exists()):
        return None
    booster = xgb.Booster()
    booster.load_model(str(MODEL_PATH))
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    return booster, meta


_loaded = _load()
# True when the trained XGBoost artifacts loaded; False means we silently fell
# back to the heuristic — surfaced via /health so a misbuilt image is visible.
MODEL_LOADED = _loaded is not None
MODEL_VERSION = _loaded[1]["model_version"] if _loaded else heuristic.MODEL_VERSION


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + np.exp(-z))


def _model_predict(booster: xgb.Booster, meta: dict, f: BuildingFeatures) -> RiskPrediction:
    a, b = meta["platt_a"], meta["platt_b"]
    row = np.array([to_vector(f)], dtype=float)
    dm = xgb.DMatrix(row, feature_names=FEATURE_ORDER)

    margin = float(booster.predict(dm, output_margin=True)[0])
    proba = _sigmoid(a * margin + b)
    score = int(round(proba * 100))

    # TreeSHAP: last column is the bias term. Scale by the Platt slope to match
    # the calibrated margin, then map log-odds -> probability points via the
    # delta method (dp ≈ p(1-p)·d(log-odds)).
    contribs = booster.predict(dm, pred_contribs=True)[0]
    return RiskPrediction(
        score=max(0, min(100, score)),
        model_version=meta["model_version"],
        explanation=_contributions_to_rows(meta, float(proba), contribs),
    )


def _contributions_to_rows(meta: dict, proba: float, contribs) -> list[FeatureContribution]:
    a = meta["platt_a"]
    scale = a * proba * (1.0 - proba) * 100.0
    rows: list[FeatureContribution] = []
    for name, raw in zip(FEATURE_ORDER, contribs[:-1], strict=True):
        pp = round(float(raw) * scale, 1)
        if abs(pp) >= _MIN_CONTRIB_PP:
            rows.append(FeatureContribution(feature=FEATURE_LABELS.get(name, name), value=pp))
    rows.sort(key=lambda c: abs(c.value), reverse=True)
    return rows[:_MAX_FACTORS]


def score(f: BuildingFeatures) -> RiskPrediction:
    if _loaded is None:
        return heuristic.score(f)
    return _model_predict(_loaded[0], _loaded[1], f)


def score_batch(items: list[BuildingFeatures]) -> list[RiskPrediction]:
    """Score many buildings in TWO booster calls (margins + TreeSHAP) instead of
    2×N — the per-item loop dominated the daily 250k-building scoring job."""
    if not items:
        return []
    if _loaded is None:
        return [heuristic.score(f) for f in items]
    booster, meta = _loaded
    a, b = meta["platt_a"], meta["platt_b"]
    matrix = np.array([to_vector(f) for f in items], dtype=float)
    dm = xgb.DMatrix(matrix, feature_names=FEATURE_ORDER)

    margins = booster.predict(dm, output_margin=True)
    probas = _sigmoid(a * margins + b)
    contribs = booster.predict(dm, pred_contribs=True)  # (N, n_features+1)

    out: list[RiskPrediction] = []
    for proba, contrib in zip(probas, contribs, strict=True):
        score_i = max(0, min(100, int(round(float(proba) * 100))))
        out.append(
            RiskPrediction(
                score=score_i,
                model_version=meta["model_version"],
                explanation=_contributions_to_rows(meta, float(proba), contrib),
            )
        )
    return out


def metrics() -> dict | None:
    """Validation metrics for the served model (for /model endpoint & tender)."""
    if _loaded is None or not METRICS_PATH.exists():
        return None
    return json.loads(METRICS_PATH.read_text(encoding="utf-8"))
