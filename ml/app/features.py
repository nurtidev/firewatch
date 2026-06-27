"""Canonical feature contract shared by training and serving.

The ORDER of FEATURE_ORDER is the column order the XGBoost model is trained on
and MUST stay stable — the served booster indexes features positionally. Add new
features only at the end and retrain.
"""

from pathlib import Path

from app.schemas import BuildingFeatures

# Artifacts produced by `python -m train.train` and baked into the image at
# build time (see ml/Dockerfile). parents[1] == the ml/ root both locally
# (ml/app/features.py -> ml/) and in the container (/app/app -> /app).
ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "model.json"
META_PATH = ARTIFACTS_DIR / "meta.json"
METRICS_PATH = ARTIFACTS_DIR / "metrics.json"

# Positional feature order. Booleans are encoded as 0/1.
FEATURE_ORDER: list[str] = [
    "age_years",
    "floors",
    "wooden_floors",
    "has_fire_alarm",
    "incidents_300m_3y",
    "block_density",
    "winter_season",
    "nearest_hydrant_m",
    "capital_repair_recent",
]

# Human-readable Russian labels for SHAP explanation rows shown in the UI.
FEATURE_LABELS: dict[str, str] = {
    "age_years": "Возраст здания",
    "floors": "Этажность",
    "wooden_floors": "Деревянные перекрытия",
    "has_fire_alarm": "АПС/АУПТ",
    "incidents_300m_3y": "Инциденты в радиусе 300 м (3 г.)",
    "block_density": "Плотность застройки квартала",
    "winter_season": "Зимний период",
    "nearest_hydrant_m": "Расстояние до гидранта",
    "capital_repair_recent": "Капитальный ремонт (недавний)",
}


def to_vector(f: BuildingFeatures) -> list[float]:
    """BuildingFeatures -> ordered numeric vector matching FEATURE_ORDER."""
    raw = {
        "age_years": float(f.age_years),
        "floors": float(f.floors),
        "wooden_floors": 1.0 if f.wooden_floors else 0.0,
        "has_fire_alarm": 1.0 if f.has_fire_alarm else 0.0,
        "incidents_300m_3y": float(f.incidents_300m_3y),
        "block_density": float(f.block_density),
        "winter_season": 1.0 if f.winter_season else 0.0,
        "nearest_hydrant_m": float(f.nearest_hydrant_m),
        "capital_repair_recent": 1.0 if f.capital_repair_recent else 0.0,
    }
    return [raw[name] for name in FEATURE_ORDER]
