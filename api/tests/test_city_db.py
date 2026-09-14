"""/city на живой PostGIS: суммы по районам == итог города, форма ответов,
граница акимата (200/403, без ПТП) и идемпотентность seed_districts.

Запускается только при FW_RUN_DB_TESTS=1 и базе с «test» в имени: фикстура
очищает здания (и всё, что на них ссылается), выезды, гидранты и пожарные
части — как test_db_integration. На общей dev-базе это снесло бы демо-данные.

Данные строятся от настоящих полигонов районов: по три здания (оценки 70, 45,
10) у точки ST_PointOnSurface каждого района, заведённые с ЧУЖИМ районом, и
одно здание восточнее всех полигонов без района — seed_districts обязан
разложить их правильно. В первом районе — часть, исправный гидрант рядом со
зданиями и два выезда с отметками времени; во втором — сломанный гидрант и
оперкарточка с предписаниями.
"""

import os
from datetime import datetime

import pytest
from sqlalchemy import text


def _is_dedicated_test_db() -> bool:
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
        reason="фикстура очищает buildings/hydrants/fire_stations — нужна база с «test» в имени",
    ),
]

# Восточнее всех полигонов районов (присоединённые земли не разбиты на районы).
_OUTSIDE = (72.1, 51.15)
_SCORES = (70, 45, 10)  # critical, high, low
_PREFIX = "city-test"


def _clean(conn) -> None:
    # Порядок — по внешним ключам: всё, что ссылается на buildings, затем сами
    # здания; выезды — до частей (callouts.station_id без каскада). У частей
    # station_vehicles/station_isochrones удаляются каскадом, users.station_id
    # обнуляется (ON DELETE SET NULL).
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
    conn.execute(text("DELETE FROM hydrants"))
    conn.execute(text("DELETE FROM fire_stations"))


