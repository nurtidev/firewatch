"""End-to-end DB tests: migrations, district scoping, audit trail.

Runs only when FW_RUN_DB_TESTS=1 and DATABASE_URL points at a PostGIS database
(set in CI). Locally without a database these are skipped.

ВНИМАНИЕ: фикстура ниже ОЧИЩАЕТ buildings и всё, что на неё ссылается. Это
безопасно только на выделенной тестовой базе. Однажды такой прогон на общей
dev-базе снёс демо-данные (4523 здания, карточки, визиты, донесения), поэтому
имя базы проверяется явно: без «test» в названии тесты не запускаются, сколько
бы флагов ни было выставлено. Локально: создать базу и указать её в
DATABASE_URL, например
  postgresql+psycopg://firewatch:firewatch@db:5432/fw_test
"""

import os
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text


def _is_dedicated_test_db() -> bool:
    """База выглядит выделенной под тесты (имя содержит «test»)."""
    url = os.getenv("DATABASE_URL", "")
    name = url.rsplit("/", 1)[-1].split("?", 1)[0].lower()
    return "test" in name


pytestmark = [
    pytest.mark.skipif(
        not os.getenv("FW_RUN_DB_TESTS"),
        reason="set FW_RUN_DB_TESTS=1 with a PostGIS DATABASE_URL to run",
    ),
    pytest.mark.skipif(
        os.getenv("FW_RUN_DB_TESTS") and not _is_dedicated_test_db(),
        reason=(
            "фикстура очищает buildings — нужна выделенная база с «test» в "
            "имени, иначе прогон снесёт демо-данные общей dev-базы"
        ),
    ),
]

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
        # Порядок важен: всё, что ссылается на buildings, чистится до неё,
        # иначе DELETE падает по FK. Список сверен с information_schema —
        # при добавлении новой таблицы со ссылкой на buildings дополнить.
        for table in (
            "risk_scores",
            "field_reports",
            "callouts",
            "inspection_visits",
            "incidents",
            "owner_buildings",
            "operational_cards",
        ):
            conn.execute(text(f"DELETE FROM {table}"))
        conn.execute(text("DELETE FROM buildings"))
        # audit_log is append-only (WORM, migration 0005_audit_worm) — a DB
        # trigger rejects DELETE once the table holds any row, which it now
        # reliably does (denied GET/POST requests are audited too — see
        # api/app/main.py). Tests below assert deltas/latest rows, never an
        # absolute count from empty, so a pre-existing audit trail is fine.
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
    # Asking for another district must still return only the inspector's own
    # (the seeded inspector lives in Есильский — see seed_users).
    feats = client.get("/buildings?district=Сарыаркинский", headers=h).json()["features"]
    assert len(feats) == 0


def test_district_change_applies_to_existing_token(client):
    """Район — из БД на каждый запрос: перевод сотрудника действует сразу,
    а не через 12 часов, когда истечёт токен со старым claim `district`."""
    from app.db import engine

    h = _login(client, "supervisor", "supervisor123")  # Есильский: 2 здания
    assert len(client.get("/buildings", headers=h).json()["features"]) == 2
    try:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE users SET district = 'Сарыаркинский' WHERE username = 'supervisor'")
            )
        # Тот же токен, без повторного входа.
        assert len(client.get("/buildings", headers=h).json()["features"]) == 3
        assert client.get("/auth/me", headers=h).json()["district"] == "Сарыаркинский"
    finally:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE users SET district = 'Есильский' WHERE username = 'supervisor'")
            )


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


# --- очередь расстановки: доставка «хотя бы один раз» ------------------------
#
# Позиции, поставленные на плане без связи, копятся на устройстве и уходят
# батчем. Дальше проверяется то, ради чего очередь вообще устроена именно так:
# повтор не двоит расстановку, одна отвергнутая позиция не утягивает остальные,
# а время постановки не подменяется временем синхронизации.


