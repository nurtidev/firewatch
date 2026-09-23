"""Пул соединений и кэш тяжёлых агрегатов — регрессия инцидента /city.

Смоук-тест /city: «QueuePool limit of size 5 overflow 10 reached, connection
timed out» и вход, висящий по 30 с. Причины и устройство — app/db.py,
app/cache.py, app/main.py::AuditMiddleware. Здесь без базы:
  • каждая сессия запроса закрывается до отправки ответа, и на запрос она одна;
  • current_user возвращает соединение в пул сразу после проверки;
  • аудит отказа пишется не из event loop;
  • перегрузка пула и statement_timeout — 503 с Retry-After и CORS, не 500 —
    но НЕ для любого OperationalError на мутирующем запросе: см. блок
    «мутирующие запросы и неоднозначные ошибки» ниже;
  • кэш: TTL, single-flight, протухшее значение на время пересчёта, сброс,
    предел ожидания холодного ключа.

Один путь, который обход зависимостей (test_every_db_session_closes_before_
the_response_is_sent) не видит: api/app/chat.py:~199 открывает соединение
напрямую через `engine.connect()` (не `Depends(get_db)`), а не сессией
запроса — но ограниченно: READ ONLY и `SET LOCAL statement_timeout = '5000'`
в той же транзакции, до `db_heavy_statement_timeout_ms` остальных тяжёлых
чтений. Ничего не сломано — просто этот путь не участвует в проверках сессии
выше, и в него нужно заглянуть отдельно, если в chat.py что-то меняется.
"""

import asyncio
import threading
import time

import psycopg
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import exc as sa_exc

from app import main as main_module
from app.cache import ReadCache
from app.db import get_db
from app.main import app
from app.routers import city, infra
from app.routers.auth import current_user

# --- сессия запроса -----------------------------------------------------------


def _walk(dependant):
    for dep in dependant.dependencies:
        yield dep
        yield from _walk(dep)


def _api_routes(routes):
    # С FastAPI 0.13x подключённые роутеры лежат в app.routes обёртками
    # `_IncludedRouter` (см. tests/test_guards.py::_api_routes).
    for r in routes:
        if isinstance(r, APIRoute):
            yield r
        elif getattr(r, "original_router", None) is not None:
            yield from _api_routes(r.original_router.routes)


def test_every_db_session_closes_before_the_response_is_sent():
    """`Depends(get_db)` без scope="function" держит соединение, пока ответ
    уходит клиенту; смешанные scope дают две сессии (два соединения) на запрос."""
    routes = list(_api_routes(app.routes))
    with_db = 0
    offenders = []
    for route in routes:
        deps = [d for d in _walk(route.dependant) if d.call is get_db]
        if not deps:
            continue
        with_db += 1
        scopes = {d.computed_scope for d in deps}
        keys = {d.cache_key for d in deps}
        if scopes != {"function"} or len(keys) != 1:
            offenders.append((sorted(route.methods), route.path, scopes, len(keys)))
    assert with_db > 50, "маршруты с сессией не найдены — обход зависимостей сломан"
    assert not offenders, offenders


def test_current_user_returns_connection_before_the_handler_runs():
    from app.auth import create_token

    calls = []

    class _Result:
        def mappings(self):
            return self

        def first(self):
            return {"sessions_revoked_at": None, "is_active": True, "district": None}

    class _Db:
        def execute(self, *_args, **_kwargs):
            calls.append("execute")
            return _Result()

        def rollback(self):
            calls.append("rollback")

    class _Req:
        query_params: dict = {}

    token = create_token("akimat", "akimat", "Акимат", None)
    user = current_user(_Req(), f"Bearer {token}", _Db())
    assert user["role"] == "akimat"
    assert calls == ["execute", "rollback"]


# --- middleware и ошибки базы --------------------------------------------------


def test_denied_request_is_audited_off_the_event_loop(monkeypatch):
    seen = []

    def fake_audit(**kwargs):
        try:
            asyncio.get_running_loop()
            on_loop = True
        except RuntimeError:
            on_loop = False
        seen.append((kwargs["status_code"], kwargs["path"], on_loop))

    monkeypatch.setattr(main_module, "audit", fake_audit)
    with TestClient(app) as client:
        resp = client.get("/city/summary", headers={"Authorization": "Bearer not-a-token"})
    assert resp.status_code == 401
    assert seen == [(401, "/city/summary", False)]


