"""Зоны прибытия по дорогам: сохранённые изохроны частей

Revision ID: 0022_station_isochrones
Revises: 0021_deployment_offline
Create Date: 2026-08-06

До сих пор зона прибытия части считалась геодезическим буфером: круг радиусом
3,5 км ≈ десять минут хода. Круг не знает ни реки Есиль, ни железной дороги,
ни закрытых кварталов — он рисует покрытие там, где машина не проедет, и
всегда завышает его. Карта с таким кругом показывает «район прикрыт» ровно
там, где на самом деле караул опаздывает.

Теперь зона считается по дорожному графу (OSRM, см. `app/routing.py`) и
хранится здесь. Почему таблица, а не расчёт на лету: матрица времён на сетке
точек — это тысячи маршрутов на каждую часть, секунды процессорного времени.
Карту открывают десятки раз в день, а сеть дорог меняется раз в месяц:
считать при каждом открытии значит платить постоянно за то, что меняется
редко.

Расчёт запускается явно (`POST /infra/coverage/rebuild`) и оставляет след:
`computed_at` и `source`. Пустая таблица — не ошибка: пока изохрон нет,
модуль работает на буфере и честно помечает выдачу `approximate: true`.
"""

from alembic import op

revision = "0022_station_isochrones"
down_revision = "0021_deployment_offline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS station_isochrones (
            id           BIGSERIAL PRIMARY KEY,
            station_id   BIGINT NOT NULL REFERENCES fire_stations(id) ON DELETE CASCADE,
            -- Норматив, под который построена зона (600 с = 10 мин в городе).
            seconds      INTEGER NOT NULL CHECK (seconds > 0),
            geom         geometry(MultiPolygon, 4326) NOT NULL,
            -- Чем считали: 'osrm' — дорожный граф. Поле существует, чтобы
            -- происхождение зоны читалось из данных, а не угадывалось.
            source       TEXT NOT NULL DEFAULT 'osrm',
            -- Сколько точек сетки уложилось в норматив: грубая мера того,
            -- насколько зона детальна, и признак вырожденного расчёта.
            points       INTEGER,
            computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (station_id, seconds)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS station_isochrones_geom_gist "
        "ON station_isochrones USING GIST (geom)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS station_isochrones")
