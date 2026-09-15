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
        _CREATED,
        _NOW,
        _CREATED + timedelta(minutes=12),
        _CREATED - timedelta(minutes=4),  # часы устройства чуть отстают
        _NOW + timedelta(minutes=4),  # или чуть спешат — как и раньше, без правки
        # Астана, UTC+5: 14:45 местного — это 09:45 UTC, внутри выезда.
        datetime(2026, 8, 6, 14, 45, tzinfo=timezone(timedelta(hours=5))),
    ],
)
def test_placed_at_within_callout_is_kept_as_is(placed):
    fix = D._reconcile_placed_at(placed, None, _CREATED, _NOW)
    assert fix.problem is None
    assert fix.value == placed
    assert fix.clock is None


def test_placed_at_missing_stays_missing():
    fix = D._reconcile_placed_at(None, _NOW, _CREATED, _NOW)
    assert (fix.value, fix.problem, fix.clock) == (None, None, None)


def test_placed_at_without_timezone_is_rejected():
    # Раньше такое время доезжало до min() рядом с aware-временем и роняло
    # ответ 500 уже после коммита.
    fix = D._reconcile_placed_at(datetime(2026, 8, 6, 9, 45), _NOW, _CREATED, _NOW)
    assert fix.problem and "часового пояса" in fix.problem


def test_fast_device_clock_is_corrected_not_rejected():
    # Часы планшета спешат на два часа: связь живая, позиция поставлена
    # минуту назад. Раньше — отказ «в будущем» и пропавший маркер.
    skew = timedelta(hours=2)
    placed = _NOW - timedelta(minutes=1)
    fix = D._reconcile_placed_at(placed + skew, _NOW + skew, _CREATED, _NOW)
    assert fix.problem is None
    assert fix.value == placed
    assert fix.clock["clock_skew_sec"] == -7200
    assert fix.clock["clamped"] is False
    assert fix.clock["device_placed_at"] == (placed + skew).isoformat()


def test_slow_device_clock_at_callout_start_is_corrected():
    # Часы отстают на два часа, ствол поставлен в первые секунды выезда —
    # по часам устройства «раньше регистрации вызова».
    skew = timedelta(hours=2)
    created, now = _CREATED, _CREATED + timedelta(seconds=40)
    placed = created + timedelta(seconds=30)
    fix = D._reconcile_placed_at(placed - skew, now - skew, created, now)
    assert fix.problem is None
    assert fix.value == placed
    assert fix.clock["clock_skew_sec"] == 7200
    assert fix.clock["clamped"] is False


def test_skew_within_tolerance_is_not_applied():
    # Разница в пределах минуты — это в том числе время в пути запроса:
    # точное время исправного планшета не сдвигается на задержку канала.
    placed = _NOW - timedelta(minutes=3)
    fix = D._reconcile_placed_at(placed, _NOW - timedelta(seconds=45), _CREATED, _NOW)
    assert fix.value == placed
    assert fix.clock is None


def test_without_sent_at_implausible_time_is_clamped_not_rejected():
    # Старый клиент без sent_at: поправить не по чему — прижимаем к выезду.
    future = D._reconcile_placed_at(_NOW + timedelta(hours=2), None, _CREATED, _NOW)
    assert future.problem is None and future.value == _NOW
    assert future.clock == {
        "device_placed_at": (_NOW + timedelta(hours=2)).isoformat(),
        "sent_at": None,
        "clock_skew_sec": None,
        "clamped": True,
    }
    past = D._reconcile_placed_at(datetime(2020, 1, 1, tzinfo=timezone.utc), None, _CREATED, _NOW)
    assert past.problem is None and past.value == _CREATED
    assert past.clock["clamped"] is True


def test_correction_is_clamped_when_placed_and_sent_disagree():
    # Поправка по sent_at всё равно не выводит время за пределы выезда.
    fix = D._reconcile_placed_at(
        _NOW + timedelta(hours=5), _NOW - timedelta(hours=1), _CREATED, _NOW
    )
    assert fix.value == _NOW
    assert fix.clock["clock_skew_sec"] == 3600 and fix.clock["clamped"] is True


def test_naive_sent_at_is_ignored_not_rejected():
    fix = D._reconcile_placed_at(
        _NOW + timedelta(hours=1), (_NOW + timedelta(hours=1)).replace(tzinfo=None), _CREATED, _NOW
    )
    assert fix.problem is None and fix.value == _NOW
    assert fix.clock["clock_skew_sec"] is None and fix.clock["clamped"] is True


def test_placed_at_naive_callout_time_does_not_crash():
    naive_created = _CREATED.replace(tzinfo=None)
    fix = D._reconcile_placed_at(_CREATED, None, naive_created, _NOW)
    assert fix.problem is None and fix.value == _CREATED


def test_browser_iso_timestamp_parses_as_aware():
    # `new Date().toISOString()` — единственный формат, который шлёт планшет.
    item = D.SyncCreate(client_uid="u1", kind="hq", placed_at="2026-08-06T09:45:12.345Z")
    body = D.DeploymentSync(creates=[item], sent_at="2026-08-06T10:00:00.000Z")
    fix = D._reconcile_placed_at(item.placed_at, body.sent_at, _CREATED, _NOW)
    assert fix.problem is None
    assert fix.value == datetime(2026, 8, 6, 9, 45, 12, 345000, tzinfo=timezone.utc)


