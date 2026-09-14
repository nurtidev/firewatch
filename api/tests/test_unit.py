"""Pure-function unit tests (no database required)."""

import pytest

from fastapi import HTTPException

from app.access import enforce_building_scope, has_full_access
from app.auth import create_token, decode_token, hash_password, verify_password
from app.chat import ChatError, validate_sql
from app.routers.forces import ForcesRequest, calc
from app.routers.routes import (
    VisitRequest,
    Violation,
    get_visit_photo,
    record_visit,
)

# --- chat: read-only SQL guard ------------------------------------------------


def test_validate_sql_adds_limit():
    assert validate_sql("SELECT 1").lower().endswith("limit 50")


def test_validate_sql_allows_select_and_with():
    assert validate_sql("select * from buildings limit 5")
    assert validate_sql("WITH t AS (SELECT 1) SELECT * FROM t LIMIT 5")


@pytest.mark.parametrize(
    "bad",
    [
        "DROP TABLE buildings",
        "SELECT 1; DROP TABLE buildings",
        "UPDATE users SET role='admin'",
        "DELETE FROM users",
        "SELECT * FROM users -- comment",
        "INSERT INTO users VALUES (1)",
    ],
)
def test_validate_sql_blocks_mutations_and_injection(bad):
    with pytest.raises(ChatError):
        validate_sql(bad)


def test_validate_sql_rejects_non_select():
    with pytest.raises(ChatError):
        validate_sql("EXPLAIN SELECT 1")


def test_validate_sql_allows_whitelisted_join():
    sql = validate_sql(
        "SELECT b.address, r.score FROM buildings b "
        "JOIN risk_scores r ON r.building_id = b.id LIMIT 5"
    )
    assert "buildings" in sql.lower()


@pytest.mark.parametrize(
    "bad",
    [
        # bare SELECT on PII tables — passes the regex, must fail the whitelist
        "SELECT username, password_hash FROM users LIMIT 5",
        "SELECT extracted FROM operational_cards LIMIT 5",
        "SELECT * FROM buildings JOIN users ON true LIMIT 5",
        # dangerous functions
        "SELECT pg_sleep(10)",
        "SELECT pg_read_file('/etc/passwd')",
    ],
)
def test_validate_sql_blocks_non_whitelisted_tables_and_funcs(bad):
    with pytest.raises(ChatError):
        validate_sql(bad)


# --- auth ---------------------------------------------------------------------


def test_password_hash_roundtrip():
    h = hash_password("s3cret")
    assert verify_password("s3cret", h)
    assert not verify_password("wrong", h)


def test_token_carries_district_and_role():
    tok = create_token("inspector", "inspector", "Ахметов", district="Сарыаркинский")
    payload = decode_token(tok)
    assert payload["sub"] == "inspector"
    assert payload["role"] == "inspector"
    assert payload["district"] == "Сарыаркинский"


def test_decode_invalid_token_returns_none():
    assert decode_token("not-a-jwt") is None


# --- access: district scoping -------------------------------------------------


def test_full_access_roles():
    assert has_full_access({"role": "admin"})
    assert has_full_access({"role": "leadership"})
    assert not has_full_access({"role": "inspector"})


def test_enforce_scope_noop_for_full_access():
    clauses, params = [], {}
    enforce_building_scope(clauses, params, {"role": "admin", "district": None})
    assert clauses == [] and params == {}


def test_enforce_scope_restricts_scoped_role():
    clauses, params = [], {}
    enforce_building_scope(clauses, params, {"role": "inspector", "district": "X"})
    assert len(clauses) == 1 and "scope_district" in clauses[0]
    assert params["scope_district"] == "X"


# --- forces: fire force-and-means calculation ---------------------------------


def test_forces_calc_produces_sane_output():
    out = calc(ForcesRequest())
    assert out["result"]["personnel"] > 0
    assert out["result"]["trucks"] >= 1
    assert out["result"]["water_liters_10min"] > 0
    assert out["result"]["rank"] in {"№1", "№2", "№3", "№4"}


def test_forces_larger_fire_needs_more_barrels():
    small = calc(ForcesRequest(width_m=3, distance_km=0.5))
    large = calc(ForcesRequest(width_m=12, distance_km=3, jtr=0.2))
    assert (
        large["result"]["barrels_ext"] + large["result"]["barrels_def"]
        >= small["result"]["barrels_ext"] + small["result"]["barrels_def"]
    )


