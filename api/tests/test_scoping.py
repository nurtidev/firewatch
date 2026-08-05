"""Скоупинг по району и защита от IDOR: маршруты, визиты, оперкарточки.

Проверяется то, что нельзя проверить на заглушке БД: пользователь одного района
не получает данные другого, а `inspector_id` из запроса не определяет авторство
акта (визит записывается от имени учётной записи, чужой id → 403).

Запускается только при FW_RUN_DB_TESTS=1 с DATABASE_URL на PostGIS (как
test_e2e/test_db_integration). Локально без базы тесты пропускаются.
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

# Районы демо-пользователей: inspector — Сарыаркинский, supervisor — Есильский.
_OWN = "Сарыаркинский"
_FOREIGN = "Алматинский"
_SUPERVISED = "Есильский"

# Учётная запись инспектора без строки в реестре — проверка fail closed.
_UNLINKED = ("inspector_nolink", "nolink12345")


def _building(conn, district: str) -> int:
    bid = conn.execute(
        text(
            f"INSERT INTO buildings (address, building_type, district, last_inspected, geom) "
            f"VALUES ('scoping addr', 'residential', :d, CURRENT_DATE - 400, {_POLY}) "
            f"RETURNING id"
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
    return bid


def _inspector(conn, name: str, district: str, user_id: int | None = None) -> int:
    return conn.execute(
        text(
            "INSERT INTO inspectors (name, district, user_id) "
            "VALUES (:n, :d, :u) RETURNING id"
        ),
        {"n": name, "d": district, "u": user_id},
    ).scalar()


def _card(conn, district: str, building_id: int | None, filename: str) -> int:
    return conn.execute(
        text(
            "INSERT INTO operational_cards "
            "(building_id, filename, media_type, status, extracted, district) "
            "VALUES (:b, :f, 'application/json', 'extracted', "
            "CAST(:ex AS JSONB), :d) RETURNING id"
        ),
        {
            "b": building_id,
            "f": filename,
            "ex": '{"address": "scoping card"}',
            "d": district,
        },
    ).scalar()


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.auth import hash_password
    from app.db import engine
    from app.main import app
    from scripts import init_db, seed_users

    init_db.main()
    seed_users.main()

    with engine.begin() as conn:
        uid = conn.execute(
            text("SELECT id FROM users WHERE username = 'inspector'")
        ).scalar()
        # Учётная запись инспектора без записи в реестре (нет FK) — ей всё закрыто.
        conn.execute(
            text(
                """
                INSERT INTO users (username, password_hash, name, role, district)
                VALUES (:u, :p, 'Инспектор без реестра', 'inspector', :d)
                ON CONFLICT (username) DO UPDATE
                   SET password_hash = EXCLUDED.password_hash,
                       role = EXCLUDED.role,
                       district = EXCLUDED.district
                """
            ),
            {"u": _UNLINKED[0], "p": hash_password(_UNLINKED[1]), "d": _OWN},
        )

        # Строка реестра, привязанная к учётной записи `inspector`. Локально она
        # уже создана миграцией 0013 — тогда переиспользуем её (user_id уникален).
        own_id = conn.execute(
            text("SELECT id FROM inspectors WHERE user_id = :u"), {"u": uid}
        ).scalar()
        if own_id is None:
            own_id = _inspector(conn, "Скоупинг · свой", _OWN, uid)
        own_district = conn.execute(
            text("SELECT district FROM inspectors WHERE id = :i"), {"i": own_id}
        ).scalar()

        foreign_id = _inspector(conn, "Скоупинг · чужой район", _FOREIGN)
        supervised_id = _inspector(conn, "Скоупинг · район супервайзера", _SUPERVISED)

        own_building = _building(conn, own_district)
        foreign_building = _building(conn, _FOREIGN)

        own_card = _card(conn, None, own_building, "scoping_own.json")
        foreign_card = _card(conn, None, foreign_building, "scoping_foreign.json")
        # Загруженный PDF без привязки к зданию: район зафиксирован при загрузке.
        upload_card = _card(conn, own_district, None, "scoping_upload.pdf")

        conn.execute(
            text("DELETE FROM inspection_visits WHERE inspector_id = ANY(:ids)"),
            {"ids": [own_id, foreign_id, supervised_id]},
        )

    c = TestClient(app)
    c.own_id = own_id                    # type: ignore[attr-defined]
    c.foreign_id = foreign_id            # type: ignore[attr-defined]
    c.supervised_id = supervised_id      # type: ignore[attr-defined]
    c.own_building = own_building        # type: ignore[attr-defined]
    c.foreign_building = foreign_building  # type: ignore[attr-defined]
    c.own_card = own_card                # type: ignore[attr-defined]
    c.foreign_card = foreign_card        # type: ignore[attr-defined]
    c.upload_card = upload_card          # type: ignore[attr-defined]
    yield c

    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM inspection_visits WHERE inspector_id = ANY(:ids)"),
            {"ids": [own_id, foreign_id, supervised_id]},
        )
        conn.execute(
            text("DELETE FROM operational_cards WHERE filename LIKE 'scoping_%'")
        )
        conn.execute(
            text("DELETE FROM inspectors WHERE id = ANY(:ids)"),
            {"ids": [foreign_id, supervised_id]},
        )
        conn.execute(text("DELETE FROM users WHERE username = :u"), {"u": _UNLINKED[0]})


def _login(client, username, password):
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _visit_row(inspector_id: int, building_id: int):
    from app.db import engine

    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT inspector_id FROM inspection_visits "
                "WHERE building_id = :b AND visit_date = CURRENT_DATE "
                "AND inspector_id = :i"
            ),
            {"b": building_id, "i": inspector_id},
        ).scalar()


# --- GET /inspectors: реестр в границах района -------------------------------


def test_inspector_sees_only_own_roster_entry(client):
    h = _login(client, "inspector", "inspector123")
    rows = client.get("/inspectors", headers=h).json()
    assert [r["id"] for r in rows] == [client.own_id]


def test_supervisor_sees_only_own_district_inspectors(client):
    h = _login(client, "supervisor", "supervisor123")
    rows = client.get("/inspectors", headers=h).json()
    assert rows, "супервайзер должен видеть инспекторов своего района"
    assert {r["district"] for r in rows} == {_SUPERVISED}
    ids = [r["id"] for r in rows]
    assert client.foreign_id not in ids and client.own_id not in ids


def test_admin_sees_the_whole_roster(client):
    h = _login(client, "admin", "admin123")
    ids = [r["id"] for r in client.get("/inspectors", headers=h).json()]
    assert {client.own_id, client.foreign_id, client.supervised_id} <= set(ids)


def test_inspector_without_roster_link_sees_nobody(client):
    h = _login(client, *_UNLINKED)
    assert client.get("/inspectors", headers=h).json() == []


# --- GET /routes/today: IDOR по inspector_id ---------------------------------


def test_route_today_denies_foreign_inspector_id(client):
    h = _login(client, "inspector", "inspector123")
    r = client.get(f"/routes/today?inspector_id={client.foreign_id}", headers=h)
    assert r.status_code == 403, r.text


def test_route_today_defaults_to_own_inspector(client):
    h = _login(client, "inspector", "inspector123")
    r = client.get("/routes/today", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["inspector"]["id"] == client.own_id


def test_route_today_denies_unlinked_account(client):
    h = _login(client, *_UNLINKED)
    assert client.get("/routes/today", headers=h).status_code == 403


def test_supervisor_route_is_limited_to_own_district(client):
    h = _login(client, "supervisor", "supervisor123")
    assert (
        client.get(f"/routes/today?inspector_id={client.own_id}", headers=h).status_code
        == 403
    )
    r = client.get(f"/routes/today?inspector_id={client.supervised_id}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["district"] == _SUPERVISED


def test_admin_may_open_any_inspector_route(client):
    h = _login(client, "admin", "admin123")
    r = client.get(f"/routes/today?inspector_id={client.foreign_id}", headers=h)
    assert r.status_code == 200, r.text


# --- POST /routes/visit: авторство акта --------------------------------------


def test_visit_cannot_be_signed_for_another_inspector(client):
    h = _login(client, "inspector", "inspector123")
    r = client.post(
        "/routes/visit",
        headers=h,
        json={
            "inspector_id": client.foreign_id,
            "building_id": client.own_building,
            "status": "done",
        },
    )
    assert r.status_code == 403, r.text
    assert _visit_row(client.foreign_id, client.own_building) is None


def test_visit_authorship_comes_from_the_account(client):
    h = _login(client, "inspector", "inspector123")
    r = client.post(
        "/routes/visit",
        headers=h,
        json={"building_id": client.own_building, "status": "done"},
    )
    assert r.status_code == 200, r.text
    assert _visit_row(client.own_id, client.own_building) == client.own_id


def test_visit_rejects_building_from_another_district(client):
    h = _login(client, "inspector", "inspector123")
    r = client.post(
        "/routes/visit",
        headers=h,
        json={
            "inspector_id": client.own_id,
            "building_id": client.foreign_building,
            "status": "done",
        },
    )
    assert r.status_code == 403, r.text
    assert _visit_row(client.own_id, client.foreign_building) is None


# --- /cards: оперкарточки (ПТП с ПДн) в границах района ----------------------


def test_cards_list_is_district_scoped(client):
    h = _login(client, "inspector", "inspector123")
    ids = {c["id"] for c in client.get("/cards", headers=h).json()}
    assert client.own_card in ids
    assert client.upload_card in ids  # загруженный PDF своего района
    assert client.foreign_card not in ids

    h = _login(client, "supervisor", "supervisor123")
    ids = {c["id"] for c in client.get("/cards", headers=h).json()}
    assert not ({client.own_card, client.foreign_card, client.upload_card} & ids)


@pytest.mark.parametrize(
    "creds",
    [("dispatcher", "dispatcher123"), ("responder", "responder123"), ("admin", "admin123")],
)
def test_citywide_roles_still_see_every_card(client, creds):
    """Боевые роли и admin читают ПТП любого объекта города — это их работа."""
    h = _login(client, *creds)
    ids = {c["id"] for c in client.get("/cards", headers=h).json()}
    assert {client.own_card, client.foreign_card, client.upload_card} <= ids


def test_card_detail_of_another_district_is_hidden(client):
    h = _login(client, "inspector", "inspector123")
    assert client.get(f"/cards/{client.foreign_card}", headers=h).status_code == 404
    assert client.get(f"/cards/{client.own_card}", headers=h).status_code == 200
    # Файл оригинала — тот же скоуп (карточка без файла даёт 404 в любом случае).
    assert client.get(f"/cards/{client.foreign_card}/file", headers=h).status_code == 404


def test_card_of_another_district_cannot_be_deleted(client):
    h = _login(client, "inspector", "inspector123")
    assert client.delete(f"/cards/{client.foreign_card}", headers=h).status_code == 404
    from app.db import engine

    with engine.connect() as conn:
        still_there = conn.execute(
            text("SELECT 1 FROM operational_cards WHERE id = :i"),
            {"i": client.foreign_card},
        ).scalar()
    assert still_there == 1
