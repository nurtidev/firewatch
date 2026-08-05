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
from datetime import date, timedelta

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
        engine, "SELECT id FROM buildings WHERE district = 'Сарыаркинский' LIMIT 1"
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
