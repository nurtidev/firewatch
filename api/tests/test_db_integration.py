"""End-to-end DB tests: migrations, district scoping, audit trail.

Runs only when FW_RUN_DB_TESTS=1 and DATABASE_URL points at a PostGIS database
(set in CI). Locally without a database these are skipped.
"""

import os

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    not os.getenv("FW_RUN_DB_TESTS"),
    reason="set FW_RUN_DB_TESTS=1 with a PostGIS DATABASE_URL to run",
)

_POLY = (
    "ST_SetSRID(ST_GeomFromText("
    "'POLYGON((71 51,71.001 51,71.001 51.001,71 51.001,71 51))'),4326)"
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.db import engine
    from app.main import app
    from scripts import init_db, seed_users

    init_db.main()
    seed_users.main()

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM risk_scores"))
        conn.execute(text("DELETE FROM buildings"))
        conn.execute(text("DELETE FROM audit_log"))
        for district, n, score in [("Сарыаркинский", 3, 80), ("Есильский", 2, 80)]:
            for _ in range(n):
                bid = conn.execute(
                    text(
                        f"INSERT INTO buildings (address, building_type, district, geom) "
                        f"VALUES ('addr', 'residential', :d, {_POLY}) RETURNING id"
                    ),
                    {"d": district},
                ).scalar()
                conn.execute(
                    text(
                        "INSERT INTO risk_scores (building_id, score, model_version) "
                        "VALUES (:b, :s, 'test')"
                    ),
                    {"b": bid, "s": score},
                )
    return TestClient(app)


def _login(client, username, password):
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_inspector_is_scoped_to_own_district(client):
    h = _login(client, "inspector", "inspector123")
    ov = client.get("/overview", headers=h).json()
    assert ov["buildings"] == 3  # only Сарыаркинский
    assert ov["high_risk"] == 3
    feats = client.get("/buildings", headers=h).json()["features"]
    assert len(feats) == 3


def test_admin_sees_all_districts(client):
    h = _login(client, "admin", "admin123")
    ov = client.get("/overview", headers=h).json()
    assert ov["buildings"] == 5  # whole city
    feats = client.get("/buildings", headers=h).json()["features"]
    assert len(feats) == 5


def test_inspector_cannot_bypass_scope_via_filter(client):
    h = _login(client, "inspector", "inspector123")
    # Asking for another district must still return only the inspector's own.
    feats = client.get("/buildings?district=Есильский", headers=h).json()["features"]
    assert len(feats) == 0


def test_login_is_audited(client):
    from app.db import engine

    client.post("/auth/login", json={"username": "inspector", "password": "WRONG"})
    with engine.connect() as conn:
        ok = conn.execute(
            text("SELECT count(*) FROM audit_log WHERE action = 'login.success'")
        ).scalar()
        bad = conn.execute(
            text("SELECT count(*) FROM audit_log WHERE action = 'login.failed'")
        ).scalar()
    assert ok >= 1 and bad >= 1