def _open_callout(client, headers) -> int:
    """Активный выезд в точке полигона тестовых зданий."""
    r = client.post(
        "/dispatch",
        json={"lat": 51.0005, "lng": 71.0005, "callout_type": "fire"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["callout"]["id"]


def test_deployment_sync_replay_does_not_duplicate(client):
    """Батч, доставленный дважды, даёт одну расстановку, а не две.

    Связь на пожаре рвётся посреди ответа: устройство не знает, дошёл ли
    запрос, и повторяет его. Без идемпотентности по client_uid каждый такой
    разрыв оставлял бы на плане второй ствол в той же точке — и сверка «подано
    3 из 4» врала бы в сторону, из-за которой сил не запросят.
    """
    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    # Время постановки обязано лежать в пределах выезда (см. _placed_at_problem),
    # поэтому оно отсчитывается от «сейчас», а не зашито датой.
    placed = datetime.now(timezone.utc) - timedelta(minutes=1)
    body = {
        "creates": [
            {
                "client_uid": "test-deploy-0001",
                "kind": "barrel_ext",
                "phase": "localization",
                "floor": "5",
                "plan_x": 0.42,
                "plan_y": 0.31,
                "heading": 90,
                "placed_at": placed.isoformat(),
            }
        ]
    }

    first = client.post(f"/dispatch/{callout_id}/deployment/sync", json=body, headers=h)
    assert first.status_code == 200, first.text
    assert first.json()["applied"] == ["test-deploy-0001"]
    assert first.json()["rejected"] == []

    replay = client.post(f"/dispatch/{callout_id}/deployment/sync", json=body, headers=h)
    assert replay.status_code == 200, replay.text
    assert replay.json()["applied"] == ["test-deploy-0001"]

    positions = client.get(f"/dispatch/{callout_id}/deployment", headers=h).json()["positions"]
    mine = [p for p in positions if p["client_uid"] == "test-deploy-0001"]
    assert len(mine) == 1
    # Время постановки — по часам устройства, не по моменту, когда связь
    # вернулась: по нему разбирают ход тушения.
    assert abs(datetime.fromisoformat(mine[0]["placed_at"]) - placed) < timedelta(milliseconds=1)
    assert mine[0]["placed_at"] != mine[0]["created_at"]
    assert mine[0]["heading"] == 90


def test_deployment_sync_applies_rest_when_one_item_is_rejected(client):
    """Позиция, снятая с пульта, не отменяет остальную очередь.

    Пока РТП работал без связи, диспетчер мог снять позицию. Её правка уже
    ни к чему не приложится — но остальные позиции того же батча обязаны
    записаться, иначе одна разошедшаяся строка стоила бы всей расстановки.
    """
    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)

    r = client.post(
        f"/dispatch/{callout_id}/deployment/sync",
        json={
            "creates": [
                {
                    "client_uid": "test-deploy-0002",
                    "kind": "barrel_def",
                    "floor": "3",
                    "plan_x": 0.2,
                    "plan_y": 0.8,
                }
            ],
            # id, которого на этом выезде нет и не было.
            "patches": [{"id": 10_000_000, "plan_x": 0.5, "plan_y": 0.5}],
        },
        headers=h,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["applied"] == ["test-deploy-0002"]
    assert [x["key"] for x in data["rejected"]] == ["srv:10000000"]
    assert data["rejected"][0]["reason"]
    assert any(p["client_uid"] == "test-deploy-0002" for p in data["positions"])


def test_deployment_sync_moves_then_drops_position(client):
    """Правка и снятие по серверному id — то, чем становится очередь после
    первой удачной синхронизации."""
    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)

    created = client.post(
        f"/dispatch/{callout_id}/deployment/sync",
        json={
            "creates": [
                {
                    "client_uid": "test-deploy-0003",
                    "kind": "barrel_ext",
                    "floor": "2",
                    "plan_x": 0.1,
                    "plan_y": 0.1,
                }
            ]
        },
        headers=h,
    ).json()
    pos_id = next(
        p["id"] for p in created["positions"] if p["client_uid"] == "test-deploy-0003"
    )

    moved = client.post(
        f"/dispatch/{callout_id}/deployment/sync",
        json={"patches": [{"id": pos_id, "plan_x": 0.9, "plan_y": 0.4, "heading": 180}]},
        headers=h,
    ).json()
    assert moved["rejected"] == []
    after = next(p for p in moved["positions"] if p["id"] == pos_id)
    assert (after["plan_x"], after["plan_y"], after["heading"]) == (0.9, 0.4, 180)

    dropped = client.post(
        f"/dispatch/{callout_id}/deployment/sync",
        json={"deletes": [pos_id]},
        headers=h,
    ).json()
    assert dropped["applied"] == [f"srv:{pos_id}"]
    assert all(p["id"] != pos_id for p in dropped["positions"])

    # Повторное снятие того же id — уже снято, повторять нечего: очередь на
    # устройстве не должна застрять на «позиции нет».
    again = client.post(
        f"/dispatch/{callout_id}/deployment/sync",
        json={"deletes": [pos_id]},
        headers=h,
    ).json()
    assert again["applied"] == [f"srv:{pos_id}"]
    assert again["rejected"] == []


# --- досинхронизация после закрытия выезда -----------------------------------
#
# РТП работал без связи, диспетчер закрыл выезд. Раньше очередь получала 409
# на весь батч и расстановка оставалась на планшете. Теперь то, что поставлено
# до закрытия, принимается поштучно и помечается, остальное — отвергается с
# причиной, а правки с пульта закрытого выезда запрещены, как и раньше.


def _close(client, headers, callout_id: int) -> None:
    r = client.post(
        f"/dispatch/{callout_id}/close", json={"close_note": "ликвидирован"}, headers=headers
    )
    assert r.status_code == 200, r.text


def _backdate(
    engine, callout_id: int, created_ago: timedelta, closed_ago: timedelta | None = None
) -> datetime | None:
    """Сдвинуть регистрацию (и закрытие, если задано) выезда в прошлое; вернуть closed_at."""
    with engine.begin() as conn:
        return conn.execute(
            text(
                "UPDATE callouts SET created_at = now() - CAST(:c AS interval), "
                "closed_at = COALESCE(now() - CAST(:z AS interval), closed_at) "
                "WHERE id = :id RETURNING closed_at"
            ),
            {"c": created_ago, "z": closed_ago, "id": callout_id},
        ).scalar()


def _plan_create(uid: str, placed_at: datetime | None = None, **fields) -> dict:
    body = {"client_uid": uid, "kind": "barrel_ext", "floor": "2", "plan_x": 0.3, "plan_y": 0.4}
    if placed_at is not None:
        body["placed_at"] = placed_at.isoformat()
    body.update(fields)
    return body


@pytest.fixture
def crew(client):
    """Три тестовые части; после теста часть responder и выездов — как было.

    Досинхронизация в закрытый выезд открыта только караулу части,
    участвовавшей в выезде, а у сидового responder части нет.
    """
    from app.db import engine

    with engine.begin() as conn:
        prev = conn.execute(
            text("SELECT station_id FROM users WHERE username = 'responder'")
        ).scalar()
        ids = [
            conn.execute(
                text(
                    "INSERT INTO fire_stations (name, geom) "
                    "VALUES (:n, ST_SetSRID(ST_MakePoint(71.0005, 51.0005), 4326)) RETURNING id"
                ),
                {"n": f"ПЧ-late-{i}"},
            ).scalar()
            for i in range(3)
        ]
    try:
        yield ids
    finally:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE users SET station_id = :s WHERE username = 'responder'"), {"s": prev}
            )
            conn.execute(
                text("UPDATE callouts SET station_id = NULL WHERE station_id = ANY(:ids)"),
                {"ids": ids},
            )
            conn.execute(text("DELETE FROM fire_stations WHERE id = ANY(:ids)"), {"ids": ids})


def _set_callout_station(engine, callout_id: int, station_id: int | None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE callouts SET station_id = :s WHERE id = :id"),
            {"s": station_id, "id": callout_id},
        )


def _set_responder_station(engine, station_id: int | None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET station_id = :s WHERE username = 'responder'"), {"s": station_id}
        )


def _send_vehicle(engine, callout_id: int, station_id: int) -> None:
    """Машина части в наряде выезда — часть участвовала, даже не будучи назначенной."""
    with engine.begin() as conn:
        vid = conn.execute(
            text(
                "INSERT INTO station_vehicles (station_id, callsign, vehicle_type) "
                "VALUES (:s, :c, 'ac') RETURNING id"
            ),
            {"s": station_id, "c": f"АЦ-late-{callout_id}"},
        ).scalar()
        conn.execute(
            text("INSERT INTO callout_vehicles (callout_id, vehicle_id) VALUES (:c, :v)"),
            {"c": callout_id, "v": vid},
        )


_NOT_CREW = "Досинхронизация после закрытия — только расчёт части, участвовавшей в выезде"
_NOT_OWN = "Выезд закрыт — после закрытия принимаются только свои позиции, поставленные на плане"
_NO_TIME = "Время постановки неизвестно — после закрытия выезда позиция не записана"


