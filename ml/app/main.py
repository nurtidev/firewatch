import os

from fastapi import FastAPI, HTTPException, Response

from app.schemas import BuildingFeatures, RiskPrediction
from app.scorer import MODEL_LOADED, MODEL_VERSION, metrics, score, score_batch

app = FastAPI(title="FireWatch ML", version="1.0.0")

_PROD = os.getenv("FW_ENV", "").strip().lower() in {"production", "prod"}


@app.get("/health")
def health(response: Response) -> dict:
    """Liveness + whether the trained model is actually loaded.

    In production a missing model means a broken build (artifacts are baked in at
    build time), so we return 503 to fail the Railway healthcheck loudly instead
    of silently serving the heuristic. In dev we stay 200 but report degraded.
    """
    if not MODEL_LOADED and _PROD:
        response.status_code = 503
    return {
        "status": "ok" if MODEL_LOADED else "degraded",
        "service": "ml",
        "model_version": MODEL_VERSION,
        "model_loaded": MODEL_LOADED,
    }


@app.get("/model")
def model() -> dict:
    """Served model card: version + held-out validation metrics (for the tender)."""
    m = metrics()
    if m is None:
        raise HTTPException(404, "Метрики недоступны (модель не обучена в этой сборке)")
    return {"model_version": MODEL_VERSION, "metrics": m}


@app.post("/predict", response_model=RiskPrediction)
def predict(features: BuildingFeatures) -> RiskPrediction:
    """Risk score 0-100 with SHAP-style per-feature explanation."""
    return score(features)


@app.post("/predict/batch", response_model=list[RiskPrediction])
def predict_batch(items: list[BuildingFeatures]) -> list[RiskPrediction]:
    """Score many buildings in one call (used by the risk-computation job).

    Vectorized: two booster calls for the whole batch, not 2×N."""
    return score_batch(items)
