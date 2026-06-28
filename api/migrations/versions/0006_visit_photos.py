"""evidence photos on inspection visits

Revision ID: 0006_visit_photos
Revises: 0005_audit_worm
Create Date: 2026-06-28

A recorded violation needs photographic evidence to have legal force as an
attachment to the protocol. Stores the uploaded photo references (filenames) on
the visit; the files live in the uploads store like operational-card scans.
"""

from alembic import op

revision = "0006_visit_photos"
down_revision = "0005_audit_worm"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE inspection_visits ADD COLUMN IF NOT EXISTS evidence_photos JSONB"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE inspection_visits DROP COLUMN IF EXISTS evidence_photos")
