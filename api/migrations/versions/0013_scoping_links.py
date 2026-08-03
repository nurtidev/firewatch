"""Связи для скоупинга: inspectors.user_id и operational_cards.district

Revision ID: 0013_scoping_links
Revises: 0012_callouts
Create Date: 2026-08-03

Две недостающие связи, без которых район-скоупинг и проверка авторства акта
были невозможны:

1. `inspectors.user_id` → `users.id`. Реестр инспекторов (`inspectors`) и
   учётные записи (`users`) жили порознь, поэтому `POST /routes/visit` не мог
   проверить, что визит закрывает именно тот инспектор, от чьего имени идёт
   акт. Сопоставление по ФИО для этого не годится: в демо-данных «Сулейменова
   А.Б.» — одновременно пользователь Есильского района и инспектор
   Алматинского, то есть совпадение имени связало бы разные подразделения.
   Связь — только явный FK; уникальный индекс не даёт привязать две строки
   реестра к одной учётной записи.

2. `operational_cards.district` — район, зафиксированный при загрузке ПТП.
   Для карточек, привязанных к зданию, район берётся у здания; загруженный PDF
   привязки не имеет, и без этой колонки его нельзя было отнести ни к одному
   району (а значит — либо показывать всем, либо никому).

Backfill (1) — разовая операция над уже созданными демо-записями: связываем
пользователя с ролью `inspector` со строкой реестра, у которой совпадают И ФИО,
И район, и только когда такая пара единственная с обеих сторон. Это миграция
данных, а не правило доступа: в рантайме используется исключительно FK.
"""

from alembic import op

revision = "0013_scoping_links"
down_revision = "0012_callouts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE inspectors ADD COLUMN IF NOT EXISTS user_id BIGINT "
        "REFERENCES users(id) ON DELETE SET NULL"
    )
    # Одна учётная запись — не более одной строки реестра (NULL не ограничен:
    # инспектор в реестре может пока не иметь учётной записи).
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS inspectors_user_id_key "
        "ON inspectors (user_id) WHERE user_id IS NOT NULL"
    )

    # Разовый backfill демо-реестра: связываем только однозначные пары — ФИО и
    # район совпадают, и с обеих сторон кандидат единственный. Неоднозначные
    # (тёзки, разные районы) остаются без связи: лучше 403 и ручная привязка,
    # чем чужое авторство акта.
    op.execute(
        """
        WITH pairs AS (
            SELECT u.id AS user_id, i.id AS inspector_id
              FROM users u
              JOIN inspectors i
                ON i.name = u.name
               AND i.district IS NOT DISTINCT FROM u.district
             WHERE u.role = 'inspector'
               AND u.district IS NOT NULL
               AND i.user_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM inspectors z WHERE z.user_id = u.id)
        ),
        unique_pairs AS (
            SELECT p.user_id, p.inspector_id
              FROM pairs p
             WHERE (SELECT count(*) FROM pairs a WHERE a.user_id = p.user_id) = 1
               AND (SELECT count(*) FROM pairs b WHERE b.inspector_id = p.inspector_id) = 1
        )
        UPDATE inspectors i
           SET user_id = up.user_id
          FROM unique_pairs up
         WHERE i.id = up.inspector_id
        """
    )

    op.execute("ALTER TABLE operational_cards ADD COLUMN IF NOT EXISTS district TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE operational_cards DROP COLUMN IF EXISTS district")
    op.execute("DROP INDEX IF EXISTS inspectors_user_id_key")
    op.execute("ALTER TABLE inspectors DROP COLUMN IF EXISTS user_id")