# --- досинхронизация в закрытый выезд ---------------------------------------
#
# Расстановка, поставленная без связи до закрытия выезда, — факт боевых
# действий: она принимается и после закрытия. Поставленное позже закрытия
# (+5 мин допуска), чужое или пришедшее спустя 7 дней — нет.

_CLOSED = datetime(2026, 8, 6, 11, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "placed",
    [
        _CLOSED - timedelta(minutes=40),
        _CLOSED,
        _CLOSED + D.LATE_SYNC_TOLERANCE,  # граница допуска — включительно
        # Астана, UTC+5: 16:03 местного — это 11:03 UTC, в пределах допуска.
        datetime(2026, 8, 6, 16, 3, tzinfo=timezone(timedelta(hours=5))),
    ],
)
def test_late_sync_accepts_positions_placed_before_close(placed):
    assert D._late_sync_problem(placed, _CLOSED, _CLOSED + timedelta(minutes=20)) is None


def test_late_sync_rejects_position_placed_after_close():
    placed = _CLOSED + D.LATE_SYNC_TOLERANCE + timedelta(seconds=1)
    problem = D._late_sync_problem(placed, _CLOSED, _CLOSED + timedelta(hours=1))
    assert problem == D.LATE_AFTER_CLOSE
    assert problem == "Позиция поставлена после закрытия выезда — не записана"


def test_late_sync_window_is_seven_days():
    placed = _CLOSED - timedelta(minutes=10)
    edge = _CLOSED + D.LATE_SYNC_WINDOW
    assert D._late_sync_window_problem(_CLOSED, edge) is None
    assert D._late_sync_problem(placed, _CLOSED, edge) is None
    later = edge + timedelta(seconds=1)
    assert D._late_sync_window_problem(_CLOSED, later) == D.LATE_TOO_OLD
    # Вне окна не спасает и честное время постановки.
    assert D._late_sync_problem(placed, _CLOSED, later) == D.LATE_TOO_OLD
    assert D.LATE_TOO_OLD.startswith("Выезд закрыт более 7 дней назад")


def test_late_sync_without_placed_at_or_close_mark_is_rejected():
    now = _CLOSED + timedelta(minutes=5)
    # Без времени (или без пояса) не доказать, что поставлено до закрытия.
    assert D._late_sync_problem(None, _CLOSED, now) == D.LATE_NO_TIME
    assert D._late_sync_problem(_CLOSED.replace(tzinfo=None), _CLOSED, now) == D.LATE_NO_TIME
    # Закрыт без отметки закрытия (правка базой) — сверять не с чем.
    assert D._late_sync_window_problem(None, now) == D.LATE_CLOSED
    assert D._late_sync_problem(_CLOSED, None, now) == D.LATE_CLOSED


def test_late_sync_naive_close_mark_is_treated_as_utc():
    placed = _CLOSED + timedelta(minutes=3)
    naive = _CLOSED.replace(tzinfo=None)
    assert D._late_sync_problem(placed, naive, _CLOSED + timedelta(hours=1)) is None


def test_late_sync_decides_on_clock_corrected_time_slow_clock():
    # Часы планшета отстают на два часа: по ним ствол поставлен задолго до
    # закрытия, на деле — через полчаса после. Решает поправленное время.
    skew = timedelta(hours=2)
    now = _CLOSED + timedelta(hours=1)
    real_placed = _CLOSED + timedelta(minutes=30)
    fix = D._reconcile_placed_at(real_placed - skew, now - skew, _CREATED, now)
    assert fix.value == real_placed
    assert D._late_sync_problem(fix.value, _CLOSED, now) == D.LATE_AFTER_CLOSE


def test_late_sync_decides_on_clock_corrected_time_fast_clock():
    # Часы спешат на два часа: по ним — после закрытия, на деле — до него.
    skew = timedelta(hours=2)
    now = _CLOSED + timedelta(hours=3)
    real_placed = _CLOSED - timedelta(minutes=15)
    fix = D._reconcile_placed_at(real_placed + skew, now + skew, _CREATED, now)
    assert fix.value == real_placed
    assert D._late_sync_problem(fix.value, _CLOSED, now) is None


def test_late_sync_old_client_future_time_is_clamped_and_rejected():
    # Без sent_at поправить не по чему: «будущее» время прижимается к моменту
    # приёма, а он уже после закрытия — постановку до закрытия не доказать.
    now = _CLOSED + timedelta(hours=1)
    fix = D._reconcile_placed_at(now + timedelta(hours=2), None, _CREATED, now)
    assert fix.value == now
    assert D._late_sync_problem(fix.value, _CLOSED, now) == D.LATE_AFTER_CLOSE


