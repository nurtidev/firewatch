"""End-to-end critical-path test: login → today's route → record a visit.

Runs only when FW_RUN_DB_TESTS=1 and DATABASE_URL points at a PostGIS database
(same gating as test_db_integration). Locally without a database this is skipped,
so `pytest tests/test_unit.py` is unaffected.
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

# The seeded "inspector" user lives in this district; we put a building here so
# the route_today query for that inspector returns at least one stop.
_DISTRICT = "Сарыаркинский"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.db import engine
    from app.main import app
    from scripts import init_db, seed_users

    init_db.main()
    seed_users.main()

    with engine.begin() as conn:
        # Маршрут и визит привязаны к учётной записи через inspectors.user_id
        # (миграция 0013_scoping_links): без связи API правомерно отвечает 403,
        # поэтому строку реестра для пользователя "inspector" здесь создаём или
        # находим по FK, а не по совпадению ФИО.
        uid = conn.execute(
            text("SELECT id FROM users WHERE username = 'inspector'")
        ).scalar()
        iid = conn.execute(
            text("SELECT id FROM inspectors WHERE user_id = :u"), {"u": uid}
        ).scalar()
        if iid is None:
            iid = conn.execute(
                text(
                    "INSERT INTO inspectors (name, district, user_id) "
                    "VALUES ('E2E Инспектор', :d, :u) RETURNING id"
                ),
                {"d": _DISTRICT, "u": uid},
            ).scalar()
        district = conn.execute(
            text("SELECT district FROM inspectors WHERE id = :i"), {"i": iid}
        ).scalar()

        # A scorable building in that district so the route has a stop.
        bid = conn.execute(
            text(
                f"INSERT INTO buildings (address, building_type, district, geom) "
                f"VALUES ('E2E addr', 'residential', :d, {_POLY}) RETURNING id"
            ),
            {"d": district},
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO risk_scores (building_id, score, model_version) "
                "VALUES (:b, 80, 'test')"
            ),
            {"b": bid},
        )

    c = TestClient(app)
    c.inspector_id = iid  # type: ignore[attr-defined]
    return c


def _login(client, username, password):
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_login_route_visit_critical_path(client):
    h = _login(client, "inspector", "inspector123")

    # Today's route for the inspector — at least one stop.
    iid = client.inspector_id  # type: ignore[attr-defined]
    r = client.get(f"/routes/today?inspector_id={iid}", headers=h)
    assert r.status_code == 200, r.text
    stops = r.json()["stops"]
    assert stops, "ожидался хотя бы один объект в маршруте"
    building_id = stops[0]["building_id"]

    # Record a completed visit with a filled checklist.
    r = client.post(
        "/routes/visit",
        headers=h,
        json={
            "inspector_id": iid,
            "building_id": building_id,
            "status": "done",
            "checklist": {"exit_free": True, "alarm": True},
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"

    # The visit now shows on the route.
    r = client.get(f"/routes/today?inspector_id={iid}", headers=h)
    statuses = {s["building_id"]: s["status"] for s in r.json()["stops"]}
    assert statuses.get(building_id) == "done"
