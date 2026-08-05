"""Расстановка сил на поэтажном плане: план-координаты и направление

Revision ID: 0020_plan_positions
Revises: 0019_deployment
Create Date: 2026-08-05

Позиция ствола на пятом этаже не имеет осмысленной GPS-координаты: у неё есть
этаж, место на плане и направление работы. На карте она вырождается в точку
поверх крыши. Поэтому расстановка живёт в двух пространствах:

  • на местности — `geom` (машины, штаб, автолестница, линия от гидранта);
  • внутри здания — `floor` + `plan_x`/`plan_y` (стволы, звенья, рубежи).

Одна позиция может иметь оба: машина у подъезда стоит и на карте, и на плане
первого этажа.

**Почему координаты нормализованы 0..1, а не в пикселях.** План рисуется в
разном масштабе — планшет РТП, десктоп диспетчера, экспорт в донесение. Любая
пиксельная координата «поедет» при первом изменении размера, и расстановка
после пожара окажется не там, где её ставили. Доля от габарита плана этим
свойством не обладает: она остаётся верной в любом масштабе и переживает
пересъёмку подложки, если пропорции сохранены.

**heading** — направление работы ствола в градусах (0 = север, по часовой).
Ноль от отсутствия отличается NULL: у штаба и рубежа направления нет, а ствол
без заданного направления — это ствол, направление которому ещё не задали.
"""

from alembic import op

revision = "0020_plan_positions"
down_revision = "0019_deployment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE deployment_positions
            -- Этаж свободным текстом: в ПТП пишут не только числа
            -- («подвал», «кровля», «тех. этаж»).
            ADD COLUMN IF NOT EXISTS floor   TEXT,
            -- Доля от габарита плана: 0..1 по каждой оси.
            ADD COLUMN IF NOT EXISTS plan_x  DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS plan_y  DOUBLE PRECISION,
            -- Направление работы ствола, градусы (0 = север, по часовой).
            ADD COLUMN IF NOT EXISTS heading SMALLINT
        """
    )
    # Координаты ставятся парой — одна половина бесполезна и рисуется у края.
    op.execute(
        """
        ALTER TABLE deployment_positions
            DROP CONSTRAINT IF EXISTS deployment_positions_plan_xy,
            ADD CONSTRAINT deployment_positions_plan_xy CHECK (
                (plan_x IS NULL) = (plan_y IS NULL)
                AND (plan_x IS NULL OR (plan_x BETWEEN 0 AND 1))
                AND (plan_y IS NULL OR (plan_y BETWEEN 0 AND 1))
            )
        """
    )
    op.execute(
        """
        ALTER TABLE deployment_positions
            DROP CONSTRAINT IF EXISTS deployment_positions_heading,
            ADD CONSTRAINT deployment_positions_heading CHECK (
                heading IS NULL OR (heading BETWEEN 0 AND 359)
            )
        """
    )
    # Схема этажа открывается целиком — выборка всегда идёт по (выезд, этаж).
    op.execute(
        "CREATE INDEX IF NOT EXISTS deployment_positions_floor_idx "
        "ON deployment_positions (callout_id, floor)"
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE deployment_positions
            DROP CONSTRAINT IF EXISTS deployment_positions_heading,
            DROP CONSTRAINT IF EXISTS deployment_positions_plan_xy,
            DROP COLUMN IF EXISTS heading,
            DROP COLUMN IF EXISTS plan_y,
            DROP COLUMN IF EXISTS plan_x,
            DROP COLUMN IF EXISTS floor
        """
    )
