"""Seed демо-данных оперативного модуля: выезды с историей, наряды, расход,
развёртывание и правки оперкарточек.

Run:  docker compose exec api python -m scripts.seed_ops_demo

Зачем отдельно от seed_vehicles: техника — это справочник, без которого модуль
не работает вообще, а здесь наполняется ИСТОРИЯ. Без неё сводка по частям
пуста (медианы считать не по чему), а планшет РТП показывает голые формы, по
которым непонятно, как модуль выглядит в работе.

Данные детерминированы (hash от индекса, без random) — повторный прогон на
другой машине даёт ту же картину, и демонстрация воспроизводима.

Реалистичность важнее красоты: часть выездов намеренно выходит за норматив
прибытия 10 минут, в одной части техника в ремонте, у одного выезда наряд
меньше расчётного. Демонстрация, где всё идеально, не показывает, ради чего
модуль сделан — он нужен, чтобы дефицит был виден.

Идемпотентно: демо-выезды помечены DEMO_MARK в note и при повторном прогоне
не дублируются.
"""

import hashlib
from datetime import timedelta

from sqlalchemy import text

from app.db import engine

# Маркер демо-строк: по нему скрипт узнаёт свои выезды и не плодит дубли.
DEMO_MARK = "[демо]"

# Сценарии выездов. minutes_* — смещения от момента сообщения о пожаре.
# response выше 10 мин (норматив) у части сценариев — намеренно.
SCENARIOS = [
    # (тип, дней назад, сбор, прибытие, первый ствол, локализация, ликвидация, ранг)
    ("fire", 27, 1.5, 7, 9, 34, 58, "№2"),
    ("fire", 24, 2, 12, 15, 51, 96, "№2"),
    ("smoke", 22, 1, 5, 7, 14, 21, "№1"),
    ("alarm", 20, 1, 6, None, None, 12, "№1"),
    ("fire", 18, 2.5, 14, 18, 62, 118, "№3"),
    ("smoke", 16, 1, 4, 6, 11, 17, "№1"),
    ("fire", 14, 2, 9, 11, 38, 71, "№2"),
    ("alarm", 12, 1.5, 8, None, None, 15, "№1"),
    ("fire", 9, 2, 11, 14, 44, 83, "№2"),
    ("smoke", 7, 1, 6, 8, 16, 26, "№1"),
    ("fire", 5, 3, 16, 21, 73, 134, "№3"),
    ("other", 4, 1, 7, None, None, 19, "№1"),
    ("fire", 3, 2, 8, 10, 29, 52, "№2"),
    ("smoke", 2, 1.5, 5, 7, 13, 22, "№1"),
]

# Расход по типу вызова: что реально списывают. Ложный вызов не тратит ничего,
# кроме ГСМ, — вносить туда пену значило бы рисовать красивую, но ложную картину.
RESOURCES_BY_TYPE = {
    "fire": [("hose", 6), ("barrel", 3), ("water", 12), ("fuel", 18), ("scba", 4)],
    "smoke": [("hose", 2), ("barrel", 1), ("water", 3), ("fuel", 8)],
    "alarm": [("fuel", 6)],
    "other": [("fuel", 7), ("hose", 1)],
}

# Расстановка по типу вызова: боевые участки и позиции.
DEPLOYMENT_BY_TYPE = {
    "fire": [
        ("barrel_ext", "localization", "БУ-1, очаг, 3 этаж"),
        ("barrel_ext", "localization", "БУ-1, лестничная клетка"),
        ("barrel_def", "localization", "БУ-2, защита этажом выше"),
        ("hq", "localization", "Штаб у главного входа"),
        ("checkpoint", "extinguishing", "Рубеж по коридору 3 этажа"),
        ("barrel_ext", "extinguishing", "БУ-1, дотушивание"),
    ],
    "smoke": [
        ("barrel_ext", "localization", "БУ-1, источник задымления"),
        ("hq", "localization", "Штаб у подъезда"),
    ],
    "alarm": [("hq", "localization", "Проверка по прибытии")],
    "other": [("hq", "localization", "Штаб на месте")],
}


def pick(seed: str, n: int) -> int:
    """Детерминированный выбор из n вариантов."""
    return int(hashlib.md5(seed.encode()).hexdigest()[:8], 16) % max(1, n)