def _building(conn, lon, lat, district, address, score) -> int:
    bid = conn.execute(
        text(
            "INSERT INTO buildings (address, building_type, district, geom) "
            "VALUES (:a, 'residential', :d, ST_MakeEnvelope("
            ":lon - 0.0001, :lat - 0.00007, :lon + 0.0001, :lat + 0.00007, 4326)) "
            "RETURNING id"
        ),
        {"a": address, "d": district, "lon": lon, "lat": lat},
    ).scalar()
    if score is not None:
        conn.execute(
            text(
                "INSERT INTO risk_scores (building_id, score, model_version) "
                "VALUES (:b, :s, 'test')"
            ),
            {"b": bid, "s": score},
        )
    return bid


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.db import engine
    from app.main import app
    from scripts import init_db, seed_districts, seed_users

    init_db.main()
    seed_users.main()

    with engine.begin() as conn:
        _clean(conn)
        seed_districts.upsert_districts(conn, seed_districts.load_features())
        anchors = conn.execute(
            text(
                "SELECT name, ST_X(ST_PointOnSurface(geom)) AS lon, "
                "ST_Y(ST_PointOnSurface(geom)) AS lat FROM districts ORDER BY id"
            )
        ).mappings().all()
        names = [a["name"] for a in anchors]

        ids: dict[str, list[int]] = {}
        for k, a in enumerate(anchors):
            wrong = names[(k + 1) % len(names)]  # заведомо чужой район
            ids[a["name"]] = [
                _building(conn, a["lon"] + i * 0.0004, a["lat"], wrong,
                          f"{_PREFIX} {a['name']} {i}", score)
                for i, score in enumerate(_SCORES)
            ]
        outside = _building(conn, *_OUTSIDE, None, f"{_PREFIX} вне районов", None)

        first, second, third, fourth = anchors[0], anchors[1], anchors[2], anchors[3]
        station_id = conn.execute(
            text(
                "INSERT INTO fire_stations (name, geom) "
                "VALUES (:n, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) RETURNING id"
            ),
            {"n": f"{_PREFIX} ПЧ", "lon": first["lon"], "lat": first["lat"]},
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO hydrants (status, geom) VALUES "
                "('ok', ST_SetSRID(ST_MakePoint(:lon1, :lat1), 4326)), "
                "('broken', ST_SetSRID(ST_MakePoint(:lon2, :lat2), 4326))"
            ),
            {"lon1": first["lon"] + 0.0004, "lat1": first["lat"],
             "lon2": second["lon"], "lat2": second["lat"]},
        )
        # Выезды в первом районе: ход 6 и 8 минут (медиана 7,0); третий — старше
        # окна в 90 дней и в сводку не входит.
        for travel_min, days_ago in ((6, 5), (8, 10), (30, 120)):
            conn.execute(
                text(
                    """
                    INSERT INTO callouts
                        (geom, callout_type, status, station_id, created_by,
                         created_at, dispatched_at, arrived_at)
                    VALUES (ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 'fire', 'closed',
                            :sid, 'dispatcher',
                            now() - make_interval(days => :d),
                            now() - make_interval(days => :d) + interval '1 minute',
                            now() - make_interval(days => :d)
                                  + make_interval(mins => 1 + :t))
                    """
                ),
                {"lon": first["lon"], "lat": first["lat"], "sid": station_id,
                 "d": days_ago, "t": travel_min},
            )

        card_id = conn.execute(
            text(
                "INSERT INTO operational_cards (building_id, filename, status, district) "
                "VALUES (:b, :f, 'extracted', 'Неверный') RETURNING id"
            ),
            {"b": ids[second["name"]][0], "f": f"{_PREFIX}.json"},
        ).scalar()
        presc = {}
        for key, status in (("open", "approved"), ("closed", "approved"), ("draft", "pending")):
            presc[key] = conn.execute(
                text(
                    "INSERT INTO prescriptions (card_id, recommendation, severity, status) "
                    "VALUES (:c, 'Проверить огнетушители', 'high', :s) RETURNING id"
                ),
                {"c": card_id, "s": status},
            ).scalar()
        conn.execute(
            text(
                "INSERT INTO remediations "
                "(prescription_id, submitted_by, note, status, reviewed_by, reviewed_at) "
                "VALUES (:p, 'owner', 'Заменено', 'accepted', 'inspector', now())"
            ),
            {"p": presc["closed"]},
        )

        report_linked = conn.execute(
            text(
                "INSERT INTO field_reports (category, description, geom, building_id, "
                "district, created_by, created_role) VALUES ('other', 'тест', "
                "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), :b, 'Неверный', "
                "'inspector', 'inspector') RETURNING id"
            ),
            {"lon": third["lon"], "lat": third["lat"], "b": ids[third["name"]][0]},
        ).scalar()
        report_free = conn.execute(
            text(
                "INSERT INTO field_reports (category, description, geom, building_id, "
                "district, created_by, created_role) VALUES ('other', 'тест', "
                "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), NULL, NULL, "
                "'admin', 'admin') RETURNING id"
            ),
            {"lon": fourth["lon"], "lat": fourth["lat"]},
        ).scalar()

        first_run = seed_districts.run(conn)

    c = TestClient(app)
    c.names = names                  # type: ignore[attr-defined]
    c.ids = ids                      # type: ignore[attr-defined]
    c.outside = outside              # type: ignore[attr-defined]
    c.card_id = card_id              # type: ignore[attr-defined]
    c.report_linked = report_linked  # type: ignore[attr-defined]
    c.report_free = report_free      # type: ignore[attr-defined]
    c.first_run = first_run          # type: ignore[attr-defined]
    yield c

    with engine.begin() as conn:
        _clean(conn)


