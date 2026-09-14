"""Районы Астаны: полигоны административных границ (OpenStreetMap)

Revision ID: 0023_districts
Revises: 0022_station_isochrones
Create Date: 2026-09-14

До сих пор `buildings.district` назначался хешем osm_id (scripts/seed_ops.py):
скоупинг инспектора резал город по случайной мозаике, а любая цифра «по
районам» была выдумкой. Теперь район — полигон административной границы из
OpenStreetMap (ODbL, «© OpenStreetMap contributors»), а здание, гидрант, часть
и выезд относятся к району по одному правилу (app/districts.py).

Миграция создаёт только схему. Наполняет таблицу и перепривязывает здания
идемпотентный `scripts/seed_districts.py` — он идёт в preDeploy сразу после
миграций (api/railway.json).

Функциональный GIST-индекс по `hydrants.geom::geography` — для городской
сводки (/city): «есть ли исправный гидрант в 800 м» проверяется для каждого
здания города, и `ST_DWithin` по geography без такого индекса перебирал бы все
гидранты на каждое здание. Геометрический индекс hydrants_geom_gist для
выражения `geom::geography` не применяется.
"""

from alembic import op

revision = "0023_districts"
down_revision = "0022_station_isochrones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS districts (
            id               SERIAL PRIMARY KEY,
            -- Написание проекта («Байконырский»), им же заполнены
            -- buildings.district и users.district. OSM-строки («район
            -- Байконур») для сопоставления не используются.
            name             TEXT NOT NULL UNIQUE,
            name_kk          TEXT,
            name_en          TEXT,
            osm_relation_id  BIGINT UNIQUE,
            area_km2         DOUBLE PRECISION,
            geom             geometry(MultiPolygon, 4326) NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS districts_geom_gist ON districts USING GIST (geom)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS hydrants_geog_gist "
        "ON hydrants USING GIST ((geom::geography))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS hydrants_geog_gist")
    op.execute("DROP TABLE IF EXISTS districts")
