"""Role-guard tests: every protected endpoint enforces its allowed roles.

No database required. `current_user` and `get_db` are dependency-overridden so we
exercise only the guard layer (the 401/403 decision) without a live PostGIS. An
allowed role passes the guard and then fails downstream (500/503/400) when it
reaches the stubbed DB / external service — we assert only the guard verdict:
a role outside the list gets 403, a role inside it never gets 401/403.
"""

import asyncio
import re

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.db import get_db
from app.main import app
from app.routers.auth import current_user, require_roles

ALL_ROLES = (
    "inspector", "supervisor", "leadership", "admin",
    "dispatcher", "responder", "owner", "akimat",
)

# Mutable holder so the overridden current_user can vary the role per request.
_ROLE = {"value": "admin"}


def _fake_current_user() -> dict:
    return {
        "username": "tester",
        "role": _ROLE["value"],
        "name": "Tester",
        "district": "Сарыаркинский",
    }


def _fake_get_db():
    yield None


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    app.dependency_overrides[current_user] = _fake_current_user
    app.dependency_overrides[get_db] = _fake_get_db
    # raise_server_exceptions=False → a downstream 500 (stubbed DB) is returned as
    # a response instead of propagating, so we can inspect the status code.
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


def _call(client, method: str, path: str, body):
    if method == "GET":
        return client.get(path)
    return client.post(path, json=body if body is not None else {})


