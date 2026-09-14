"""Дорожная маршрутизация: время хода по улицам вместо прямой линии.

**Что этим чинится.** Зоны прибытия и «слепые зоны» до сих пор считались
геодезическим буфером вокруг части: круг радиусом 3,5 км ≈ десять минут хода.
Круг не знает ни реки Есиль, ни железной дороги, ни закрытых кварталов — он
рисует покрытие там, где машина физически не проедет, и всегда завышает его.
Для карты это неточность, для вывода «этот район прикрыт» — ошибка, которая
делается основанием решений о размещении частей.

**Почему адаптер, а не жёсткая зависимость.** Роутер — внешний сервис (OSRM
на графе OSM). Пока `FW_ROUTING_URL` пуст, всё работает как раньше: буфер и
честная пометка `approximate: true`. Так же устроена телематика — интеграция,
которой может не быть, не должна ронять модуль. Выдуманных изохрон здесь нет:
либо настоящая достижимость по дорогам, либо признание, что это оценка.

**Как считается изохрона.** OSRM не умеет изохроны нативно, зато умеет
матрицу времён (`/table`). Вокруг части раскладывается сетка точек, одним
запросом берутся времена хода до каждой, остаются уложившиеся в норматив —
их оболочка и есть зона. Это честнее любой аналитики по прямой: точка за
рекой не попадёт в зону, потому что до неё ехать через мост.

Сетка — компромисс: шаг 400 м даёт контур, различающий кварталы, и держит
матрицу в пределах пары тысяч точек на часть. Мельче — точнее и дороже
квадратично.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# Роутер локальный (соседний контейнер), но матрица на тысячу точек считается
# десятки миллисекунд, а не мгновение — таймаут с запасом. Ручки карты при
# отказе откатываются на буфер, а не отдают ошибку.
REQUEST_TIMEOUT_SEC = 20.0

# Потолок точек в одном запросе матрицы: у OSRM свой лимит (`--max-table-size`,
# по умолчанию 100 — мы поднимаем его в compose), и большой квадрат считается
# заметно дольше, чем полезен.
MAX_GRID_POINTS = 2500


@dataclass(frozen=True)
class Point:
    lng: float
    lat: float


def is_configured() -> bool:
    """Настроен ли роутер. Без него модуль работает на буфере, как раньше."""
    return bool(settings.routing_url.strip())


def _base_url() -> str:
    return settings.routing_url.strip().rstrip("/")


def health() -> dict:
    """Состояние интеграции — для экрана инфраструктуры и диагностики."""
    if not is_configured():
        return {"configured": False, "ok": False, "detail": "FW_ROUTING_URL не задан"}
    try:
        # Пробный маршрут из точки в неё же: дешёвый способ убедиться, что
        # граф загружен и сервис отвечает.
        r = httpx.get(
            f"{_base_url()}/route/v1/driving/71.43,51.13;71.44,51.14",
            params={"overview": "false"},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        ok = r.status_code == 200 and r.json().get("code") == "Ok"
        return {"configured": True, "ok": ok, "detail": None if ok else r.text[:200]}
    except Exception as err:  # noqa: BLE001 — диагностика не должна падать
        return {"configured": True, "ok": False, "detail": str(err)[:200]}


@dataclass
class RouteResult:
    distance_m: float
    duration_s: float
    """GeoJSON LineString — то, что рисуется на карте как путь следования."""
    geometry: dict | None


def route(origin: Point, dest: Point) -> RouteResult | None:
    """Маршрут по дорогам. None — роутер не настроен или не ответил."""
    if not is_configured():
        return None
    url = (
        f"{_base_url()}/route/v1/driving/"
        f"{origin.lng},{origin.lat};{dest.lng},{dest.lat}"
    )
    try:
        r = httpx.get(
            url,
            params={"overview": "full", "geometries": "geojson", "alternatives": "false"},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        first = data["routes"][0]
        return RouteResult(
            distance_m=float(first["distance"]),
            duration_s=float(first["duration"]),
            geometry=first.get("geometry"),
        )
    except Exception as err:  # noqa: BLE001
        log.warning("routing: маршрут не построен: %s", err)
        return None


def _grid(center: Point, radius_m: float, step_m: float) -> list[Point]:
    """Квадратная сетка точек вокруг центра, в пределах радиуса.

    Радиус берётся с запасом от прямолинейной оценки: по дорогам всегда
    дальше, чем по прямой, но не в разы — заезжать за двойной радиус значит
    считать матрицу впустую.
    """
    # Метры → градусы: по широте константа, по долготе — с поправкой на широту.
    deg_lat = step_m / 111_320.0
    deg_lng = step_m / (111_320.0 * max(0.2, math.cos(math.radians(center.lat))))
    steps = int(radius_m / step_m)
    points: list[Point] = []
    for i in range(-steps, steps + 1):
        for j in range(-steps, steps + 1):
            # Круг, а не квадрат: углы квадрата всё равно отсекутся по времени,
            # а матрица от них дорожает.
            if i * i + j * j > steps * steps:
                continue
            points.append(Point(center.lng + j * deg_lng, center.lat + i * deg_lat))
    return points


def reachable_points(center: Point, seconds: float, radius_m: float) -> list[Point] | None:
    """Точки сетки, до которых от центра доезжают за `seconds`.

    Возвращает None, если роутер не настроен или не ответил, — вызывающий
    откатывается на прямолинейный буфер и помечает результат приблизительным.
    """
    if not is_configured():
        return None

    step = max(100, settings.routing_grid_step_m)
    grid = _grid(center, radius_m, step)
    if len(grid) > MAX_GRID_POINTS:
        # Разрежаем сетку, а не молча обрезаем список: обрезанная сетка дала бы
        # зону в форме сектора — правдоподобную и неверную.
        factor = math.ceil(math.sqrt(len(grid) / MAX_GRID_POINTS))
        grid = grid[::factor]

    coords = ";".join(f"{p.lng},{p.lat}" for p in [center, *grid])
    try:
        r = httpx.get(
            f"{_base_url()}/table/v1/driving/{coords}",
            params={"sources": "0", "annotations": "duration"},
            timeout=REQUEST_TIMEOUT_SEC,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok":
            log.warning("routing: матрица не построена: %s", data.get("code"))
            return None
        durations = data["durations"][0][1:]  # первый столбец — сам центр
    except Exception as err:  # noqa: BLE001
        log.warning("routing: матрица недоступна: %s", err)
        return None

    factor = max(0.1, settings.routing_time_factor)
    out: list[Point] = []
    for point, duration in zip(grid, durations):
        # null — точку не удалось привязать к дороге (посреди степи, в озере):
        # это не «недостижимо за время», это «дороги там нет».
        # Множитель — поправка на дорожную обстановку: OSRM считает по
        # свободному потоку, а караул едет в трафике (см. config).
        if duration is not None and duration * factor <= seconds:
            out.append(point)
    return out


def calibration(samples: list[tuple[Point, Point, float]]) -> dict:
    """Сравнить фактические времена прибытия с расчётными.

    `samples` — тройки (часть, точка выезда, фактические секунды хода). Для
    каждой считается маршрут по дорогам, и берётся отношение факта к расчёту.
    Медиана этих отношений и есть честный множитель `FW_ROUTING_TIME_FACTOR`:
    он получен из того, как ездит именно этот гарнизон в этом городе, а не из
    общих соображений.

    Система его не применяет сама. Коэффициент, меняющий картину покрытия
    города, — это решение, которое принимает человек, глядя на выборку: по
    трём выездам такое не калибруют.
    """
    ratios: list[float] = []
    outliers = 0
    for origin, dest, actual_sec in samples:
        r = route(origin, dest)
        if r is None or r.duration_s <= 0 or actual_sec <= 0:
            continue
        ratio = actual_sec / r.duration_s
        # Отношение вне этого коридора — не дорожная обстановка, а испорченная
        # отметка: прибытие, проставленное задним числом при разборе, или
        # выезд не с той части. Медиану такие не сдвинут, но крайние значения
        # в отчёте выглядели бы как разброс дорожных условий, а это не он.
        if not (0.2 <= ratio <= 10.0):
            outliers += 1
            continue
        ratios.append(ratio)
    used = len(ratios)
    if not ratios:
        return {
            "samples": 0,
            "suggested_factor": None,
            "median_ratio": None,
            "outliers": outliers,
        }
    ratios.sort()
    mid = len(ratios) // 2
    median = ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2
    return {
        "samples": used,
        "median_ratio": round(median, 2),
        "suggested_factor": round(median, 2),
        "min_ratio": round(ratios[0], 2),
        "max_ratio": round(ratios[-1], 2),
        "outliers": outliers,
        "current_factor": settings.routing_time_factor,
    }
