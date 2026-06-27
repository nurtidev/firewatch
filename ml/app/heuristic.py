"""Transparent additive heuristic — fallback when no trained model is present.

Kept as a safety net so the service never hard-fails if artifacts are missing
(e.g. a dev checkout without a build step). Production serves the XGBoost model;
this only runs when ml/artifacts/model.json is absent.
"""

from app.schemas import BuildingFeatures, FeatureContribution, RiskPrediction

MODEL_VERSION = "heuristic-0.2"
BASE_SCORE = 20.0


def _contributions(f: BuildingFeatures) -> list[FeatureContribution]:
    items: list[tuple[str, float]] = [
        ("Возраст здания", min(f.age_years * 0.35, 25.0)),
        ("Деревянные перекрытия", 16.0 if f.wooden_floors else 0.0),
        ("Инциденты в радиусе 300м (3 г.)", min(f.incidents_300m_3y * 6.0, 18.0)),
        ("Плотность застройки квартала", f.block_density * 8.0),
        ("Сезон (зимний период)", 7.0 if f.winter_season else 0.0),
        ("Этажность", min(max(f.floors - 5, 0) * 1.2, 8.0)),
        (
            "АПС/АУПТ отсутствуют" if not f.has_fire_alarm else "АПС/АУПТ исправны",
            10.0 if not f.has_fire_alarm else -4.0,
        ),
        ("Капремонт (недавний)", -5.0 if f.capital_repair_recent else 0.0),
        (
            "Гидрант рядом",
            -4.0 if f.nearest_hydrant_m <= 50 else (3.0 if f.nearest_hydrant_m > 150 else 0.0),
        ),
    ]
    nonzero = [(name, round(val, 1)) for name, val in items if val != 0.0]
    nonzero.sort(key=lambda kv: abs(kv[1]), reverse=True)
    return [FeatureContribution(feature=n, value=v) for n, v in nonzero]


def score(f: BuildingFeatures) -> RiskPrediction:
    contribs = _contributions(f)
    raw = BASE_SCORE + sum(c.value for c in contribs)
    clamped = max(0, min(100, round(raw)))
    return RiskPrediction(score=clamped, model_version=MODEL_VERSION, explanation=contribs)
