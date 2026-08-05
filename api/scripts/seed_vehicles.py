"""Seed демо-техники по пожарным частям (оперативный модуль).

Run:  docker compose exec api python -m scripts.seed_vehicles

Ставит на учёт типовой набор машин в каждой части и привязывает учётную запись
`responder` к первой части (`users.station_id`) — без этой привязки начальник
караула не может менять состояние техники: скоупинг требует явной части, а не
молчаливого доступа ко всему городу.

Состав набора — типовой для городской ПЧ: две автоцистерны (основная и
резервная), автолестница и насосно-рукавный. Одна машина в каждой третьей
части ставится в ремонт, чтобы демонстрация показывала не только идеальную
картину: расчёт сил обязан упираться в фактическое наличие, иначе учёт
бессмысленен.

Идемпотентно: позывной уникален в пределах части (station_vehicles_callsign_key).
"""

from sqlalchemy import text

from app.db import engine

# (позывной, тип, ёмкость цистерны в литрах)
FLEET = [
    ("АЦ-1", "ac", 3000),
    ("АЦ-2", "ac", 5000),
    ("АЛ-30", "al", None),
    ("АНР-40", "anr", 2000),
]


def main() -> None:
    with engine.begin() as conn:
        stations = conn.execute(
            text("SELECT id, name FROM fire_stations ORDER BY id")
        ).mappings().all()
        if not stations:
            print("Пожарных частей нет — сначала прогоните import_infra.")
            return

        created = 0
        for idx, station in enumerate(stations):
            for callsign, vtype, water in FLEET:
                # Каждая третья часть держит резервную АЦ в ремонте — так
                # демонстрация показывает и дефицит, а не только полный строй.
                status = "repair" if (idx % 3 == 2 and callsign == "АЦ-2") else "in_service"
                res = conn.execute(
                    text(
                        """
                        INSERT INTO station_vehicles
                            (station_id, callsign, vehicle_type, water_l, status, updated_by)
                        VALUES (:sid, :cs, :vt, :water, :status, 'seed')
                        ON CONFLICT (station_id, lower(callsign)) DO NOTHING
                        RETURNING id
                        """
                    ),
                    {
                        "sid": station["id"],
                        "cs": callsign,
                        "vt": vtype,
                        "water": water,
                        "status": status,
                    },
                ).scalar()
                if res is not None:
                    created += 1

        # Начальник караула ведёт технику своей части — привязка обязательна.
        first_station = stations[0]["id"]
        conn.execute(
            text(
                "UPDATE users SET station_id = :sid "
                "WHERE role = 'responder' AND station_id IS NULL"
            ),
            {"sid": first_station},
        )

        total = conn.execute(text("SELECT COUNT(*) FROM station_vehicles")).scalar()
        print(
            f"Техника: добавлено {created}, всего на учёте {total} "
            f"в {len(stations)} частях; responder привязан к части #{first_station}."
        )


if __name__ == "__main__":
    main()
