from fastapi import FastAPI

from app.schemas import BuildingFeatures, RiskPrediction
from app.scorer import MODEL_VERSION, score

app = FastAPI(title="FireWatch ML", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ml", "model_version": MODEL_VERSION}


@app.post("/predict", response_model=RiskPrediction)
def predict(features: BuildingFeatures) -> RiskPrediction:
    """Risk score 0-100 with SHAP-style per-feature explanation."""
    return score(features)


@app.post("/predict/batch", response_model=list[RiskPrediction])
def predict_batch(items: list[BuildingFeatures]) -> list[RiskPrediction]:
    """Score many buildings in one call (used by the risk-computation job)."""
    return [score(f) for f in items]
