"""Module 07 · Расчёт сил и средств на тушение пожара.

Implements the standard ДЧС РК force-and-means methodology (as in the
"Есеп Евразия" plan): free-development time → fire/extinguishing area →
required water flow → number of barrels, trucks, personnel, squads, fire rank.
Reproduces the Евразия worked example.
"""

import math

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.routers.auth import current_user

router = APIRouter(
    prefix="/forces",
    tags=["forces"],
    dependencies=[Depends(current_user)],
)

# Object presets: Vл — линейная скорость распространения (м/мин), Jтр — требуемая
# интенсивность подачи воды (л/(с·м²)).
PRESETS = [
    {"key": "residential", "label": "Жилое / административное", "vl": 1.0, "jtr": 0.06},
    {"key": "public", "label": "Общественное (с массовым пребыванием)", "vl": 1.0, "jtr": 0.10},
    {"key": "industrial", "label": "Производственное / склад", "vl": 1.5, "jtr": 0.20},
]

# Ствол: расход (л/с)
BARRELS = [
    {"key": "rs50", "label": "РС-50 («Б»)", "q": 3.7},
    {"key": "rs70", "label": "РС-70 («А»)", "q": 7.4},
    {"key": "lafet", "label": "Лафетный", "q": 20.0},
]
BARREL_Q = {b["key"]: b["q"] for b in BARRELS}


class ForcesRequest(BaseModel):
    # Fire development
    vl: float = Field(1.0, gt=0, description="Линейная скорость, м/мин")
    jtr: float = Field(0.10, gt=0, description="Требуемая интенсивность, л/(с·м²)")
    form: str = Field("rectangular", description="rectangular | circular")
    directions: int = Field(2, ge=1, le=4, description="Число направлений (n)")
    width_m: float = Field(5.0, gt=0, description="Ширина участка a, м")
    depth_m: float = Field(5.0, gt=0, description="Глубина тушения h, м (ручные — 5)")
    barrel: str = Field("rs50", description="Тип ствола")
    # Time components (мин), see Т1св
    detection_min: float = Field(3.0, ge=0)
    report_min: float = Field(1.0, ge=0)
    info_min: float = Field(0.5, ge=0)
    gather_min: float = Field(1.0, ge=0)
    distance_km: float = Field(1.0, ge=0)
    travel_speed_kmh: float = Field(40.0, gt=0)
    hose_lay_m: float = Field(100.0, ge=0, description="Длина рукавной линии, м")
    # Logistics
    supply_per_truck: float = Field(40.0, gt=0, description="Подача воды одной АЦ, л/с")


def _rank(squads: int) -> str:
    if squads <= 2:
        return "№1"
    if squads <= 4:
        return "№2"
    if squads <= 6:
        return "№3"
    return "№4"


@router.get("/presets")
def presets() -> dict:
    return {"objects": PRESETS, "barrels": BARRELS}


@router.post("/calc")
def calc(req: ForcesRequest) -> dict:
    q_barrel = BARREL_Q.get(req.barrel, 3.7)

    # 1) Время свободного развития пожара (до подачи первых средств)
    t_travel = 60 * req.distance_km / req.travel_speed_kmh
    t_deploy = 0.035 * req.hose_lay_m  # Тр.с.с — боевое развёртывание
    t_free = (
        req.detection_min
        + req.report_min
        + req.info_min
        + req.gather_min
        + t_travel
        + t_deploy
    )

    # 2) Путь, пройденный огнём (для первых 10 мин скорость вдвое меньше)
    if t_free > 10:
        radius = 0.5 * req.vl * 10 + req.vl * (t_free - 10)
    else:
        radius = 0.5 * req.vl * t_free

    # 3) Площадь пожара и площадь тушения
    if req.form == "circular":
        s_fire = math.pi * radius**2
        inner = max(radius - req.depth_m, 0)
        s_ext = math.pi * (radius**2 - inner**2)
    else:  # rectangular
        s_fire = req.directions * req.width_m * radius
        s_ext = (
            req.directions * req.width_m * req.depth_m
            if radius > req.depth_m
            else s_fire
        )

    # 4) Требуемый расход воды (тушение + защита, защита ≈ ¼ интенсивности)
    q_req_ext = s_ext * req.jtr
    q_req_def = s_ext * (req.jtr / 4)
    q_req = q_req_ext + q_req_def

    # 5) Число стволов
    n_ext = math.ceil(q_req_ext / q_barrel)
    n_def = max(1, math.ceil(q_req_def / q_barrel))

    # 6) Фактический расход
    q_act_ext = n_ext * q_barrel
    q_act_def = n_def * q_barrel
    q_act = q_act_ext + q_act_def

    # 7) Число пожарных машин (АЦ)
    n_trucks = math.ceil(q_act / req.supply_per_truck)

    # 8) Личный состав
    people_parts = {
        "ствольщики (тушение, ×3)": n_ext * 3,
        "ствольщики (защита, ×2)": n_def * 2,
        "водители АЦ": n_trucks,
        "звено ГДЗС / разведка": 3,
        "пост безопасности": 2,
        "связной": 1,
        "работа с водоисточником": 1,
    }
    n_people = sum(people_parts.values())

    # 9) Отделения и ранг пожара
    n_squads = math.ceil(n_people / 4)
    rank = _rank(n_squads)

    # 10) Объём воды на расчётное время тушения (10 мин)
    water_liters = round(q_act * 10 * 60)

    r2 = lambda x: round(x, 2)  # noqa: E731
    return {
        "time": {
            "t_travel": r2(t_travel),
            "t_deploy": r2(t_deploy),
            "t_free": r2(t_free),
        },
        "fire": {
            "radius_m": r2(radius),
            "s_fire_m2": r2(s_fire),
            "s_ext_m2": r2(s_ext),
        },
        "flow": {
            "q_req_ext": r2(q_req_ext),
            "q_req_def": r2(q_req_def),
            "q_req": r2(q_req),
            "q_act_ext": r2(q_act_ext),
            "q_act_def": r2(q_act_def),
            "q_act": r2(q_act),
        },
        "result": {
            "barrels_ext": n_ext,
            "barrels_def": n_def,
            "trucks": n_trucks,
            "personnel": n_people,
            "personnel_breakdown": people_parts,
            "squads": n_squads,
            "rank": rank,
            "water_liters_10min": water_liters,
        },
    }
