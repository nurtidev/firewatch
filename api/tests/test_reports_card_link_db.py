"""GET /reports · card_id на живом PostGIS: последняя карточка здания,
null без здания, null для роли вне CARD_READ (leadership), и district-скоупинг
supervisor при явном building_id из чужого района («Расхождение с ПТП» →
карточка, /cards → уведомление о донесениях).

Запускается только при FW_RUN_DB_TESTS=1 с DATABASE_URL на PostGIS. Фикстура
удаляет только свои строки (префикс 'card-link-test').
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
_PT = "ST_SetSRID(ST_MakePoint(71.43, 51.13), 4326)"
_PREFIX = "card-link-test"
# supervisor демо-пользователя (seed_users) — Есильский; чужой район для
# проверки district-скоупинга при явном building_id.
_OWN_DISTRICT = "Есильский"
_FOREIGN_DISTRICT = f"{_PREFIX}-foreign"


def _building(conn, district: str) -> int:
    return conn.execute(
        text(
            f"INSERT INTO buildings (address, building_type, district, geom) "
            f"VALUES (:a, 'residential', :d, {_POLY}) RETURNING id"
        ),
        {"a": f"{_PREFIX} addr", "d": district},
    ).scalar()


def _card(conn, building_id: int, filename: str) -> int:
    return conn.execute(
        text(
            "INSERT INTO operational_cards (building_id, filename, media_type, status, extracted) "
            "VALUES (:b, :f, 'application/json', 'extracted', CAST(:ex AS JSONB)) RETURNING id"
        ),
        {"b": building_id, "f": filename, "ex": '{"address": "card-link test"}'},
    ).scalar()


def _report(conn, *, building_id: int | None, district: str | None) -> int:
    return conn.execute(
        text(
            f"""
            INSERT INTO field_reports
                (category, description, geom, building_id, district, photos, created_by, created_role)
            VALUES
                ('ptp_mismatch', 'card-link test', {_PT}, :b, :d, '[]', :by, 'inspector')
            RETURNING id
            """
        ),
        {"b": building_id, "d": district, "by": f"{_PREFIX}-author"},
    ).scalar()


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.db import engine
    from app.main import app
    from scripts import init_db, seed_users

    init_db.main()
    seed_users.main()

    with engine.begin() as conn:
        own_building = _building(conn, _OWN_DISTRICT)
        foreign_building = _building(conn, _FOREIGN_DISTRICT)

        older_card = _card(conn, own_building, f"{_PREFIX}-older.json")
        newer_card = _card(conn, own_building, f"{_PREFIX}-newer.json")

        report_with_card = _report(conn, building_id=own_building, district=_OWN_DISTRICT)
        report_without_building = _report(conn, building_id=None, district=None)
        report_foreign = _report(conn, building_id=foreign_building, district=_FOREIGN_DISTRICT)

    c = TestClient(app)
    c.own_building = own_building              # type: ignore[attr-defined]
    c.foreign_building = foreign_building      # type: ignore[attr-defined]
    c.older_card = older_card                  # type: ignore[attr-defined]
    c.newer_card = newer_card                  # type: ignore[attr-defined]
    c.report_with_card = report_with_card      # type: ignore[attr-defined]
    c.report_without_building = report_without_building  # type: ignore[attr-defined]
    c.report_foreign = report_foreign          # type: ignore[attr-defined]
    yield c

    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM field_reports WHERE id = ANY(:ids)"),
            {"ids": [report_with_card, report_without_building, report_foreign]},
        )
        conn.execute(
            text("DELETE FROM operational_cards WHERE id = ANY(:ids)"),
            {"ids": [older_card, newer_card]},
        )
        conn.execute(
            text("DELETE FROM buildings WHERE id = ANY(:ids)"),
            {"ids": [own_building, foreign_building]},
        )


def _login(client, username: str, password: str) -> dict:
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _report_row(rows: list[dict], report_id: int) -> dict:
    row = next((r for r in rows if r["id"] == report_id), None)
    assert row is not None, f"report {report_id} not in response"
    return row


def test_card_id_is_latest_card_of_building(client):
    headers = _login(client, "dispatcher", "dispatcher123")  # citywide — видит любое здание
    r = client.get(
        "/reports", params={"building_id": client.own_building, "category": "ptp_mismatch"}, headers=headers
    )
    assert r.status_code == 200, r.text
    row = _report_row(r.json(), client.report_with_card)
    assert row["card_id"] == client.newer_card  # последняя по id, не первая созданная


def test_card_id_null_without_building(client):
    headers = _login(client, "dispatcher", "dispatcher123")
    r = client.get("/reports", params={"category": "ptp_mismatch"}, headers=headers)
    row = _report_row(r.json(), client.report_without_building)
    assert row["card_id"] is None


def test_card_id_null_for_role_outside_card_read(client):
    # leadership читает донесения (READ_ROLES), но не карточки (CARD_READ) —
    # card_id обязан быть null, иначе интерфейс предложил бы ссылку на /cards,
    # которую AppShell тут же развернёт обратно.
    headers = _login(client, "minister", "minister123")
    r = client.get(
        "/reports", params={"building_id": client.own_building, "category": "ptp_mismatch"}, headers=headers
    )
    assert r.status_code == 200, r.text
    row = _report_row(r.json(), client.report_with_card)
    assert row["card_id"] is None


def test_supervisor_building_id_from_foreign_district_is_empty(client):
    headers = _login(client, "supervisor", "supervisor123")  # Есильский
    r = client.get(
        "/reports", params={"building_id": client.foreign_building}, headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_supervisor_own_district_building_id_is_visible(client):
    headers = _login(client, "supervisor", "supervisor123")  # Есильский == own_building
    r = client.get(
        "/reports", params={"building_id": client.own_building, "category": "ptp_mismatch"}, headers=headers
    )
    assert r.status_code == 200, r.text
    ids = {row["id"] for row in r.json()}
    assert client.report_with_card in ids
