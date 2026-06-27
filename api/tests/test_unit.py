"""Pure-function unit tests (no database required)."""

import pytest

from app.access import enforce_building_scope, has_full_access
from app.auth import create_token, decode_token, hash_password, verify_password
from app.chat import ChatError, validate_sql
from app.routers.forces import ForcesRequest, calc

# --- chat: read-only SQL guard ------------------------------------------------


def test_validate_sql_adds_limit():
    assert validate_sql("SELECT 1").lower().endswith("limit 50")


def test_validate_sql_allows_select_and_with():
    assert validate_sql("select * from buildings limit 5")
    assert validate_sql("WITH t AS (SELECT 1) SELECT * FROM t LIMIT 5")


@pytest.mark.parametrize(
    "bad",
    [
        "DROP TABLE buildings",
        "SELECT 1; DROP TABLE buildings",
        "UPDATE users SET role='admin'",
        "DELETE FROM users",
        "SELECT * FROM users -- comment",
        "INSERT INTO users VALUES (1)",
    ],
)
def test_validate_sql_blocks_mutations_and_injection(bad):
    with pytest.raises(ChatError):
        validate_sql(bad)


def test_validate_sql_rejects_non_select():
    with pytest.raises(ChatError):
        validate_sql("EXPLAIN SELECT 1")


# --- auth ---------------------------------------------------------------------


def test_password_hash_roundtrip():
    h = hash_password("s3cret")
    assert verify_password("s3cret", h)
    assert not verify_password("wrong", h)


def test_token_carries_district_and_role():
    tok = create_token("inspector", "inspector", "Ахметов", district="Сарыаркинский")
    payload = decode_token(tok)
    assert payload["sub"] == "inspector"
    assert payload["role"] == "inspector"
    assert payload["district"] == "Сарыаркинский"


def test_decode_invalid_token_returns_none():
    assert decode_token("not-a-jwt") is None


# --- access: district scoping -------------------------------------------------


def test_full_access_roles():
    assert has_full_access({"role": "admin"})
    assert has_full_access({"role": "leadership"})
    assert not has_full_access({"role": "inspector"})


def test_enforce_scope_noop_for_full_access():
    clauses, params = [], {}
    enforce_building_scope(clauses, params, {"role": "admin", "district": None})
    assert clauses == [] and params == {}


def test_enforce_scope_restricts_scoped_role():
    clauses, params = [], {}
    enforce_building_scope(clauses, params, {"role": "inspector", "district": "X"})
    assert len(clauses) == 1 and "scope_district" in clauses[0]
    assert params["scope_district"] == "X"


# --- forces: fire force-and-means calculation ---------------------------------


def test_forces_calc_produces_sane_output():
    out = calc(ForcesRequest())
    assert out["result"]["personnel"] > 0
    assert out["result"]["trucks"] >= 1
    assert out["result"]["water_liters_10min"] > 0
    assert out["result"]["rank"] in {"№1", "№2", "№3", "№4"}


def test_forces_larger_fire_needs_more_barrels():
    small = calc(ForcesRequest(width_m=3, distance_km=0.5))
    large = calc(ForcesRequest(width_m=12, distance_km=3, jtr=0.2))
    assert (
        large["result"]["barrels_ext"] + large["result"]["barrels_def"]
        >= small["result"]["barrels_ext"] + small["result"]["barrels_def"]
    )
