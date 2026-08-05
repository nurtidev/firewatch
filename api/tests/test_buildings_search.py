"""`GET /buildings/search` — поиск объекта по адресу вне пульта ЦОУ (карта и т.п.).

Начальнику отдела, которому позвонили «почему на Тәуелсіздік 33 не закрыты
нарушения», раньше найти объект было не через что: на карте только три
`<select>`. Эндпоинт переиспользует нормализацию диакритики из
`app.routers.dispatch` (`norm_addr`/`_digit_variant`/`_like_escape` — импортом,
без второй копии таблицы свёртки) и добавляет то, чего нет у `/dispatch/search`:
district-скоуп для inspector/supervisor и координаты центроида для
центрирования карты.

Запускается только при FW_RUN_DB_TESTS=1 с DATABASE_URL на PostGIS (как
test_scoping/test_db_integration). Локально без базы тесты пропускаются.
"""

import os

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    not os.getenv("FW_RUN_DB_TESTS"),
    reason="set FW_RUN_DB_TESTS=1 with a PostGIS DATABASE_URL to run",
)

# `buildings.geom` — Polygon (footprint), не Point: маленький квадрат вдали от
# демо-данных, с центроидом ровно (72.5, 52.5) — чтобы проверить lat/lng.
_POLY = (
    "ST_SetSRID(ST_GeomFromText("
    "'POLYGON((72.4995 52.4995,72.5005 52.4995,72.5005 52.5005,"
    "72.4995 52.5005,72.4995 52.4995))'),4326)"
)
_LAT, _LNG = 52.5, 72.5

# Районы демо-пользователей (см. test_scoping.py): inspector — Сарыаркинский,
# supervisor — Есильский.
_OWN = "Сарыаркинский"
_FOREIGN = "Алматинский"

_ADDR = "Тестовая Әлем көшесі 501"
_ADDR_NORM_QUERY = "тестовая алем кошеси 501"  # то же, с русской раскладки


def _building(conn, district: str, address: str, alias: str | None = None) -> int:
    return conn.execute(
        text(
            "INSERT INTO buildings (address, alias, building_type, district, geom) "
            f"VALUES (:a, :alias, 'residential', :d, {_POLY}) RETURNING id"
        ),
        {"a": address, "alias": alias, "d": district},
    ).scalar()


@pytest.fixture
def own_building():
    from app.db import engine

    with engine.begin() as conn:
        bid = _building(conn, _OWN, _ADDR, alias="Народный ЖК «Тестовый»")
    yield bid
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM buildings WHERE id = :b"), {"b": bid})


@pytest.fixture
def foreign_building():
    from app.db import engine

    with engine.begin() as conn:
        bid = _building(conn, _FOREIGN, "Тестовая Шыдырту көшесі 12")
    yield bid
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM buildings WHERE id = :b"), {"b": bid})


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    from scripts import init_db, seed_users

    # На чистой базе (как в CI) таблиц и демо-учёток ещё нет: без этого
    # фикстуры зданий падают на «relation "buildings" does not exist», а логины
    # — на отсутствующих пользователях. Оба скрипта идемпотентны.
    init_db.main()
    seed_users.main()

    with TestClient(app) as c:
        yield c


def _login(client, username, password):
    r = client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


# --- нормализация диакритики -------------------------------------------------


def test_search_finds_diacritic_free_query(client, own_building):
    # Печатается с русской раскладки (нет ә/і), находит казахский адрес в БД —
    # ровно тот случай, который аудит требовал починить.
    h = _login(client, "admin", "admin123")
    r = client.get("/buildings/search", params={"q": _ADDR_NORM_QUERY}, headers=h)
    assert r.status_code == 200
    ids = [b["id"] for b in r.json()]
    assert own_building in ids


def test_search_finds_by_alias(client, own_building):
    # Народное название комплекса — тот же путь поиска, что и по адресу.
    h = _login(client, "admin", "admin123")
    r = client.get("/buildings/search", params={"q": "Тестовый"}, headers=h)
    ids = [b["id"] for b in r.json()]
    assert own_building in ids


def test_search_returns_centroid_for_map_centering(client, own_building):
    h = _login(client, "admin", "admin123")
    r = client.get("/buildings/search", params={"q": _ADDR_NORM_QUERY}, headers=h)
    row = next(b for b in r.json() if b["id"] == own_building)
    assert row["lat"] == pytest.approx(_LAT, abs=1e-6)
    assert row["lng"] == pytest.approx(_LNG, abs=1e-6)


def test_search_empty_query_returns_empty_list(client):
    h = _login(client, "admin", "admin123")
    r = client.get("/buildings/search", params={"q": ""}, headers=h)
    assert r.status_code == 200
    assert r.json() == []


# --- district-скоуп: не в /dispatch/search, но обязателен здесь -------------


def test_supervisor_does_not_find_foreign_district(client, foreign_building):
    # supervisor — Есильский; здание заведено в Алматинском.
    h = _login(client, "supervisor", "supervisor123")
    r = client.get(
        "/buildings/search", params={"q": "тестовая шыдырту 12"}, headers=h
    )
    ids = [b["id"] for b in r.json()]
    assert foreign_building not in ids


def test_inspector_does_not_find_foreign_district(client, foreign_building):
    # inspector — Сарыаркинский; тоже не Алматинский.
    h = _login(client, "inspector", "inspector123")
    r = client.get(
        "/buildings/search", params={"q": "тестовая шыдырту 12"}, headers=h
    )
    ids = [b["id"] for b in r.json()]
    assert foreign_building not in ids


def test_inspector_finds_own_district(client, own_building):
    # own_building заведён в Сарыаркинском — то же, что у inspector.
    h = _login(client, "inspector", "inspector123")
    r = client.get("/buildings/search", params={"q": _ADDR_NORM_QUERY}, headers=h)
    ids = [b["id"] for b in r.json()]
    assert own_building in ids


def test_admin_finds_any_district(client, foreign_building):
    h = _login(client, "admin", "admin123")
    r = client.get(
        "/buildings/search", params={"q": "тестовая шыдырту 12"}, headers=h
    )
    ids = [b["id"] for b in r.json()]
    assert foreign_building in ids


def test_leadership_finds_any_district(client, foreign_building):
    h = _login(client, "minister", "minister123")
    r = client.get(
        "/buildings/search", params={"q": "тестовая шыдырту 12"}, headers=h
    )
    ids = [b["id"] for b in r.json()]
    assert foreign_building in ids
