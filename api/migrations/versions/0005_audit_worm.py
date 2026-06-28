"""append-only (WORM) audit_log

Revision ID: 0005_audit_worm
Revises: 0004_visit_violations
Create Date: 2026-06-28

Makes the audit trail tamper-evident at the database layer: a trigger rejects any
UPDATE or DELETE on audit_log, so even a compromised application account (or an
admin) cannot rewrite or erase history. INSERT/SELECT remain allowed. This is the
in-database half of WORM; a separate restricted DB role + off-box log shipping is
the infra half (tracked separately).
"""

from alembic import op

revision = "0005_audit_worm"
down_revision = "0004_visit_violations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_log_no_mutate() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_log is append-only (WORM): % not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS audit_log_worm ON audit_log")
    op.execute(
        """
        CREATE TRIGGER audit_log_worm
        BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_no_mutate();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_log_worm ON audit_log")
    op.execute("DROP FUNCTION IF EXISTS audit_log_no_mutate()")
