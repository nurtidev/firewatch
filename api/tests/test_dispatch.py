"""Боевой-модуль validation tests: bad input is rejected before it reaches the
database. No database required — `current_user`/`get_db` are overridden like in
test_guards.py / test_reports.py; only Pydantic-level 422s are asserted (a valid
request fails downstream at the stubbed DB, which is expected).
"""

import pytest

from app.db import get_db
from app.main import app
from app.routers.auth import current_user

# Mutable role holder so a single client can exercise different боевой roles.
_ROLE = {"value": "dispatcher"}


def _fake_current_user() -> dict:
    return {
        "username": "disp1",
        "role": _ROLE["value"],
        "name": "Dispatcher",
        "district": None,
    }


def _fake_get_db():
    yield None


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    app.dependency_overrides[current_user] = _fake_current_user
    app.dependency_overrides[get_db] = _fake_get_db
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_role():
    _ROLE["value"] = "dispatcher"
    yield
    _ROLE["value"] = "dispatcher"


# --- POST /dispatch: validation --------------------------------------------


def test_create_callout_requires_location(client):
    # Neither building_id nor lat+lng — no point to dispatch to.
    resp = client.post("/dispatch", json={"callout_type": "fire"})
    assert resp.status_code == 422


def test_create_callout_partial_coords_rejected(client):
    # lat without lng is not a usable point.
    resp = client.post("/dispatch", json={"lat": 51.16, "callout_type": "fire"})
    assert resp.status_code == 422


def test_create_callout_rejects_unknown_type(client):
    resp = client.post(
        "/dispatch", json={"lat": 51.16, "lng": 71.44, "callout_type": "boom"}
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_lat", [-90.5, 90.5, 200])
def test_create_callout_rejects_lat_out_of_range(client, bad_lat):
    resp = client.post(
        "/dispatch", json={"lat": bad_lat, "lng": 71.44, "callout_type": "fire"}
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("bad_lng", [-180.5, 180.5, 999])
def test_create_callout_rejects_lng_out_of_range(client, bad_lng):
    resp = client.post(
        "/dispatch", json={"lat": 51.16, "lng": bad_lng, "callout_type": "fire"}
    )
    assert resp.status_code == 422


def test_create_callout_by_building_passes_validation(client):
    resp = client.post("/dispatch", json={"building_id": 1, "callout_type": "smoke"})
    assert resp.status_code not in (401, 403, 422)


def test_create_callout_by_point_passes_validation(client):
    resp = client.post(
        "/dispatch",
        json={"lat": 51.16, "lng": 71.44, "callout_type": "fire", "address": "ул. Абая 1"},
    )
    assert resp.status_code not in (401, 403, 422)


# --- GET /dispatch: status filter validation -------------------------------


def test_list_callouts_rejects_bad_status(client):
    _ROLE["value"] = "responder"
    resp = client.get("/dispatch?status=weird")
    assert resp.status_code == 422


# --- POST /infra/hydrants/{id}/status: validation --------------------------


def test_hydrant_status_rejects_unknown_status(client):
    resp = client.post("/infra/hydrants/1/status", json={"status": "wet"})
    assert resp.status_code == 422


def test_hydrant_status_valid_passes_validation(client):
    resp = client.post("/infra/hydrants/1/status", json={"status": "broken"})
    assert resp.status_code not in (401, 403, 422)


# --- PATCH /dispatch/{id}: validation ---------------------------------------


def test_patch_callout_requires_a_field(client):
    # Пустое тело — нечего переназначать.
    resp = client.patch("/dispatch/1", json={})
    assert resp.status_code == 422


def test_patch_callout_building_passes_validation(client):
    resp = client.patch("/dispatch/1", json={"building_id": 1401})
    assert resp.status_code not in (401, 403, 422)


def test_patch_callout_forbidden_for_responder(client):
    _ROLE["value"] = "responder"
    resp = client.patch("/dispatch/1", json={"station_id": 1})
    assert resp.status_code == 403


# --- нормализация адреса ----------------------------------------------------
#
# Диспетчер печатает с русской раскладки, где нет казахских букв. Свёртка должна
# сводить обе стороны сравнения к одному виду — иначе поиск молчит на вызове.

import json  # noqa: E402
from pathlib import Path  # noqa: E402

from app.routers import dispatch as D  # noqa: E402

_SEED_DIR = Path(__file__).resolve().parents[1] / "scripts" / "seed_data"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Тәуелсіздік даңғылы 33", "тауелсиздик дангили 33"),
        ("Сарайшық көшесі 7/1", "сарайшик кошеси 7/1"),
        # запрос с русской раскладки сворачивается в то же самое
        ("тауелсиздик 33", "тауелсиздик 33"),
        ("сарайшик 7/1", "сарайшик 7/1"),
        ("Мәңгілік Ел", "мангилик ел"),
    ],
)
def test_norm_addr_folds_kazakh_letters(raw, expected):
    assert D.norm_addr(raw) == expected


