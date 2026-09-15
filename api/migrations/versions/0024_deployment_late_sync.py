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

**deployment_late_removals** — надгробие позиции, снятой из очереди уже
после закрытия. Снятая строка из `deployment_positions` исчезает, и без
надгробия снятие после закрытия осталось бы только в журнале: ни донесение,
ни пульт его бы не показали. Хранится то, что нужно разбору: что это была
за позиция, когда её поставили и сняли (время жеста после поправки часов),
кто снял и когда это дошло до сервера.
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
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS deployment_late_removals (
            id          BIGSERIAL PRIMARY KEY,
            callout_id  BIGINT NOT NULL REFERENCES callouts(id) ON DELETE CASCADE,
            -- id снятой строки: самой строки уже нет, ссылка без FK.
            position_id BIGINT NOT NULL,
            client_uid  TEXT,
            kind        TEXT NOT NULL,
            phase       TEXT NOT NULL,
            floor       TEXT,
            sector      TEXT,
            placed_at   TIMESTAMPTZ,
            created_by  TEXT NOT NULL,
            -- Когда сняли (часы устройства, сведённые к часам сервера).
            removed_at  TIMESTAMPTZ NOT NULL,
            removed_by  TEXT NOT NULL,
            -- Когда снятие дошло до сервера.
            synced_at   TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS deployment_late_removals_callout_idx "
        "ON deployment_late_removals (callout_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS deployment_late_removals")
    op.execute(
        "ALTER TABLE deployment_positions DROP COLUMN IF EXISTS synced_after_close_at"
    )
