"""DB-integration test: coverage_source honesty for mixed/stale isochrones.

Ревью нашёл, что /infra/stats, /infra/coverage и /infra/blind-zones раньше не
различали «все части — по дорогам» от «часть частей — буфер (изохроны никогда
не было) или устаревшая изохрона (последний пересчёт для этой части не
удался, а прежняя не удаляется, см. rebuild_coverage)». `_resolve_coverage_source`
в app/routers/infra.py — единственный источник этой логики; юнит-тесты в
test_unit.py проверяют её как чистую функцию от счётчиков. Здесь то же самое
проверяется на настоящем PostGIS: `_stations_stale_isochrones` сравнивает
`computed_at` через реальный JOIN и интервальную арифметику, которую мок не
исполняет.

Runs only when FW_RUN_DB_TESTS=1 and DATABASE_URL points at a PostGIS database
whose name contains "test" (same guard as test_db_integration.py) — the
fixture writes to fire_stations/station_isochrones and cleans up after itself,
but only a dedicated test database is safe to point this at.
"""

import os

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
            "фикстура пишет в fire_stations/station_isochrones — нужна "
            "выделенная база с «test» в имени, как в test_db_integration.py"
        ),
    ),
]

_PT = "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)"
_SECONDS = 600  # settings.arrival_normative_min (10) * 60 — стандартный норматив


@pytest.fixture(scope="module", autouse=True)
def _migrated_and_seeded():
    """Схема (alembic head) и тестовые пользователи (admin/admin123 — нужен
    второму тесту для логина). Идемпотентно — безопасно повторять, если файл
    запускается в одной pytest-сессии с test_db_integration.py."""
    from scripts import init_db, seed_users

    init_db.main()
    seed_users.main()


@pytest.fixture
def stations_and_isochrones():
    """Три части, три разных состояния изохроны под один норматив:

    - «missing» — изохроны никогда не было (новая часть, или всегда падал OSRM);
    - «stale»   — изохрона есть, но заметно (> 5 мин) старше самой свежей в
      таблице — как если бы rebuild_coverage не смог пересчитать именно эту
      часть в последнем проходе и оставил прежнюю геометрию (см. item 3);
    - «fresh»   — изохрона только что пересчитана.

    Это ровно смешанный случай, который coverage_source должен читать как
    "mixed", а не молча как "osrm" (была хоть одна изохрона) или "buffer".
    """
    from app.db import engine

    ids: list[int] = []
    with engine.begin() as conn:
        for name, lng, lat in [
            ("ПЧ-тест-missing", 71.40, 51.10),
            ("ПЧ-тест-stale", 71.41, 51.11),
            ("ПЧ-тест-fresh", 71.42, 51.12),
        ]:
            sid = conn.execute(
                text(
                    f"INSERT INTO fire_stations (name, geom) VALUES (:n, {_PT}) "
                    "RETURNING id"
                ),
                {"n": name, "lng": lng, "lat": lat},
            ).scalar()
            ids.append(sid)

        missing_id, stale_id, fresh_id = ids

        conn.execute(
            text(
                "INSERT INTO station_isochrones "
                "(station_id, seconds, geom, source, points, computed_at) "
                f"VALUES (:sid, :sec, ST_Multi(ST_Buffer({_PT}::geography, 500)::geometry), "
                "'osrm', 10, now() - interval '1 day')"
            ),
            {"sid": stale_id, "sec": _SECONDS, "lng": 71.41, "lat": 51.11},
        )
        conn.execute(
            text(
                "INSERT INTO station_isochrones "
                "(station_id, seconds, geom, source, points, computed_at) "
                f"VALUES (:sid, :sec, ST_Multi(ST_Buffer({_PT}::geography, 500)::geometry), "
                "'osrm', 12, now())"
            ),
            {"sid": fresh_id, "sec": _SECONDS, "lng": 71.42, "lat": 51.12},
        )
        # missing_id намеренно остаётся без строки в station_isochrones.

    yield {
        "missing_id": missing_id,
        "stale_id": stale_id,
        "fresh_id": fresh_id,
        "seconds": _SECONDS,
    }

    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM station_isochrones WHERE station_id = ANY(:ids)"),
            {"ids": ids},
        )
        conn.execute(text("DELETE FROM fire_stations WHERE id = ANY(:ids)"), {"ids": ids})


def test_stale_and_missing_helpers_agree_on_mixed_case(stations_and_isochrones):
    """_stations_missing_isochrones и _stations_stale_isochrones — реальный SQL
    на реальном PostGIS, не мок: сортируют части по трём непересекающимся
    вёдрам ровно так, как ожидает _resolve_coverage_source."""
    from app.db import SessionLocal
    from app.routers.infra import (
        _resolve_coverage_source,
        _stations_missing_isochrones,
        _stations_stale_isochrones,
        _stations_total,
    )

    fx = stations_and_isochrones
    db = SessionLocal()
    try:
        missing_ids = {r["id"] for r in _stations_missing_isochrones(db, fx["seconds"])}
        stale_ids = {r["id"] for r in _stations_stale_isochrones(db, fx["seconds"])}

        assert fx["missing_id"] in missing_ids
        assert fx["stale_id"] not in missing_ids  # у неё ЕСТЬ строка, просто старая
        assert fx["fresh_id"] not in missing_ids

        assert fx["stale_id"] in stale_ids
        assert fx["fresh_id"] not in stale_ids
        assert fx["missing_id"] not in stale_ids  # это другое ведро — нет строки вовсе

        total = _stations_total(db)
        assert total >= 3
        assert _resolve_coverage_source(total, len(missing_ids), len(stale_ids)) == "mixed"
    finally:
        db.close()


def test_infra_stats_reports_mixed_with_honest_counts(stations_and_isochrones):
    """То же самое сквозь реальную HTTP-ручку: /infra/stats обязана показать
    coverage_source: "mixed" и оба счётчика, а не молчаливое "osrm" — ровно
    баг, который ревью нашло в легенде карты (web/src/app/infra/page.tsx)."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        login = client.post(
            "/auth/login", json={"username": "admin", "password": "admin123"}
        )
        assert login.status_code == 200, login.text
        headers = {"Authorization": f"Bearer {login.json()['token']}"}

        resp = client.get("/infra/stats", headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()

    assert body["coverage_source"] == "mixed"
    assert body["approximate"] is True
    assert body["stations_missing_isochrones"] >= 1
    assert body["stations_stale_isochrones"] >= 1
