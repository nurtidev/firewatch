"""building functional fire-hazard attributes (ДЧС domain features)

Revision ID: 0003_building_domain_features
Revises: 0002_audit_and_district
Create Date: 2026-06-27

Adds the functional-fire-hazard attributes a fire inspector sorts objects by —
mass / vulnerable occupancy, production hazard category (А–Д), gas supply — so
the risk model and routing can consume real ДЧС passport data instead of being
blind to building use. Nullable: existing rows keep NULL and the scoring job
synthesizes a value until the real passport feed is wired.
"""

from alembic import op

revision = "0003_building_domain_features"
down_revision = "0002_audit_and_district"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE buildings ADD COLUMN IF NOT EXISTS mass_occupancy BOOLEAN")
    op.execute(
        "ALTER TABLE buildings ADD COLUMN IF NOT EXISTS vulnerable_occupancy BOOLEAN"
    )
    op.execute(
        "ALTER TABLE buildings ADD COLUMN IF NOT EXISTS hazard_category SMALLINT "
        "CHECK (hazard_category BETWEEN 0 AND 5)"
    )
    op.execute("ALTER TABLE buildings ADD COLUMN IF NOT EXISTS has_gas BOOLEAN")
    op.execute(
        "ALTER TABLE buildings ADD COLUMN IF NOT EXISTS occupancy_capacity INTEGER"
    )


def downgrade() -> None:
    for col in (
        "mass_occupancy",
        "vulnerable_occupancy",
        "hazard_category",
        "has_gas",
        "occupancy_capacity",
    ):
        op.execute(f"ALTER TABLE buildings DROP COLUMN IF EXISTS {col}")
