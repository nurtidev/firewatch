"""Районы: данные границ и правила привязки — без базы.

DB-часть (upsert полигонов, перепривязка зданий, идемпотентность) — в
tests/test_city_db.py под FW_RUN_DB_TESTS.
"""

import json

from app.districts import district_of
from app.routers.auth import DISTRICTS
from scripts import seed_districts, seed_ops, seed_users

# Габариты Астаны с запасом — ловят перепутанные lon/lat и чужую проекцию.
_LON = (70.9, 72.2)
_LAT = (50.8, 51.5)


def _coords(geometry: dict):
    parts = geometry["coordinates"]
    polygons = [parts] if geometry["type"] == "Polygon" else parts
    for polygon in polygons:
        for ring in polygon:
            yield from ring


def test_geojson_names_match_project_districts():
    names = [f["name"] for f in seed_districts.load_features()]
    # Имена в написании проекта (users.district, фильтры, скоупинг), не OSM.
    assert sorted(names) == sorted(DISTRICTS)


def test_geojson_carries_translations_and_osm_ids():
    features = seed_districts.load_features()
    assert len({f["osm_relation_id"] for f in features}) == len(features) == 5
    for f in features:
        assert f["name_kk"] and f["name_en"], f["name"]
        assert f["area_km2"] and f["area_km2"] > 10, f["name"]


def test_geojson_geometries_are_polygons_in_wgs84_within_astana():
    for f in seed_districts.load_features():
        geometry = json.loads(f["geometry"])
        assert geometry["type"] in ("Polygon", "MultiPolygon"), f["name"]
        for lon, lat in _coords(geometry):
            assert _LON[0] < lon < _LON[1] and _LAT[0] < lat < _LAT[1], (f["name"], lon, lat)


def test_district_of_uses_the_qualified_geometry_in_both_branches():
    sql = district_of("b.geom")
    assert sql.startswith("COALESCE(")
    assert "ST_Contains(d.geom, b.geom)" in sql
    # Ближайший район — в метрах (geography), а не планарно в градусах.
    assert "ST_Distance(d.geom::geography, (b.geom)::geography)" in sql
    assert "<->" not in sql


def test_demo_inspector_registry_and_supervisor_share_a_district():
    """Сюжет демо: инспектор ведёт Хайвилл, его руководитель контролирует."""
    inspector = next(u for u in seed_users.USERS if u[0] == "inspector")
    supervisor = next(u for u in seed_users.USERS if u[0] == "supervisor")
    registry = next(i for i in seed_ops.INSPECTORS if i[2] == "inspector")
    assert inspector[4] == registry[1] == supervisor[4] == "Есильский"


def test_seed_users_has_citywide_akimat():
    akimat = next(u for u in seed_users.USERS if u[0] == "akimat")
    assert akimat[3] == "akimat"
    assert akimat[4] is None  # весь город, района нет


def test_seed_ops_no_longer_hashes_districts():
    # Район — только из полигонов (seed_districts), не из хеша osm_id.
    assert not hasattr(seed_ops, "DISTRICTS")
