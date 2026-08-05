"""идемпотентность донесений: field_reports.client_id

Revision ID: 0014_report_client_id
Revises: 0013_scoping_links
Create Date: 2026-08-03

Донесение из поля уходит через офлайн-очередь: устройство хранит его локально и
повторяет отправку, пока не получит подтверждение. Такая доставка «хотя бы один
раз» по определению допускает повтор — POST дошёл до сервера, ответ потерялся,
клиент отправляет снова. У визитов дубль невозможен благодаря уникальному
ключу (inspector_id, building_id, visit_date); у донесений такого ключа нет —
одно и то же препятствие может фиксироваться дважды законно (разными людьми,
в разное время), поэтому «естественного» ключа не существует.

Отсюда `client_id` — идентификатор попытки, который генерирует само устройство
(id элемента очереди). Частичный уникальный индекс отсекает повторную вставку
той же попытки; исторические записи с NULL друг другу не мешают.
"""

from alembic import op

revision = "0014_report_client_id"
down_revision = "0013_scoping_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS client_id TEXT")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS field_reports_client_id_key "
        "ON field_reports (client_id) WHERE client_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS field_reports_client_id_key")
    op.execute("ALTER TABLE field_reports DROP COLUMN IF EXISTS client_id")
