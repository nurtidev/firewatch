from fastapi import FastAPI, HTTPException

from app.schemas import BuildingFeatures, RiskPrediction
from app.scorer import MODEL_VERSION, metrics, score

app = FastAPI(title="FireWatch ML", version="1.0.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ml", "model_version": MODEL_VERSION}


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
    """Score many buildings in one call (used by the risk-computation job)."""
    return [score(f) for f in items]