@pytest.mark.parametrize(
    "target,problem",
    [
        ({"client_uid": "u1", "created_by": "disp1", "placed_at": _CLOSED}, None),
        # позиция с пульта — без client_uid
        ({"client_uid": None, "created_by": "disp1", "placed_at": _CLOSED}, D.LATE_NOT_OWN),
        # чужая позиция с плана
        ({"client_uid": "u1", "created_by": "rtp2", "placed_at": _CLOSED}, D.LATE_NOT_OWN),
        # своя, но поставленная после закрытия
        (
            {"client_uid": "u1", "created_by": "disp1",
             "placed_at": _CLOSED + timedelta(hours=1)},
            D.LATE_AFTER_CLOSE,
        ),
    ],
)
def test_late_target_only_own_plan_positions(target, problem):
    now = _CLOSED + timedelta(hours=2)
    assert D._late_target_problem(target, "disp1", _CLOSED, now) == problem


@pytest.mark.parametrize(
    "role,own,crew,problem",
    [
        ("responder", 7, {7}, None),  # караул назначенной части
        ("responder", 9, {7, 9}, None),  # часть прислала машину в наряд
        ("responder", 8, {7, 9}, D.LATE_NOT_CREW),  # другая часть
        ("responder", None, {7}, D.LATE_NOT_CREW),  # без привязки к части
        ("dispatcher", 7, {7}, D.LATE_NOT_CREW),
        ("admin", None, {7}, D.LATE_NOT_CREW),
        ("responder", 7, set(), D.LATE_NOT_CREW),  # у выезда нет ни части, ни наряда
    ],
)
def test_late_crew_only_participating_station_responder(role, own, crew, problem):
    assert D._late_crew_problem(role, own, crew) == problem
    assert D.LATE_NOT_CREW == (
        "Досинхронизация после закрытия — только расчёт части, участвовавшей в выезде"
    )


def test_reconcile_marks_clamp_to_registration_as_early():
    early = D._reconcile_placed_at(datetime(2020, 1, 1, tzinfo=timezone.utc), _NOW, _CREATED, _NOW)
    assert early.early is True and early.value == _CREATED
    late = D._reconcile_placed_at(_NOW + timedelta(hours=2), None, _CREATED, _NOW)
    assert late.early is False and late.clock["clamped"] is True
    assert D._reconcile_placed_at(_CREATED, None, _CREATED, _NOW).early is False


def test_late_time_rejects_time_clamped_to_registration():
    # В открытом выезде «раньше вызова» прижимается к регистрации и
    # принимается; в закрытом так недоказуемое время стало бы принятым.
    now = _CLOSED + timedelta(minutes=30)
    for sent_at in (now, None):
        fix = D._reconcile_placed_at(datetime(2020, 1, 1, tzinfo=timezone.utc), sent_at, _CREATED, now)
        assert fix.problem is None and fix.value == _CREATED
        assert D._late_time_problem(fix, _CLOSED, now) == D.LATE_NO_TIME
    # Вне окна причина — окно, а не время.
    fix = D._reconcile_placed_at(datetime(2020, 1, 1, tzinfo=timezone.utc), None, _CREATED, now)
    assert D._late_time_problem(fix, _CLOSED, _CLOSED + timedelta(days=8)) == D.LATE_TOO_OLD


def test_late_time_gesture_reasons():
    now = _CLOSED + timedelta(hours=1)
    before = D._reconcile_placed_at(_CLOSED - timedelta(minutes=1), now, _CREATED, now)
    assert D._late_time_problem(
        before, _CLOSED, now, no_time=D.LATE_REMOVE_NO_TIME, after_close=D.LATE_REMOVED_AFTER_CLOSE
    ) is None
    after = D._reconcile_placed_at(_CLOSED + timedelta(minutes=6), now, _CREATED, now)
    assert D._late_time_problem(
        after, _CLOSED, now, no_time=D.LATE_MOVE_NO_TIME, after_close=D.LATE_MOVED_AFTER_CLOSE
    ) == D.LATE_MOVED_AFTER_CLOSE
    naive = D._reconcile_placed_at(_CLOSED.replace(tzinfo=None), now, _CREATED, now)
    assert D._late_time_problem(
        naive, _CLOSED, now, no_time=D.LATE_REMOVE_NO_TIME, after_close=D.LATE_REMOVED_AFTER_CLOSE
    ) == D.LATE_REMOVE_NO_TIME


def test_sync_gesture_at_is_parsed_and_bounded(client):
    ok = client.post(
        _SYNC,
        json={"delete_uids": ["u1"], "deletes": [7],
              "gesture_at": {"u1": "2026-08-06T09:45:12.345Z", "srv:7": "2026-08-06T09:46:00Z"}},
    )
    assert ok.status_code not in (401, 403, 422)
    body = D.DeploymentSync(delete_uids=["u1"], gesture_at={"u1": "2026-08-06T09:45:12.345Z"})
    assert body.gesture_at["u1"] == datetime(2026, 8, 6, 9, 45, 12, 345000, tzinfo=timezone.utc)
    too_many = {f"u{i}": "2026-08-06T09:45:00Z" for i in range(D.SYNC_MAX_ITEMS + 1)}
    assert client.post(_SYNC, json={"deletes": [1], "gesture_at": too_many}).status_code == 422


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
