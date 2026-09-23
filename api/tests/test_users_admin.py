"""Администрирование учётных записей: приём, отключение, включение, сброс пароля.

Два блока:

1. Guard-тесты без базы — новые эндпоинты доступны только роли `admin`
   (все остальные роли, включая leadership, получают 403).
2. Полный жизненный цикл на живой базе (FW_RUN_DB_TESTS=1) — главный сценарий
   аттестации: уволенный сотрудник не входит ни старым токеном, ни паролем.

Тесты заводят только собственные учётные записи с префиксом `zz_test_` и
удаляют их за собой; демо-учётки (inspector/admin/…) не трогаются.
"""

import os

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from app.db import get_db
from app.main import app
from app.routers.auth import UserCreate, current_user

ALL_ROLES = (
    "inspector", "supervisor", "leadership", "admin",
    "dispatcher", "responder", "owner",
)

# Учётные записи, которые создают тесты (удаляются в teardown).
_ADMIN = ("zz_test_admin", "zz_admin_pass_1")
_STAFF = ("zz_test_inspector", "zz_staff_pass_1")
_STAFF_NEW_PASS = "zz_staff_pass_2"
_DISTRICT = "Алматинский"
_RESPONDER = ("zz_test_responder", "zz_responder_pass_1")


# ─────────────────────────── 1. Guards (без базы) ───────────────────────────

_ROLE = {"value": "admin"}


def _fake_current_user() -> dict:
    return {
        "username": "tester",
        "role": _ROLE["value"],
        "name": "Tester",
        "district": "Сарыаркинский",
    }


def _fake_get_db():
    yield None


@pytest.fixture(scope="module")
def _stub_client():
    from fastapi.testclient import TestClient

    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture
def guard_client(_stub_client):
    """Клиент с подменёнными current_user/get_db — только на время одного теста.

    Подмена снимается сразу после теста: иначе блок с живой базой ниже получил
    бы заглушку вместо сессии (порядок модульных фикстур этого не гарантирует).
    """
    app.dependency_overrides[current_user] = _fake_current_user
    app.dependency_overrides[get_db] = _fake_get_db
    yield _stub_client
    app.dependency_overrides.pop(current_user, None)
    app.dependency_overrides.pop(get_db, None)


# (id, method, path, body) — все операции над учётными записями admin-only.
ADMIN_ONLY = [
    ("list", "GET", "/auth/users", None),
    ("create", "POST", "/auth/users",
     {"username": "zz_guard", "password": "guardpass1", "name": "Г", "role": "leadership"}),
    ("disable", "POST", "/auth/users/zz_guard/disable", {}),
    ("enable", "POST", "/auth/users/zz_guard/enable", {}),
    ("password", "POST", "/auth/users/zz_guard/password", {"password": "guardpass2"}),
    ("station", "PATCH", "/auth/users/zz_guard/station", {"station_id": 1}),
]


@pytest.mark.parametrize("name,method,path,body", ADMIN_ONLY, ids=[e[0] for e in ADMIN_ONLY])
@pytest.mark.parametrize("role", ALL_ROLES)
def test_user_admin_endpoints_are_admin_only(guard_client, name, method, path, body, role):
    _ROLE["value"] = role
    if method == "GET":
        res = guard_client.get(path)
    elif method == "PATCH":
        res = guard_client.patch(path, json=body or {})
    else:
        res = guard_client.post(path, json=body or {})
    if role == "admin":
        # Дальше падает на заглушке базы (500) — важно, что не 401/403.
        assert res.status_code not in (401, 403), res.text
    else:
        assert res.status_code == 403, f"{role} → {res.status_code}"


# ─────────────── 1b. Валидация станции в модели (без базы) ──────────────────


def _new_user(**overrides) -> dict:
    base = {"username": "zz_valid", "password": "passpass1", "name": "Т", "role": "responder"}
    base.update(overrides)
    return base


def test_station_rejected_for_non_responder_role():
    with pytest.raises(ValidationError, match="station_id"):
        UserCreate(**_new_user(role="dispatcher", station_id=3))