def _raising_current_user(err: Exception):
    def dependency():
        raise err

    return dependency


@pytest.mark.parametrize(
    "err",
    [
        sa_exc.TimeoutError("QueuePool limit of size 5 overflow 10 reached"),
        sa_exc.OperationalError(
            "SELECT 1", {}, psycopg.errors.QueryCanceled("canceling statement due to statement timeout")
        ),
        sa_exc.OperationalError(
            "SELECT 1", {}, psycopg.errors.ConnectionTimeout("connection timeout expired")
        ),
    ],
    ids=["pool-timeout", "statement-timeout", "connection-timeout"],
)
def test_db_overload_is_503_with_retry_after_and_cors(err):
    app.dependency_overrides[current_user] = _raising_current_user(err)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/city/summary", headers={"Origin": "http://localhost:3001"})
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert resp.status_code == 503
    assert resp.headers["retry-after"] == "5"
    assert resp.headers.get("access-control-allow-origin") in ("*", "http://localhost:3001")


def test_other_db_errors_stay_500():
    err = sa_exc.OperationalError("SELECT 1", {}, psycopg.errors.UndefinedTable("no such table"))
    app.dependency_overrides[current_user] = _raising_current_user(err)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/city/summary")
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert resp.status_code == 500


# --- мутирующие запросы и неоднозначные ошибки --------------------------------
#
# POST /dispatch/{id}/close: DISPATCH_ROLES (app/routers/dispatch.py) wraps
# current_user via Depends — overriding current_user still intercepts it
# (FastAPI matches sub-dependencies by callable identity, not by nesting
# depth). `json={}` is a valid CalloutClose body (close_note is optional), so
# the request never reaches the handler regardless of the exact order
# dependencies vs. the body are resolved in — current_user always raises
# first either way.


def _post_dispatch_close(**extra_headers):
    with TestClient(app, raise_server_exceptions=False) as client:
        return client.post("/dispatch/1/close", json={}, headers=extra_headers)


def test_get_query_canceled_is_503():
    """GET + QueryCanceled → 503 (safe method: любой OperationalError, включая
    отменённый statement, безопасен для «повторите» — читать нечего задваивать)."""
    err = sa_exc.OperationalError(
        "SELECT 1", {}, psycopg.errors.QueryCanceled("canceling statement due to statement timeout")
    )
    app.dependency_overrides[current_user] = _raising_current_user(err)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            resp = client.get("/city/summary")
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert resp.status_code == 503
    assert resp.headers["retry-after"] == "5"


def test_post_query_canceled_is_503():
    """POST + QueryCanceled → 503: statement был отменён Postgres'ом ДО
    применения — единственный OperationalError, для которого 503 сохранён и
    на мутации (см. main.py::db_overloaded)."""
    err = sa_exc.OperationalError(
        "UPDATE callouts ...", {}, psycopg.errors.QueryCanceled("canceling statement due to statement timeout")
    )
    app.dependency_overrides[current_user] = _raising_current_user(err)
    try:
        resp = _post_dispatch_close()
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert resp.status_code == 503
    assert resp.headers["retry-after"] == "5"


@pytest.mark.parametrize(
    "err",
    [
        sa_exc.OperationalError(
            "UPDATE callouts ...", {},
            psycopg.errors.AdminShutdown("terminating connection due to administrator command"),
        ),
        sa_exc.OperationalError(
            "UPDATE callouts ...", {}, psycopg.errors.TransactionRollback("deadlock detected")
        ),
    ],
    ids=["admin-shutdown", "transaction-rollback"],
)
def test_post_ambiguous_operational_error_stays_500_without_retry_after(err):
    """POST + AdminShutdown/TransactionRollback → 500 без Retry-After: обрыв
    соединения (рестарт Postgres на Railway) или дедлок в момент COMMIT не
    говорит, попала запись в базу или нет — «повторите» рискует задвоить её,
    поэтому это обычный необработанный 500, а не 503 (см. main.py::db_overloaded)."""
    app.dependency_overrides[current_user] = _raising_current_user(err)
    try:
        resp = _post_dispatch_close()
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert resp.status_code == 500
    assert "retry-after" not in resp.headers


