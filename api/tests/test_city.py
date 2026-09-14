"""Городской трек (/city): чистые функции и единые источники — без базы.

DB-интеграция (суммы на живой PostGIS, форма ответов, akimat 200/403) — в
tests/test_city_db.py под FW_RUN_DB_TESTS.
"""

import pytest

from app import coverage
from app.routers import city
from app.routers.buildings import RISK_BANDS

# --- единые источники ---------------------------------------------------------


def test_band_keys_cover_every_risk_band_once():
    assert sorted(src for _, src in city.BAND_KEYS) == sorted(RISK_BANDS)
    assert [key for key, _ in city.BAND_KEYS] == ["critical", "high", "elevated", "low"]


def test_high_or_above_is_built_from_risk_bands():
    assert RISK_BANDS["high"] in city.HIGH_OR_ABOVE_SQL
    assert RISK_BANDS["critical"] in city.HIGH_OR_ABOVE_SQL
    # Текст методики называет ту же нижнюю границу, что и SQL полосы high.
    assert f"BETWEEN {city.HIGH_MIN_SCORE} AND" in RISK_BANDS["high"]


def test_method_strings_match_the_contract():
    assert city.SUMMARY_METHOD == (
        "Внимание = здания с оценкой ≥40 в слепой зоне прибытия "
        "ИЛИ без исправного гидранта в 800 м"
    )
    assert city.PRIORITIES_METHOD == (
        "Оценка по плотности зданий высокого риска в ячейках 500×500 м — "
        "ориентир для обследования, не оптимальная точка размещения"
    )


def test_hydrant_radius_is_shared_with_dispatch():
    from app.routers import dispatch

    assert dispatch.HYDRANT_RADIUS_M == coverage.HYDRANT_RADIUS_M == 800


def test_blind_zone_logic_is_shared_with_infra():
    """/city и /infra обязаны считать слепую зону одним и тем же SQL."""
    from app.routers import infra

    assert infra._BLIND_ZONE_CLAUSE is coverage.BLIND_ZONE_CLAUSE
    assert infra._stations_missing_isochrones is coverage.stations_missing_isochrones
    assert infra._stations_stale_isochrones is coverage.stations_stale_isochrones
    assert infra._resolve_coverage_source is coverage.resolve_coverage_source
    assert infra._normative_seconds is coverage.normative_seconds


def test_grid_is_metric_utm_42n():
    assert city.GRID_SRID == 32642
    assert city.CELL_M == 500


# --- мелкие помощники ----------------------------------------------------------


@pytest.mark.parametrize(
    "total,missing,stale,source,approximate",
    [
        (4, 4, 0, "buffer", True),
        (0, 0, 0, "buffer", True),
        (4, 0, 0, "osrm", False),
        (4, 1, 0, "mixed", True),
        (4, 0, 1, "mixed", True),  # устаревшая изохрона — тоже не «целиком по дорогам»
    ],
)
def test_envelope_uses_the_shared_coverage_resolver(
    monkeypatch, total, missing, stale, source, approximate
):
    monkeypatch.setattr(coverage, "stations_total", lambda db: total)
    monkeypatch.setattr(coverage, "stations_missing_isochrones", lambda db, s: [{}] * missing)
    monkeypatch.setattr(coverage, "stations_stale_isochrones", lambda db, s: [{}] * stale)
    env = city._envelope(None)
    assert (env["coverage_source"], env["approximate"]) == (source, approximate)
    assert env["stations_missing_isochrones"] == missing
    assert env["stations_stale_isochrones"] == stale
    assert env["demo_data"] is True


def test_cell_id_is_stable_and_distinguishes_neighbours():
    assert city.cell_id(709_500.0, 5_669_000.0) == "utm42n-500-1419-11338"
    assert city.cell_id(709_500.0, 5_669_000.0) != city.cell_id(710_000.0, 5_669_000.0)
    assert city.cell_id(709_500.0, 5_669_000.0) != city.cell_id(709_500.0, 5_669_500.0)