def test_late_sync_accepts_pre_close_items_marks_and_audits(client, crew):
    """Поставлено до закрытия — принято и помечено; после — отказ поштучно.

    Ствол поставлен за десять минут до закрытия, связь вернулась через
    полчаса: он обязан попасть в донесение с пометкой. Ствол, поставленный
    через двадцать минут после закрытия, не записывается — с причиной, а не
    отказом всему батчу.
    """
    from app.db import engine

    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, crew[0])
    _set_responder_station(engine, crew[0])
    _close(client, disp, callout_id)
    closed_at = _backdate(engine, callout_id, timedelta(hours=2), timedelta(minutes=30))

    pre, post = "test-late-pre", "test-late-post"
    now = datetime.now(timezone.utc)
    r = client.post(
        f"/dispatch/{callout_id}/deployment/sync",
        json={
            "creates": [
                _plan_create(pre, closed_at - timedelta(minutes=10)),
                _plan_create(post, closed_at + timedelta(minutes=20)),
            ],
            "sent_at": now.isoformat(),
        },
        headers=rtp,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["applied"] == [pre]
    assert data["rejected"] == [
        {"key": post, "reason": "Позиция поставлена после закрытия выезда — не записана"}
    ]
    by_uid = {p["client_uid"]: p for p in data["positions"]}
    assert post not in by_uid
    mark = datetime.fromisoformat(by_uid[pre]["synced_after_close_at"])
    assert mark > closed_at
    assert abs(datetime.fromisoformat(by_uid[pre]["placed_at"]) - (closed_at - timedelta(minutes=10))) < timedelta(seconds=5)

    added = _added_detail(engine, callout_id, pre)
    assert added["after_close"] is True
    assert added["username"] == "responder"
    assert datetime.fromisoformat(added["closed_at"]) == closed_at
    assert datetime.fromisoformat(added["synced_at"]) == mark
    assert datetime.fromisoformat(added["placed_at"]) == datetime.fromisoformat(
        by_uid[pre]["placed_at"]
    )
    summary = _audit_details(engine, "callout.deployment_synced", callout_id)[-1]
    assert summary["after_close"] is True
    assert summary["applied"] == 1 and summary["rejected"] == 1

    # Пульт видит, что закрытый выезд получил данные: и в пакете, и в списке.
    pack = client.get(f"/dispatch/{callout_id}/pack", headers=disp).json()
    assert pack["callout"]["late_sync"]["positions"] == 1
    assert datetime.fromisoformat(pack["callout"]["late_sync"]["last_synced_at"]) == mark
    listed = client.get("/dispatch?status=closed", headers=disp).json()
    assert next(c for c in listed if c["id"] == callout_id)["late_sync"]["positions"] == 1


def test_late_sync_console_edits_on_closed_callout_stay_rejected(client, crew):
    """Пульт, диспетчер и чужие позиции закрытого выезда — по-прежнему нет.

    Досинхронизация — доставка того, что расчёт участвовавшей части поставил
    сам, а не второй вход в закрытый выезд: поштучные POST/PATCH/DELETE — 409,
    диспетчер через синхронизацию не пишет ничего (даже своё), а караул части
    не трогает позиции с пульта и чужие позиции с плана.
    """
    from app.db import engine

    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, crew[0])
    _set_responder_station(engine, crew[0])

    console = client.post(
        f"/dispatch/{callout_id}/deployment",
        json={"kind": "hq", "sector": "штаб у въезда"},
        headers=disp,
    )
    assert console.status_code == 200, console.text
    console_id = next(p["id"] for p in console.json() if p["client_uid"] is None)
    uid, disp_uid = "test-late-rtp-own", "test-late-disp-own"
    _sync(client, disp, callout_id, {"creates": [_plan_create(disp_uid)]})
    plan = _sync(client, rtp, callout_id, {"creates": [_plan_create(uid)]})
    plan_id = next(p["id"] for p in plan["positions"] if p["client_uid"] == uid)
    assert all(p["synced_after_close_at"] is None for p in plan["positions"])

    _close(client, disp, callout_id)

    base = f"/dispatch/{callout_id}/deployment"
    assert client.patch(f"{base}/{console_id}", json={"sector": "БУ-9"}, headers=disp).status_code == 409
    assert client.patch(f"{base}/{plan_id}", json={"heading": 45}, headers=rtp).status_code == 409
    assert client.post(base, json={"kind": "hq"}, headers=disp).status_code == 409
    assert client.delete(f"{base}/{console_id}", headers=disp).status_code == 409

    now = datetime.now(timezone.utc).isoformat()
    gestures = {f"srv:{console_id}": now, disp_uid: now}
    # Диспетчер — не расчёт части: ни новая позиция, ни своя с плана, ни с пульта.
    by_disp = _sync(
        client, disp, callout_id,
        {"creates": [_plan_create(disp_uid, plan_x=0.9, plan_y=0.9),
                     _plan_create("test-late-disp-new")],
         "patches": [{"id": console_id, "sector": "БУ-9"}],
         "deletes": [console_id], "delete_uids": [disp_uid],
         "gesture_at": gestures, "sent_at": now},
    )
    assert by_disp["applied"] == []
    assert by_disp["rejected"] == [
        {"key": disp_uid, "reason": _NOT_CREW},
        {"key": "test-late-disp-new", "reason": _NOT_CREW},
        {"key": f"srv:{console_id}", "reason": _NOT_CREW},
        {"key": f"srv:{console_id}", "reason": _NOT_CREW},
        {"key": disp_uid, "reason": _NOT_CREW},
    ]
    # Караул участвовавшей части — только своё: ни позицию с пульта, ни чужую
    # позицию с плана (повтор постановки, правка, снятие).
    by_rtp = _sync(
        client, rtp, callout_id,
        {"creates": [_plan_create(disp_uid, datetime.now(timezone.utc), plan_x=0.9, plan_y=0.9)],
         "patches": [{"id": console_id, "sector": "БУ-9"}, {"client_uid": disp_uid, "heading": 90}],
         "deletes": [console_id], "delete_uids": [disp_uid],
         "gesture_at": gestures, "sent_at": now},
    )
    assert by_rtp["applied"] == []
    assert by_rtp["rejected"] == [
        {"key": disp_uid, "reason": _NOT_OWN},
        {"key": f"srv:{console_id}", "reason": _NOT_OWN},
        {"key": disp_uid, "reason": _NOT_OWN},
        {"key": f"srv:{console_id}", "reason": _NOT_OWN},
        {"key": disp_uid, "reason": _NOT_OWN},
    ]

    positions = {p["id"]: p for p in by_rtp["positions"]}
    assert positions[console_id]["sector"] == "штаб у въезда"
    disp_pos = next(p for p in by_rtp["positions"] if p["client_uid"] == disp_uid)
    assert (disp_pos["plan_x"], disp_pos["heading"]) == (0.3, None)
    assert all(p["synced_after_close_at"] is None for p in positions.values())
    assert client.get(f"/dispatch/{callout_id}/pack", headers=disp).json()["callout"]["late_sync"] is None


def test_late_sync_resent_create_after_close_upserts(client, crew):
    """Ответ на постановку потерялся, выезд закрыли, РТП успел сдвинуть ствол.

    Повтор постановки после закрытия обновляет ту же позицию (не вторая) и
    помечает её; чистый повтор ничего не меняет — ни пометки, ни журнала.
    """
    from app.db import engine

    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, crew[0])
    _set_responder_station(engine, crew[0])
    placed = datetime.now(timezone.utc) - timedelta(seconds=30)
    moved_uid, still_uid = "test-late-resent", "test-late-replay"
    first = _sync(
        client, rtp, callout_id,
        {"creates": [_plan_create(moved_uid, placed), _plan_create(still_uid, placed)]},
    )
    pos_id = next(p["id"] for p in first["positions"] if p["client_uid"] == moved_uid)

    _close(client, disp, callout_id)

    body = {"creates": [_plan_create(moved_uid, placed, plan_x=0.8, plan_y=0.7, heading=180),
                        _plan_create(still_uid, placed)]}
    resent = _sync(client, rtp, callout_id, body)
    assert resent["applied"] == [moved_uid, still_uid]
    assert resent["rejected"] == []
    mine = [p for p in resent["positions"] if p["client_uid"] == moved_uid]
    assert len(mine) == 1 and mine[0]["id"] == pos_id
    assert (mine[0]["plan_x"], mine[0]["plan_y"], mine[0]["heading"]) == (0.8, 0.7, 180)
    assert mine[0]["synced_after_close_at"] is not None
    # Повтор без изменений — не запись после закрытия.
    still = next(p for p in resent["positions"] if p["client_uid"] == still_uid)
    assert still["synced_after_close_at"] is None

    moved = [d for d in _audit_details(engine, "callout.deployment_moved", callout_id)
             if d.get("client_uid") == moved_uid]
    assert len(moved) == 1
    assert moved[0]["after_close"] is True and moved[0]["username"] == "responder"
    assert moved[0]["replay"] is True

    again = _sync(client, rtp, callout_id, body)
    assert again["applied"] == [moved_uid, still_uid]
    assert len(_audit_details(engine, "callout.deployment_moved", callout_id)) == 1
    assert len(_audit_details(engine, "callout.deployment_added", callout_id)) == 2


