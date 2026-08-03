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


def _band(ov, key):
    return next(b for b in ov["risk_bands"] if b["key"] == key)


def test_supervisor_is_scoped_to_own_district(client):
    # /overview is restricted to supervisor/leadership/admin (inspector gets
    # 403) — supervisor is the scoped role that can actually call it, and the
    # seed user's district is Есильский (2 buildings, score 80 -> "critical").
    h = _login(client, "supervisor", "supervisor123")
    ov = client.get("/overview", headers=h).json()
    assert ov["buildings"] == 2  # only Есильский
    assert _band(ov, "critical")["count"] == 2
    assert _band(ov, "high")["count"] == 0
    feats = client.get("/buildings", headers=h).json()["features"]
    assert len(feats) == 2


def test_admin_sees_all_districts(client):
    h = _login(client, "admin", "admin123")
    ov = client.get("/overview", headers=h).json()
    assert ov["buildings"] == 5  # whole city
    assert _band(ov, "critical")["count"] == 5  # score 80 for every seeded row
    feats = client.get("/buildings", headers=h).json()["features"]
    assert len(feats) == 5


def test_overview_risk_bands_match_buildings_filter(client):
    # The whole point of the fix: whatever /overview reports per band must be
    # exactly what GET /buildings?risk=<key> returns for the same token — no
    # second set of thresholds, no "72 vs 302" surprise for leadership.
    h = _login(client, "admin", "admin123")
    ov = client.get("/overview", headers=h).json()
    keys = {b["key"] for b in ov["risk_bands"]}
    assert keys == {"critical", "high", "mid", "low"}
    for band in ov["risk_bands"]:
        feats = client.get(f"/buildings?risk={band['key']}", headers=h).json()["features"]
        assert len(feats) == band["count"], band["key"]


def test_inspector_cannot_bypass_scope_via_filter(client):
    h = _login(client, "inspector", "inspector123")
    # Asking for another district must still return only the inspector's own.
    feats = client.get("/buildings?district=Есильский", headers=h).json()["features"]
    assert len(feats) == 0


def test_queued_report_replay_does_not_duplicate(client):
    """Офлайн-очередь донесений доставляет «хотя бы один раз».

    Устройство повторяет POST, пока не увидит ответ, поэтому один и тот же
    client_id приходит дважды: второй раз сервер обязан вернуть уже созданное
    донесение, а не завести второе. Без этого потеря ответа при возврате связи
    превращается в дубль в очереди на разбор.
    """
    from app.db import engine

    h = _login(client, "inspector", "inspector123")
    body = {
        "category": "ptp_mismatch",
        "description": "Планировка 14 этажа не совпала с ПТП, второй выход закрыт",
        "lat": 51.128,
        "lng": 71.43,
        "client_id": "test-replay-0001",
        "photos": [],
    }

    first = client.post("/reports", json=body, headers=h)
    assert first.status_code == 200, first.text
    replay = client.post("/reports", json=body, headers=h)
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == first.json()["id"]

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT count(*) FROM field_reports WHERE client_id = :c"),
            {"c": body["client_id"]},
        ).scalar()
    assert rows == 1

    # Без client_id (старый клиент) поведение прежнее — каждая отправка новая.
    legacy = {k: v for k, v in body.items() if k != "client_id"}
    a = client.post("/reports", json=legacy, headers=h)
    b = client.post("/reports", json=legacy, headers=h)
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["id"] != b.json()["id"]


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
