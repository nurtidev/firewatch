"""Индекс operational_cards(building_id)

Revision ID: 0025_cards_building_idx
Revises: 0024_deployment_late_sync
Create Date: 2026-09-15

Follow-up ревью Phase 3 (архив донесений / «Расхождение с ПТП» → карточка):
GET /reports теперь на каждый выезд с привязкой к зданию джойнит
`operational_cards` через LATERAL `WHERE building_id = fr.building_id
ORDER BY id DESC LIMIT 1` (та же логика «последняя карточка объекта», что у
боевого пакета, `_build_pack` в dispatch.py). Без индекса это последовательный
скан таблицы карточек на каждую строку донесений — на реестре из сотен
объектов и растущем архиве оцифровок это быстро становится заметным.
"""

from alembic import op

revision = "0025_cards_building_idx"
down_revision = "0024_deployment_late_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS operational_cards_building_id_idx "
        "ON operational_cards (building_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS operational_cards_building_id_idx")
