"""callouts — боевой модуль: dispatcher registers a callout, responder reads it

Revision ID: 0012_callouts
Revises: 0011_owner_portal
Create Date: 2026-07-05

The боевой module: a dispatcher (ЦОУ/112) registers a callout (выезд) at a
building or a raw point, optionally assigning a station (nearest by default).
The начальник караула/РТП then pulls the боевой пакет (nearest hydrants, the
object's ПТП, active access reports, forces hint). A callout is 'active' until
the dispatcher closes it. Deliberately separate from `incidents` (which feeds
the ML risk model and must not be polluted with operational dispatch rows).
"""

from alembic import op

revision = "0012_callouts"
down_revision = "0011_owner_portal"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS callouts (
            id           SERIAL PRIMARY KEY,
            building_id  INT REFERENCES buildings(id),
            address      TEXT,
            geom         geometry(Point, 4326) NOT NULL,
            callout_type TEXT NOT NULL,   -- fire / smoke / alarm / other
            note         TEXT,
            status       TEXT NOT NULL DEFAULT 'active',  -- active / closed
            station_id   INT REFERENCES fire_stations(id),
            created_by   TEXT NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            closed_by    TEXT,
            closed_at    TIMESTAMPTZ,
            close_note   TEXT
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS callouts_geom_gist "
        "ON callouts USING GIST (geom)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS callouts_status_idx ON callouts (status)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS callouts_created_at_idx ON callouts (created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS callouts")