def test_late_sync_patch_and_delete_after_close_need_gesture_time(client, crew):
    """Своя позиция после закрытия: правка и снятие — только сделанные до закрытия.

    Время жеста приходит в `gesture_at` и сводится к часам сервера так же, как
    время постановки. Перемещение или снятие после закрытия (+5 мин) — отказ;
    без времени жеста (старый клиент) — тоже отказ, а не молчаливое принятие.
    Снятое до закрытия оставляет надгробие, и пульт видит счёт снятых.
    """
    from app.db import engine

    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, crew[0])
    _set_responder_station(engine, crew[0])
    _backdate(engine, callout_id, timedelta(hours=2))
    now = datetime.now(timezone.utc)
    placed = now - timedelta(hours=1)
    kept, dropped, by_id, by_id_no_at = (
        "test-late-patch", "test-late-drop", "test-late-drop-id", "test-late-drop-id-no-at",
    )
    moved_late, dropped_late, no_at = (
        "test-late-move-late", "test-late-drop-late", "test-late-move-no-at",
    )
    uids = (kept, dropped, by_id, by_id_no_at, moved_late, dropped_late, no_at)
    created = _sync(
        client, rtp, callout_id,
        {"creates": [_plan_create(u, placed) for u in uids], "sent_at": now.isoformat()},
    )
    ids = {p["client_uid"]: p["id"] for p in created["positions"]}

    _close(client, disp, callout_id)
    closed_at = _backdate(engine, callout_id, timedelta(hours=2), timedelta(minutes=30))
    before = (now - timedelta(minutes=40)).isoformat()
    after = (now - timedelta(minutes=10)).isoformat()
    never = "test-late-never-arrived"

    data = _sync(
        client, rtp, callout_id,
        {"patches": [{"client_uid": kept, "plan_x": 0.6, "plan_y": 0.2},
                     {"client_uid": moved_late, "heading": 90},
                     {"client_uid": no_at, "heading": 45}],
         "deletes": [ids[by_id], ids[by_id_no_at]],
         "delete_uids": [dropped, never, dropped_late],
         "gesture_at": {kept: before, moved_late: after, f"srv:{ids[by_id]}": before,
                        dropped: before, dropped_late: after},
         "sent_at": datetime.now(timezone.utc).isoformat()},
    )
    assert data["applied"] == [kept, f"srv:{ids[by_id]}", dropped, never]
    assert data["rejected"] == [
        {"key": moved_late, "reason": "Позиция перемещена после закрытия выезда — правка не записана"},
        {"key": no_at, "reason": "Время перемещения неизвестно — после закрытия выезда правка не записана"},
        {"key": f"srv:{ids[by_id_no_at]}",
         "reason": "Время снятия неизвестно — после закрытия выезда позиция не снята"},
        {"key": dropped_late, "reason": "Позиция снята после закрытия выезда — снятие не записано"},
    ]
    by_uid = {p["client_uid"]: p for p in data["positions"]}
    assert dropped not in by_uid and by_id not in by_uid
    assert {by_id_no_at, dropped_late, moved_late, no_at} <= set(by_uid)
    assert (by_uid[kept]["plan_x"], by_uid[kept]["plan_y"]) == (0.6, 0.2)
    assert by_uid[kept]["synced_after_close_at"] is not None
    assert by_uid[moved_late]["heading"] is None
    assert by_uid[moved_late]["synced_after_close_at"] is None

    removed = [d for d in _audit_details(engine, "callout.deployment_removed", callout_id)
               if d.get("after_close")]
    assert sorted(d["position_id"] for d in removed) == sorted([ids[by_id], ids[dropped]])
    drop = next(d for d in removed if d.get("client_uid") == dropped)
    assert drop["username"] == "responder" and drop["closed_at"] and drop["synced_at"]
    assert drop["placed_at"] and drop["device_gesture_at"]
    assert abs(
        datetime.fromisoformat(drop["gesture_at"]) - datetime.fromisoformat(before)
    ) < timedelta(seconds=1)
    moved = _audit_details(engine, "callout.deployment_moved", callout_id)
    assert [m["fields"] for m in moved] == [["plan_x", "plan_y"]]
    assert moved[0]["after_close"] is True and moved[0]["gesture_at"]

    with engine.connect() as conn:
        tomb = conn.execute(
            text(
                "SELECT position_id, kind, removed_by, removed_at FROM deployment_late_removals "
                "WHERE callout_id = :c ORDER BY position_id"
            ),
            {"c": callout_id},
        ).mappings().all()
    assert [t["position_id"] for t in tomb] == sorted([ids[by_id], ids[dropped]])
    assert all(t["removed_by"] == "responder" and t["kind"] == "barrel_ext" for t in tomb)
    assert all(t["removed_at"] < closed_at for t in tomb)

    # Снятое после закрытия видно пульту — в пакете и в списке.
    late = client.get(f"/dispatch/{callout_id}/pack", headers=disp).json()["callout"]["late_sync"]
    assert (late["positions"], late["removed"]) == (1, 2)
    listed = client.get("/dispatch?status=closed", headers=disp).json()
    assert next(c for c in listed if c["id"] == callout_id)["late_sync"]["removed"] == 2


def test_late_sync_rejects_each_item_after_seven_days(client, crew):
    """Выезд закрыт больше недели назад — отказ каждой позиции с причиной."""
    from app.db import engine

    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, crew[0])
    _set_responder_station(engine, crew[0])
    _close(client, disp, callout_id)
    closed_at = _backdate(engine, callout_id, timedelta(days=9), timedelta(days=8))

    uid = "test-late-too-old"
    data = _sync(
        client, rtp, callout_id,
        {"creates": [_plan_create(uid, closed_at - timedelta(minutes=5))],
         "delete_uids": ["test-late-too-old-drop"]},
    )
    reason = "Выезд закрыт более 7 дней назад — позиция не записана"
    assert data["applied"] == []
    assert data["rejected"] == [
        {"key": uid, "reason": reason},
        {"key": "test-late-too-old-drop", "reason": reason},
    ]
    assert all(p["client_uid"] != uid for p in data["positions"])


def test_late_sync_only_crew_of_participating_station(client, crew):
    """Досинхронизация после закрытия — только караул участвовавшей части.

    Участвовала назначенная часть и часть, приславшая машину в наряд.
    Диспетчер, караул другой части и responder без привязки к части — отказ,
    в том числе по своей же позиции после перевода в другую часть.
    """
    from app.db import engine

    assigned, by_vehicle, other = crew
    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, assigned)
    _send_vehicle(engine, callout_id, by_vehicle)
    _close(client, disp, callout_id)
    placed = datetime.now(timezone.utc) - timedelta(seconds=5)

    def attempt(headers, uid: str, **fields) -> dict:
        return _sync(
            client, headers, callout_id,
            {"creates": [_plan_create(uid, placed, **fields)],
             "sent_at": datetime.now(timezone.utc).isoformat()},
        )

    def refused(data: dict, uid: str) -> bool:
        return data["applied"] == [] and data["rejected"] == [{"key": uid, "reason": _NOT_CREW}]

    assert refused(attempt(disp, "test-late-crew-disp"), "test-late-crew-disp")
    _set_responder_station(engine, other)
    assert refused(attempt(rtp, "test-late-crew-other"), "test-late-crew-other")
    _set_responder_station(engine, None)
    assert refused(attempt(rtp, "test-late-crew-none"), "test-late-crew-none")

    _set_responder_station(engine, by_vehicle)
    assert attempt(rtp, "test-late-crew-vehicle")["applied"] == ["test-late-crew-vehicle"]
    _set_responder_station(engine, assigned)
    accepted = attempt(rtp, "test-late-crew-assigned")
    assert accepted["applied"] == ["test-late-crew-assigned"]

    # Своя позиция, но учётную запись перевели в часть, которая не выезжала.
    _set_responder_station(engine, other)
    resend = attempt(rtp, "test-late-crew-assigned", plan_x=0.9, plan_y=0.9)
    assert refused(resend, "test-late-crew-assigned")
    mine = next(p for p in resend["positions"] if p["client_uid"] == "test-late-crew-assigned")
    assert mine["plan_x"] == 0.3
    uids = {p["client_uid"] for p in resend["positions"]}
    assert uids.isdisjoint({"test-late-crew-disp", "test-late-crew-other", "test-late-crew-none"})


