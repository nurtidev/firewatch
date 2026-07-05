"""owner portal — external owners, building links, remediation claims

Revision ID: 0011_owner_portal
Revises: 0010_field_reports
Create Date: 2026-07-05

External object owners (a proprietor / an ОСИ chairman) get a scoped portal:
they are linked to buildings (owner_buildings) and may see only the approved
prescriptions of those buildings and claim remediation (a note + photos). An
inspector/supervisor then accepts or declines the claim. Owners are outside the
gov contour — everything here is fail-closed by design.
"""

from alembic import op

revision = "0011_owner_portal"
down_revision = "0010_field_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS owner_buildings (
            user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            building_id INT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, building_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS remediations (
            id              SERIAL PRIMARY KEY,
            prescription_id INT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
            submitted_by    TEXT NOT NULL,
            note            TEXT NOT NULL,
            photos          JSONB NOT NULL DEFAULT '[]',
            status          TEXT NOT NULL DEFAULT 'pending',
            reviewed_by     TEXT,
            reviewed_at     TIMESTAMPTZ,
            review_note     TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Postgres has no ADD CONSTRAINT IF NOT EXISTS — guard so re-runs are safe.
    op.execute(
        """
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'remediations_status_chk'
          ) THEN
            ALTER TABLE remediations
              ADD CONSTRAINT remediations_status_chk
              CHECK (status IN ('pending', 'accepted', 'declined'));
          END IF;
        END $$;
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS remediations_prescription_idx "
        "ON remediations (prescription_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS remediations")
    op.execute("DROP TABLE IF EXISTS owner_buildings")
