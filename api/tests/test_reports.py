"""Field-reports validation tests: bad input is rejected before it reaches the
database. No database required — `current_user`/`get_db` are overridden like in
test_guards.py; only the Pydantic-level 422s are asserted precisely, positive
cases just assert the guard/validation layer let the request through (not
401/403/422), since the stubbed DB fails downstream.
"""

import pytest

from app.db import get_db
from app.main import app
from app.routers import reports as reports_router
from app.routers.auth import current_user

_VALID_PHOTO = f"visit_{'0' * 32}.jpg"


def _fake_current_user() -> dict:
    return {
        "username": "tester",
        "role": "admin",
        "name": "Tester",
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


def _base_report(**overrides) -> dict:
    body = {
        "category": "blocked_access",
        "lat": 51.169,
        "lng": 71.449,
        "photos": [_VALID_PHOTO],
    }
    body.update(overrides)
    return body


# --- POST /reports: evidence rules -----------------------------------------
#
# Obstacle categories keep the hard photo requirement; the after-the-fact ones
# (a crew recording a mismatch with the ПТП once back at the station) accept a
# written description in place of a photo, but never nothing at all.


@pytest.mark.parametrize("category", sorted(reports_router.PHOTO_REQUIRED_CATEGORIES))
def test_obstacle_categories_require_at_least_one_photo(client, category):
    resp = client.post("/reports", json=_base_report(category=category, photos=[]))
    assert resp.status_code == 422


@pytest.mark.parametrize("category", sorted(reports_router.PHOTO_REQUIRED_CATEGORIES))
def test_obstacle_categories_reject_missing_photos_field(client, category):
    body = _base_report(category=category)
    del body["photos"]
    resp = client.post("/reports", json=body)
    assert resp.status_code == 422


@pytest.mark.parametrize("category", ["ptp_mismatch", "other"])
def test_after_the_fact_categories_accept_description_without_photo(client, category):
    resp = client.post(
        "/reports",
        json=_base_report(
            category=category,
            photos=[],
            description="Планировка 14 этажа секции Б не совпадает с ПТП, второй выход закрыт",
        ),
    )
    assert resp.status_code not in (401, 403, 422)


@pytest.mark.parametrize("category", ["ptp_mismatch", "other"])
def test_after_the_fact_categories_reject_no_photo_and_no_description(client, category):
    resp = client.post("/reports", json=_base_report(category=category, photos=[]))
    assert resp.status_code == 422


@pytest.mark.parametrize("category", ["ptp_mismatch", "other"])
def test_after_the_fact_categories_reject_a_token_description(client, category):
    # A stray character is not a report — the description has to carry content.
    resp = client.post(
        "/reports",
        json=_base_report(category=category, photos=[], description="  x  "),
    )
    assert resp.status_code == 422


def test_ptp_mismatch_is_a_known_category(client):
    resp = client.post("/reports", json=_base_report(category="ptp_mismatch"))
    assert resp.status_code not in (401, 403, 422)


def test_create_report_rejects_unknown_category(client):
    resp = client.post("/reports", json=_base_report(category="not_a_category"))
    assert resp.status_code == 422


# --- POST /reports: idempotency key ----------------------------------------


def test_create_report_accepts_client_id(client):
    resp = client.post("/reports", json=_base_report(client_id="1754212345678-ab12cd"))
    assert resp.status_code not in (401, 403, 422)


@pytest.mark.parametrize(
    "bad_client_id",
    [
        "id with spaces",
        "../../etc/passwd",
        "id;DROP TABLE field_reports",
        "x" * 65,
    ],
)
def test_create_report_rejects_bad_client_id(client, bad_client_id):
    resp = client.post("/reports", json=_base_report(client_id=bad_client_id))
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "bad_photo_id",
    [
        "not_a_photo_id",
        "../../etc/passwd",
        "visit_short.jpg",
        f"visit_{'0' * 32}.exe",
        "card_" + "0" * 32 + ".jpg",  # wrong prefix — not a visit-photo id
    ],
)
def test_create_report_rejects_bad_photo_id(client, bad_photo_id):
    resp = client.post("/reports", json=_base_report(photos=[bad_photo_id]))
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_lat", [-90.5, 90.5, 200])
def test_create_report_rejects_lat_out_of_range(client, bad_lat):
    resp = client.post("/reports", json=_base_report(lat=bad_lat))
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_lng", [-180.5, 180.5, 999])
def test_create_report_rejects_lng_out_of_range(client, bad_lng):
    resp = client.post("/reports", json=_base_report(lng=bad_lng))
    assert resp.status_code == 422


def test_create_report_valid_body_passes_validation(client):
    """Valid input clears guard + Pydantic validation; the stubbed DB fails
    downstream (no real database here), which is expected — we only assert the
    request wasn't rejected as unauthenticated/forbidden/invalid."""
    resp = client.post("/reports", json=_base_report())
    assert resp.status_code not in (401, 403, 422)


def test_create_report_with_building_id_passes_validation(client):
    resp = client.post("/reports", json=_base_report(building_id=1))
    assert resp.status_code not in (401, 403, 422)


# --- POST /reports/{id}/status: validation ---------------------------------


def test_update_status_rejects_unknown_status(client):
    resp = client.post("/reports/1/status", json={"status": "not_a_status"})
    assert resp.status_code in (400, 422)


def test_update_status_rejects_open_as_a_transition(client):
    # "open" is the initial state only, not a valid manual transition target.
    resp = client.post("/reports/1/status", json={"status": "open"})
    assert resp.status_code in (400, 422)


@pytest.mark.parametrize("status", ["in_progress", "resolved", "dismissed"])
def test_update_status_valid_values_pass_validation(client, status):
    resp = client.post("/reports/1/status", json={"status": status})
    assert resp.status_code not in (401, 403, 422)
