"""Train, calibrate, validate and persist the FireWatch fire-risk model.

Run:  python -m train.train            (also runs at Docker build time)

Pipeline:
  dataset -> stratified train/calib/test split
          -> XGBoost gradient-boosted trees (binary:logistic)
          -> Platt scaling on the calibration split (probability calibration)
          -> evaluation on the untouched test split (ROC-AUC, PR-AUC, Brier,
             lift@N, reliability curve)
          -> QUALITY GATE: exit non-zero if ROC-AUC < MIN_ROC_AUC, so a bad
             model fails the build/CI instead of silently shipping
          -> artifacts: model.json (native booster), meta.json, metrics.json,
             MODEL_CARD.md

Artifacts are baked into the ML image; serving never trains.
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

from app.features import (
    ARTIFACTS_DIR,
    FEATURE_LABELS,
    FEATURE_ORDER,
    META_PATH,
    METRICS_PATH,
    MODEL_PATH,
)
from train.dataset import SEED, synthetic
from train.metrics import evaluate

MODEL_VERSION = "xgboost-1.0"
MIN_ROC_AUC = 0.78  # build-breaking floor; the synthetic ground truth gives ~0.86

XGB_PARAMS = {
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "max_depth": 4,
    "eta": 0.05,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "min_child_weight": 5,
    "lambda": 1.0,
    "seed": SEED,
    "nthread": 1,  # single-threaded → bit-for-bit reproducible build artifacts
}
NUM_ROUNDS = 350


def _dmatrix(X, y=None) -> xgb.DMatrix:
    return xgb.DMatrix(np.asarray(X, dtype=float), label=y, feature_names=FEATURE_ORDER)


def main() -> None:
    source = os.getenv("FW_TRAIN_SOURCE", "synthetic")
    print(f"[train] source={source} seed={SEED}")
    if source != "synthetic":
        raise SystemExit(f"source '{source}' not available yet — see train/dataset.py")

    X, y = synthetic()

    X_tmp, X_test, y_tmp, y_test = train_test_split(
        X, y, test_size=0.15, random_state=SEED, stratify=y
    )
    X_tr, X_cal, y_tr, y_cal = train_test_split(
        X_tmp, y_tmp, test_size=0.1765, random_state=SEED, stratify=y_tmp
    )  # -> ~70/15/15 overall
    print(f"[train] sizes train={len(X_tr)} calib={len(X_cal)} test={len(X_test)} "
          f"base_rate={y.mean():.3f}")

    booster = xgb.train(
        XGB_PARAMS,
        _dmatrix(X_tr, y_tr),
        num_boost_round=NUM_ROUNDS,
        evals=[(_dmatrix(X_cal, y_cal), "calib")],
        early_stopping_rounds=30,
        verbose_eval=False,
    )

    # Platt scaling: fit a 1-D logistic on calibration-split margins.
    margin_cal = booster.predict(_dmatrix(X_cal), output_margin=True)
    platt = LogisticRegression(C=1e6, solver="lbfgs")
    platt.fit(margin_cal.reshape(-1, 1), y_cal)
    platt_a = float(platt.coef_[0][0])
    platt_b = float(platt.intercept_[0])

    def calibrated(X) -> np.ndarray:
        m = booster.predict(_dmatrix(X), output_margin=True)
        return 1.0 / (1.0 + np.exp(-(platt_a * m + platt_b)))

    proba_raw_test = booster.predict(_dmatrix(X_test))
    proba_cal_test = calibrated(X_test)
    metrics = evaluate(np.asarray(y_test), proba_raw_test, proba_cal_test)

    importance = booster.get_score(importance_type="gain")
    metrics["feature_importance_gain"] = {
        FEATURE_LABELS.get(k, k): round(v, 2)
        for k, v in sorted(importance.items(), key=lambda kv: -kv[1])
    }

    print(f"[train] ROC-AUC={metrics['roc_auc']} PR-AUC={metrics['pr_auc']} "
          f"Brier(cal)={metrics['brier_calibrated']} "
          f"lift@10%={metrics['lift'][1]['lift']}")

    if metrics["roc_auc"] < MIN_ROC_AUC:
        sys.exit(
            f"[train] QUALITY GATE FAILED: ROC-AUC {metrics['roc_auc']} "
            f"< {MIN_ROC_AUC} — refusing to ship this model"
        )

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(MODEL_PATH))
    META_PATH.write_text(
        json.dumps(
            {
                "model_version": MODEL_VERSION,
                "source": source,
                "seed": SEED,
                "feature_order": FEATURE_ORDER,
                "platt_a": platt_a,
                "platt_b": platt_b,
                "base_rate": metrics["base_rate"],
                "best_iteration": int(getattr(booster, "best_iteration", NUM_ROUNDS)),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    METRICS_PATH.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    _write_model_card(metrics)
    print(f"[train] saved -> {ARTIFACTS_DIR}")


def _write_model_card(metrics: dict) -> None:
    lift = {l["fraction"]: l for l in metrics["lift"]}
    lines = [
        "# FireWatch — Карточка модели (Model Card)",
        "",
        f"**Версия:** `{MODEL_VERSION}` · **Алгоритм:** XGBoost (binary:logistic) "
        "+ Platt-калибровка · **Объяснимость:** TreeSHAP",
        "",
        "## Назначение",
        "Оценка вероятности пожара по зданию (0–100) для приоритизации надзорных "
        "проверок ДЧС РК. Не заменяет инспектора — ранжирует объекты по риску.",
        "",
        "## Данные обучения",
        f"Источник: `{metrics.get('source', 'synthetic')}`. Текущая сборка обучена на "
        "синтетическом наборе с фиксированным seed (плейсхолдер до передачи "
        "исторических данных ДЧС). Контракт признаков и пайплайн идентичны для "
        "реальных данных — см. `train/dataset.py::from_incidents`.",
        "",
        "## Метрики на отложенной выборке (test)",
        f"- **ROC-AUC:** {metrics['roc_auc']}",
        f"- **PR-AUC:** {metrics['pr_auc']}",
        f"- **Brier (до/после калибровки):** {metrics['brier_raw']} → "
        f"{metrics['brier_calibrated']}",
        f"- **Базовая частота события:** {metrics['base_rate']}",
        f"- **Lift @10%:** {lift[0.10]['lift']}× (захват "
        f"{int(lift[0.10]['recall_captured'] * 100)}% пожаров в топ-10% риска)",
        f"- **Lift @20%:** {lift[0.20]['lift']}×",
        "",
        "## Гейт качества",
        f"Сборка падает, если ROC-AUC < {MIN_ROC_AUC}. Плохая модель не доедет до прод.",
        "",
        "## Ограничения",
        "- Синтетический ground truth ≠ реальная пожарная статистика; "
        "цифры подтверждают работоспособность пайплайна, не оперативную точность.",
        "- Перед боевым применением — переобучение на данных ДЧС и валидация "
        "на ретроспективе (out-of-time).",
    ]
    (ARTIFACTS_DIR / "MODEL_CARD.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