def test_late_sync_rejects_unprovable_placed_at(client, crew):
    """Время, не доказывающее «до закрытия», в закрытом выезде — отказ.

    Без placed_at и с временем раньше регистрации: в открытом выезде оно
    прижимается к регистрации и принимается, а в закрытом так недоказуемое
    время превращалось бы в принятое. И с sent_at, и у старого клиента без него.
    """
    from app.db import engine

    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, crew[0])
    _set_responder_station(engine, crew[0])
    _close(client, disp, callout_id)
    ancient = datetime(2020, 1, 1, tzinfo=timezone.utc)

    new = _sync(
        client, rtp, callout_id,
        {"creates": [_plan_create("test-late-no-placed"),
                     _plan_create("test-late-clamped", ancient)],
         "sent_at": datetime.now(timezone.utc).isoformat()},
    )
    old = _sync(client, rtp, callout_id, {"creates": [_plan_create("test-late-clamped-old", ancient)]})
    assert new["applied"] == [] and old["applied"] == []
    assert new["rejected"] == [
        {"key": "test-late-no-placed", "reason": _NO_TIME},
        {"key": "test-late-clamped", "reason": _NO_TIME},
    ]
    assert old["rejected"] == [{"key": "test-late-clamped-old", "reason": _NO_TIME}]
    uids = {p["client_uid"] for p in old["positions"]}
    assert uids.isdisjoint({"test-late-no-placed", "test-late-clamped", "test-late-clamped-old"})


def test_late_sync_waits_for_concurrent_close(client, crew):
    """Закрытие и синхронизация одновременно: позиция не ложится без пометки.

    Закрытие держит строку выезда (UPDATE не закоммичен). Синхронизация ждёт
    его на FOR SHARE и после коммита видит выезд закрытым: позиция записана
    как досинхронизированная после закрытия, а не как обычная в открытый выезд.
    """
    import threading

    from app.db import engine

    disp = _login(client, "dispatcher", "dispatcher123")
    rtp = _login(client, "responder", "responder123")
    callout_id = _open_callout(client, disp)
    _set_callout_station(engine, callout_id, crew[0])
    _set_responder_station(engine, crew[0])
    uid = "test-late-race"
    placed = datetime.now(timezone.utc) - timedelta(seconds=30)
    result: dict = {}

    def run() -> None:
        result["r"] = client.post(
            f"/dispatch/{callout_id}/deployment/sync",
            json={"creates": [_plan_create(uid, placed)],
                  "sent_at": datetime.now(timezone.utc).isoformat()},
            headers=rtp,
        )

    conn = engine.connect()
    tx = conn.begin()
    worker = threading.Thread(target=run)
    try:
        conn.execute(
            text(
                "UPDATE callouts SET status = 'closed', closed_at = now(), closed_by = 'dispatcher' "
                "WHERE id = :id"
            ),
            {"id": callout_id},
        )
        worker.start()
        worker.join(1.5)
        assert worker.is_alive(), "синхронизация не дождалась незакоммиченного закрытия"
        tx.commit()
    finally:
        if tx.is_active:
            tx.rollback()
        conn.close()
    worker.join(15)
    assert not worker.is_alive()

    r = result["r"]
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == [uid]
    mine = next(p for p in r.json()["positions"] if p["client_uid"] == uid)
    assert mine["synced_after_close_at"] is not None
    assert _added_detail(engine, callout_id, uid)["after_close"] is True


def test_deployment_sync_is_audited_per_position(client):
    """Каждая позиция — отдельное действие в журнале, плюс сводка по батчу.

    Аудит здесь не формальность: расстановка — это распоряжение силами, и
    «кто поставил ствол на пятом этаже» разбирают поимённо. Пометка `via:sync`
    отличает позицию, доехавшую из очереди, от поставленной с пульта.
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    placed = datetime.now(timezone.utc) - timedelta(minutes=2)
    client.post(
        f"/dispatch/{callout_id}/deployment/sync",
        json={
            "creates": [
                {
                    "client_uid": "test-deploy-0005",
                    "kind": "ladder",
                    "floor": "1",
                    "plan_x": 0.3,
                    "plan_y": 0.6,
                    "placed_at": placed.isoformat(),
                }
            ]
        },
        headers=h,
    )

    with engine.connect() as conn:
        added = conn.execute(
            text(
                "SELECT count(*) FROM audit_log "
                "WHERE action = 'callout.deployment_added' "
                "  AND detail->>'via' = 'sync' "
                "  AND (detail->>'callout_id')::bigint = :c"
            ),
            {"c": callout_id},
        ).scalar()
        summary = conn.execute(
            text(
                "SELECT detail FROM audit_log "
                "WHERE action = 'callout.deployment_synced' "
                "  AND (detail->>'callout_id')::bigint = :c "
                "ORDER BY id DESC LIMIT 1"
            ),
            {"c": callout_id},
        ).scalar()
    assert added == 1
    assert summary["applied"] == 1 and summary["rejected"] == 0
    assert abs(datetime.fromisoformat(summary["oldest_placed_at"]) - placed) < timedelta(
        milliseconds=1
    )


def _sync(client, headers, callout_id: int, body: dict) -> dict:
    r = client.post(f"/dispatch/{callout_id}/deployment/sync", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _audit_details(engine, action: str, callout_id: int) -> list[dict]:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT detail FROM audit_log WHERE action = :a "
                "  AND (detail->>'callout_id')::bigint = :c ORDER BY id"
            ),
            {"a": action, "c": callout_id},
        ).scalars().all()


def test_deployment_sync_resent_create_applies_final_state(client):
    """Потерянный ответ плюс перемещение — повтор постановки с новой точкой.

    Устройство не узнало, что постановка дошла, а РТП тем временем передвинул
    ствол. Очередь шлёт конечное состояние: тот же client_uid с новыми
    координатами. Раньше конфликт глотался (DO NOTHING), сервер отвечал
    «принято», устройство убирало запись — и ствол навсегда оставался в старой
    точке, в том числе в напечатанном донесении.
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    uid = "test-deploy-0006"
    first = _sync(
        client, h, callout_id,
        {"creates": [{"client_uid": uid, "kind": "barrel_ext", "floor": "4",
                      "plan_x": 0.1, "plan_y": 0.1, "heading": 0}]},
    )
    pos_id = next(p["id"] for p in first["positions"] if p["client_uid"] == uid)

    # Участок уточнили с пульта: повтор из очереди без участка не должен его стереть.
    r = client.patch(
        f"/dispatch/{callout_id}/deployment/{pos_id}", json={"sector": "БУ-2"}, headers=h
    )
    assert r.status_code == 200, r.text

    moved_body = {"creates": [{"client_uid": uid, "kind": "barrel_ext", "floor": "5",
                               "plan_x": 0.7, "plan_y": 0.6, "heading": 270}]}
    resent = _sync(client, h, callout_id, moved_body)
    assert resent["applied"] == [uid]
    assert resent["rejected"] == []
    mine = [p for p in resent["positions"] if p["client_uid"] == uid]
    assert len(mine) == 1
    assert mine[0]["id"] == pos_id
    assert (mine[0]["floor"], mine[0]["plan_x"], mine[0]["plan_y"], mine[0]["heading"]) == (
        "5", 0.7, 0.6, 270,
    )
    assert mine[0]["sector"] == "БУ-2"

    def sync_moves() -> list[dict]:
        return [
            d for d in _audit_details(engine, "callout.deployment_moved", callout_id)
            if d.get("via") == "sync"
        ]

    assert len(sync_moves()) == 1
    assert sync_moves()[0]["position_id"] == pos_id

    # Чистый повтор того же состояния — не перемещение: журнал не растёт.
    again = _sync(client, h, callout_id, moved_body)
    assert again["applied"] == [uid]
    assert len(sync_moves()) == 1
    assert len(_audit_details(engine, "callout.deployment_added", callout_id)) == 1