# (id, method, path, json_body, allowed_roles) — mirrors the access matrix.
ENDPOINTS = [
    ("chat", "POST", "/chat", {"question": "сколько зданий в базе"},
     {"leadership", "admin"}),
    ("model", "GET", "/model", None,
     {"leadership", "supervisor", "admin"}),
    ("overview", "GET", "/overview", None,
     {"supervisor", "leadership", "admin"}),
    # Городской трек: акимат и руководство ведомства, admin — сопровождение.
    ("city_summary", "GET", "/city/summary", None,
     {"akimat", "leadership", "admin"}),
    ("city_districts", "GET", "/city/districts.geojson", None,
     {"akimat", "leadership", "admin"}),
    ("city_priorities", "GET", "/city/priorities", None,
     {"akimat", "leadership", "admin"}),
    ("forces_presets", "GET", "/forces/presets", None,
     {"supervisor", "admin", "dispatcher", "responder"}),
    ("forces_calc", "POST", "/forces/calc", {},
     {"supervisor", "admin", "dispatcher", "responder"}),
    ("infra_stats", "GET", "/infra/stats", None,
     {"supervisor", "leadership", "admin", "dispatcher", "responder", "akimat"}),
    ("infra_stations", "GET", "/infra/stations", None,
     {"supervisor", "leadership", "admin", "dispatcher", "responder", "akimat"}),
    ("infra_blind_zones", "GET", "/infra/blind-zones", None,
     {"supervisor", "leadership", "admin", "dispatcher", "responder", "akimat"}),
    ("hydrant_status", "POST", "/infra/hydrants/1/status", {"status": "ok"},
     {"dispatcher", "responder", "supervisor", "admin"}),
    # Пересчёт зон прибытия переписывает слой, на котором строятся выводы о
    # покрытии города, — это админская операция, а не «обновить карту».
    ("coverage_rebuild", "POST", "/infra/coverage/rebuild", None, {"admin"}),
    ("routing_calibration", "GET", "/infra/routing/calibration", None,
     {"supervisor", "leadership", "admin"}),
    ("cards_list", "GET", "/cards", None,
     {"inspector", "supervisor", "admin", "dispatcher", "responder"}),
    ("cards_review", "POST", "/cards/1/prescriptions/1/review", {"status": "approved"},
     {"inspector", "supervisor", "admin"}),
    ("routes_checklist", "GET", "/routes/checklist", None,
     {"inspector", "supervisor", "admin"}),
    ("inspectors", "GET", "/inspectors", None,
     {"inspector", "supervisor", "admin"}),
    ("routes_today", "GET", "/routes/today?inspector_id=1", None,
     {"inspector", "supervisor", "admin"}),
    ("routes_visit", "POST", "/routes/visit",
     {"inspector_id": 1, "building_id": 1, "status": "done"},
     {"inspector", "supervisor", "admin"}),
    ("routes_progress", "GET", "/routes/progress", None,
     {"supervisor", "leadership", "admin"}),
    ("reports_create", "POST", "/reports",
     {
         "category": "blocked_access",
         "lat": 51.169,
         "lng": 71.449,
         "photos": [f"visit_{'0' * 32}.jpg"],
     },
     {"inspector", "supervisor", "admin", "dispatcher", "responder"}),
    ("reports_status", "POST", "/reports/1/status", {"status": "in_progress"},
     {"supervisor", "admin"}),
    # Очередь донесений читают только внутренние роли ДЧС: фото, авторы и
    # описания с мест не уходят ни внешнему owner, ни акимату.
    ("reports_list", "GET", "/reports", None,
     {"inspector", "supervisor", "leadership", "admin", "dispatcher", "responder"}),
    ("reports_geojson", "GET", "/reports/geojson", None,
     {"inspector", "supervisor", "leadership", "admin", "dispatcher", "responder"}),
    # Боевой модуль — dispatch of callouts and the боевой пакет.
    ("dispatch_search", "GET", "/dispatch/search?q=абая", None,
     {"dispatcher", "admin"}),
    ("dispatch_create", "POST", "/dispatch",
     {"lat": 51.169, "lng": 71.449, "callout_type": "fire"},
     {"dispatcher", "admin"}),
    ("dispatch_list", "GET", "/dispatch", None,
     {"dispatcher", "responder", "supervisor", "leadership", "admin"}),
    ("dispatch_pack", "GET", "/dispatch/1/pack", None,
     {"dispatcher", "responder", "supervisor", "leadership", "admin"}),
    ("dispatch_close", "POST", "/dispatch/1/close", {},
     {"dispatcher", "admin"}),
    # Owner portal — external role. None of ALL_ROLES may enter; owner passes the
    # guard (asserted in test_allowed_role_passes_guard, which iterates `allowed`).
    ("portal_summary", "GET", "/portal/summary", None,
     {"owner"}),
    ("portal_remediation", "POST", "/portal/prescriptions/1/remediation",
     {"note": "нарушение устранено"},
     {"owner"}),
    # Admin-only external account creation.
    ("auth_users", "POST", "/auth/users",
     {"username": "newowner", "password": "password123", "name": "Owner",
      "role": "owner", "building_ids": [1]},
     {"admin"}),
]


@pytest.mark.parametrize("name,method,path,body,allowed", ENDPOINTS, ids=[e[0] for e in ENDPOINTS])
def test_forbidden_role_gets_403(client, name, method, path, body, allowed):
    denied = [r for r in ALL_ROLES if r not in allowed]
    assert denied, f"{name}: every role allowed — nothing to test"
    for role in denied:
        _ROLE["value"] = role
        resp = _call(client, method, path, body)
        assert resp.status_code == 403, (
            f"{name}: role {role} must be forbidden, got {resp.status_code}"
        )


@pytest.mark.parametrize("name,method,path,body,allowed", ENDPOINTS, ids=[e[0] for e in ENDPOINTS])
def test_allowed_role_passes_guard(client, name, method, path, body, allowed):
    for role in allowed:
        _ROLE["value"] = role
        resp = _call(client, method, path, body)
        # The guard let the request through; it may still fail downstream at the
        # stubbed DB / external service, but never with an auth verdict.
        assert resp.status_code not in (401, 403), (
            f"{name}: role {role} must pass the guard, got {resp.status_code}"
        )


# --- visit-photo tightening: internal-only after owners were introduced -------


def test_visit_photo_denies_owner(client):
    """An external owner must never see inspection-visit evidence photos."""
    _ROLE["value"] = "owner"
    resp = client.get(f"/routes/visit/photo/visit_{'0' * 32}.jpg")
    assert resp.status_code == 403