def test_forces_hard_conditions_add_gdzs_and_warn():
    """Высота + задымление требуют больше звеньев ГДЗС, резерв и предупреждения."""
    ground = calc(ForcesRequest(floor=1, smoke=False))
    hard = calc(ForcesRequest(floor=9, smoke=True))
    assert hard["result"]["gdzs_links"] > ground["result"]["gdzs_links"]
    assert hard["result"]["warnings"], "ожидались предупреждения по условиям/напору"
    assert hard["result"]["personnel"] > ground["result"]["personnel"]


def test_forces_water_source_insufficient_flagged():
    out = calc(ForcesRequest(width_m=12, jtr=0.2, water_source_lps=1.0))
    assert out["result"]["water_source_ok"] is False
    assert any("водоисточник" in w.lower() for w in out["result"]["warnings"])


# --- inspection visits: violation needs codes + photo evidence ----------------


def test_visit_violation_requires_codes():
    # Validation rejects before any DB/request access (both unused on this path).
    body = VisitRequest(inspector_id=1, building_id=1, status="violation")
    with pytest.raises(HTTPException) as e:
        record_visit(body, request=None, db=None)  # type: ignore[arg-type]
    assert e.value.status_code == 422


def test_visit_violation_requires_photo():
    body = VisitRequest(
        inspector_id=1,
        building_id=1,
        status="violation",
        violations=[Violation(code="ЭВ-01", note="выход заблокирован")],
    )
    with pytest.raises(HTTPException) as e:
        record_visit(body, request=None, db=None)  # type: ignore[arg-type]
    assert e.value.status_code == 422
    assert "фото" in e.value.detail.lower()


@pytest.mark.parametrize(
    "bad_id",
    ["../../etc/passwd", "visit_xyz.png", "evil.png", "visit_" + "a" * 32 + ".gif"],
)
def test_visit_photo_rejects_unsafe_names(bad_id):
    # Name-pattern check rejects before request/user are touched.
    with pytest.raises(HTTPException) as e:
        get_visit_photo(bad_id, request=None)  # type: ignore[arg-type]
    assert e.value.status_code == 404


# --- дорожная маршрутизация: сетка изохроны и калибровка --------------------
#
# Роутер — внешний сервис, и здесь он не поднимается: проверяется то, что
# считает наш код. Главное свойство — интеграция, которой нет, не должна
# ничего ломать: без FW_ROUTING_URL модуль обязан молча возвращать «нет
# данных», а вызывающий — откатываться на прямолинейный буфер.

from app import routing as R  # noqa: E402


def test_routing_disabled_without_url(monkeypatch):
    monkeypatch.setattr(R.settings, "routing_url", "")
    assert R.is_configured() is False
    assert R.route(R.Point(71.4, 51.1), R.Point(71.5, 51.2)) is None
    assert R.reachable_points(R.Point(71.4, 51.1), 600, 3000) is None
    assert R.health() == {
        "configured": False,
        "ok": False,
        "detail": "FW_ROUTING_URL не задан",
    }


def test_grid_stays_inside_radius():
    center = R.Point(71.43, 51.13)
    step, radius = 400, 2000
    points = R._grid(center, radius_m=radius, step_m=step)
    assert points, "сетка не должна быть пустой"

    # Все точки — внутри круга (с допуском в один шаг: узлы сетки лежат по
    # краю). Квадратная сетка без отсечения углов дала бы точки за радиусом,
    # то есть матрицу, посчитанную впустую.
    import math

    for p in points:
        dy = (p.lat - center.lat) * 111_320.0
        dx = (p.lng - center.lng) * 111_320.0 * math.cos(math.radians(center.lat))
        assert math.hypot(dx, dy) <= radius + step


def test_calibration_drops_broken_marks(monkeypatch):
    """Отметка, проставленная задним числом, не должна двигать коэффициент."""
    monkeypatch.setattr(R.settings, "routing_url", "http://osrm:5000")
    monkeypatch.setattr(
        R, "route", lambda a, b: R.RouteResult(distance_m=5000, duration_s=300, geometry=None)
    )
    p = R.Point(71.4, 51.1)
    samples = [
        (p, p, 300.0),    # ровно по расчёту
        (p, p, 450.0),    # в полтора раза дольше
        (p, p, 360.0),
        (p, p, 90_000.0),  # «ехали сутки» — испорченная отметка
    ]
    out = R.calibration(samples)
    assert out["samples"] == 3
    assert out["outliers"] == 1
    assert out["median_ratio"] == 1.2
    assert out["max_ratio"] == 1.5


