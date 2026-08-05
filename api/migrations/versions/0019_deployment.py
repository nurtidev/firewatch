"""План развёртывания: расстановка сил на выезде

Revision ID: 0019_deployment
Revises: 0018_card_revisions
Create Date: 2026-08-05

Расстановка сил по боевым участкам: где поданы стволы на тушение и на защиту,
где стоят машины, где рубеж локализации, где штаб. До этого расчёт говорил
«4 ствола на тушение, 2 на защиту», но куда именно они поданы, не фиксировалось
нигде, кроме памяти РТП и бумажного донесения после выезда.

**Что даёт связка с расчётом.** Позиции типа `barrel_ext`/`barrel_def`
сопоставимы с `forces_hint`: система показывает «подано 3 из 4 стволов по
расчёту». Это то же сравнение «факт против методики», что и у наряда техники,
и оно же — источник разбора после выезда.

**Ограничение, зафиксированное осознанно.** Позиция хранит координату и
текстовый сектор («БУ-1», «5 этаж, северная лестница»), но не привязана к
геометрии плана объекта: интерактивная расстановка на поэтажном плане —
отдельная работа, требующая редактора схем. Сейчас расстановка ведётся
списком по участкам; координата опциональна и нужна тем позициям, что стоят
на местности (машины, рубежи), а не внутри здания.
"""

from alembic import op

revision = "0019_deployment"
down_revision = "0018_card_revisions"
branch_labels = None
depends_on = None


# Типы позиций. Разделение стволов на тушение/защиту не косметическое: расчёт
# по методике даёт для них разные числа (Qт и Qз), и сверять факт с планом
# можно только раздельно.
POSITION_KINDS = (
    "barrel_ext",   # ствол на тушение
    "barrel_def",   # ствол на защиту
    "vehicle",      # позиция машины
    "checkpoint",   # рубеж локализации
    "hq",           # штаб пожаротушения
    "ladder",       # автолестница / место установки
    "other",
)

# Этап боевых действий, к которому относится позиция: расстановка на
# локализации и на ликвидации различается, и затирать первую второй нельзя —
# по ним потом разбирают выезд.
POSITION_PHASES = ("localization", "extinguishing")


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS deployment_positions (
            id          BIGSERIAL PRIMARY KEY,
            callout_id  BIGINT NOT NULL REFERENCES callouts(id) ON DELETE CASCADE,
            kind        TEXT NOT NULL CHECK (kind IN ({_in_list(POSITION_KINDS)})),
            phase       TEXT NOT NULL DEFAULT 'localization'
                        CHECK (phase IN ({_in_list(POSITION_PHASES)})),
            -- Боевой участок: «БУ-1», «5 этаж, северная лестница». Свободный
            -- текст намеренно: нумерация участков задаётся РТП на месте.
            sector      TEXT,
            -- Координата нужна позициям на местности; внутри здания её нет.
            geom        geometry(Point, 4326),
            note        TEXT,
            -- Машина из наряда, если позиция — это конкретная единица техники.
            vehicle_id  BIGINT REFERENCES station_vehicles(id) ON DELETE SET NULL,
            created_by  TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS deployment_positions_callout_idx "
        "ON deployment_positions (callout_id, phase)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS deployment_positions_geom_gist "
        "ON deployment_positions USING GIST (geom)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS deployment_positions")
