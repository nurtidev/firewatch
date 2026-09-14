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
import time
from dataclasses import dataclass

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# Роутер локальный (соседний контейнер), но матрица на тысячу точек считается
# десятки миллисекунд, а не мгновение — таймаут с запасом. Ручки карты при
# отказе откатываются на буфер, а не отдают ошибку.
REQUEST_TIMEOUT_SEC = 20.0

# Потолок точек в одном запросе матрицы: у OSRM свой лимит (`--max-table-size`,
# по умолчанию 100 — мы поднимаем его в compose до 4000, см. docker-compose.yml),
# и большой квадрат считается заметно дольше, чем полезен.
MAX_GRID_POINTS = 2500

# Калибровка перебирает до 200 выездов последовательно, по одному /route на
# каждый. При зависшем OSRM и REQUEST_TIMEOUT_SEC=20 это до ~66 минут синхронно
# в HTTP-обработчике — недопустимо для ручной GET-ручки. Общий бюджет времени:
# по истечении калибровка останавливается и отдаёт то, что успела посчитать,
# с explicit-флагом `truncated`, а не молча зависает или падает по таймауту
# gateway.
CALIBRATION_DEADLINE_SEC = 60.0


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
        if not ok:
            log.warning("routing: health-check не прошёл: HTTP %s %s", r.status_code, r.text[:200])
        return {"configured": True, "ok": ok, "detail": None if ok else r.text[:200]}
    except Exception as err:  # noqa: BLE001 — диагностика не должна падать
        log.warning("routing: health-check не прошёл: %s", err)
        return {"configured": True, "ok": False, "detail": str(err)[:200]}


@dataclass
class RouteResult:
    distance_m: float
    duration_s: float
    """GeoJSON LineString — то, что рисуется на карте как путь следования."""
    geometry: dict | None


def route(
    origin: Point, dest: Point, timeout: float = REQUEST_TIMEOUT_SEC
) -> RouteResult | None:
    """Маршрут по дорогам. None — роутер не настроен или не ответил.

    `timeout` по умолчанию REQUEST_TIMEOUT_SEC; `calibration` передаёт остаток
    своего общего бюджета, чтобы один зависший запрос не съел времени сверх
    выделенного (см. CALIBRATION_DEADLINE_SEC).
    """
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
            timeout=timeout,
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


def reachable_points(
    center: Point, seconds: float, radius_m: float
) -> tuple[list[Point], float] | None:
    """Точки сетки, до которых от центра доезжают за `seconds`.

    Возвращает `(точки, эффективный_шаг_м)`. Эффективный шаг может быть
    крупнее настроенного `FW_ROUTING_GRID_STEP_M`: при прореживании (см.
    выше) сетка пересчитывается с большим шагом, и вызывающий обязан рисовать
    круги вокруг точек радиусом, связанным именно с ЭТИМ шагом — иначе на
    прореженной сетке круги меньше расстояния между соседними точками, и в
    зоне остаются дыры 50–90 м (см. rebuild_coverage).

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
        #
        # Сетка двумерная: точек в ней ~ (radius/step)², то есть квадратично от
        # шага. `grid[::factor]` берёт каждую factor-ю точку ПЛОСКОГО списка —
        # это линейное прореживание, а нужно квадратичное. При мелком шаге
        # (< ~170 м на радиусе 3.5 км×1.5) исходная сетка в разы больше
        # MAX_GRID_POINTS, factor линейно её не догоняет, и итоговый запрос
        # всё ещё превышает лимит OSRM, который мы задаём в compose (4000; сам
        # OSRM по умолчанию ограничивается 100, см. MAX_GRID_POINTS выше).
        # Пересчитываем сетку с шагом, увеличенным в factor раз по каждой оси
        # — площадь ячейки растёт как factor², итоговое число точек уже
        # укладывается в лимит.
        factor = math.ceil(math.sqrt(len(grid) / MAX_GRID_POINTS))
        step = step * factor
        grid = _grid(center, radius_m, step)

    # Полная точность float (до ~17 значащих цифр) на координатах раздувает GET
    # URL матрицы (до ~18 КБ на MAX_GRID_POINTS точек) без пользы: OSRM всё
    # равно привязывает точку к ближайшему узлу графа. 6 знаков после запятой
    # — это ~11 см, с большим запасом точнее шага сетки.
    coords = ";".join(f"{p.lng:.6f},{p.lat:.6f}" for p in [center, *grid])
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
    return out, step


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
    attempted = 0
    truncated = False
    deadline = time.monotonic() + CALIBRATION_DEADLINE_SEC
    for origin, dest, actual_sec in samples:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            # Завис или тормозит OSRM — не ждём оставшиеся выезды по 20 с
            # каждый, отдаём то, что успели посчитать, и честно помечаем это.
            truncated = True
            break
        attempted += 1
        # Таймаут ЭТОГО запроса — не полные REQUEST_TIMEOUT_SEC, а то, что
        # реально осталось от общего бюджета: иначе один зависший запрос под
        # конец бюджета всё равно способен растянуть ручку на лишние секунды
        # сверх CALIBRATION_DEADLINE_SEC.
        r = route(origin, dest, timeout=min(REQUEST_TIMEOUT_SEC, remaining))
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
            "attempted": attempted,
            "suggested_factor": None,
            "median_ratio": None,
            "outliers": outliers,
            "truncated": truncated,
        }
    ratios.sort()
    mid = len(ratios) // 2
    median = ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2
    return {
        "samples": used,
        "attempted": attempted,
        "median_ratio": round(median, 2),
        "suggested_factor": round(median, 2),
        "min_ratio": round(ratios[0], 2),
        "max_ratio": round(ratios[-1], 2),
        "outliers": outliers,
        "truncated": truncated,
        "current_factor": settings.routing_time_factor,
    }
