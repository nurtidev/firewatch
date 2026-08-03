"""отключение учётной записи: users.is_active

Revision ID: 0015_user_disable
Revises: 0014_report_client_id
Create Date: 2026-08-03

`sessions_revoked_at` (миграция 0007) глушит только уже выданные токены: после
«отзыва доступа» уволенный сотрудник заново логинился тем же паролем и получал
новый рабочий токен. То есть отзыва доступа как такового не существовало —
существовало принудительное завершение сессий.

`is_active` — сам признак действующей учётной записи. Проверяется в двух местах
(`login` и `current_user`), поэтому отключение закрывает и вход по паролю, и
любой уже выданный токен, даже если он был выпущен позже отметки об отзыве.

`disabled_at`/`disabled_by` — не дубль журнала аудита, а текущее состояние
записи: администратору нужно видеть в списке пользователей, когда и кем
учётная запись отключена, не поднимая журнал.

Даунгрейд снимает признак: все учётные записи снова считаются действующими —
поэтому откат этой ревизии на проде равносилен включению всех отключённых.
"""

from alembic import op

revision = "0015_user_disable"
down_revision = "0014_report_client_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"
    )
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_by TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS disabled_by")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS disabled_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS is_active")