@pytest.mark.parametrize("value,expected", [(40.5, 41), (39.49, 39), (0.0, 0), (None, None)])
def test_round_half_up(value, expected):
    assert city.round_half_up(value) == expected


# --- сводка: суммы по районам == итог города ------------------------------------


def _district(name):
    return {"name": name, "name_kk": f"{name}-kk", "name_en": f"{name}-en", "area_km2": 50.0}


def _buildings(district, total, scored, score_sum, bands, attention, blind, gap):
    critical, high, elevated, low = bands
    return {
        "district": district,
        "buildings_total": total,
        "scored": scored,
        "score_sum": score_sum,
        "critical": critical,
        "high": high,
        "elevated": elevated,
        "low": low,
        "attention_buildings": attention,
        "blind_zone_buildings": blind,
        "hydrant_gap_buildings": gap,
    }


def _points(district, stations, hydrants, broken, callouts, median, is_total=False):
    return {
        "district": district,
        "is_total": is_total,
        "stations_total": stations,
        "hydrants_total": hydrants,
        "hydrants_broken": broken,
        "callouts_90d": callouts,
        "median_travel_sec": median,
    }


DISTRICTS = [_district("Альфа"), _district("Бета"), _district("Гамма")]
BUILDINGS = [
    _buildings("Альфа", 10, 10, 500, (3, 2, 3, 2), 4, 5, 1),
    _buildings("Бета", 20, 18, 540, (1, 3, 6, 8), 4, 2, 7),
    _buildings("Гамма", 5, 0, 0, (0, 0, 0, 0), 0, 5, 5),
]
POINTS = [
    _points("Альфа", 2, 30, 2, 5, 420.0),
    _points("Бета", 0, 10, 1, 0, None),
    _points("Гамма", 1, 0, 0, 1, 600.0),
    _points(None, 3, 40, 3, 6, 450.0, is_total=True),
]
PRESCRIPTIONS = [{"district": "Бета", "open_prescriptions": 4}]


def _assert_sums_equal_city(out):
    for field in city._COUNT_FIELDS:
        assert sum(d[field] for d in out["districts"]) == out["city"][field], field
    for band, _ in city.BAND_KEYS:
        assert sum(d["bands"][band] for d in out["districts"]) == out["city"]["bands"][band], band


def test_district_sums_equal_city_totals():
    out = city.assemble_summary(DISTRICTS, BUILDINGS, POINTS, PRESCRIPTIONS)
    _assert_sums_equal_city(out)
    assert out["unassigned"] == {"buildings": 0, "open_prescriptions": 0}


def test_summary_metrics_are_derived_honestly():
    out = city.assemble_summary(DISTRICTS, BUILDINGS, POINTS, PRESCRIPTIONS)
    by_name = {d["name"]: d for d in out["districts"]}
    assert by_name["Альфа"]["avg_score"] == 50
    assert by_name["Альфа"]["blind_pct"] == 50.0
    assert by_name["Альфа"]["median_arrival_min"] == 7.0
    # Нет оценённых зданий / нет отметок времени — «нет данных», а не ноль.
    assert by_name["Гамма"]["avg_score"] is None
    assert by_name["Бета"]["median_arrival_min"] is None
    # Медиана города — из строки итога, а не среднее медиан районов.
    assert out["city"]["median_arrival_min"] == 7.5
    assert out["city"]["avg_score"] == 37  # 1040 / 28 = 37.1
    assert out["city"]["open_prescriptions"] == 4


def test_districts_ranked_by_attention_then_avg_score():
    out = city.assemble_summary(DISTRICTS, BUILDINGS, POINTS, PRESCRIPTIONS)
    # Альфа и Бета — по 4 «здания внимания»; у Альфы выше средняя оценка.
    assert [(d["rank"], d["name"]) for d in out["districts"]] == [
        (1, "Альфа"),
        (2, "Бета"),
        (3, "Гамма"),
    ]
    assert all("_avg" not in d for d in out["districts"])
    assert out["districts"][0]["name_kk"] == "Альфа-kk"