def test_post_pool_timeout_is_503():
    """POST + пул исчерпан (TimeoutError) → 503: тайм-аут `Pool.connect()`
    срабатывает ДО первого `execute()` в сессии — запрос не успел взять
    соединение вообще, значит ничего не записал (см. main.py::db_pool_exhausted)."""
    err = sa_exc.TimeoutError("QueuePool limit of size 5 overflow 10 reached")
    app.dependency_overrides[current_user] = _raising_current_user(err)
    try:
        resp = _post_dispatch_close()
    finally:
        app.dependency_overrides.pop(current_user, None)
    assert resp.status_code == 503
    assert resp.headers["retry-after"] == "5"


# --- кэш ----------------------------------------------------------------------


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _never(label: str):
    def compute():
        raise AssertionError(f"не должно пересчитываться: {label}")

    return compute


def test_cache_serves_value_until_ttl_then_recomputes():
    clock = _Clock()
    cache = ReadCache(60, clock=clock)
    calls = []

    def compute():
        calls.append(1)
        return len(calls)

    assert cache.get_or_compute("k", compute) == 1
    clock.now += 59
    assert cache.get_or_compute("k", compute) == 1
    clock.now += 2
    assert cache.get_or_compute("k", compute) == 2


def test_zero_ttl_disables_cache():
    cache = ReadCache(0)
    calls = []
    cache.get_or_compute("k", lambda: calls.append(1))
    cache.get_or_compute("k", lambda: calls.append(1))
    assert len(calls) == 2


def test_cold_key_is_computed_once_for_concurrent_callers():
    cache = ReadCache(60)
    calls = []
    gate = threading.Event()

    def compute():
        calls.append(1)
        gate.wait(2)
        return "v"

    results = []
    threads = [
        threading.Thread(target=lambda: results.append(cache.get_or_compute("k", compute)))
        for _ in range(8)
    ]
    for t in threads:
        t.start()
    time.sleep(0.1)
    gate.set()
    for t in threads:
        t.join(5)
    assert calls == [1]
    assert results == ["v"] * 8


def test_stale_value_is_served_while_one_caller_refreshes():
    clock = _Clock()
    cache = ReadCache(60, clock=clock)
    cache.get_or_compute("k", lambda: "old")
    clock.now += 61
    started, release = threading.Event(), threading.Event()

    def slow_refresh():
        started.set()
        release.wait(2)
        return "new"

    refresher = threading.Thread(target=lambda: cache.get_or_compute("k", slow_refresh))
    refresher.start()
    assert started.wait(2)
    assert cache.get_or_compute("k", _never("второй пересчёт")) == "old"
    release.set()
    refresher.join(5)
    assert cache.get_or_compute("k", _never("свежее значение")) == "new"


def test_too_old_value_is_not_served_stale():
    clock = _Clock()
    cache = ReadCache(60, clock=clock)
    cache.get_or_compute("k", lambda: "ancient")
    clock.now += 121  # дольше TTL + ещё одного TTL
    assert cache.get_or_compute("k", lambda: "fresh") == "fresh"


def test_cold_key_lock_timeout_raises_pool_timeout_error():
    """Холодный ключ (отдавать нечего), лок занят дольше lock_timeout_sec —
    поднимается sa_exc.TimeoutError: тот же тип, что и таймаут пула
    (app/db.py), поэтому она попадает в уже существующий обработчик 503
    (app/main.py::db_pool_exhausted) без нового формата ошибки, а не держит
    поток anyio (их 40) заблокированным на неопределённый срок."""
    cache = ReadCache(60, lock_timeout_sec=0.05)
    started, release = threading.Event(), threading.Event()

    def slow_first():
        started.set()
        release.wait(2)
        return "v1"

    holder = threading.Thread(target=lambda: cache.get_or_compute("k", slow_first))
    holder.start()
    assert started.wait(2)
    with pytest.raises(sa_exc.TimeoutError):
        cache.get_or_compute("k", _never("не должно вызываться — лок занят"))
    release.set()
    holder.join(5)