def test_station_none_ok_for_non_responder_role():
    u = UserCreate(**_new_user(role="dispatcher", station_id=None))
    assert u.station_id is None


def test_station_allowed_for_responder():
    u = UserCreate(**_new_user(role="responder", station_id=3))
    assert u.station_id == 3


def test_owner_station_forced_none_even_if_sent():
    """Владелец получает и district, и station_id принудительно пустыми —

    зеркалит уже существующее правило для district: поле роли, которой
    станция не касается, не должно молча остаться в теле."""
    u = UserCreate(**_new_user(role="owner", station_id=3, building_ids=[1]))
    assert u.station_id is None


def test_current_user_rejects_disabled_account():
    """Отключённая учётная запись не проходит `current_user` даже с валидным токеном.

    Проверка именно здесь, а не только в `login`: токен, выданный до отключения,
    иначе дожил бы до истечения срока.
    """

    class _Result:
        def mappings(self):
            return self

        def first(self):
            return {"sessions_revoked_at": None, "is_active": False}

    class _Db:
        def execute(self, *_args, **_kwargs):
            return _Result()

        def rollback(self):
            """current_user возвращает соединение в пул сразу после проверки."""

    class _Req:
        query_params: dict = {}

    from app.auth import create_token

    token = create_token("zz_disabled", "inspector", "Отключённый", _DISTRICT)

    with pytest.raises(HTTPException) as err:
        current_user(_Req(), f"Bearer {token}", _Db())
    assert err.value.status_code == 401
    assert "отключена" in err.value.detail.lower()


# ───────────────────── 2. Жизненный цикл (на живой базе) ─────────────────────

db_only = pytest.mark.skipif(
    not os.getenv("FW_RUN_DB_TESTS"),
    reason="set FW_RUN_DB_TESTS=1 with a PostGIS DATABASE_URL to run",
)


@pytest.fixture(scope="module")
def client():
    if not os.getenv("FW_RUN_DB_TESTS"):
        pytest.skip("нужна живая база (FW_RUN_DB_TESTS=1)")

    from fastapi.testclient import TestClient

    from app.auth import hash_password
    from app.db import engine

    with engine.begin() as conn:
        _cleanup(conn)
        conn.execute(
            text(
                "INSERT INTO users (username, password_hash, name, role, district) "
                "VALUES (:u, :p, 'Тестовый администратор', 'admin', NULL)"
            ),
            {"u": _ADMIN[0], "p": hash_password(_ADMIN[1])},
        )

    c = TestClient(app)
    r = c.post("/auth/login", json={"username": _ADMIN[0], "password": _ADMIN[1]})
    assert r.status_code == 200, r.text
    c.admin = {"Authorization": f"Bearer {r.json()['token']}"}  # type: ignore[attr-defined]
    yield c

    with engine.begin() as conn:
        _cleanup(conn)


def _cleanup(conn) -> None:
    """Убрать за собой: строки реестра, привязки и сами учётные записи."""
    names = [_ADMIN[0], _STAFF[0], _RESPONDER[0]]
    conn.execute(
        text(
            "DELETE FROM inspectors WHERE user_id IN "
            "(SELECT id FROM users WHERE username = ANY(:n))"
        ),
        {"n": names},
    )
    conn.execute(
        text(
            "DELETE FROM owner_buildings WHERE user_id IN "
            "(SELECT id FROM users WHERE username = ANY(:n))"
        ),
        {"n": names},
    )
    conn.execute(text("DELETE FROM users WHERE username = ANY(:n)"), {"n": names})