def test_deployment_sync_delete_by_client_uid_is_idempotent(client):
    """Снятие позиции, чья постановка была в полёте, — по client_uid.

    Серверного id у устройства нет, а если ответ потерялся — и не будет.
    Раньше такое снятие висело в очереди без адреса: сервер хранил позицию,
    планшет её прятал, «ждёт отправки» не уходило никогда.
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    uid = "test-deploy-0007"
    _sync(
        client, h, callout_id,
        {"creates": [{"client_uid": uid, "kind": "barrel_def", "floor": "2",
                      "plan_x": 0.3, "plan_y": 0.3}]},
    )

    dropped = _sync(client, h, callout_id, {"delete_uids": [uid]})
    assert dropped["applied"] == [uid]
    assert dropped["rejected"] == []
    assert all(p["client_uid"] != uid for p in dropped["positions"])

    # Повтор и снятие того, что до сервера так и не дошло: цель достигнута.
    never = "test-deploy-never-arrived"
    again = _sync(client, h, callout_id, {"delete_uids": [uid, never]})
    assert again["applied"] == [uid, never]
    assert again["rejected"] == []

    removed = [
        d for d in _audit_details(engine, "callout.deployment_removed", callout_id)
        if d.get("via") == "sync"
    ]
    assert len(removed) == 1
    assert removed[0]["client_uid"] == uid


def _callout_created_at(engine, callout_id: int) -> datetime:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT created_at FROM callouts WHERE id = :c"), {"c": callout_id}
        ).scalar()


def _create(uid: str, placed_at: str) -> dict:
    return {"client_uid": uid, "kind": "barrel_ext", "floor": "1",
            "plan_x": 0.5, "plan_y": 0.5, "placed_at": placed_at}


def _added_detail(engine, callout_id: int, uid: str) -> dict:
    return next(
        d for d in _audit_details(engine, "callout.deployment_added", callout_id)
        if d.get("client_uid") == uid
    )


def test_deployment_sync_clamps_implausible_placed_at_without_sent_at(client):
    """Старый клиент без sent_at: неправдоподобное время прижимается к выезду.

    Отказ из-за часов терял позицию при живой связи. Отвергается только время
    без пояса — поштучно, а не батч: без пояса оно раньше доезжало до min()
    рядом с aware-временем и роняло ответ 500 уже после коммита.
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    created = _callout_created_at(engine, callout_id)
    now = datetime.now(timezone.utc)
    good = now - timedelta(seconds=1)
    early, future, naive = "test-deploy-0009", "test-deploy-0010", "test-deploy-0011"

    data = _sync(
        client, h, callout_id,
        {"creates": [
            _create("test-deploy-0008", good.isoformat()),
            _create(early, "2020-01-01T00:00:00+00:00"),  # раньше вызова
            _create(future, (now + timedelta(hours=2)).isoformat()),  # в будущем
            _create(naive, now.replace(tzinfo=None).isoformat()),  # без пояса
        ]},
    )
    assert data["applied"] == ["test-deploy-0008", early, future]
    assert [r["key"] for r in data["rejected"]] == [naive]
    by_uid = {p["client_uid"]: p for p in data["positions"]}
    assert naive not in by_uid
    assert datetime.fromisoformat(by_uid[early]["placed_at"]) == created
    after = datetime.now(timezone.utc)
    assert now <= datetime.fromisoformat(by_uid[future]["placed_at"]) <= after

    clock = _added_detail(engine, callout_id, future)
    assert clock["clamped"] is True
    assert clock["clock_skew_sec"] is None and clock["sent_at"] is None
    assert datetime.fromisoformat(clock["device_placed_at"]) == now + timedelta(hours=2)
    assert _added_detail(engine, callout_id, early)["clamped"] is True
    # Время в пределах выезда пишется как пришло, без пометок о часах.
    assert "clamped" not in _added_detail(engine, callout_id, "test-deploy-0008")

    summary = _audit_details(engine, "callout.deployment_synced", callout_id)[-1]
    assert summary["applied"] == 3 and summary["rejected"] == 1
    assert datetime.fromisoformat(summary["oldest_placed_at"]) == min(created, good)

    # Поштучная постановка с пульта ведёт себя так же: принята, время прижато.
    r = client.post(
        f"/dispatch/{callout_id}/deployment",
        json={"kind": "hq", "client_uid": "test-deploy-single-old",
              "placed_at": "2020-01-01T00:00:00+00:00"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    single = next(p for p in r.json() if p["client_uid"] == "test-deploy-single-old")
    assert datetime.fromisoformat(single["placed_at"]) == created


def test_deployment_sync_fast_device_clock_is_corrected(client):
    """Часы планшета спешат на два часа — позиция принята с верным временем.

    Регрессия прошлого раунда: при живой связи каждая постановка на схеме
    получала отказ «время в будущем» и исчезала в «не принято».
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    skew = timedelta(hours=2)
    now = datetime.now(timezone.utc)
    placed = now - timedelta(seconds=1)
    uid = "test-deploy-fast-clock"

    data = _sync(
        client, h, callout_id,
        {"creates": [_create(uid, (placed + skew).isoformat())],
         "sent_at": (now + skew).isoformat()},
    )
    assert data["applied"] == [uid] and data["rejected"] == []
    stored = datetime.fromisoformat(
        next(p for p in data["positions"] if p["client_uid"] == uid)["placed_at"]
    )
    # Поправка — по часам сервера в момент приёма: к «сейчас» теста добавляется
    # только время в пути запроса.
    assert timedelta(0) <= stored - placed < timedelta(seconds=5)

    clock = _added_detail(engine, callout_id, uid)
    assert abs(clock["clock_skew_sec"] + 7200) <= 5
    assert clock["clamped"] is False
    assert datetime.fromisoformat(clock["device_placed_at"]) == placed + skew
    assert datetime.fromisoformat(clock["sent_at"]) == now + skew


def test_deployment_sync_slow_device_clock_at_callout_start_is_corrected(client):
    """Часы отстают на два часа, ствол поставлен в первые секунды выезда.

    По часам устройства это «раньше регистрации вызова» — раньше отказ.
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    created = _callout_created_at(engine, callout_id)
    skew = timedelta(hours=2)
    now = datetime.now(timezone.utc)
    uid = "test-deploy-slow-clock"

    data = _sync(
        client, h, callout_id,
        {"creates": [_create(uid, (now - skew).isoformat())],
         "sent_at": (now - skew).isoformat()},
    )
    assert data["applied"] == [uid] and data["rejected"] == []
    stored = datetime.fromisoformat(
        next(p for p in data["positions"] if p["client_uid"] == uid)["placed_at"]
    )
    # До поправки это было «на два часа раньше регистрации вызова».
    assert stored - created > -timedelta(minutes=1)
    assert timedelta(0) <= stored - now < timedelta(seconds=5)

    clock = _added_detail(engine, callout_id, uid)
    assert abs(clock["clock_skew_sec"] - 7200) <= 5
    assert clock["clamped"] is False


def test_single_add_uses_sent_at_and_replay_is_not_a_second_add(client):
    """Поштучная постановка: та же поправка часов, а повтор — не второй ствол.

    Повтор с тем же client_uid раньше писал второй `deployment_added`; повтор
    с изменённым участком — перемещение только по участку; чистый повтор —
    ничего.
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    skew = timedelta(hours=2)
    now = datetime.now(timezone.utc)
    body = {"kind": "hq", "client_uid": "test-deploy-single-1", "floor": "1",
            "plan_x": 0.4, "plan_y": 0.4,
            "placed_at": (now + skew).isoformat(), "sent_at": (now + skew).isoformat()}

    first = client.post(f"/dispatch/{callout_id}/deployment", json=body, headers=h)
    assert first.status_code == 200, first.text
    mine = next(p for p in first.json() if p["client_uid"] == "test-deploy-single-1")
    assert timedelta(0) <= datetime.fromisoformat(mine["placed_at"]) - now < timedelta(seconds=5)

    for _ in range(2):
        again = client.post(f"/dispatch/{callout_id}/deployment", json=body, headers=h)
        assert again.status_code == 200, again.text
    resector = client.post(
        f"/dispatch/{callout_id}/deployment", json={**body, "sector": "БУ-3"}, headers=h
    )
    assert resector.status_code == 200, resector.text

    added = _audit_details(engine, "callout.deployment_added", callout_id)
    moved = _audit_details(engine, "callout.deployment_moved", callout_id)
    assert len(added) == 1
    assert abs(added[0]["clock_skew_sec"] + 7200) <= 5
    assert [m["fields"] for m in moved] == [["sector"]]


def test_deployment_moved_logs_only_changed_fields(client):
    """В журнал перемещения — только то, что сдвинулось; повтор — ничего."""
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    uid = "test-deploy-fields"
    created = _sync(
        client, h, callout_id,
        {"creates": [{"client_uid": uid, "kind": "barrel_ext", "floor": "2",
                      "plan_x": 0.1, "plan_y": 0.2, "heading": 90}]},
    )
    pos_id = next(p["id"] for p in created["positions"] if p["client_uid"] == uid)

    # Правка из очереди шлёт координаты целиком, но сдвинулся только участок.
    patch = {"client_uid": uid, "plan_x": 0.1, "plan_y": 0.2, "heading": 90, "sector": "БУ-1"}
    assert _sync(client, h, callout_id, {"patches": [patch]})["applied"] == [uid]
    # Повтор той же правки: принят (очередь должна очиститься), в журнал не идёт.
    assert _sync(client, h, callout_id, {"patches": [patch]})["applied"] == [uid]
    # Повтор постановки со сдвинутой точкой — перемещение только по plan_x.
    _sync(
        client, h, callout_id,
        {"creates": [{"client_uid": uid, "kind": "barrel_ext", "floor": "2",
                      "plan_x": 0.6, "plan_y": 0.2, "heading": 90}]},
    )
    # Одиночный PATCH: только примечание; затем тот же PATCH ещё раз.
    for _ in range(2):
        r = client.patch(
            f"/dispatch/{callout_id}/deployment/{pos_id}",
            json={"note": "у лифтового холла", "heading": 90},
            headers=h,
        )
        assert r.status_code == 200, r.text

    moved = _audit_details(engine, "callout.deployment_moved", callout_id)
    assert [m["fields"] for m in moved] == [["sector"], ["plan_x"], ["note"]]


def test_deployment_sync_patch_rejection_is_keyed_by_client_uid(client):
    """Отказ по правке приходит под ключом очереди устройства.

    Для позиции, поставленной на плане, ключ очереди — client_uid. Сервер
    отвечал `srv:<id>`, клиент не находил отказ у себя и убирал правку как
    принятую: РТП не узнавал, что перемещение не записалось.
    """
    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)
    uid = "test-deploy-0012"
    _sync(
        client, h, callout_id,
        {"creates": [{"client_uid": uid, "kind": "barrel_ext", "floor": "3",
                      "plan_x": 0.2, "plan_y": 0.2}]},
    )

    # Правка по client_uid, без серверного id.
    moved = _sync(
        client, h, callout_id,
        {"patches": [{"client_uid": uid, "plan_x": 0.8, "plan_y": 0.9}]},
    )
    assert moved["applied"] == [uid]
    after = next(p for p in moved["positions"] if p["client_uid"] == uid)
    assert (after["plan_x"], after["plan_y"]) == (0.8, 0.9)

    gone = _sync(
        client, h, callout_id,
        {"patches": [
            {"id": 10_000_000, "client_uid": "test-deploy-gone-1", "heading": 90},
            {"client_uid": "test-deploy-gone-2", "heading": 90},
        ]},
    )
    assert gone["applied"] == []
    assert [r["key"] for r in gone["rejected"]] == ["test-deploy-gone-1", "test-deploy-gone-2"]


def test_report_export_is_audited_with_preliminary_flag(client):
    """Выгрузка донесения попадает в журнал, и незакрытый выезд помечен.

    Донесение уходит в дело. По журналу должно быть видно не только «кто и
    когда выгрузил», но и что именно: документ по идущему пожару — это
    предварительная версия, и через месяц отличить её от итоговой можно
    только по этой отметке.
    """
    from app.db import engine

    h = _login(client, "dispatcher", "dispatcher123")
    callout_id = _open_callout(client, h)

    active = client.post(f"/dispatch/{callout_id}/report/export", headers=h)
    assert active.status_code == 200, active.text
    assert active.json()["preliminary"] is True

    client.post(f"/dispatch/{callout_id}/close", json={"close_note": "e2e"}, headers=h)
    final = client.post(f"/dispatch/{callout_id}/report/export", headers=h)
    assert final.status_code == 200, final.text
    assert final.json()["preliminary"] is False

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT detail->>'preliminary' AS prelim FROM audit_log "
                "WHERE action = 'callout.report_exported' "
                "  AND (detail->>'callout_id')::bigint = :c "
                "ORDER BY id"
            ),
            {"c": callout_id},
        ).scalars().all()
    assert rows == ["true", "false"]


def test_report_export_unknown_callout_is_404(client):
    h = _login(client, "dispatcher", "dispatcher123")
    r = client.post("/dispatch/10000000/report/export", headers=h)
    assert r.status_code == 404


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


# --- audit trail: access denials, detail payload, no duplicates, pagination --
#
# Covers the "аттестация комиссии" gaps: denied GETs previously left no trace,
# POST /routes/visit was logged as a bare fact (no building/status), evidence
# photo views weren't audited at all, and "rich" self-audited actions were
# written twice (generic middleware row + the handler's own).


def _ensure_inspector_link(engine, username: str) -> int:
    """Roster row (`inspectors`) linked to the account via `user_id` FK.

    The one-time backfill in migration 0013 only links pairs that already
    matched by name+district *at migration time* — not guaranteed on a fresh
    test database — so link explicitly here, same as test_scoping.py's fixture.
    """
    with engine.begin() as conn:
        user = conn.execute(
            text("SELECT id, district FROM users WHERE username = :u"), {"u": username}
        ).mappings().first()
        row = conn.execute(
            text("SELECT id FROM inspectors WHERE user_id = :u"), {"u": user["id"]}
        ).scalar()
        if row is not None:
            return row
        return conn.execute(
            text(
                "INSERT INTO inspectors (name, district, user_id) "
                "VALUES ('Аудит · тестовый инспектор', :d, :u) RETURNING id"
            ),
            {"d": user["district"], "u": user["id"]},
        ).scalar()


def _audit_count(engine, **where) -> int:
    clauses = " AND ".join(f"{k} = :{k}" for k in where)
    with engine.connect() as conn:
        return conn.execute(
            text(f"SELECT count(*) FROM audit_log WHERE {clauses}"), where
        ).scalar()


def conn_scalar(engine, sql: str):
    with engine.connect() as conn:
        return conn.execute(text(sql)).scalar()


def test_denied_get_request_is_audited(client):
    """Пять подтверждённых отказов подряд по GET — раньше ноль строк в журнале
    (мидлварь аудировала только мутирующие методы). inspector не входит в
    FULL_ACCESS_ROLES — /audit ему всегда 403."""
    from app.db import engine

    h = _login(client, "inspector", "inspector123")
    before = _audit_count(engine, path="/audit", status_code=403)
    for _ in range(5):
        r = client.get("/audit", headers=h)
        assert r.status_code == 403, r.text
    after = _audit_count(engine, path="/audit", status_code=403)
    assert after - before == 5


def test_visit_is_recorded_once_with_building_detail(client):
    """«Что конкретно сделал инспектор» — building_id/status в detail, и ровно
    одна строка на действие (не generic-мидлварь + свой audit() отдельно)."""
    from app.db import engine

    h = _login(client, "inspector", "inspector123")
    _ensure_inspector_link(engine, "inspector")
    building_id = conn_scalar(
        engine, "SELECT id FROM buildings WHERE district = 'Есильский' LIMIT 1"
    )

    before = _audit_count(engine, path="/routes/visit")
    r = client.post(
        "/routes/visit",
        headers=h,
        json={"building_id": building_id, "status": "done"},
    )
    assert r.status_code == 200, r.text
    after = _audit_count(engine, path="/routes/visit")
    # Ровно одна новая строка — не пара (generic + свой audit()).
    assert after - before == 1

    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT action, detail FROM audit_log "
                "WHERE path = '/routes/visit' ORDER BY ts DESC LIMIT 1"
            )
        ).mappings().first()
    assert row["action"] == "visit.recorded"
    assert row["detail"]["building_id"] == building_id
    assert row["detail"]["status"] == "done"


def test_visit_photo_view_is_audited(client):
    from app.db import engine

    h = _login(client, "inspector", "inspector123")
    up = client.post(
        "/routes/visit/photo",
        headers=h,
        files={"file": ("x.png", b"\x89PNG\r\n", "image/png")},
    )
    assert up.status_code == 200, up.text
    photo_id = up.json()["id"]

    before = _audit_count(engine, action="read.visit_photo")
    r = client.get(f"/routes/visit/photo/{photo_id}", headers=h)
    assert r.status_code == 200, r.text
    after = _audit_count(engine, action="read.visit_photo")
    assert after - before == 1

    with engine.connect() as conn:
        detail = conn.execute(
            text(
                "SELECT detail FROM audit_log WHERE action = 'read.visit_photo' "
                "ORDER BY ts DESC LIMIT 1"
            )
        ).scalar()
    assert detail["photo_id"] == photo_id


def test_rich_mutating_action_is_not_duplicated_generically(client):
    """user.created (auth.py, self-audited) не должен получать вторую,
    generic-строку от мидлвари — тот же путь/метод, тот же запрос."""
    from app.db import engine

    username = "zz_test_dup_check"
    h = _login(client, "admin", "admin123")
    before = _audit_count(engine, path="/auth/users")
    try:
        r = client.post(
            "/auth/users",
            headers=h,
            json={
                "username": username,
                "password": "password123",
                "name": "Дубль-тест",
                "role": "leadership",
            },
        )
        assert r.status_code == 200, r.text
        after = _audit_count(engine, path="/auth/users")
        assert after - before == 1
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE username = :u"), {"u": username})


def test_audit_pagination_offset_moves_the_window(client):
    h = _login(client, "admin", "admin123")
    page1 = client.get("/audit?limit=3&offset=0", headers=h).json()
    page2 = client.get("/audit?limit=3&offset=3", headers=h).json()
    assert page1["events"], "ожидались события на первой странице"
    ids1 = {e["id"] for e in page1["events"]}
    ids2 = {e["id"] for e in page2["events"]}
    assert ids1.isdisjoint(ids2)
    assert page1["matched"] == page2["matched"]


def test_audit_date_filter_excludes_future_range(client):
    h = _login(client, "admin", "admin123")
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    r = client.get(f"/audit?date_from={tomorrow}", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["matched"] == 0
    assert d["events"] == []


def test_audit_date_filter_includes_today(client):
    h = _login(client, "admin", "admin123")
    today = date.today().isoformat()
    r = client.get(f"/audit?date_from={today}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["matched"] > 0


# --- owner portal: score explanation + reviewer name (UX audit #4, #6) -----


def test_owner_portal_summary_translates_type_and_surfaces_top_factors():
    """Owner-facing #4/#5 from the UX audit: a bare `residential`/`11` on the
    portal card explains nothing to an ОСИ chair. `/portal/summary` must ship
    a translated `building_type_label` and a small, honest slice of the SHAP
    explanation (top 2 factors) — without opening the full `/buildings/{id}`
    dashboard, which stays closed to owner by design (district-scoped)."""
    import json as _json

    from app.db import engine
    from app.main import app

    explanation = [
        {"feature": "Деревянные перекрытия", "value": 27.4},
        {"feature": "Возраст здания", "value": 23.4},
        {"feature": "Капитальный ремонт (недавний)", "value": -1.2},
    ]
    with engine.begin() as conn:
        bid = conn.execute(
            text(
                f"INSERT INTO buildings (address, building_type, district, geom) "
                f"VALUES ('портал-тест', 'industrial', 'Есильский', {_POLY}) RETURNING id"
            )
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO risk_scores (building_id, score, model_version, explanation) "
                "VALUES (:b, 58, 'test', CAST(:e AS JSONB))"
            ),
            {"b": bid, "e": _json.dumps(explanation, ensure_ascii=False)},
        )
        owner_id = conn.execute(
            text("SELECT id FROM users WHERE username = 'owner'")
        ).scalar()
        conn.execute(
            text("INSERT INTO owner_buildings (user_id, building_id) VALUES (:u, :b)"),
            {"u": owner_id, "b": bid},
        )

    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        h = _login(c, "owner", "owner123")
        r = c.get("/portal/summary", headers=h)
        assert r.status_code == 200, r.text
        b = next(x for x in r.json()["buildings"] if x["id"] == bid)
        assert b["building_type"] == "industrial"
        assert b["building_type_label"] == "Производственное"  # not the raw English value
        assert b["top_factors"] == explanation[:2]  # top 2, |value| desc, never the -1.2 tail


def test_owner_portal_remediation_reviewed_by_name_is_human_readable():
    """#6 from the UX audit: the portal showed the reviewer's login
    ("inspector") instead of a name. `reviewed_by` (the login, kept for
    compatibility) must be joined to `users.name` in `reviewed_by_name`."""
    from app.db import engine
    from app.main import app

    with engine.begin() as conn:
        bid = conn.execute(
            text(
                f"INSERT INTO buildings (address, building_type, district, geom) "
                f"VALUES ('портал-тест-2', 'residential', 'Сарыаркинский', {_POLY}) RETURNING id"
            )
        ).scalar()
        owner_id = conn.execute(
            text("SELECT id FROM users WHERE username = 'owner'")
        ).scalar()
        inspector_name = conn.execute(
            text("SELECT name FROM users WHERE username = 'inspector'")
        ).scalar()
        conn.execute(
            text("INSERT INTO owner_buildings (user_id, building_id) VALUES (:u, :b)"),
            {"u": owner_id, "b": bid},
        )
        card_id = conn.execute(
            text(
                "INSERT INTO operational_cards (building_id, filename, status, district) "
                "VALUES (:b, 'tmp.pdf', 'reviewed', 'Сарыаркинский') RETURNING id"
            ),
            {"b": bid},
        ).scalar()
        presc_id = conn.execute(
            text(
                "INSERT INTO prescriptions (card_id, recommendation, severity, status) "
                "VALUES (:c, 'Проверить огнетушители', 'high', 'approved') RETURNING id"
            ),
            {"c": card_id},
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO remediations (prescription_id, submitted_by, note, status, reviewed_by, reviewed_at) "
                "VALUES (:p, 'owner', 'Заменено', 'accepted', 'inspector', now())"
            ),
            {"p": presc_id},
        )

    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        h = _login(c, "owner", "owner123")
        r = c.get("/portal/prescriptions", headers=h)
        assert r.status_code == 200, r.text
        presc = next(x for x in r.json() if x["id"] == presc_id)
        rem = presc["remediation"]
        assert rem["reviewed_by"] == "inspector"
        assert rem["reviewed_by_name"] == inspector_name
        assert rem["reviewed_by_name"] != "inspector"
