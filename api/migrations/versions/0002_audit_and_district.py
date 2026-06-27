"""audit log + per-user district scoping

Revision ID: 0002_audit_and_district
Revises: 0001_baseline
Create Date: 2026-06-27

Gov-contour hardening:
  * users.district — confines inspector/supervisor accounts to one district.
  * audit_log — immutable trail of logins and state-changing requests.
"""

from alembic import op

revision = "0002_audit_and_district"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS district TEXT")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id          BIGSERIAL PRIMARY KEY,
            ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
            username    TEXT,
            role        TEXT,
            action      TEXT NOT NULL,
            method      TEXT,
            path        TEXT,
            status_code INTEGER,
            ip          TEXT,
            detail      JSONB
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log (ts DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (username)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS district")
