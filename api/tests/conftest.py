"""Shared pytest fixtures for api/tests/.

DB-test safety net: several *_db.py / *_integration.py test files carry their
own copy of "refuse to run without 'test' in the database name" (each with
its own `_is_dedicated_test_db()` helper and `pytestmark` skip). That
per-file pattern is easy to forget on a new file — and the whole reason this
check exists (an incident where a DB test wiped demo data) means a missed
copy is exactly the failure mode it can't afford. This single autouse,
session-scoped fixture is now the one place that check is guaranteed to run,
regardless of which test file is collected; the existing per-file guards stay
as a second, redundant layer (they additionally *skip* individual DB test
files when FW_RUN_DB_TESTS isn't set at all, which this fixture doesn't do).
"""

import os

import pytest


def _db_name(url: str) -> str:
    return url.rsplit("/", 1)[-1].split("?", 1)[0].lower()


@pytest.fixture(scope="session", autouse=True)
def _refuse_unsafe_db() -> None:
    """Hard-fail the whole test session (not just skip) when FW_RUN_DB_TESTS=1
    points at a database without "test" in its name — a dev/demo database
    lacking the word is the exact scenario that wiped demo data once."""
    if not os.getenv("FW_RUN_DB_TESTS"):
        return
    url = os.getenv("DATABASE_URL", "")
    name = _db_name(url)
    if "test" not in name:
        pytest.exit(
            f"FW_RUN_DB_TESTS=1 but DATABASE_URL database {name!r} has no "
            "'test' in its name — refusing to run against a non-test "
            "database (see CLAUDE.md: DB-тесты).",
            returncode=1,
        )