@db_only
def test_admin_creates_inspector_linked_to_registry(client):
    """Заведение инспектора создаёт и связывает строку реестра.

    Без связи `inspectors.user_id` новый сотрудник получил бы 403 на своём же
    маршруте (app/access.py::resolve_inspector).
    """
    r = client.post(
        "/auth/users",
        headers=client.admin,
        json={
            "username": _STAFF[0],
            "password": _STAFF[1],
            "name": "Тестов Т.Т.",
            "role": "inspector",
            "district": _DISTRICT,
        },
    )
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["district"] == _DISTRICT
    assert created["inspector_id"] is not None

    # Новый сотрудник входит и видит СВОЙ маршрут (не 403), в своём районе.
    tok = client.post(
        "/auth/login", json={"username": _STAFF[0], "password": _STAFF[1]}
    ).json()["token"]
    route = client.get("/routes/today", headers={"Authorization": f"Bearer {tok}"})
    assert route.status_code == 200, route.text
    assert route.json()["inspector"]["id"] == created["inspector_id"]
    assert route.json()["district"] == _DISTRICT

    # Чужой маршрут — 403 (id из запроса не определяет авторство).
    other = client.get(
        "/routes/today?inspector_id=999999", headers={"Authorization": f"Bearer {tok}"}
    )
    assert other.status_code == 403

    # Повторный логин занят.
    dup = client.post(
        "/auth/users",
        headers=client.admin,
        json={
            "username": _STAFF[0], "password": _STAFF[1],
            "name": "Дубль", "role": "inspector", "district": _DISTRICT,
        },
    )
    assert dup.status_code == 409


@db_only
def test_create_validates_role_and_district(client):
    bad = [
        # роль вне списка
        {"username": "zz_bad1", "password": "passpass1", "name": "Х", "role": "root"},
        # инспектору обязателен район
        {"username": "zz_bad2", "password": "passpass1", "name": "Х", "role": "inspector"},
        # несуществующий район
        {"username": "zz_bad3", "password": "passpass1", "name": "Х",
         "role": "supervisor", "district": "Караганда"},
        # владельцу обязательны объекты
        {"username": "zz_bad4", "password": "passpass1", "name": "Х", "role": "owner"},
        # объекты только для владельца
        {"username": "zz_bad5", "password": "passpass1", "name": "Х",
         "role": "leadership", "building_ids": [1]},
        # короткий пароль
        {"username": "zz_bad6", "password": "123", "name": "Х", "role": "leadership"},
    ]
    for body in bad:
        r = client.post("/auth/users", headers=client.admin, json=body)
        assert r.status_code == 422, f"{body} → {r.status_code}"


@db_only
def test_disabled_user_cannot_log_in_again(client):
    """Сценарий увольнения — то, чего не давал `/auth/revoke`.

    Отзыв сессий глушил только выданные токены: сотрудник входил заново тем же
    паролем. Отключение обязано закрыть оба пути.
    """
    login = client.post("/auth/login", json={"username": _STAFF[0], "password": _STAFF[1]})
    assert login.status_code == 200
    old = {"Authorization": f"Bearer {login.json()['token']}"}
    assert client.get("/auth/me", headers=old).status_code == 200

    assert client.post(
        f"/auth/users/{_STAFF[0]}/disable", headers=client.admin
    ).status_code == 200

    # 1. Старый токен мёртв.
    assert client.get("/auth/me", headers=old).status_code == 401
    # 2. И повторный вход тем же паролем — тоже.
    again = client.post("/auth/login", json={"username": _STAFF[0], "password": _STAFF[1]})
    assert again.status_code == 401, again.text
    assert "отключена" in again.json()["detail"].lower()

    # Список показывает статус и кем отключено.
    row = next(
        u for u in client.get("/auth/users", headers=client.admin).json()["users"]
        if u["username"] == _STAFF[0]
    )
    assert row["is_active"] is False
    assert row["disabled_by"] == _ADMIN[0]

    # Включение возвращает доступ, но старый токен остаётся мёртвым.
    assert client.post(
        f"/auth/users/{_STAFF[0]}/enable", headers=client.admin
    ).status_code == 200
    assert client.post(
        "/auth/login", json={"username": _STAFF[0], "password": _STAFF[1]}
    ).status_code == 200
    assert client.get("/auth/me", headers=old).status_code == 401


