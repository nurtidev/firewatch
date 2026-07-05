"""field reports — obstacles to firefighting access outside planned inspections

Revision ID: 0010_field_reports
Revises: 0009_prescription_review
Create Date: 2026-07-05

Ad-hoc field reports: an inspector/supervisor records an obstacle found outside
a planned visit (car blocking a fire access road, an anti-parking barrier, a
broken hydrant, a blocked emergency exit) — geo-point + category + photo
evidence. Supervisors triage the queue (open -> in_progress -> resolved /
dismissed).
"""

from alembic import op

revision = "0010_field_reports"
down_revision = "0009_prescription_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS field_reports (
            id               SERIAL PRIMARY KEY,
            category         TEXT NOT NULL,
            description      TEXT,
            geom             geometry(Point, 4326) NOT NULL,
            building_id      INT REFERENCES buildings(id),
            district         TEXT,
            photos           JSONB NOT NULL DEFAULT '[]',
            status           TEXT NOT NULL DEFAULT 'open',
            created_by       TEXT NOT NULL,
            created_role     TEXT NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_by      TEXT,
            resolved_at      TIMESTAMPTZ,
            resolution_note  TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS field_reports_geom_gist "
        "ON field_reports USING GIST (geom)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS field_reports_status_idx "
        "ON field_reports (status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS field_reports_district_idx "
        "ON field_reports (district)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS field_reports")