@pytest.mark.parametrize(
    "role",
    ["inspector", "supervisor", "leadership", "admin", "dispatcher", "responder"],
)
def test_visit_photo_allows_internal_roles(client, role):
    _ROLE["value"] = role
    resp = client.get(f"/routes/visit/photo/visit_{'0' * 32}.jpg")
    # Passes the guard; the file doesn't exist → 404, never an auth verdict.
    assert resp.status_code not in (401, 403)


# --- visit-photo upload: shared pool with field-report evidence ---------------
# dispatcher/responder upload evidence photos for donesения through this same
# endpoint, so the upload guard is wider than FIELD_ROLES — but leadership
# (view-only) must still not be able to upload.


@pytest.mark.parametrize("role", ["leadership", "owner", "akimat"])
def test_visit_photo_upload_denies_view_only_roles(client, role):
    _ROLE["value"] = role
    resp = client.post("/routes/visit/photo")
    assert resp.status_code == 403, f"{role} must not upload visit photos, got {resp.status_code}"


@pytest.mark.parametrize(
    "role",
    ["inspector", "supervisor", "admin", "dispatcher", "responder"],
)
def test_visit_photo_upload_allows_field_and_boevoy_roles(client, role):
    _ROLE["value"] = role
    resp = client.post(
        "/routes/visit/photo",
        files={"file": ("x.png", b"", "image/png")},
    )
    # Passes the guard; never an auth verdict.
    assert resp.status_code not in (401, 403)


# --- akimat: граница городского трека ------------------------------------------
# Акимат — только чтение картины города: реестр зданий с оценкой уязвимости,
# инфраструктура, /city/*. Проверяется не выборка, а ВСЕ маршруты приложения:
# новый эндпоинт, который без guard'а случайно открылся акимату, валит тест,
# пока его не внесут в разрешённый список осознанно.
#
# Разрешённые записи (POST) — только собственная сессия: вход, выход и
# завершение своих сессий. Всё прочее с методом записи — 403.
AKIMAT_ALLOWED = {
    ("GET", "/"),
    ("GET", "/health"),
    ("POST", "/auth/login"),
    ("GET", "/auth/me"),
    ("POST", "/auth/logout"),
    ("POST", "/auth/revoke"),
    ("GET", "/buildings"),
    ("GET", "/buildings/search"),
    ("GET", "/buildings/freshness"),
    ("GET", "/buildings/{building_id}"),
    ("GET", "/infra/stations"),
    ("GET", "/infra/hydrants"),
    ("GET", "/infra/coverage"),
    ("GET", "/infra/routing/health"),
    ("GET", "/infra/blind-zones"),
    ("GET", "/infra/stats"),
    ("GET", "/city/summary"),
    ("GET", "/city/districts.geojson"),
    ("GET", "/city/priorities"),
}

# Явно названные запреты из продуктового решения — дублируют перебор ниже,
# чтобы отказ по ним читался в отчёте pytest поимённо.
AKIMAT_DENIED = [
    ("GET", "/reports"),
    ("GET", "/reports/geojson"),
    ("GET", "/cards"),
    ("GET", "/cards/1"),
    ("GET", "/cards/1/file"),
    ("POST", "/chat"),
    ("GET", "/audit"),
    ("GET", "/dispatch"),
    ("GET", "/dispatch/stats"),
    ("GET", "/forces/presets"),
    ("GET", "/routes/progress"),
    ("GET", "/routes/today"),
    ("GET", "/inspectors"),
    ("GET", "/portal/summary"),
    ("GET", "/auth/users"),
    ("GET", "/model"),
    ("GET", "/overview"),
    ("GET", "/infra/routing/calibration"),
    ("GET", f"/routes/visit/photo/visit_{'0' * 32}.jpg"),
    ("GET", f"/portal/photo/owner_{'0' * 32}.jpg"),
    ("POST", "/infra/hydrants/1/status"),
    ("POST", "/infra/coverage/rebuild"),
    ("POST", "/reports"),
    ("POST", "/routes/visit/photo"),
]


