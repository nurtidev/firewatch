"""Owner-portal validation & guard tests: bad input is rejected before it reaches
the database, and role guards hold. No database required — `current_user`/`get_db`
are overridden like in test_guards.py / test_reports.py; only Pydantic-level 422s
and 401/403 guard verdicts are asserted (a valid request fails downstream at the
stubbed DB, which is expected).
"""

import pytest

from app.db import get_db
from app.main import app
from app.routers.auth import current_user

_VALID_OWNER_PHOTO = f"owner_{'0' * 32}.jpg"

# Mutable role holder so a single client can exercise different roles.
_ROLE = {"value": "owner"}


def _fake_current_user() -> dict:
    return {
        "username": "owner1",
        "role": _ROLE["value"],
        "name": "Owner",
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
    _ROLE["value"] = "owner"
    yield
    _ROLE["value"] = "owner"


# --- POST /portal/prescriptions/{id}/remediation: validation ---------------


def test_remediation_rejects_empty_note(client):
    resp = client.post("/portal/prescriptions/1/remediation", json={"note": ""})
    assert resp.status_code == 422


def test_remediation_rejects_blank_note(client):
    resp = client.post("/portal/prescriptions/1/remediation", json={"note": "   "})
    assert resp.status_code == 422


def test_remediation_rejects_missing_note(client):
    resp = client.post("/portal/prescriptions/1/remediation", json={"photos": []})
    assert resp.status_code == 422


def test_remediation_rejects_too_many_photos(client):
    resp = client.post(
        "/portal/prescriptions/1/remediation",
        json={"note": "устранено", "photos": [_VALID_OWNER_PHOTO] * 6},
    )
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "bad_photo_id",
    [
        "not_a_photo_id",
        "../../etc/passwd",
        "owner_short.jpg",
        f"owner_{'0' * 32}.exe",
        f"visit_{'0' * 32}.jpg",  # wrong prefix — a visit photo, not an owner one
    ],
)
def test_remediation_rejects_bad_photo_id(client, bad_photo_id):
    resp = client.post(
        "/portal/prescriptions/1/remediation",
        json={"note": "устранено", "photos": [bad_photo_id]},
    )
    assert resp.status_code == 422


def test_remediation_valid_body_passes_validation(client):
    resp = client.post(
        "/portal/prescriptions/1/remediation",
        json={"note": "нарушение устранено", "photos": [_VALID_OWNER_PHOTO]},
    )
    assert resp.status_code not in (401, 403, 422)


def test_remediation_note_only_passes_validation(client):
    resp = client.post(
        "/portal/prescriptions/1/remediation", json={"note": "устранено"}
    )
    assert resp.status_code not in (401, 403, 422)


# --- POST /portal/prescriptions/{id}/remediation: guard --------------------


@pytest.mark.parametrize("role", ["inspector", "supervisor", "leadership", "admin"])
def test_remediation_forbidden_for_internal_roles(client, role):
    _ROLE["value"] = role
    resp = client.post("/portal/prescriptions/1/remediation", json={"note": "x"})
    assert resp.status_code == 403


@pytest.mark.parametrize("role", ["inspector", "supervisor", "leadership", "admin"])
def test_summary_forbidden_for_internal_roles(client, role):
    _ROLE["value"] = role
    resp = client.get("/portal/summary")
    assert resp.status_code == 403


# --- POST /auth/users: validation (admin role) -----------------------------


def _valid_user(**overrides) -> dict:
    body = {
        "username": "newowner",
        "password": "password123",
        "name": "Owner",
        "role": "owner",
        "building_ids": [1],
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize(
    "bad_username",
    ["ab", "UpperCase", "has space", "экспл", "x" * 51, ""],
)
def test_create_user_rejects_bad_username(client, bad_username):
    _ROLE["value"] = "admin"
    resp = client.post("/auth/users", json=_valid_user(username=bad_username))
    assert resp.status_code == 422


def test_create_user_rejects_short_password(client):
    _ROLE["value"] = "admin"
    resp = client.post("/auth/users", json=_valid_user(password="short"))
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_role", ["inspector", "admin", "supervisor", "leadership", "root"])
def test_create_user_rejects_non_owner_role(client, bad_role):
    _ROLE["value"] = "admin"
    resp = client.post("/auth/users", json=_valid_user(role=bad_role))
    assert resp.status_code == 422


def test_create_user_rejects_empty_building_ids(client):
    _ROLE["value"] = "admin"
    resp = client.post("/auth/users", json=_valid_user(building_ids=[]))
    assert resp.status_code == 422


def test_create_user_valid_body_passes_validation(client):
    _ROLE["value"] = "admin"
    resp = client.post("/auth/users", json=_valid_user())
    assert resp.status_code not in (401, 403, 422)


# --- cards remediation review guard: owner must be forbidden ---------------


def test_owner_cannot_review_remediation(client):
    """The internal review endpoint (inspector/supervisor/admin, router-level)
    must reject an external owner."""
    _ROLE["value"] = "owner"
    resp = client.post(
        "/cards/1/prescriptions/1/remediations/1/review", json={"status": "accepted"}
    )
    assert resp.status_code == 403
