"""Боевой-модуль validation tests: bad input is rejected before it reaches the
database. No database required — `current_user`/`get_db` are overridden like in
test_guards.py / test_reports.py; only Pydantic-level 422s are asserted (a valid
request fails downstream at the stubbed DB, which is expected).
"""

import pytest

from app.db import get_db
from app.main import app
from app.routers.auth import current_user

# Mutable role holder so a single client can exercise different боевой roles.
_ROLE = {"value": "dispatcher"}


def _fake_current_user() -> dict:
    return {
        "username": "disp1",
        "role": _ROLE["value"],
        "name": "Dispatcher",
        "district": None,
    }


def _fake_get_db():
    yield None


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    app.dependency_overrides[current_user] = _fake_current_user
    app.dependency_overrides[get_db] = _fake_get_db
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_role():
    _ROLE["value"] = "dispatcher"
    yield
    _ROLE["value"] = "dispatcher"


# --- POST /dispatch: validation --------------------------------------------


def test_create_callout_requires_location(client):
    # Neither building_id nor lat+lng — no point to dispatch to.
    resp = client.post("/dispatch", json={"callout_type": "fire"})
    assert resp.status_code == 422


def test_create_callout_partial_coords_rejected(client):
    # lat without lng is not a usable point.
    resp = client.post("/dispatch", json={"lat": 51.16, "callout_type": "fire"})
    assert resp.status_code == 422


def test_create_callout_rejects_unknown_type(client):
    resp = client.post(
        "/dispatch", json={"lat": 51.16, "lng": 71.44, "callout_type": "boom"}
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_lat", [-90.5, 90.5, 200])
def test_create_callout_rejects_lat_out_of_range(client, bad_lat):
    resp = client.post(
        "/dispatch", json={"lat": bad_lat, "lng": 71.44, "callout_type": "fire"}
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_lng", [-180.5, 180.5, 999])
def test_create_callout_rejects_lng_out_of_range(client, bad_lng):
    resp = client.post(
        "/dispatch", json={"lat": 51.16, "lng": bad_lng, "callout_type": "fire"}
    )
    assert resp.status_code == 422


def test_create_callout_by_building_passes_validation(client):
    resp = client.post("/dispatch", json={"building_id": 1, "callout_type": "smoke"})
    assert resp.status_code not in (401, 403, 422)


def test_create_callout_by_point_passes_validation(client):
    resp = client.post(
        "/dispatch",
        json={"lat": 51.16, "lng": 71.44, "callout_type": "fire", "address": "ул. Абая 1"},
    )
    assert resp.status_code not in (401, 403, 422)


# --- GET /dispatch: status filter validation -------------------------------


def test_list_callouts_rejects_bad_status(client):
    _ROLE["value"] = "responder"
    resp = client.get("/dispatch?status=weird")
    assert resp.status_code == 422


# --- POST /infra/hydrants/{id}/status: validation --------------------------


def test_hydrant_status_rejects_unknown_status(client):
    resp = client.post("/infra/hydrants/1/status", json={"status": "wet"})
    assert resp.status_code == 422


def test_hydrant_status_valid_passes_validation(client):
    resp = client.post("/infra/hydrants/1/status", json={"status": "broken"})
    assert resp.status_code not in (401, 403, 422)
