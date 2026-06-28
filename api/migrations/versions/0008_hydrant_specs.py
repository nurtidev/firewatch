"""hydrant operational specs (pressure, diameter, type)

Revision ID: 0008_hydrant_specs
Revises: 0007_token_revocation
Create Date: 2026-06-28

A hydrant on the map is only operationally useful if the dispatcher can judge
whether it sustains the required flow. Adds the fields the force-and-means
calculation needs: working pressure (bar), main diameter (mm), and type
(подземный/надземный). Nullable until the real ДЧС/water-utility feed is wired.
"""

from alembic import op

revision = "0008_hydrant_specs"
down_revision = "0007_token_revocation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE hydrants ADD COLUMN IF NOT EXISTS pressure_bar REAL")
    op.execute("ALTER TABLE hydrants ADD COLUMN IF NOT EXISTS diameter_mm INTEGER")
    op.execute("ALTER TABLE hydrants ADD COLUMN IF NOT EXISTS hydrant_type TEXT")


def downgrade() -> None:
    for col in ("pressure_bar", "diameter_mm", "hydrant_type"):
        op.execute(f"ALTER TABLE hydrants DROP COLUMN IF EXISTS {col}")
