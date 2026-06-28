"""Pure-function unit tests (no database required)."""

import pytest

from fastapi import HTTPException

from app.access import enforce_building_scope, has_full_access
from app.auth import create_token, decode_token, hash_password, verify_password
from app.chat import ChatError, validate_sql
from app.routers.forces import ForcesRequest, calc
from app.routers.routes import VisitRequest, Violation, record_visit

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


def test_validate_sql_allows_whitelisted_join():
    sql = validate_sql(
        "SELECT b.address, r.score FROM buildings b "
        "JOIN risk_scores r ON r.building_id = b.id LIMIT 5"
    )
    assert "buildings" in sql.lower()


@pytest.mark.parametrize(
    "bad",
    [
        # bare SELECT on PII tables — passes the regex, must fail the whitelist
        "SELECT username, password_hash FROM users LIMIT 5",
        "SELECT extracted FROM operational_cards LIMIT 5",
        "SELECT * FROM buildings JOIN users ON true LIMIT 5",
        # dangerous functions
        "SELECT pg_sleep(10)",
        "SELECT pg_read_file('/etc/passwd')",
    ],
)
def test_validate_sql_blocks_non_whitelisted_tables_and_funcs(bad):
    with pytest.raises(ChatError):
        validate_sql(bad)


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


def test_forces_hard_conditions_add_gdzs_and_warn():
    """Высота + задымление требуют больше звеньев ГДЗС, резерв и предупреждения."""
    ground = calc(ForcesRequest(floor=1, smoke=False))
    hard = calc(ForcesRequest(floor=9, smoke=True))
    assert hard["result"]["gdzs_links"] > ground["result"]["gdzs_links"]
    assert hard["result"]["warnings"], "ожидались предупреждения по условиям/напору"
    assert hard["result"]["personnel"] > ground["result"]["personnel"]


def test_forces_water_source_insufficient_flagged():
    out = calc(ForcesRequest(width_m=12, jtr=0.2, water_source_lps=1.0))
    assert out["result"]["water_source_ok"] is False
    assert any("водоисточник" in w.lower() for w in out["result"]["warnings"])


# --- inspection visits: violation needs codes + photo evidence ----------------


def test_visit_violation_requires_codes():
    # Validation rejects before any DB access (db unused on this path).
    body = VisitRequest(inspector_id=1, building_id=1, status="violation")
    with pytest.raises(HTTPException) as e:
        record_visit(body, db=None)  # type: ignore[arg-type]
    assert e.value.status_code == 422


def test_visit_violation_requires_photo():
    body = VisitRequest(
        inspector_id=1,
        building_id=1,
        status="violation",
        violations=[Violation(code="ЭВ-01", note="выход заблокирован")],
    )
    with pytest.raises(HTTPException) as e:
        record_visit(body, db=None)  # type: ignore[arg-type]
    assert e.value.status_code == 422
    assert "фото" in e.value.detail.lower()