def test_very_stale_value_is_served_when_lock_times_out():
    """Значение старше TTL*2 есть, но лок занят дольше lock_timeout_sec —
    отдаём то, что есть, вместо того чтобы ждать или поднимать ошибку:
    устаревшая цифра на экране лучше, чем 503 при живом (хоть и медленном)
    пересчёте у кого-то другого."""
    clock = _Clock()
    cache = ReadCache(60, clock=clock, lock_timeout_sec=0.05)
    cache.get_or_compute("k", lambda: "ancient")
    clock.now += 121  # дольше TTL + ещё одного TTL — холодная ветка

    started, release = threading.Event(), threading.Event()

    def slow_refresh():
        started.set()
        release.wait(2)
        return "fresh"

    refresher = threading.Thread(target=lambda: cache.get_or_compute("k", slow_refresh))
    refresher.start()
    assert started.wait(2)
    assert cache.get_or_compute("k", _never("не должно вызываться — лок занят")) == "ancient"
    release.set()
    refresher.join(5)


def test_invalidate_drops_value_and_discards_result_computed_before_it():
    cache = ReadCache(60)
    cache.get_or_compute("city:summary", lambda: "v1")
    cache.get_or_compute("infra:coverage", lambda: "c1")
    cache.invalidate("city:")
    started, release = threading.Event(), threading.Event()

    def slow():
        started.set()
        release.wait(2)
        return "computed-before-rebuild"

    worker = threading.Thread(target=lambda: cache.get_or_compute("city:summary", slow))
    worker.start()
    assert started.wait(2)
    cache.invalidate("city:")  # пересчёт зон прибытия пришёлся на расчёт
    release.set()
    worker.join(5)
    assert cache.get_or_compute("city:summary", lambda: "v2") == "v2"
    assert cache.get_or_compute("infra:coverage", _never("другой префикс")) == "c1"


# --- кэш в городских ручках ----------------------------------------------------


def test_city_map_and_overview_share_one_summary_computation(monkeypatch):
    """/summary и /districts.geojson — один тяжёлый расчёт, а не два на экран."""
    calls = {"summary": 0, "heavy": 0}

    def fake_summary_data(db):
        calls["summary"] += 1
        return {
            "city": {"buildings_total": 10},
            "districts": [
                {"name": "Есиль", "rank": 1, "attention_buildings": 2, "buildings_total": 10}
            ],
            "unassigned": {"buildings": 0, "open_prescriptions": 0},
        }

    class _Rows:
        def mappings(self):
            return self

        def all(self):
            return [{"name": "Есиль", "name_kk": "Есіл", "name_en": "Yesil",
                     "geom": '{"type": "Polygon", "coordinates": []}'}]

    class _Db:
        def execute(self, *_args, **_kwargs):
            return _Rows()

    monkeypatch.setattr(city, "read_cache", ReadCache(60))
    monkeypatch.setattr(city, "_summary_data", fake_summary_data)
    monkeypatch.setattr(city, "_envelope", lambda db: {"computed_at": "t0", "demo_data": True})
    monkeypatch.setattr(city, "heavy_read", lambda db: calls.__setitem__("heavy", calls["heavy"] + 1))

    first = city.summary(_Db())
    geo = city.districts_geojson(_Db())
    again = city.summary(_Db())

    assert calls == {"summary": 1, "heavy": 1}
    assert first == again
    assert first["computed_at"] == geo["computed_at"] == "t0"
    assert geo["features"][0]["properties"]["rank"] == 1


def test_hydrant_status_change_invalidates_city_aggregates(monkeypatch):
    invalidated = []

    class _Spy:
        def invalidate(self, prefix=""):
            invalidated.append(prefix)

    class _Result:
        def mappings(self):
            return self

        def first(self):
            return {"id": 7, "status": "broken", "last_check": None, "pressure_bar": None,
                    "diameter_mm": None, "hydrant_type": None, "lat": 51.1, "lng": 71.4}

    class _Db:
        def execute(self, *_args, **_kwargs):
            return _Result()

        def commit(self):
            pass

    class _Req:
        headers: dict = {}
        client = type("C", (), {"host": "127.0.0.1"})()

    monkeypatch.setattr(infra, "read_cache", _Spy())
    monkeypatch.setattr(infra, "audit", lambda **_kw: None)
    infra.set_hydrant_status(
        7, infra.HydrantStatusUpdate(status="broken"), _Req(), _Db(),
        {"username": "responder", "role": "responder"},
    )
    assert invalidated == ["city:"]
