"""GET /dispatch/archive на живом PostGIS: дефолтный статус, фильтры (часть,
тип, период, текстовый поиск с экранированием LIKE-спецсимволов), точность
`matched` и устойчивая пагинация при совпадающих `created_at` (тай-брейкер
по id — без него demo-сиды с одинаковой секундой регистрации дают дубли/
пропуски между страницами).

Запускается только при FW_RUN_DB_TESTS=1 с DATABASE_URL на PostGIS (как
test_scoping/test_city_db). Фикстура удаляет только свои строки (префикс
'arch-test'), общие таблицы не трогает.
"""

import os

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(
    not os.getenv("FW_RUN_DB_TESTS"),
    reason="set FW_RUN_DB_TESTS=1 with a PostGIS DATABASE_URL to run",
)

_PT = "ST_SetSRID(ST_MakePoint(71.43, 51.13), 4326)"
_PREFIX = "arch-test"


def _station(conn, name: str) -> int:
    return conn.execute(
        text(f"INSERT INTO fire_stations (name, geom, vehicles) VALUES (:n, {_PT}, 1) RETURNING id"),
        {"n": name},
    ).scalar()


def _callout(
    conn,
    *,
    station_id: int,
    address: str,
    callout_type: str = "fire",
    status: str = "closed",
    days_ago: float = 1,
) -> int:
    return conn.execute(
        text(
            f"""
            INSERT INTO callouts
                (address, geom, callout_type, status, station_id, created_by, created_at)
            VALUES
                (:addr, {_PT}, :ct, :status, :sid, :by,
                 now() - make_interval(days => :days))
            RETURNING id
            """
        ),
        {
            "addr": address,
            "ct": callout_type,
            "status": status,
            "sid": station_id,
            "by": "arch-test-disp",
            "days": days_ago,
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
        # Отдельный dispatcher-аккаунт для этого файла — не трогаем демо-пароль
        # общего seed_users/dispatcher, если его параллельно меняет другой тест.
        conn.execute(
            text(
                """
                INSERT INTO users (username, password_hash, name, role, district)
                VALUES (:u, :p, 'Архив · тест', 'dispatcher', NULL)
                ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
                """
            ),
            {"u": f"{_PREFIX}-disp", "p": hash_password("archtest12345")},
        )

        station_a = _station(conn, f"{_PREFIX} ПЧ-A")
        station_b = _station(conn, f"{_PREFIX} ПЧ-B")

        # Активный — обязан выпасть из архива по умолчанию (status=closed).
        active_id = _callout(
            conn, station_id=station_a, address=f"{_PREFIX}, актив",
            status="active", days_ago=0,
        )
        # Свежий закрытый на части A, с LIKE-спецсимволами в адресе — проверка
        # экранирования `_like_escape`.
        recent_id = _callout(
            conn, station_id=station_a, address=f"{_PREFIX} 1%_особый",
            callout_type="fire", days_ago=1,
        )
        # Похожий адрес БЕЗ спецсимволов — без экранирования запрос на
        # "1%_особый" совпал бы и с ним через LIKE-подстановку.
        decoy_id = _callout(
            conn, station_id=station_a, address=f"{_PREFIX} 1Xособый",
            callout_type="fire", days_ago=1,
        )
        # Старый закрытый (за пределами days=7) на части A, другой тип вызова.
        old_id = _callout(
            conn, station_id=station_a, address=f"{_PREFIX}, старый",
            callout_type="smoke", days_ago=40,
        )
        # Закрытый на части B — для фильтра station_id.
        station_b_id = _callout(
            conn, station_id=station_b, address=f"{_PREFIX}, часть B",
            days_ago=1,
        )
        all_ids = [active_id, recent_id, decoy_id, old_id, station_b_id]

        # Три выезда с ОДИНАКОВЫМ created_at (до микросекунды) — демо-сиды
        # часто заводятся одним скриптом в одну транзакцию и получают ровно
        # такую коллизию. Без тай-брейкера по id LIMIT/OFFSET между страницами
        # дублирует/теряет строки.
        tied_ids = []
        for i in range(3):
            tied_ids.append(
                _callout(conn, station_id=station_a, address=f"{_PREFIX}, tied {i}", days_ago=2)
            )
        conn.execute(
            text(
                "UPDATE callouts SET created_at = '2026-01-01 12:00:00+00' "
                "WHERE id = ANY(:ids)"
            ),
            {"ids": tied_ids},
        )
        all_ids += tied_ids

    c = TestClient(app)
    c.station_a = station_a          # type: ignore[attr-defined]
    c.station_b = station_b          # type: ignore[attr-defined]
    c.active_id = active_id          # type: ignore[attr-defined]
    c.recent_id = recent_id          # type: ignore[attr-defined]
    c.decoy_id = decoy_id            # type: ignore[attr-defined]
    c.old_id = old_id                # type: ignore[attr-defined]
    c.station_b_id = station_b_id    # type: ignore[attr-defined]
    c.tied_ids = tied_ids            # type: ignore[attr-defined]
    yield c

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM callouts WHERE id = ANY(:ids)"), {"ids": all_ids})
        conn.execute(
            text("DELETE FROM fire_stations WHERE id = ANY(:ids)"),
            {"ids": [station_a, station_b]},
        )
        conn.execute(text("DELETE FROM users WHERE username = :u"), {"u": f"{_PREFIX}-disp"})


def _auth(client) -> dict:
    r = client.post("/auth/login", json={"username": f"{_PREFIX}-disp", "password": "archtest12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_default_status_excludes_active(client):
    headers = _auth(client)
    r = client.get("/dispatch/archive?limit=100", headers=headers)
    assert r.status_code == 200, r.text
    ids = {c["id"] for c in r.json()["callouts"]}
    assert client.active_id not in ids
    assert client.recent_id in ids


def test_filters_by_station(client):
    headers = _auth(client)
    r = client.get(f"/dispatch/archive?station_id={client.station_a}&limit=100", headers=headers)
    ids = {c["id"] for c in r.json()["callouts"]}
    assert client.station_b_id not in ids
    assert client.recent_id in ids


def test_filters_by_callout_type(client):
    headers = _auth(client)
    r = client.get("/dispatch/archive?callout_type=smoke&limit=100", headers=headers)
    ids = {c["id"] for c in r.json()["callouts"]}
    assert ids == {client.old_id}


def test_filters_by_days(client):
    headers = _auth(client)
    r = client.get("/dispatch/archive?days=7&limit=100", headers=headers)
    ids = {c["id"] for c in r.json()["callouts"]}
    assert client.old_id not in ids  # 40 дней назад — за пределами окна
    assert client.recent_id in ids


def test_q_escapes_like_wildcards(client):
    headers = _auth(client)
    r = client.get(
        "/dispatch/archive",
        params={"q": f"{_PREFIX} 1%_особый", "limit": 100},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    ids = {c["id"] for c in r.json()["callouts"]}
    # Совпадает только буквальный адрес с '%' и '_' — без экранирования сюда
    # попал бы и decoy_id (LIKE читал бы '%'/'_' как подстановочные символы).
    assert client.recent_id in ids
    assert client.decoy_id not in ids


def test_matched_reflects_filtered_count_not_page_size(client):
    headers = _auth(client)
    r = client.get(
        f"/dispatch/archive?station_id={client.station_a}&limit=2&offset=0", headers=headers
    )
    body = r.json()
    assert len(body["callouts"]) == 2
    # recent + decoy + old + 3 tied — все закрытые на части A; активный
    # (active_id) на той же части не считается (дефолтный status=closed).
    assert body["matched"] == 6


def test_stable_pagination_with_equal_created_at(client):
    """Три выезда с одинаковым created_at листаются по одному без дублей и
    пропусков — гарантирует тай-брейкер `ORDER BY created_at DESC, id DESC`."""
    headers = _auth(client)
    seen: list[int] = []
    for offset in range(3):
        r = client.get(
            "/dispatch/archive",
            params={"q": f"{_PREFIX}, tied", "limit": 1, "offset": offset},
            headers=headers,
        )
        rows = r.json()["callouts"]
        assert len(rows) == 1, (offset, rows)
        seen.append(rows[0]["id"])
    assert sorted(seen) == sorted(client.tied_ids)
    assert len(set(seen)) == 3  # ни одного дубля
    assert seen == sorted(client.tied_ids, reverse=True)  # id DESC — детерминированный порядок
