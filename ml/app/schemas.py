from pydantic import BaseModel, Field


class BuildingFeatures(BaseModel):
    """Subset of the 30+ features used by the risk model.

    Phase 0 ships a transparent heuristic; the real XGBoost model consumes the
    full feature set (weather, holidays, density, incident history, ...).
    """

    # Safety-relevant fields default to the CONSERVATIVE (risk-raising) value, not
    # the benign one: missing data must never silently lower a building's risk.
    # `has_fire_alarm` defaults False (assume no АПС/АУПТ until confirmed present).
    age_years: int = Field(0, ge=0)
    floors: int = Field(1, ge=1)
    wooden_floors: bool = False
    has_fire_alarm: bool = False  # unknown → assume АПС/АУПТ absent (conservative)
    incidents_300m_3y: int = Field(0, ge=0)
    block_density: float = Field(0.5, ge=0, le=1)
    winter_season: bool = False
    nearest_hydrant_m: int = Field(100, ge=0)
    capital_repair_recent: bool = False

    # ДЧС domain features (functional fire-hazard class).
    mass_occupancy: bool = False        # >50 people (Ф2/Ф3 — ТЦ, зрелищные)
    vulnerable_occupancy: bool = False  # дети/маломобильные/стационар (Ф1.1, Ф4.1)
    hazard_category: int = Field(0, ge=0, le=5)  # производство: 0=нет, Д=1…А=5
    has_gas: bool = False               # газоснабжение / газовое оборудование


class FeatureContribution(BaseModel):
    feature: str
    value: float  # SHAP-style signed contribution (+ raises risk, - lowers)


class RiskPrediction(BaseModel):
    score: int = Field(..., ge=0, le=100)
    model_version: str
    explanation: list[FeatureContribution]