def _login(client, username: str) -> dict:
    r = client.post("/auth/login", json={"username": username, "password": f"{username}123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _scalar(sql: str, **params):
    from app.db import engine

    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


# --- seed_districts -------------------------------------------------------------


def test_seed_districts_reassigns_buildings_reports_and_cards(client):
    stats = client.first_run
    assert stats["buildings_changed"] == 5 * len(_SCORES) + 1
    assert stats["field_reports_changed"] == 2
    assert stats["cards_changed"] == 1
    assert stats["outside_polygons"] == 1


def test_buildings_land_in_their_polygon_and_outside_gets_nearest(client):
    for name, bids in client.ids.items():
        got = _scalar(
            "SELECT string_agg(DISTINCT district, ',') FROM buildings WHERE id = ANY(:ids)",
            ids=bids,
        )
        assert got == name
    assert _scalar("SELECT district FROM buildings WHERE id = :i", i=client.outside) in client.names


def test_denormalized_districts_follow_the_building_or_the_point(client):
    third, fourth, second = client.names[2], client.names[3], client.names[1]
    assert _scalar("SELECT district FROM field_reports WHERE id = :i", i=client.report_linked) == third
    assert _scalar("SELECT district FROM field_reports WHERE id = :i", i=client.report_free) == fourth
    assert _scalar("SELECT district FROM operational_cards WHERE id = :i", i=client.card_id) == second


def test_seed_districts_second_run_changes_nothing(client):
    from app.db import engine
    from scripts import seed_districts

    with engine.begin() as conn:
        stats = seed_districts.run(conn)
    assert seed_districts.changed_rows(stats) == 0
    assert stats["before"] == stats["after"]


def test_demo_inspector_and_registry_row_live_in_esil():
    assert _scalar("SELECT district FROM users WHERE username = 'inspector'") == "Есильский"
    registry = _scalar(
        "SELECT i.district FROM inspectors i JOIN users u ON u.id = i.user_id "
        "WHERE u.username = 'inspector'"
    )
    assert registry in (None, "Есильский")  # строка реестра может быть не заведена


# --- /city/summary --------------------------------------------------------------


def test_summary_district_sums_equal_city_totals(client):
    from app.routers import city

    r = client.get("/city/summary", headers=_login(client, "akimat"))
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["demo_data"] is True
    datetime.fromisoformat(body["computed_at"])
    # Изохрон в тестовой базе нет — зона прибытия по буферу и честно приблизительна.
    assert (body["coverage_source"], body["approximate"]) == ("buffer", True)
    assert body["method"] == city.SUMMARY_METHOD
    assert body["unassigned"] == {"buildings": 0, "open_prescriptions": 0}

    districts = body["districts"]
    assert sorted(d["name"] for d in districts) == sorted(client.names)
    assert [d["rank"] for d in districts] == [1, 2, 3, 4, 5]
    for field in city._COUNT_FIELDS:
        assert sum(d[field] for d in districts) == body["city"][field], field
    for band, _ in city.BAND_KEYS:
        assert sum(d["bands"][band] for d in districts) == body["city"]["bands"][band], band

    town = body["city"]
    assert town["buildings_total"] == 5 * len(_SCORES) + 1
    assert town["bands"] == {"critical": 5, "high": 5, "elevated": 0, "low": 5}
    assert (town["stations_total"], town["hydrants_total"], town["hydrants_broken"]) == (1, 2, 1)
    assert town["callouts_90d"] == 2
    assert town["median_arrival_min"] == 7.0
    assert town["open_prescriptions"] == 1

    by_name = {d["name"]: d for d in districts}
    first, second = client.names[0], client.names[1]
    # Первый район: гидрант рядом и часть рядом — ни одного «здания внимания».
    assert by_name[first]["attention_buildings"] == 0
    assert by_name[first]["rank"] == 5
    assert by_name[first]["median_arrival_min"] == 7.0
    # Остальные: 70 и 45 без исправного гидранта в 800 м.
    assert all(by_name[n]["attention_buildings"] == 2 for n in client.names[1:])
    assert by_name[second]["hydrants_broken"] == 1
    assert by_name[second]["open_prescriptions"] == 1
    assert by_name[second]["name_kk"] and by_name[second]["name_en"]
    # Сводка — только счётчики: ни одного адреса.
    assert _PREFIX not in r.text


# --- /city/districts.geojson ---------------------------------------------------


def test_districts_geojson_matches_summary(client):
    from app.routers import city

    h = _login(client, "akimat")
    r = client.get("/city/districts.geojson", headers=h)
    assert r.status_code == 200, r.text
    fc = r.json()
    summary = client.get("/city/summary", headers=h).json()

    assert fc["type"] == "FeatureCollection"
    assert fc["demo_data"] is True and fc["attribution"] == city.ATTRIBUTION
    expected = {
        d["name"]: (d["rank"], d["attention_buildings"], d["buildings_total"])
        for d in summary["districts"]
    }
    assert [f["properties"]["rank"] for f in fc["features"]] == [1, 2, 3, 4, 5]
    for feature in fc["features"]:
        props = feature["properties"]
        assert set(props) == {"name", "name_kk", "name_en", "rank",
                              "attention_buildings", "buildings_total"}
        assert (props["rank"], props["attention_buildings"], props["buildings_total"]) == expected[props["name"]]
        assert feature["geometry"]["type"] in ("Polygon", "MultiPolygon")
    # Упрощённые полигоны заметно легче исходного файла (179 КБ).
    assert len(r.content) < 120_000


# --- /city/priorities ------------------------------------------------------------


def test_priorities_shape_limits_and_order(client):
    from app.routers import city

    h = _login(client, "akimat")
    for bad in (0, 51):
        assert client.get(f"/city/priorities?limit={bad}", headers=h).status_code == 422

    body = client.get("/city/priorities?limit=2", headers=h).json()
    assert body["demo_data"] is True
    assert (body["cell_m"], body["hydrant_radius_m"]) == (500, 800)
    assert body["method"] == city.PRIORITIES_METHOD
    assert 0 < len(body["hydrant_gaps"]) <= 2
    assert 0 < len(body["station_gaps"]) <= 2

    full = client.get("/city/priorities?limit=50", headers=h).json()
    for cell in full["hydrant_gaps"]:
        assert set(cell) == {"cell_id", "lon", "lat", "district", "buildings",
                             "avg_score", "max_score", "sample_addresses"}
        assert cell["district"] in client.names
        assert 70.9 < cell["lon"] < 72.3 and 50.8 < cell["lat"] < 51.5
        assert len(cell["sample_addresses"]) <= 3
        assert cell["max_score"] >= city.HIGH_MIN_SCORE
    for cell in full["station_gaps"]:
        assert set(cell) == {"cell_id", "lon", "lat", "district", "blind_buildings",
                             "high_risk_blind", "avg_score", "sample_addresses"}
        assert len(cell["sample_addresses"]) <= 3

    # По 2 здания высокого риска (70 и 45) без воды в каждом районе, кроме первого.
    assert sum(c["buildings"] for c in full["hydrant_gaps"]) == 8
    assert client.names[0] not in {c["district"] for c in full["hydrant_gaps"]}
    ranking = [c["buildings"] * c["avg_score"] for c in full["hydrant_gaps"]]
    assert ranking == sorted(ranking, reverse=True)
    station_rank = [(c["high_risk_blind"] * (c["avg_score"] or 0), c["blind_buildings"])
                    for c in full["station_gaps"]]
    assert station_rank == sorted(station_rank, reverse=True)


# --- граница акимата на живой базе ---------------------------------------------

AKIMAT_OK = [
    "/city/summary",
    "/city/districts.geojson",
    "/city/priorities",
    "/buildings",
    f"/buildings/search?q={_PREFIX}",
    "/buildings/freshness",
    "/infra/stats",
    "/infra/stations",
    "/infra/hydrants",
    "/infra/coverage",
    "/infra/blind-zones",
    "/infra/routing/health",
    "/auth/me",
]

AKIMAT_FORBIDDEN = [
    ("GET", "/reports"),
    ("GET", "/reports/geojson"),
    ("GET", "/cards"),
    ("GET", "/cards/{card}"),
    ("GET", "/cards/{card}/file"),
    ("POST", "/chat"),
    ("GET", "/audit"),
    ("GET", "/dispatch"),
    ("GET", "/forces/presets"),
    ("GET", "/routes/progress"),
    ("GET", "/inspectors"),
    ("GET", "/portal/summary"),
    ("GET", "/auth/users"),
    ("GET", "/model"),
    ("GET", "/overview"),
    ("GET", "/infra/routing/calibration"),
    ("POST", "/infra/hydrants/1/status"),
    ("POST", "/reports"),
]


@pytest.mark.parametrize("path", AKIMAT_OK)
def test_akimat_allowed_list_is_200(client, path):
    r = client.get(path, headers=_login(client, "akimat"))
    assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"


def test_akimat_forbidden_list_is_403(client):
    h = _login(client, "akimat")
    for method, path in AKIMAT_FORBIDDEN:
        path = path.format(card=client.card_id)
        r = client.request(method, path, headers=h, json=None if method == "GET" else {})
        assert r.status_code == 403, f"{method} {path}: {r.status_code}"


def test_akimat_buildings_list_is_citywide(client):
    feats = client.get("/buildings", headers=_login(client, "akimat")).json()["features"]
    assert len(feats) == 5 * len(_SCORES) + 1


def test_akimat_building_detail_has_no_ptp_card(client):
    bid = client.ids[client.names[1]][0]  # здание с оперкарточкой и предписаниями
    body = client.get(f"/buildings/{bid}", headers=_login(client, "akimat")).json()
    assert body["card"] is None
    assert set(body) == {
        "id", "osm_id", "address", "building_type", "type_label", "osm_tag",
        "year_built", "floors", "score", "model_version", "explanation",
        "computed_at", "card",
    }
    # Руководство видит ту же сводку ПТП — редакция именно для городского трека.
    lead = client.get(f"/buildings/{bid}", headers=_login(client, "minister")).json()
    assert lead["card"] is not None


@pytest.mark.parametrize("username", ["inspector", "supervisor", "dispatcher", "responder", "owner"])
def test_city_is_closed_to_dchs_field_and_external_roles(client, username):
    assert client.get("/city/summary", headers=_login(client, username)).status_code == 403


@pytest.mark.parametrize("username", ["minister", "admin"])
def test_city_is_open_to_leadership_and_admin(client, username):
    assert client.get("/city/summary", headers=_login(client, username)).status_code == 200