def _app_routes():
    """Все (метод, шаблон пути) приложения.

    Через OpenAPI-схему, а не `app.routes`: начиная с FastAPI 0.13x подключённые
    роутеры лежат в `app.routes` обёртками `_IncludedRouter`, и перебор по
    `APIRoute` видел бы один корневой маршрут. Маршрутов со
    `include_in_schema=False` в api нет (проверяется ниже).
    """
    for template, ops in app.openapi()["paths"].items():
        for method in ops:
            yield method.upper(), template


def _api_routes(routes):
    for r in routes:
        if isinstance(r, APIRoute):
            yield r
        elif getattr(r, "original_router", None) is not None:
            yield from _api_routes(r.original_router.routes)


def test_no_routes_hidden_from_schema():
    routes = list(_api_routes(app.routes))
    assert len(routes) > 50, "обход роутеров не нашёл маршруты — сменилась внутренняя структура FastAPI"
    hidden = [r.path for r in routes if not r.include_in_schema]
    assert hidden == [], hidden


@pytest.mark.parametrize("method,path", AKIMAT_DENIED, ids=[f"{m} {p}" for m, p in AKIMAT_DENIED])
def test_akimat_denied_list(client, method, path):
    _ROLE["value"] = "akimat"
    resp = client.request(method, path, json=None if method == "GET" else {})
    assert resp.status_code == 403, f"akimat: {method} {path} → {resp.status_code}"


def test_akimat_boundary_covers_every_route(client):
    _ROLE["value"] = "akimat"
    seen: set[tuple[str, str]] = set()
    leaks, blocked = [], []
    for method, template in _app_routes():
        seen.add((method, template))
        path = re.sub(r"\{[^}]+\}", "1", template)
        resp = client.request(method, path, json=None if method == "GET" else {})
        if (method, template) in AKIMAT_ALLOWED:
            if resp.status_code in (401, 403):
                blocked.append(f"{method} {template} → {resp.status_code}")
        elif resp.status_code != 403:
            leaks.append(f"{method} {template} → {resp.status_code}")
    assert not leaks, "акимату открыты маршруты вне городского трека: " + "; ".join(leaks)
    assert not blocked, "акимату закрыты разрешённые маршруты: " + "; ".join(blocked)
    # Разрешённый список не должен ссылаться на удалённые/переименованные маршруты.
    assert AKIMAT_ALLOWED <= seen, AKIMAT_ALLOWED - seen


# --- /infra/routing/health: сырой текст ошибки роутера — только admin ----------


@pytest.mark.parametrize(
    "role,expected",
    [
        ("akimat", "Дорожный роутер не отвечает"),
        ("leadership", "Дорожный роутер не отвечает"),
        ("dispatcher", "Дорожный роутер не отвечает"),
        ("admin", "connect to http://osrm.internal:5000 refused"),
    ],
)
def test_routing_health_hides_raw_error_from_non_admin(client, monkeypatch, role, expected):
    from app import routing

    monkeypatch.setattr(
        routing,
        "health",
        lambda: {"configured": True, "ok": False,
                 "detail": "connect to http://osrm.internal:5000 refused"},
    )
    _ROLE["value"] = role
    body = client.get("/infra/routing/health").json()
    assert body["ok"] is False
    assert body["detail"] == expected


# --- require_roles factory (pure, no app) -------------------------------------


def test_require_roles_allows_listed_role():
    guard = require_roles("supervisor", "admin")
    user = {"role": "admin"}
    assert asyncio.run(guard(user=user)) is user


def test_require_roles_blocks_unlisted_role():
    guard = require_roles("supervisor", "admin")
    with pytest.raises(HTTPException) as e:
        asyncio.run(guard(user={"role": "inspector"}))
    assert e.value.status_code == 403
