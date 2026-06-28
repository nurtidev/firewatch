"""coded violations + inspection basis on inspection visits

Revision ID: 0004_visit_violations
Revises: 0003_building_domain_features
Create Date: 2026-06-27

A recorded violation must be attributable to a specific norm and carry a
remediation deadline to have legal force. Adds:
  * inspection_visits.violations    — JSONB [{code, note, deadline_days}]
  * inspection_visits.inspection_type — planned / unplanned (basis for the visit)
"""

from alembic import op

revision = "0004_visit_violations"
down_revision = "0003_building_domain_features"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE inspection_visits ADD COLUMN IF NOT EXISTS violations JSONB")
    op.execute(
        "ALTER TABLE inspection_visits ADD COLUMN IF NOT EXISTS "
        "inspection_type TEXT NOT NULL DEFAULT 'planned'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE inspection_visits DROP COLUMN IF EXISTS violations")
    op.execute("ALTER TABLE inspection_visits DROP COLUMN IF EXISTS inspection_type")