@db_only
def test_password_reset_kills_old_password_and_sessions(client):
    login = client.post("/auth/login", json={"username": _STAFF[0], "password": _STAFF[1]})
    old = {"Authorization": f"Bearer {login.json()['token']}"}

    assert client.post(
        f"/auth/users/{_STAFF[0]}/password",
        headers=client.admin,
        json={"password": _STAFF_NEW_PASS},
    ).status_code == 200

    assert client.get("/auth/me", headers=old).status_code == 401
    assert client.post(
        "/auth/login", json={"username": _STAFF[0], "password": _STAFF[1]}
    ).status_code == 401
    assert client.post(
        "/auth/login", json={"username": _STAFF[0], "password": _STAFF_NEW_PASS}
    ).status_code == 200

    # Пароль в журнал аудита не попадает.
    events = client.get("/audit?action=user.password_reset&limit=50", headers=client.admin)
    assert events.status_code == 200
    assert _STAFF_NEW_PASS not in events.text


@db_only
def test_admin_cannot_disable_self_or_unknown(client):
    """Себя отключить нельзя (иначе включить обратно будет некому).

    Отдельная защита «последний действующий администратор» здесь не проверяется:
    для этого пришлось бы отключить демо-учётку `admin`, на которой работают
    другие сценарии. Логика — в disable_user (409).
    """
    r = client.post(f"/auth/users/{_ADMIN[0]}/disable", headers=client.admin)
    assert r.status_code == 400

    unknown = client.post("/auth/users/zz_no_such_user/disable", headers=client.admin)
    assert unknown.status_code == 404


# ────────────────── 3. Станция начальника караула (на живой базе) ───────────


@pytest.fixture
def stations():
    """Две тестовые пожарные части — для проверки station_id у responder."""
    if not os.getenv("FW_RUN_DB_TESTS"):
        pytest.skip("нужна живая база (FW_RUN_DB_TESTS=1)")

    from app.db import engine

    with engine.begin() as conn:
        ids = [
            conn.execute(
                text(
                    "INSERT INTO fire_stations (name, geom) "
                    "VALUES (:n, ST_SetSRID(ST_MakePoint(71.0005, 51.0005), 4326)) "
                    "RETURNING id"
                ),
                {"n": f"ПЧ-zz-station-{i}"},
            ).scalar()
            for i in range(2)
        ]
    try:
        yield ids
    finally:
        with engine.begin() as conn:
            # ON DELETE CASCADE (station_vehicles) / SET NULL (users.station_id)
            # в 0017 — за собой можно не чистить ничего, кроме самих частей.
            conn.execute(text("DELETE FROM fire_stations WHERE id = ANY(:ids)"), {"ids": ids})


