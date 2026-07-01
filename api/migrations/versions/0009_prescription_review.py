"""prescription review workflow (status / reviewer / reviewed_at)

Revision ID: 0009_prescription_review
Revises: 0008_hydrant_specs
Create Date: 2026-07-01

An АI-generated prescription is an administrative act with legal consequences
(fine, suspension of operation) — an inspector must confirm it before it is
issued to the object owner. Auto-extracted prescriptions therefore start as
'pending' and require an explicit approve/reject by a responsible officer;
`reviewed_by`/`reviewed_at` record who decided and when, for audit.
"""

from alembic import op

revision = "0009_prescription_review"
down_revision = "0008_hydrant_specs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE prescriptions "
        "ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'"
    )
    op.execute("ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS reviewed_by TEXT")
    op.execute(
        "ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ"
    )
    # Postgres has no ADD CONSTRAINT IF NOT EXISTS — guard so re-runs are safe.
    op.execute(
        """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'prescriptions_status_chk'
          ) THEN
            ALTER TABLE prescriptions
              ADD CONSTRAINT prescriptions_status_chk
              CHECK (status IN ('pending', 'approved', 'rejected'));
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS prescriptions_status_chk"
    )
    for col in ("status", "reviewed_by", "reviewed_at"):
        op.execute(f"ALTER TABLE prescriptions DROP COLUMN IF EXISTS {col}")
