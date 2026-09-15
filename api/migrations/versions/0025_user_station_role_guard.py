"""users.station_id: держать инвариант «только у responder» в самой БД

Revision ID: 0025_user_station_role_guard
Revises: 0024_deployment_late_sync
Create Date: 2026-09-15

`users.station_id` (0017) появился раньше, чем какой-либо admin-эндпоинт умел
его заполнять — до сих пор это делалось точечным SQL. Теперь `POST /auth/users`
и `PATCH /auth/users/{username}/station` проверяют роль в приложении, но район
уже показал: на проде привязки правятся и прямым SQL (CLAUDE.md — «перенос
района — точечным SQL»). Роль пользователя меняется тем же путём: отдельного
API для смены роли нет и не планируется в этой задаче.

Триггер — вторая линия обороны на случай именно такой правки: если роль
становится не `responder` (при INSERT или UPDATE), station_id обнуляется тут
же, в той же транзакции, тем же оператором, который менял роль. Не CHECK —
CHECK на вставке/обновлении просто упал бы ошибкой на «UPDATE users SET
role = 'dispatcher' WHERE username = …», оставив админа разбираться, почему
безобидная смена роли не проходит. Самоисправление безопаснее отказа.

Бэкфилл ниже — на случай, если какой-то ряд уже противоречит инварианту
(с этой миграции такого быть не должно, но она же и вводит правило).
"""

from alembic import op

revision = "0025_user_station_role_guard"
down_revision = "0024_deployment_late_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE users SET station_id = NULL "
        "WHERE role <> 'responder' AND station_id IS NOT NULL"
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fw_clear_station_if_not_responder() RETURNS trigger
            LANGUAGE plpgsql
        AS $$
        BEGIN
            IF NEW.role <> 'responder' THEN
                NEW.station_id := NULL;
            END IF;
            RETURN NEW;
        END
        $$
        """
    )
    op.execute("DROP TRIGGER IF EXISTS users_clear_station_on_role_change ON users")
    op.execute(
        """
        CREATE TRIGGER users_clear_station_on_role_change
        BEFORE INSERT OR UPDATE OF role, station_id ON users
        FOR EACH ROW EXECUTE FUNCTION fw_clear_station_if_not_responder()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS users_clear_station_on_role_change ON users")
    op.execute("DROP FUNCTION IF EXISTS fw_clear_station_if_not_responder()")
