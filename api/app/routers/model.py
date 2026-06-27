"""Module 08 · Model card — proxies the ML service validation metrics.

The web app talks only to the API, so this forwards the ML `/model` endpoint
(version + held-out ROC-AUC / PR-AUC / Brier / lift / calibration) to the UI.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.routers.auth import current_user

router = APIRouter(prefix="/model", tags=["model"], dependencies=[Depends(current_user)])


@router.get("")
def model_card() -> dict:
    try:
        with httpx.Client(base_url=settings.ml_url, timeout=10) as client:
            resp = client.get("/model")
    except httpx.HTTPError as err:
        raise HTTPException(503, "ML-сервис недоступен") from err
    if resp.status_code == 404:
        raise HTTPException(404, "Модель не обучена в текущей сборке")
    if resp.status_code != 200:
        raise HTTPException(502, "Не удалось получить метрики модели")
    return resp.json()