@db_only
def test_admin_manages_responder_station(client, stations):
    """Сквозной сценарий станции: заведение, список, перепривязка, ошибки,

    резолвинг по БД на каждый запрос (без пересоздания токена) и защита БД
    при смене роли в обход продукта (точечный SQL, как на проде — CLAUDE.md).
    """
    station_a, station_b = stations

    # 1. Создание responder со станцией.
    created = client.post(
        "/auth/users",
        headers=client.admin,
        json={
            "username": _RESPONDER[0], "password": _RESPONDER[1], "name": "Кар. Н.",
            "role": "responder", "station_id": station_a,
        },
    )
    assert created.status_code == 200, created.text
    assert created.json()["station_id"] == station_a

    # 2. Список отдаёт station {id, name}, а не голый station_id.
    row = next(
        u for u in client.get("/auth/users", headers=client.admin).json()["users"]
        if u["username"] == _RESPONDER[0]
    )
    assert row["station"] == {"id": station_a, "name": "ПЧ-zz-station-0"}

    # 3. Валидация: чужой роли станция недоступна, неизвестная часть — 422.
    bad_role = client.post(
        "/auth/users",
        headers=client.admin,
        json={
            "username": "zz_bad_station_role", "password": "passpass1", "name": "Х",
            "role": "dispatcher", "station_id": station_a,
        },
    )
    assert bad_role.status_code == 422, bad_role.text

    bad_station = client.post(
        "/auth/users",
        headers=client.admin,
        json={
            "username": "zz_bad_station_id", "password": "passpass1", "name": "Х",
            "role": "responder", "station_id": 999_999_999,
        },
    )
    assert bad_station.status_code == 422, bad_station.text

    # 4. PATCH .../station с неизвестной частью — 422; на не-responder — 422
    # (демо-админ роли не меняет, запрос падает до UPDATE).
    unknown = client.patch(
        f"/auth/users/{_RESPONDER[0]}/station",
        headers=client.admin, json={"station_id": 999_999_999},
    )
    assert unknown.status_code == 422, unknown.text

    # _STAFF (zz_test_inspector, роль inspector) заведён более ранним тестом
    # этого модуля и переживает его — используем его вместо демо-учётки,
    # чтобы тест не зависел от seed_users/порядка файлов.
    wrong_role = client.patch(
        f"/auth/users/{_STAFF[0]}/station", headers=client.admin, json={"station_id": station_a},
    )
    assert wrong_role.status_code == 422, wrong_role.text

    # 5. Резолвинг по БД на каждый запрос: логинимся один раз и ни разу не
    # логинимся заново — сервер обязан видеть станцию по актуальному значению
    # в users, а не по claim'у токена (тот же принцип, что у района).
    login = client.post(
        "/auth/login", json={"username": _RESPONDER[0], "password": _RESPONDER[1]}
    )
    assert login.status_code == 200
    tok = {"Authorization": f"Bearer {login.json()['token']}"}
    assert login.json()["user"]["station"] == {"id": station_a, "name": "ПЧ-zz-station-0"}

    # Пока привязан к station_a — постановка техники в station_b запрещена.
    denied = client.post(
        f"/dispatch/stations/{station_b}/vehicles",
        headers=tok, json={"callsign": "AC-B", "vehicle_type": "ac"},
    )
    assert denied.status_code == 403, denied.text

    # Админ перепривязывает — БЕЗ повторного логина responder'а.
    patched = client.patch(
        f"/auth/users/{_RESPONDER[0]}/station",
        headers=client.admin, json={"station_id": station_b},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["station_id"] == station_b

    # Тем же старым токеном: станция уже новая, без повторного входа.
    assert client.get("/auth/me", headers=tok).json()["station"] == {
        "id": station_b, "name": "ПЧ-zz-station-1",
    }
    allowed = client.post(
        f"/dispatch/stations/{station_b}/vehicles",
        headers=tok, json={"callsign": "AC-B2", "vehicle_type": "ac"},
    )
    assert allowed.status_code == 200, allowed.text
    # А прежняя часть — уже не своя.
    now_denied = client.post(
        f"/dispatch/stations/{station_a}/vehicles",
        headers=tok, json={"callsign": "AC-A2", "vehicle_type": "ac"},
    )
    assert now_denied.status_code == 403, now_denied.text

    # 6. Снятие привязки (station_id: null) допустимо для responder.
    cleared = client.patch(
        f"/auth/users/{_RESPONDER[0]}/station", headers=client.admin, json={"station_id": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["station_id"] is None

    # 7. Смена роли в обход продукта (точечный SQL — как перенос района на
    # проде) обязана самоочистить station_id: возвращаем станцию и меняем
    # роль напрямую в БД, минуя любой эндпоинт.
    from app.db import engine

    with engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET station_id = :s WHERE username = :u"),
            {"s": station_a, "u": _RESPONDER[0]},
        )
        conn.execute(
            text("UPDATE users SET role = 'dispatcher' WHERE username = :u"),
            {"u": _RESPONDER[0]},
        )
        after = conn.execute(
            text("SELECT role, station_id FROM users WHERE username = :u"),
            {"u": _RESPONDER[0]},
        ).mappings().first()
    assert after["role"] == "dispatcher"
    assert after["station_id"] is None, "триггер обязан обнулить station_id при смене роли"
