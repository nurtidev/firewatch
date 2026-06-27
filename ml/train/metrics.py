"""Evaluation metrics for the risk model — the numbers a tender will ask for."""

from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
)


def lift_at(y_true: np.ndarray, proba: np.ndarray, frac: float) -> dict:
    """Lift among the top `frac` highest-risk objects.

    lift = (positive rate in the top-k) / (base positive rate). A lift of 3.0 at
    10% means: inspecting the model's top-10% riskiest buildings finds 3× more
    fires than inspecting at random — the core operational value proposition.
    """
    n = len(y_true)
    k = max(1, int(round(n * frac)))
    order = np.argsort(-proba)
    top = order[:k]
    base_rate = float(y_true.mean()) or 1e-9
    top_rate = float(y_true[top].mean())
    captured = float(y_true[top].sum() / max(y_true.sum(), 1))  # recall in top-k
    return {
        "fraction": frac,
        "k": k,
        "precision": round(top_rate, 4),
        "lift": round(top_rate / base_rate, 3),
        "recall_captured": round(captured, 4),
    }


def calibration_bins(y_true: np.ndarray, proba: np.ndarray, n_bins: int = 10) -> list[dict]:
    """Reliability curve: predicted vs observed frequency per probability bin."""
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(proba, edges[1:-1]), 0, n_bins - 1)
    out = []
    for b in range(n_bins):
        mask = idx == b
        count = int(mask.sum())
        if count == 0:
            continue
        out.append(
            {
                "bin": f"{edges[b]:.1f}–{edges[b + 1]:.1f}",
                "count": count,
                "mean_predicted": round(float(proba[mask].mean()), 4),
                "observed_frequency": round(float(y_true[mask].mean()), 4),
            }
        )
    return out


def evaluate(y_true: np.ndarray, proba_raw: np.ndarray, proba_cal: np.ndarray) -> dict:
    """Full metric bundle on a held-out test set."""
    return {
        "n": int(len(y_true)),
        "base_rate": round(float(y_true.mean()), 4),
        "roc_auc": round(float(roc_auc_score(y_true, proba_cal)), 4),
        "pr_auc": round(float(average_precision_score(y_true, proba_cal)), 4),
        "brier_raw": round(float(brier_score_loss(y_true, proba_raw)), 4),
        "brier_calibrated": round(float(brier_score_loss(y_true, proba_cal)), 4),
        "lift": [lift_at(y_true, proba_cal, f) for f in (0.05, 0.10, 0.20)],
        "calibration": calibration_bins(y_true, proba_cal),
    }
