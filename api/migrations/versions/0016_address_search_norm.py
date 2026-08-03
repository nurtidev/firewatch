"""Поиск адреса без казахской диакритики: buildings.search_norm + buildings.alias

Revision ID: 0016_address_search_norm
Revises: 0015_user_disable
Create Date: 2026-08-03

Диспетчер ЦОУ принимает вызов с русской раскладки, где нет `ә ғ қ ң ө ұ ү һ і`.
Адрес в реестре записан по-казахски («Тәуелсіздік даңғылы 33»), поэтому точное
вхождение подстроки не срабатывает: из восьми написаний, которыми абонент
реально диктует адрес, находились два. Названия улиц в РК не переводятся —
только транслитерируются, поэтому чинится именно диакритика, а не перевод.

Решение — нормализованная колонка, по которой и идёт поиск:

* `fw_norm_addr(text)` — IMMUTABLE-функция свёртки: lower() + казахские буквы к
  базовым кириллическим (ә→а, қ→к, і→и, ы→и, …). Одна и та же таблица свёртки
  продублирована в `api/app/routers/dispatch.py` (`_FOLD_FROM/_FOLD_TO`) —
  запрос нормализуется в Python, адрес в SQL, обе стороны обязаны совпадать
  (проверяется тестом `test_db_integration.py::test_norm_addr_sql_matches_python`).
* `buildings.alias` — народные названия крупных объектов («Хайвилл»), по которым
  диспетчер и абонент ищут чаще, чем по официальному адресу. Источник — уже
  оцифрованные ПТП (`operational_cards.extracted->object->name/name_alt`);
  синхронизация держится триггером на `operational_cards`, а не разовым
  бэкфиллом: сиды ПТП идемпотентны и пересоздают карточки (в т.ч. с привязкой к
  другому зданию), а PDF грузят через `/cards` — одноразовая заливка протухла бы
  на первой же пересборке.
* `buildings.search_norm` — STORED generated из адреса и алиаса: поиск не платит
  за translate() на каждой строке, а GIN/pg_trgm держит LIKE '%…%' быстрым по
  мере роста реестра (сейчас 4,5 тыс. зданий, поиск 22 мс — деградации быть
  не должно).
"""

from alembic import op

revision = "0016_address_search_norm"
down_revision = "0015_user_disable"
branch_labels = None
depends_on = None

# Свёртка казахских букв к базовым кириллическим. ы→и — не диакритика, а частая
# транслитерация на слух («Сарайшық» → «сарайшик»); свёртка применяется к обеим
# сторонам сравнения, поэтому равенство симметрично.
FOLD_FROM = "әғқңөұүһіыё"
FOLD_TO = "агкноуухиие"


def upgrade() -> None:
    # pg_trgm — для GIN-индекса под LIKE '%…%'. В образе PostGIS доступно.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION fw_norm_addr(t text) RETURNS text
            LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
        AS $$ SELECT translate(lower(t), '{FOLD_FROM}', '{FOLD_TO}') $$
        """
    )
    op.execute("ALTER TABLE buildings ADD COLUMN IF NOT EXISTS alias TEXT")
    op.execute(
        """
        ALTER TABLE buildings ADD COLUMN IF NOT EXISTS search_norm TEXT
            GENERATED ALWAYS AS (
                fw_norm_addr(coalesce(address, '') || ' ' || coalesce(alias, ''))
            ) STORED
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS buildings_search_norm_trgm "
        "ON buildings USING gin (search_norm gin_trgm_ops)"
    )

    # Алиасы объекта из его карточек ПТП: официальное имя + известные варианты
    # («ЖК «Хайвилл-Астана»», «Хайвил Астана», «High Vill Kazakhstan»).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fw_building_alias(bid bigint) RETURNS text
            LANGUAGE sql STABLE
        AS $$
            SELECT string_agg(DISTINCT x.val, ' ')
              FROM operational_cards oc
              JOIN buildings bb ON bb.id = oc.building_id
              CROSS JOIN LATERAL (
                  SELECT oc.extracted->'object'->>'name' AS val
                  UNION ALL
                  SELECT jsonb_array_elements_text(oc.extracted->'object'->'name_alt')
                   WHERE jsonb_typeof(oc.extracted->'object'->'name_alt') = 'array'
              ) x
             WHERE oc.building_id = bid
               AND jsonb_typeof(oc.extracted->'object') = 'object'
               AND x.val IS NOT NULL AND x.val <> ''
               -- у демо-карточек «имя объекта» = сам адрес: такой алиас ничего
               -- не добавляет к поиску, только шум в выдаче
               AND fw_norm_addr(x.val) <> fw_norm_addr(coalesce(bb.address, ''))
        $$
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fw_sync_building_alias() RETURNS trigger
            LANGUAGE plpgsql
        AS $$
        BEGIN
            -- Карточку перепривязали/удалили — старое здание теряет алиас.
            IF TG_OP <> 'INSERT' AND OLD.building_id IS NOT NULL THEN
                UPDATE buildings SET alias = fw_building_alias(OLD.building_id)
                 WHERE id = OLD.building_id;
            END IF;
            IF TG_OP <> 'DELETE' AND NEW.building_id IS NOT NULL THEN
                UPDATE buildings SET alias = fw_building_alias(NEW.building_id)
                 WHERE id = NEW.building_id;
            END IF;
            RETURN NULL;
        END
        $$
        """
    )
    op.execute("DROP TRIGGER IF EXISTS operational_cards_alias_sync ON operational_cards")
    op.execute(
        """
        CREATE TRIGGER operational_cards_alias_sync
        AFTER INSERT OR DELETE OR UPDATE OF building_id, extracted
        ON operational_cards
        FOR EACH ROW EXECUTE FUNCTION fw_sync_building_alias()
        """
    )
    # Первичное заполнение по всем зданиям: заодно снимает алиасы там, где
    # карточки больше нет.
    op.execute(
        """
        UPDATE buildings b SET alias = fw_building_alias(b.id)
         WHERE b.alias IS DISTINCT FROM fw_building_alias(b.id)
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS operational_cards_alias_sync ON operational_cards")
    op.execute("DROP FUNCTION IF EXISTS fw_sync_building_alias()")
    op.execute("DROP FUNCTION IF EXISTS fw_building_alias(bigint)")
    op.execute("DROP INDEX IF EXISTS buildings_search_norm_trgm")
    op.execute("ALTER TABLE buildings DROP COLUMN IF EXISTS search_norm")
    op.execute("ALTER TABLE buildings DROP COLUMN IF EXISTS alias")
    op.execute("DROP FUNCTION IF EXISTS fw_norm_addr(text)")
