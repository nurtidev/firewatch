"""Редактор оперкарт: версионирование и согласование

Revision ID: 0018_card_revisions
Revises: 0017_ops_module
Create Date: 2026-08-05

До этой миграции карточка ПТП была снимком распознавания: то, что извлёк
Claude, оставалось единственной версией навсегда. Исправить опечатку
распознавания или внести изменение по объекту (сменили насосную, заложили
проезд) было нельзя — только загрузить документ заново, потеряв предписания.

**Версионирование.** `card_revisions` хранит снимок `extracted` ДО изменения,
а не после: чтобы откатиться, достаточно взять снимок нужной ревизии, и не
нужно проигрывать историю с начала. Список изменённых полей лежит рядом
(`changed_fields`) — по нему строится читаемая история без диффа JSONB на
клиенте.

**Согласование.** Оперативная карточка — документ, по которому караул
работает на пожаре, поэтому правка не должна попадать в боевой пакет молча.
Статусы: `draft` (правится) → `on_review` (отправлена на согласование) →
`approved` (утверждена). Карточки, существовавшие до миграции, помечаются
`approved`: они уже использовались в работе, и объявить их черновиками задним
числом значило бы обнулить доверие к тому, что и так показывается караулу.

Кто согласует — начальник отдела (supervisor) или админ; правит — инспектор в
своём районе. Это то же разделение, что и у предписаний.
"""

from alembic import op

revision = "0018_card_revisions"
down_revision = "0017_ops_module"
branch_labels = None
depends_on = None


REVIEW_STATUSES = ("draft", "on_review", "approved")


def upgrade() -> None:
    statuses = ", ".join(f"'{s}'" for s in REVIEW_STATUSES)

    op.execute(
        f"""
        ALTER TABLE operational_cards
            ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved'
                CHECK (review_status IN ({statuses})),
            ADD COLUMN IF NOT EXISTS updated_by  TEXT,
            ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS approved_by TEXT,
            ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS card_revisions (
            id             BIGSERIAL PRIMARY KEY,
            card_id        BIGINT NOT NULL REFERENCES operational_cards(id) ON DELETE CASCADE,
            -- Снимок ДО изменения: откат = взять этот JSON целиком.
            extracted      JSONB,
            changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            note           TEXT,
            author         TEXT NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS card_revisions_card_idx "
        "ON card_revisions (card_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS card_revisions")
    op.execute(
        """
        ALTER TABLE operational_cards
            DROP COLUMN IF EXISTS approved_at,
            DROP COLUMN IF EXISTS approved_by,
            DROP COLUMN IF EXISTS updated_at,
            DROP COLUMN IF EXISTS updated_by,
            DROP COLUMN IF EXISTS review_status
        """
    )