def main() -> None:
    with engine.begin() as conn:
        existing = conn.execute(
            text("SELECT COUNT(*) FROM callouts WHERE note LIKE :m"),
            {"m": f"%{DEMO_MARK}%"},
        ).scalar()
        if existing:
            print(f"Демо-выезды уже есть ({existing}) — повторный прогон пропущен.")
            return

        stations = conn.execute(
            text("SELECT id FROM fire_stations ORDER BY id")
        ).scalars().all()
        buildings = conn.execute(
            text(
                "SELECT id, address, ST_Y(ST_Centroid(geom)) AS lat, "
                "ST_X(ST_Centroid(geom)) AS lng FROM buildings "
                "WHERE geom IS NOT NULL ORDER BY id LIMIT 60"
            )
        ).mappings().all()
        if not stations or not buildings:
            print("Нет частей или зданий — сначала import_infra / import_osm.")
            return

        vehicles_by_station: dict[int, list[int]] = {}
        for row in conn.execute(
            text(
                "SELECT id, station_id FROM station_vehicles "
                "WHERE status <> 'repair' ORDER BY id"
            )
        ).mappings():
            vehicles_by_station.setdefault(row["station_id"], []).append(row["id"])

        made = 0
        for i, (ctype, days_ago, turnout, arrive, jet, localize, extinguish, rank) in enumerate(
            SCENARIOS
        ):
            b = buildings[pick(f"b{i}", len(buildings))]
            station_id = stations[pick(f"s{i}", len(stations))]

            # Момент сообщения о пожаре — опорная точка всей хронологии.
            reported = f"now() - interval '{days_ago} days'"

            def at(minutes: float | None) -> str:
                if minutes is None:
                    return "NULL"
                return f"{reported} + interval '{minutes} minutes'"

            callout_id = conn.execute(
                text(
                    f"""
                    INSERT INTO callouts
                        (building_id, address, geom, callout_type, note, status,
                         station_id, created_by, created_at,
                         dispatched_at, arrived_at, first_jet_at,
                         localized_at, extinguished_at, rank_declared,
                         closed_by, closed_at, close_note)
                    VALUES
                        (:bid, :addr,
                         ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                         :ctype, :note, 'closed',
                         :sid, 'dispatcher', {reported},
                         {at(turnout)}, {at(arrive)}, {at(jet)},
                         {at(localize)}, {at(extinguish)}, :rank,
                         'dispatcher', {at(extinguish)}, :close_note)
                    RETURNING id
                    """
                ),
                {
                    "bid": b["id"],
                    "addr": b["address"],
                    "lat": b["lat"],
                    "lng": b["lng"],
                    "ctype": ctype,
                    "note": f"Учебный выезд {DEMO_MARK}",
                    "sid": station_id,
                    "rank": rank,
                    "close_note": "Ликвидирован, пострадавших нет",
                },
            ).scalar()

            # Наряд: 1–3 машины части. У одного выезда намеренно меньше
            # расчётного — дефицит должен быть виден на экране, а не спрятан.
            pool = vehicles_by_station.get(station_id, [])
            count = 1 if ctype in ("alarm", "other") else 2 + (i % 2)
            for vid in pool[:count]:
                conn.execute(
                    text(
                        "INSERT INTO callout_vehicles "
                        "(callout_id, vehicle_id, assigned_by, assigned_at, released_at) "
                        f"VALUES (:cid, :vid, 'dispatcher', {at(turnout)}, {at(extinguish)})"
                    ),
                    {"cid": callout_id, "vid": vid},
                )

            for key, qty in RESOURCES_BY_TYPE[ctype]:
                # Разброс ±30% от базовой величины, детерминированный.
                factor = 0.7 + (pick(f"r{i}{key}", 7) / 10.0)
                conn.execute(
                    text(
                        "INSERT INTO callout_resources "
                        "(callout_id, item_key, qty, recorded_by, recorded_at) "
                        f"VALUES (:cid, :k, :q, 'responder', {at(extinguish)})"
                    ),
                    {"cid": callout_id, "k": key, "q": round(qty * factor, 1)},
                )

            for kind, phase, sector in DEPLOYMENT_BY_TYPE[ctype]:
                conn.execute(
                    text(
                        "INSERT INTO deployment_positions "
                        "(callout_id, kind, phase, sector, created_by, created_at) "
                        f"VALUES (:cid, :kind, :phase, :sector, 'responder', {at(arrive)})"
                    ),
                    {"cid": callout_id, "kind": kind, "phase": phase, "sector": sector},
                )
            made += 1

        # Один действующий выезд — чтобы планшет РТП открывался с живым пакетом,
        # а не пустым списком. Без отметок: их ставит демонстрирующий.
        b = buildings[pick("active", len(buildings))]
        active_id = conn.execute(
            text(
                """
                INSERT INTO callouts
                    (building_id, address, geom, callout_type, note, status,
                     station_id, created_by, created_at)
                VALUES (:bid, :addr, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                        'fire', :note, 'active', :sid, 'dispatcher',
                        now() - interval '6 minutes')
                RETURNING id
                """
            ),
            {
                "bid": b["id"],
                "addr": b["address"],
                "lat": b["lat"],
                "lng": b["lng"],
                "note": f"Действующий выезд {DEMO_MARK}",
                "sid": stations[0],
            },
        ).scalar()

        # Правки оперкарточек: история версий и разные стадии согласования —
        # иначе редактор выглядит нетронутым и непонятно, что он умеет.
        cards = conn.execute(
            text("SELECT id, extracted FROM operational_cards ORDER BY id LIMIT 3")
        ).mappings().all()
        edited = 0
        for n, card in enumerate(cards):
            before = card["extracted"] if isinstance(card["extracted"], dict) else {}
            conn.execute(
                text(
                    "INSERT INTO card_revisions "
                    "(card_id, extracted, changed_fields, note, author, created_at) "
                    "VALUES (:cid, CAST(:ex AS jsonb), CAST(:ch AS jsonb), :note, "
                    "'inspector', now() - interval '9 days')"
                ),
                {
                    "cid": card["id"],
                    "ex": __import__("json").dumps(before, ensure_ascii=False),
                    "ch": '["notes"]',
                    "note": "Уточнение по результатам обследования",
                    "cid_note": None,
                },
            )
            # Три карточки — три стадии, чтобы на демонстрации был виден цикл.
            status = ("approved", "on_review", "draft")[n % 3]
            conn.execute(
                text(
                    "UPDATE operational_cards SET review_status = :st, "
                    "updated_by = 'inspector', updated_at = now() - interval '9 days', "
                    "approved_by = CASE WHEN :st = 'approved' THEN 'supervisor' END, "
                    "approved_at = CASE WHEN :st = 'approved' "
                    "THEN now() - interval '8 days' END "
                    "WHERE id = :cid"
                ),
                {"st": status, "cid": card["id"]},
            )
            edited += 1

        total_pos = conn.execute(
            text("SELECT COUNT(*) FROM deployment_positions")
        ).scalar()
        print(
            f"Демо-данные: выездов {made} закрытых + 1 действующий (#{active_id}), "
            f"позиций развёртывания {total_pos}, карточек с историей {edited}."
        )


if __name__ == "__main__":
    main()
