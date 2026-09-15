"""Расстановка: досинхронизация после закрытия выезда

Revision ID: 0024_deployment_late_sync
Revises: 0023_districts
Create Date: 2026-09-15

До этой миграции синхронизация очереди расстановки в закрытый выезд
отвергалась целиком (409), и очередь планшета считала отказ окончательным:
позиции, поставленные РТП без связи ещё до закрытия, оставались на
устройстве в «Не принято» и не доходили ни до донесения, ни до разбора.
Расстановка — факт боевых действий, терять её нельзя.

Теперь сервер принимает из очереди то, что поставлено не позже закрытия
выезда (+5 мин допуска, в пределах 7 дней после закрытия), и помечает такие
позиции: донесение и схема обязаны показывать, что строка пришла на сервер
уже после закрытия.

**synced_after_close_at** — когда позиция в последний раз получила данные
из очереди после закрытия выезда. NULL — всё записано, пока выезд был
открыт. Бэкфилла нет: до этой миграции запись в закрытый выезд была
невозможна.
"""

from alembic import op

revision = "0024_deployment_late_sync"
down_revision = "0023_districts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE deployment_positions
            ADD COLUMN IF NOT EXISTS synced_after_close_at TIMESTAMPTZ
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE deployment_positions DROP COLUMN IF EXISTS synced_after_close_at"
    )
