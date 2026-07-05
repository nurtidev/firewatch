"""Module 07 · Расчёт сил и средств на тушение пожара.

Implements the standard ДЧС РК force-and-means methodology (as in the
"Есеп Евразия" plan): free-development time → fire/extinguishing area →
required water flow → number of barrels, trucks, personnel, squads, fire rank.
Reproduces the Евразия worked example.
"""

import math

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.routers.auth import require_roles

router = APIRouter(
    prefix="/forces",
    tags=["forces"],
    dependencies=[Depends(require_roles("supervisor", "admin"))],
)

# Object presets: Vл — линейная скорость распространения (м/мин), Jтр — требуемая
# интенсивность подачи воды (л/(с·м²)). `agent` — огнетушащее вещество, `note` —
# тактическая особенность. Разбито подробнее, чем «жилое/общественное/пром»: разные
# подклассы дают разные Vл/Jтр и тактику (находка: библиотека, больница и ГСМ-склад
# не должны считаться одинаково).
PRESETS = [
    {"key": "residential", "label": "Жилое / административное", "vl": 1.0, "jtr": 0.06, "agent": "вода", "note": ""},
    {"key": "public", "label": "Общественное (учреждение)", "vl": 1.0, "jtr": 0.10, "agent": "вода", "note": ""},
    {"key": "public_mass", "label": "Массовое пребывание (ТЦ, зрелищные)", "vl": 1.2, "jtr": 0.12, "agent": "вода", "note": "Приоритет — эвакуация людей"},
    {"key": "medical", "label": "Лечебное со стационаром (Ф1.1)", "vl": 0.8, "jtr": 0.10, "agent": "вода", "note": "Маломобильные — усиленное ГДЗС"},
    {"key": "education", "label": "Детское / учебное (Ф1.1, Ф4.1)", "vl": 1.0, "jtr": 0.10, "agent": "вода", "note": "Дети — приоритет эвакуации"},
    {"key": "industrial", "label": "Производственное (кат. В)", "vl": 1.5, "jtr": 0.20, "agent": "вода", "note": ""},
    {"key": "warehouse", "label": "Склад ТМЦ", "vl": 1.5, "jtr": 0.20, "agent": "вода", "note": "Высокая пожарная нагрузка"},
    {"key": "flammable", "label": "ГСМ / ЛВЖ (кат. А-Б)", "vl": 3.0, "jtr": 0.20, "agent": "пена", "note": "Вода неэффективна — пенная атака, угроза вскипания/выброса"},
    {"key": "cable", "label": "Электроустановки / кабельные", "vl": 1.1, "jtr": 0.20, "agent": "порошок/CO₂", "note": "Снять напряжение до подачи воды"},
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
    # Tactical conditions — drive ГДЗС, deployment time and head.
    floor: int = Field(1, ge=-3, le=50, description="Этаж пожара (отриц. = подвал)")
    smoke: bool = Field(False, description="Сильное задымление / работа в НДС")
    # Logistics
    supply_per_truck: float = Field(40.0, gt=0, description="Подача воды одной АЦ, л/с")
    calc_time_min: int = Field(10, ge=1, le=360, description="Расчётное время тушения, мин")
    water_source_lps: float | None = Field(
        None, ge=0, description="Доступная подача водоисточника/гидрантов, л/с"
    )
    def_intensity_ratio: float = Field(
        0.25, gt=0, le=1, description="Доля интенсивности на защиту (зависит от конструкций)"
    )


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

    warnings: list[str] = []

    # 1) Время свободного развития пожара (до подачи первых средств)
    t_travel = 60 * req.distance_km / req.travel_speed_kmh
    # Боевое развёртывание: прокладка рукавов + подъём на этаж пожара (подвал —
    # спуск + работа в НДС), что заметно увеличивает время на высоте/в подземье.
    climb_levels = abs(req.floor) - 1 if req.floor != 0 else 0
    t_deploy = 0.035 * req.hose_lay_m + max(0, climb_levels) * 1.0
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

    # 4) Требуемый расход воды (тушение + защита). Доля защиты зависит от
    # конструкций/угрозы вертикального распространения — параметр, а не жёсткая ¼.
    q_req_ext = s_ext * req.jtr
    q_req_def = s_ext * (req.jtr * req.def_intensity_ratio)
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

    # 8) Звенья ГДЗС — не фикс. 3 чел., а по обстановке. Высота (≥4 эт.), подвал и
    # задымление требуют дополнительных звеньев и ОБЯЗАТЕЛЬНОГО резервного звена;
    # пост безопасности — на каждое работающее звено.
    hard_conditions = req.smoke or req.floor >= 4 or req.floor < 0
    working_links = 1 + (1 if req.smoke else 0) + (1 if (req.floor >= 4 or req.floor < 0) else 0)
    reserve_links = 1 if hard_conditions else 0
    gdzs_links = working_links + reserve_links
    gdzs_people = gdzs_links * 3
    safety_post = working_links  # постовой на каждое работающее звено
    if hard_conditions:
        warnings.append(
            f"Сложные условия (этаж {req.floor}"
            f"{', задымление' if req.smoke else ''}) — "
            f"{working_links} звена ГДЗС + резерв, пост безопасности на каждое звено"
        )

    # 9) Личный состав
    people_parts = {
        "ствольщики (тушение, ×3)": n_ext * 3,
        "ствольщики (защита, ×2)": n_def * 2,
        "водители АЦ": n_trucks,
        "звенья ГДЗС (×3)": gdzs_people,
        "пост безопасности": safety_post,
        "связной": 1,
        "работа с водоисточником": 1,
    }
    n_people = sum(people_parts.values())

    # 10) Отделения и ранг пожара. Отделение на основном АЦ — 5 чел. (нач. караула/
    # командир + водитель + ствольщики); деление на 4 занижало число отделений и ранг.
    n_squads = math.ceil(n_people / 5)
    rank = _rank(n_squads)

    # 11) Вода: расход × расчётное время + нормативный 3-кратный запас (на полное
    # тушение, дотушивание и перекачку/подвоз). Проверка достаточности водоисточника.
    water_calc = round(q_act * req.calc_time_min * 60)
    water_supply_required = round(water_calc * 3)
    source_ok = None
    if req.water_source_lps is not None:
        source_ok = req.water_source_lps >= q_act
        if not source_ok:
            warnings.append(
                f"Водоисточник даёт {round(req.water_source_lps, 1)} л/с < требуемых "
                f"{round(q_act, 1)} л/с — организовать подвоз/перекачку воды"
            )

    # 12) Напор: подача на верхние этажи требует повышенного давления/перекачки.
    if req.floor >= 8:
        warnings.append(
            f"Этаж {req.floor}: подача воды на высоту — повышенный напор, "
            "при необходимости перекачка через АЦ (в две ступени)"
        )

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
            "gdzs_links": gdzs_links,
            "squads": n_squads,
            "rank": rank,
            "water_liters_calc": water_calc,
            "water_liters_required": water_supply_required,
            "water_source_ok": source_ok,
            # back-compat alias (расчётное время по умолчанию 10 мин)
            "water_liters_10min": water_calc,
            "warnings": warnings,
        },
    }
