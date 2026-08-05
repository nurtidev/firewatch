"""Оперативный модуль: таймлайн выезда, техника частей, расход средств

Revision ID: 0017_ops_module
Revises: 0016_address_search_norm
Create Date: 2026-08-05

Четыре связанных изменения, закрывающие требования службы пожаротушения:

1. **Таймлайн выезда** — отметки времени боевых действий прямо в `callouts`.
   Хронология по методике: сообщение → выезд → прибытие → первый ствол →
   локализация → ликвидация. `created_at` уже хранит момент регистрации
   вызова, поэтому отдельного `reported_at` нет. Отметки монотонны не по
   схеме, а по проверке в API: реальная хронология допускает, например,
   отсутствие `first_jet_at` (ложный вызов закрывается сразу).

2. **Техника частей** (`station_vehicles`) — что физически стоит в части и в
   каком состоянии. Без этого расчёт сил повисает в воздухе: система
   предлагает три отделения, не зная, есть ли они. `fire_stations.vehicles`
   (число из OSM) остаётся как справочная ёмкость и не трогается.

3. **Наряд сил** (`callout_vehicles`) — какие машины отправлены на выезд.
   Отдельная таблица, а не поле, потому что связь многие-ко-многим и нужна
   история: машина может быть снята с выезда раньше остальных.

4. **Расход средств** (`callout_resources`) — что израсходовано при тушении.
   Номенклатура намеренно короткая (7 позиций): чем больше полей требует
   форма, тем меньше их заполняют, а незаполненный учёт хуже отсутствующего.

Плюс `users.station_id` — третий уровень скоупинга (район → часть). Нужен,
чтобы начальник караула вёл технику своей части, а не всего города.
"""

from alembic import op

revision = "0017_ops_module"
down_revision = "0016_address_search_norm"
branch_labels = None
depends_on = None


# Единый источник значений — дублируется в app/routers/dispatch.py.
# При изменении править оба места (CHECK ловит рассинхрон на вставке).
VEHICLE_TYPES = ("ac", "al", "akp", "anr", "asa", "other")
VEHICLE_STATUSES = ("in_service", "on_callout", "repair", "reserve")
RESOURCE_ITEMS = ("hose", "barrel", "foam", "water", "fuel", "ladder", "scba")


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    # --- 1. Таймлайн выезда --------------------------------------------------
    for column in (
        "dispatched_at",   # выезд по тревоге
        "arrived_at",      # прибытие к месту
        "first_jet_at",    # подача первого ствола
        "localized_at",    # локализация
        "extinguished_at",  # ликвидация
    ):
        op.execute(
            f"ALTER TABLE callouts ADD COLUMN IF NOT EXISTS {column} TIMESTAMPTZ"
        )
    # Объявленный ранг пожара. Ранг объявляет РТП, он может отличаться от
    # расчётного — расхождение и есть самая ценная обратная связь по методике.
    op.execute("ALTER TABLE callouts ADD COLUMN IF NOT EXISTS rank_declared TEXT")

    # --- 2. Техника частей ---------------------------------------------------
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS station_vehicles (
            id           BIGSERIAL PRIMARY KEY,
            station_id   BIGINT NOT NULL REFERENCES fire_stations(id) ON DELETE CASCADE,
            callsign     TEXT NOT NULL,
            vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ({_in_list(VEHICLE_TYPES)})),
            status       TEXT NOT NULL DEFAULT 'in_service'
                         CHECK (status IN ({_in_list(VEHICLE_STATUSES)})),
            water_l      INTEGER,
            note         TEXT,
            updated_by   TEXT,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Позывной уникален в пределах части, не глобально: «АЦ-1» есть в каждой ПЧ.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS station_vehicles_callsign_key "
        "ON station_vehicles (station_id, lower(callsign))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS station_vehicles_station_idx "
        "ON station_vehicles (station_id, status)"
    )

    # --- 3. Наряд сил на выезд -----------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS callout_vehicles (
            id          BIGSERIAL PRIMARY KEY,
            callout_id  BIGINT NOT NULL REFERENCES callouts(id) ON DELETE CASCADE,
            vehicle_id  BIGINT NOT NULL REFERENCES station_vehicles(id) ON DELETE CASCADE,
            assigned_by TEXT,
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            released_at TIMESTAMPTZ
        )
        """
    )
    # Одна машина — не более одного действующего назначения на выезд.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS callout_vehicles_active_key "
        "ON callout_vehicles (callout_id, vehicle_id) WHERE released_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS callout_vehicles_callout_idx "
        "ON callout_vehicles (callout_id)"
    )

    # --- 4. Расход средств ---------------------------------------------------
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS callout_resources (
            id          BIGSERIAL PRIMARY KEY,
            callout_id  BIGINT NOT NULL REFERENCES callouts(id) ON DELETE CASCADE,
            item_key    TEXT NOT NULL CHECK (item_key IN ({_in_list(RESOURCE_ITEMS)})),
            qty         NUMERIC(10, 2) NOT NULL CHECK (qty >= 0),
            recorded_by TEXT,
            recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Одна позиция номенклатуры — одна строка на выезд (правка перезаписывает).
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS callout_resources_item_key "
        "ON callout_resources (callout_id, item_key)"
    )

    # --- 5. Скоупинг по части ------------------------------------------------
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS station_id BIGINT "
        "REFERENCES fire_stations(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS station_id")
    op.execute("DROP TABLE IF EXISTS callout_resources")
    op.execute("DROP TABLE IF EXISTS callout_vehicles")
    op.execute("DROP TABLE IF EXISTS station_vehicles")
    for column in (
        "rank_declared",
        "extinguished_at",
        "localized_at",
        "first_jet_at",
        "arrived_at",
        "dispatched_at",
    ):
        op.execute(f"ALTER TABLE callouts DROP COLUMN IF EXISTS {column}")
