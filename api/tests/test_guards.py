"""Role-guard tests: every protected endpoint enforces its allowed roles.

No database required. `current_user` and `get_db` are dependency-overridden so we
exercise only the guard layer (the 401/403 decision) without a live PostGIS. An
allowed role passes the guard and then fails downstream (500/503/400) when it
reaches the stubbed DB / external service — we assert only the guard verdict:
a role outside the list gets 403, a role inside it never gets 401/403.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.db import get_db
from app.main import app
from app.routers.auth import current_user, require_roles

ALL_ROLES = ("inspector", "supervisor", "leadership", "admin")

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
    ("forces_presets", "GET", "/forces/presets", None,
     {"supervisor", "admin"}),
    ("forces_calc", "POST", "/forces/calc", {},
     {"supervisor", "admin"}),
    ("infra_stats", "GET", "/infra/stats", None,
     {"supervisor", "leadership", "admin"}),
    ("infra_stations", "GET", "/infra/stations", None,
     {"supervisor", "leadership", "admin"}),
    ("cards_list", "GET", "/cards", None,
     {"inspector", "supervisor", "admin"}),
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
     {"inspector", "supervisor", "admin"}),
    ("reports_status", "POST", "/reports/1/status", {"status": "in_progress"},
     {"supervisor", "admin"}),
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
