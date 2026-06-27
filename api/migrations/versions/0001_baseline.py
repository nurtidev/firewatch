"""baseline schema (== app/schema.sql, frozen)

Revision ID: 0001_baseline
Revises:
Create Date: 2026-06-27

The first revision materialises the original core schema. It executes the frozen
app/schema.sql so the historical baseline has a single source of truth; later
revisions evolve the schema with explicit DDL and never touch that file.
"""

from pathlib import Path

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

_SCHEMA_SQL = Path(__file__).resolve().parents[2] / "app" / "schema.sql"


def _split(sql: str) -> list[str]:
    return [s.strip() for s in sql.split(";") if s.strip()]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    for statement in _split(_SCHEMA_SQL.read_text(encoding="utf-8")):
        op.execute(statement)


def downgrade() -> None:
    for table in (
        "hydrants",
        "fire_stations",
        "users",
        "inspection_visits",
        "inspectors",
        "prescriptions",
        "operational_cards",
        "risk_scores",
        "incidents",
        "buildings",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
