"""Pure-function unit tests for scripts/import_infra.py (no DB, no network).

Regression coverage for docs/ux_audit_2026-08-03.md #19: the synthesized
hydrant network used to insert `osm_id = NULL`, and `ON CONFLICT (osm_id) DO
NOTHING` never dedupes NULLs in Postgres (NULL <> NULL in a unique index), so
every rerun doubled the network (2262 hydrants after two runs, not the 1135 a
single run produces). The fix makes every synthesized hydrant carry a
deterministic, non-NULL osm_id — these tests pin that guarantee at the
function level; the actual Postgres upsert behavior is verified live (see the
track's final report) since a unique-index conflict can't be exercised without
a database.
"""

from scripts.import_infra import (
    SYNTH_HYDRANT_OSM_BASE,
    hydrant_specs,
    rng,
    synth_hydrants_from_buildings,
    synth_osm_id,
)


def _buildings(ids: list[int]) -> list[dict]:
    return [{"id": i, "lon": 71.4 + i * 1e-5, "lat": 51.1 + i * 1e-5} for i in ids]


# --- rng: deterministic, stable across reruns -------------------------------


def test_rng_is_deterministic():
    assert rng(123, "status") == rng(123, "status")


def test_rng_varies_by_salt_and_key():
    assert rng(123, "status") != rng(123, "check")
    assert rng(123, "status") != rng(456, "status")


def test_rng_in_unit_interval():
    for key in (1, 42, 9000, 10**9):
        v = rng(key, "x")
        assert 0.0 <= v <= 1.0


# --- synth_osm_id: never NULL, never collides -------------------------------


def test_synth_osm_id_deterministic():
    assert synth_osm_id(904) == synth_osm_id(904)


def test_synth_osm_id_is_negative_and_unique_per_building():
    ids = [synth_osm_id(b) for b in range(1, 5000)]
    assert all(i < 0 for i in ids)
    assert len(set(ids)) == len(ids)


def test_synth_osm_id_never_collides_with_seed_sentinels():
    # seed_hayvill.py / seed_extra_objects.py use -9000..-9203 as sentinel
    # osm_ids for their object-specific hydrants (see those scripts). The
    # synthesized network must stay well clear of that range for any
    # realistic building id, or a real object's hydrant could get silently
    # skipped by ON CONFLICT (osm_id) DO NOTHING.
    for building_id in (1, 100, 9000, 100_000, 1_000_000):
        assert synth_osm_id(building_id) < -9203


def test_synth_hydrant_osm_base_is_far_below_real_osm_ids():
    # Real OSM node/way ids are always positive, so any negative base is safe
    # in principle — but pin the intended magnitude so a future edit that
    # shrinks the base gets caught here instead of in production.
    assert SYNTH_HYDRANT_OSM_BASE <= -1_000_000


# --- hydrant_specs: deterministic, plausible ranges -------------------------


def test_hydrant_specs_deterministic():
    assert hydrant_specs(555) == hydrant_specs(555)


def test_hydrant_specs_plausible_ranges():
    for key in range(200):
        specs = hydrant_specs(key)
        assert specs["diameter_mm"] in (100, 150, 200)
        assert 1.5 <= specs["pressure_bar"] <= 4.5
        assert specs["hydrant_type"] in ("подземный", "надземный")


def test_hydrant_specs_never_none():
    for key in range(50):
        specs = hydrant_specs(key)
        assert all(v is not None for v in specs.values())


# --- synth_hydrants_from_buildings: the actual dedup-fix regression test ---


def test_synth_hydrants_from_buildings_is_deterministic():
    buildings = _buildings(range(1, 21))
    first = synth_hydrants_from_buildings(buildings)
    second = synth_hydrants_from_buildings(buildings)
    assert first == second


def test_synth_hydrants_from_buildings_never_null_osm_id():
    # The bug this whole module docstring is about: a NULL osm_id defeats
    # ON CONFLICT (osm_id) DO NOTHING, so every synthesized row must carry a
    # concrete id.
    buildings = _buildings(range(1, 41))
    rows = synth_hydrants_from_buildings(buildings)
    assert rows  # sanity: buildings[::4] actually produced rows
    assert all(r["osm_id"] is not None for r in rows)


def test_synth_hydrants_from_buildings_osm_ids_are_unique():
    buildings = _buildings(range(1, 401))
    rows = synth_hydrants_from_buildings(buildings)
    osm_ids = [r["osm_id"] for r in rows]
    assert len(set(osm_ids)) == len(osm_ids)


def test_synth_hydrants_from_buildings_carries_specs():
    buildings = _buildings([4, 8, 12])
    rows = synth_hydrants_from_buildings(buildings)
    for r in rows:
        assert r["pressure_bar"] is not None
        assert r["diameter_mm"] is not None
        assert r["hydrant_type"] is not None


def test_synth_hydrants_from_buildings_samples_every_fourth():
    buildings = _buildings(range(1, 13))  # 12 buildings -> 3 sampled (0,4,8)
    rows = synth_hydrants_from_buildings(buildings)
    assert len(rows) == 3