def test_norm_addr_table_lengths_match():
    # translate() в SQL требует строк одинаковой длины — рассинхрон таблиц ломает
    # нормализацию адреса в БД молча.
    assert len(D._FOLD_FROM) == len(D._FOLD_TO)


@pytest.mark.parametrize(
    "token,variant",
    [
        ("3з", "33"),      # опечатка в номере дома: кириллическая «з» вместо 3
        ("зз", None),      # без цифры это слово, а не номер — не трогаем
        ("33", None),      # менять нечего
        ("7б", "76"),      # дополнительный вариант, исходный токен не теряется
        ("тауелсиздик", None),
    ],
)
def test_digit_variant(token, variant):
    assert D._digit_variant(token) == variant


def test_like_escape_neutralizes_wildcards():
    assert D._like_escape("100%") == "100\\%"
    assert D._like_escape("a_b") == "a\\_b"


# --- расчёт сил из карточки ПТП ---------------------------------------------


def test_other_type_has_forces_preset():
    # ЖК «Аланда» в реестре OSM — `other`; без записи в маппинге пакет уходил в
    # калькулятор с дефолтом «жилое» и занижал ранг.
    assert "other" in D._TYPE_TO_PRESET
    assert D._TYPE_TO_PRESET["other"] == "public_mass"


def test_card_forces_alanda_matches_document():
    extracted = json.loads((_SEED_DIR / "alanda.json").read_text(encoding="utf-8"))
    forces = D._card_forces(extracted)
    assert forces is not None
    # Цифры обязаны сойтись с расчётом в карточке ПТП: ранг №3, 4+2 ствола,
    # 7 отделений, Qобщ.тр = 19,47 л/с.
    assert forces["rank"] == "№3"
    assert forces["barrels_ext"] == 4
    assert forces["barrels_def"] == 2
    assert forces["squads"] == 7
    assert forces["personnel"] == 26
    assert forces["trucks"] == 2
    assert forces["q_req_l_s"] == 19.47


def test_card_forces_hayvill_reads_prose_layout():
    # У Хайвилла те же величины записаны выкладкой строкой («Nотд = 26/4 = 7
    # отделений») — брать первое число нельзя.
    extracted = json.loads((_SEED_DIR / "hayvill.json").read_text(encoding="utf-8"))
    forces = D._card_forces(extracted)
    assert forces is not None
    assert forces["squads"] == 7
    assert forces["personnel"] == 26
    assert forces["trucks"] == 3
    assert forces["q_req_l_s"] == 38


def test_card_forces_none_without_force_calc():
    assert D._card_forces({"object": {"name": "х"}}) is None
    assert D._card_forces({"force_calc": {}}) is None
    assert D._card_forces(None) is None


def test_card_floors_prefers_document():
    alanda = json.loads((_SEED_DIR / "alanda.json").read_text(encoding="utf-8"))
    # В реестре OSM у здания 20 этажей, в ПТП — 24; автолестницу выбирают по
    # цифре из документа.
    assert D._card_floors(alanda) == 24
    hayvill = json.loads((_SEED_DIR / "hayvill.json").read_text(encoding="utf-8"))
    assert D._card_floors(hayvill) == 24
    assert D._card_floors({"object": {}}) is None
    assert D._card_floors(None) is None


# --- нормализация: SQL и Python обязаны совпадать ---------------------------
#
# Адрес сворачивается в БД (`fw_norm_addr`, миграция 0016), запрос — в Python
# (`norm_addr`). Расхождение таблиц = молчащий поиск на боевом вызове, поэтому
# равенство проверяется на живой базе.

import os  # noqa: E402


@pytest.mark.skipif(
    not os.getenv("FW_RUN_DB_TESTS"),
    reason="set FW_RUN_DB_TESTS=1 with a PostGIS DATABASE_URL to run",
)
@pytest.mark.parametrize(
    "sample",
    [
        "Тәуелсіздік даңғылы 33",
        "Сарайшық көшесі 7/1",
        "Мәңгілік Ел даңғылы 55/17",
        "Тұран даңғылы 7в",
        "улица Алексея Петрова 14/3",
    ],
)
def test_norm_addr_sql_matches_python(sample):
    from sqlalchemy import text as sql_text

    from app.db import engine

    with engine.begin() as conn:
        in_sql = conn.execute(
            sql_text("SELECT fw_norm_addr(:s)"), {"s": sample}
        ).scalar()
    assert in_sql == D.norm_addr(sample)