def test_calibration_without_samples_suggests_nothing(monkeypatch):
    monkeypatch.setattr(R.settings, "routing_url", "http://osrm:5000")
    monkeypatch.setattr(R, "route", lambda a, b: None)
    out = R.calibration([(R.Point(71.4, 51.1), R.Point(71.5, 51.2), 300.0)])
    assert out["samples"] == 0
    assert out["suggested_factor"] is None


def test_calibration_stops_at_deadline(monkeypatch):
    """До 200 выездов последовательно, по /route на каждый: при зависшем OSRM
    (REQUEST_TIMEOUT_SEC=20 на запрос) это была бы синхронная ручка на добрый
    час. Общий бюджет времени обязан остановить перебор раньше и честно
    пометить результат неполным, а не тихо досчитать всё до конца."""
    import time

    monkeypatch.setattr(R.settings, "routing_url", "http://osrm:5000")
    monkeypatch.setattr(R, "CALIBRATION_DEADLINE_SEC", 0.05)

    def _slow_route(a, b):
        time.sleep(0.03)
        return R.RouteResult(distance_m=1000, duration_s=300, geometry=None)

    monkeypatch.setattr(R, "route", _slow_route)
    p = R.Point(71.4, 51.1)
    samples = [(p, p, 300.0)] * 10  # при 0.03с/выезд весь список занял бы 0.3с
    out = R.calibration(samples)
    assert out["truncated"] is True
    assert out["attempted"] < len(samples)


def test_calibration_not_truncated_within_deadline(monkeypatch):
    monkeypatch.setattr(R.settings, "routing_url", "http://osrm:5000")
    monkeypatch.setattr(
        R, "route", lambda a, b: R.RouteResult(distance_m=1000, duration_s=300, geometry=None)
    )
    p = R.Point(71.4, 51.1)
    out = R.calibration([(p, p, 300.0), (p, p, 300.0)])
    assert out["truncated"] is False
    assert out["attempted"] == 2


# --- дорожная маршрутизация: сетка для матрицы /table ------------------------
#
# reachable_points шлёт матрицу времён в OSRM одним GET-запросом. Раньше при
# сетке гуще MAX_GRID_POINTS прореживание (`grid[::factor]`) резало ПЛОСКИЙ
# список, а сетка двумерная — число точек растёт квадратично от шага, так что
# линейное прореживание не успевало за мелким шагом и запрос всё ещё превышал
# лимит точек (и `--max-table-size` OSRM). Ниже проверяется, что итоговый
# запрос всегда укладывается в потолок, а координаты не раздувают URL.


class _FakeTableResp:
    def __init__(self, n: int):
        self._n = n

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        # Все точки «достижимы» (duration=0) — тест смотрит на форму запроса,
        # не на итоговую зону.
        return {"code": "Ok", "durations": [[0.0] * self._n]}


def _coords_from_table_url(url: str) -> list[str]:
    # .../table/v1/driving/<coords> — координаты после последнего '/'.
    return url.rsplit("/", 1)[-1].split(";")


def test_reachable_points_thins_grid_quadratically(monkeypatch):
    monkeypatch.setattr(R.settings, "routing_url", "http://osrm:5000")
    monkeypatch.setattr(R.settings, "routing_grid_step_m", 100)  # мелкий шаг

    captured: dict = {}

    def _fake_get(url, params=None, timeout=None):
        coords = _coords_from_table_url(url)
        captured["n"] = len(coords)
        return _FakeTableResp(len(coords))

    monkeypatch.setattr(R.httpx, "get", _fake_get)

    # Тот же радиус сетки, что rebuild_coverage берёт для реального норматива
    # (полуторный от coverage_radius_m=3500) — на шаге 100 м сырая сетка в разы
    # больше MAX_GRID_POINTS, прореживание обязано сработать.
    points = R.reachable_points(R.Point(71.43, 51.13), seconds=600, radius_m=5250)

    assert points is not None
    assert captured["n"] <= R.MAX_GRID_POINTS + 1  # +1 — сам центр


def test_reachable_points_rounds_coordinates(monkeypatch):
    monkeypatch.setattr(R.settings, "routing_url", "http://osrm:5000")

    captured: dict = {}

    def _fake_get(url, params=None, timeout=None):
        coords = _coords_from_table_url(url)
        captured["coords"] = coords
        return _FakeTableResp(len(coords))

    monkeypatch.setattr(R.httpx, "get", _fake_get)

    R.reachable_points(R.Point(71.123456789, 51.987654321), seconds=600, radius_m=500)

    for pair in captured["coords"]:
        lng_s, lat_s = pair.split(",")
        for s in (lng_s, lat_s):
            frac = s.split(".")[1] if "." in s else ""
            assert len(frac) <= 6, f"координата не округлена: {s}"
