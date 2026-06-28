"""token revocation (forced session termination)

Revision ID: 0007_token_revocation
Revises: 0006_visit_photos
Create Date: 2026-06-28

Gov-attestation requirement: an administrator (or the user themselves) must be
able to forcibly terminate all active sessions. We stamp users.sessions_revoked_at
and reject any access token whose "iat" predates it — no server-side token store
needed, the timestamp invalidates every token issued before the revocation.
"""

from alembic import op

revision = "0007_token_revocation"
down_revision = "0006_visit_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS sessions_revoked_at")
