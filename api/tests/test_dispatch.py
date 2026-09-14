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


# --- POST /dispatch/{id}/deployment/sync: validation -------------------------
#
# Очередь расстановки приходит с устройства, которое работало без связи, —
# то есть с наименее проверяемой стороны системы. Всё, что здесь отвергается,
# отвергается до базы.

_SYNC = "/dispatch/1/deployment/sync"


def test_sync_rejects_empty_batch(client):
    # Пустая синхронизация — это лишний запрос с боевого планшета по плохому
    # каналу, а не «ничего не изменилось».
    resp = client.post(_SYNC, json={"creates": [], "patches": [], "deletes": []})
    assert resp.status_code == 422


def test_sync_create_requires_client_uid(client):
    # Без client_uid повтор доставки не отличить от второго ствола рядом.
    resp = client.post(
        _SYNC,
        json={"creates": [{"kind": "barrel_ext", "plan_x": 0.4, "plan_y": 0.3, "floor": "5"}]},
    )
    assert resp.status_code == 422


def test_sync_create_rejects_half_plan_coords(client):
    resp = client.post(
        _SYNC,
        json={"creates": [{"client_uid": "u1", "kind": "barrel_ext", "plan_x": 0.4}]},
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("bad", [-0.01, 1.01])
def test_sync_create_rejects_plan_coords_out_of_range(client, bad):
    # 0..1 — доля от габарита плана; всё вне диапазона рисуется за краем.
    resp = client.post(
        _SYNC,
        json={
            "creates": [
                {"client_uid": "u1", "kind": "barrel_ext", "plan_x": bad, "plan_y": 0.5}
            ]
        },
    )
    assert resp.status_code == 422


def test_sync_patch_requires_a_field_beside_id(client):
    # Один id — это не правка, а холостая запись в историю выезда.
    resp = client.post(_SYNC, json={"patches": [{"id": 7}]})
    assert resp.status_code == 422


def test_sync_patch_rejects_half_plan_coords(client):
    resp = client.post(_SYNC, json={"patches": [{"id": 7, "plan_x": 0.2}]})
    assert resp.status_code == 422


def test_sync_rejects_oversized_batch(client):
    over = D.SYNC_MAX_ITEMS + 1
    resp = client.post(_SYNC, json={"deletes": list(range(1, over + 1))})
    assert resp.status_code == 422


def test_sync_valid_batch_passes_validation(client):
    resp = client.post(
        _SYNC,
        json={
            "creates": [
                {
                    "client_uid": "1754500000-ab12cd",
                    "kind": "barrel_ext",
                    "phase": "localization",
                    "floor": "5",
                    "plan_x": 0.42,
                    "plan_y": 0.31,
                    "heading": 90,
                    "placed_at": "2026-08-06T09:32:00+00:00",
                }
            ],
            "patches": [{"id": 12, "plan_x": 0.7, "plan_y": 0.2}],
            "deletes": [14],
        },
    )
    assert resp.status_code not in (401, 403, 422)


def test_sync_forbidden_for_oversight_role(client):
    # Расстановкой распоряжаются РТП и диспетчер; надзор смотрит.
    _ROLE["value"] = "supervisor"
    resp = client.post(_SYNC, json={"deletes": [1]})
    assert resp.status_code == 403


def test_sync_delete_by_client_uid_passes_validation(client):
    # Позицию сняли, пока её постановка была в полёте: серверного id у
    # устройства ещё нет, и снимать её можно только по client_uid.
    resp = client.post(_SYNC, json={"delete_uids": ["1754500000-ab12cd"]})
    assert resp.status_code not in (401, 403, 422)


def test_sync_delete_by_client_uid_rejects_empty_uid(client):
    resp = client.post(_SYNC, json={"delete_uids": [""]})
    assert resp.status_code == 422


def test_sync_delete_uids_count_toward_batch_limit(client):
    uids = [f"u{i}" for i in range(D.SYNC_MAX_ITEMS)]
    resp = client.post(_SYNC, json={"deletes": [1], "delete_uids": uids})
    assert resp.status_code == 422


def test_sync_patch_by_client_uid_passes_validation(client):
    resp = client.post(
        _SYNC, json={"patches": [{"client_uid": "u1", "plan_x": 0.2, "plan_y": 0.3}]}
    )
    assert resp.status_code not in (401, 403, 422)


def test_sync_patch_requires_id_or_client_uid(client):
    # Правка без адреса ни к чему не приложится.
    resp = client.post(_SYNC, json={"patches": [{"plan_x": 0.2, "plan_y": 0.3}]})
    assert resp.status_code == 422


def test_sync_patch_address_alone_is_not_a_change(client):
    resp = client.post(_SYNC, json={"patches": [{"id": 7, "client_uid": "u1"}]})
    assert resp.status_code == 422


# --- POST /dispatch/{id}/report/export: доступ -------------------------------


def test_report_export_allowed_for_oversight(client):
    # Донесение читают и надзорные роли — выгрузка идёт под теми же правами,
    # что и просмотр выезда.
    _ROLE["value"] = "supervisor"
    resp = client.post("/dispatch/1/report/export")
    assert resp.status_code not in (401, 403, 422)


def test_report_export_forbidden_for_owner(client):
    # Владелец объекта видит свой портал, но не боевые документы ДЧС.
    _ROLE["value"] = "owner"
    resp = client.post("/dispatch/1/report/export")
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


# --- синхронизация расстановки: ключи и время постановки --------------------
#
# Ключ ответа обязан совпадать с ключом очереди на устройстве: у позиции,
# поставленной на плане, это client_uid. Разойдись они — отвергнутая правка
# молча исчезает из очереди как «принятая».

from datetime import datetime, timedelta, timezone  # noqa: E402


def test_sync_key_prefers_client_uid():
    assert D._sync_key("1754500000-ab12cd", 42) == "1754500000-ab12cd"
    assert D._sync_key(None, 42) == "srv:42"


_CREATED = datetime(2026, 8, 6, 9, 30, tzinfo=timezone.utc)
_NOW = datetime(2026, 8, 6, 10, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "placed",
    [
        None,
        _CREATED,
        _NOW,
        _CREATED - timedelta(minutes=4),  # часы устройства чуть отстают
        _NOW + timedelta(minutes=4),  # или чуть спешат
        # Астана, UTC+5: 14:45 местного — это 09:45 UTC, внутри выезда.
        datetime(2026, 8, 6, 14, 45, tzinfo=timezone(timedelta(hours=5))),
    ],
)
def test_placed_at_within_callout_is_accepted(placed):
    assert D._placed_at_problem(placed, _CREATED, _NOW) is None


def test_placed_at_without_timezone_is_rejected():
    # Раньше такое время доезжало до min() рядом с aware-временем и роняло
    # ответ 500 уже после коммита.
    problem = D._placed_at_problem(datetime(2026, 8, 6, 9, 45), _CREATED, _NOW)
    assert problem and "часового пояса" in problem


def test_placed_at_before_callout_is_rejected():
    problem = D._placed_at_problem(_CREATED - timedelta(minutes=6), _CREATED, _NOW)
    assert problem and "раньше регистрации" in problem


def test_placed_at_in_future_is_rejected():
    problem = D._placed_at_problem(_NOW + timedelta(minutes=6), _CREATED, _NOW)
    assert problem and "в будущем" in problem


def test_placed_at_naive_callout_time_does_not_crash():
    naive_created = _CREATED.replace(tzinfo=None)
    assert D._placed_at_problem(_CREATED, naive_created, _NOW) is None


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