def test_rank_tie_breaks_on_raw_average_then_name():
    items = [
        {"name": "Б", "attention_buildings": 3, "_avg": 40.4},
        {"name": "А", "attention_buildings": 3, "_avg": 40.4},
        {"name": "В", "attention_buildings": 3, "_avg": 40.45},  # то же после округления
    ]
    assert [d["name"] for d in city.rank_districts(items)] == ["В", "А", "Б"]


def test_unassigned_objects_stay_in_city_and_are_reported():
    buildings = [*BUILDINGS, _buildings("Вне таблицы", 7, 7, 70, (0, 0, 0, 7), 0, 0, 0)]
    prescriptions = [*PRESCRIPTIONS, {"district": None, "open_prescriptions": 2}]
    out = city.assemble_summary(DISTRICTS, buildings, POINTS, prescriptions)
    assert out["unassigned"] == {"buildings": 7, "open_prescriptions": 2}
    assert out["city"]["buildings_total"] == 35 + 7
    assert out["city"]["open_prescriptions"] == 6
    assert sum(d["buildings_total"] for d in out["districts"]) == 35


def test_empty_district_table_still_counts_the_city():
    out = city.assemble_summary([], BUILDINGS, [POINTS[-1]], PRESCRIPTIONS)
    assert out["districts"] == []
    assert out["city"]["buildings_total"] == 35
    assert out["city"]["stations_total"] == 3
    assert out["unassigned"]["buildings"] == 35


# --- приоритеты -----------------------------------------------------------------


def _cell(cid, **kw):
    return {"cell_id": cid, "lon": 71.4, "lat": 51.1, "district": "Альфа",
            "sample_addresses": None, **kw}


def test_hydrant_gaps_ranked_by_buildings_times_avg_score():
    cells = [
        _cell("a", buildings=2, avg_score=70.0, max_score=75),   # 140
        _cell("b", buildings=5, avg_score=45.0, max_score=50),   # 225
        _cell("c", buildings=3, avg_score=50.0, max_score=90),   # 150
        _cell("d", buildings=3, avg_score=50.0, max_score=60),   # 150, ниже max
    ]
    assert [c["cell_id"] for c in city.rank_hydrant_gaps(cells, 3)] == ["b", "c", "d"]


def test_station_gaps_ranked_by_high_risk_then_blind_count():
    cells = [
        _cell("a", blind_buildings=40, high_risk_blind=0, avg_score=15.0),
        _cell("b", blind_buildings=5, high_risk_blind=3, avg_score=50.0),   # 150
        _cell("c", blind_buildings=9, high_risk_blind=0, avg_score=None),
        _cell("d", blind_buildings=6, high_risk_blind=2, avg_score=75.0),   # 150, больше слепых
    ]
    assert [c["cell_id"] for c in city.rank_station_gaps(cells, 10)] == ["d", "b", "a", "c"]


def test_public_cell_rounds_and_limits_payload():
    cell = _cell(
        "utm42n-500-1-2", buildings=3, avg_score=48.5, max_score=61,
        sample_addresses=["ул. А 1", "ул. Б 2", "ул. В 3"],
    )
    cell["lon"], cell["lat"] = 71.123456789, 51.987654321
    out = city._public_cell(cell, ("buildings", "avg_score", "max_score"))
    assert out == {
        "cell_id": "utm42n-500-1-2",
        "lon": 71.123457,
        "lat": 51.987654,
        "district": "Альфа",
        "buildings": 3,
        "avg_score": 49,
        "max_score": 61,
        "sample_addresses": ["ул. А 1", "ул. Б 2", "ул. В 3"],
    }
    empty = city._public_cell({**cell, "sample_addresses": None}, ("buildings",))
    assert empty["sample_addresses"] == []
