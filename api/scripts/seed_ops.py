"""Seed inspection-planning data (Module 04).

Run:  docker compose exec api python -m scripts.seed_ops

Assigns each building a last-inspected date (deterministically synthesized from
osm_id — replace with real ДЧС inspection history at pilot), assigns its
district from the real OSM administrative boundary (scripts/seed_districts —
раньше район тоже был хешем osm_id, то есть выдумкой), and creates a few
inspectors. Idempotent.
"""

import hashlib
from datetime import date, timedelta

from sqlalchemy import text

from app.db import engine
from scripts import seed_districts, seed_users

TODAY = date(2026, 6, 26)

# Третий элемент — username учётной записи, с которой связана строка реестра
# (inspectors.user_id). Связь обязательна: по ней резолвится авторство акта
# проверки, сопоставление по ФИО как правило доступа неприемлемо.
#
# Демо-инспектор — в Есильском, том же районе, что и демо-руководитель
# (seed_users): после перехода на настоящие границы районов в Есильском
# оказался ЖК «Хайвилл», а в Сарыаркинском осталось 65 зданий из 4523 —
# сюжет «инспектор ведёт объект, руководитель контролирует» держится только так.
INSPECTORS = [
    ("Ахметов Д.К.", "Есильский", "inspector"),
    ("Сулейменова А.Б.", "Алматинский", None),
    ("Жунусов Е.М.", "Есильский", None),
]


def rng(osm_id: int, salt: str) -> float:
    h = hashlib.md5(f"{osm_id}:{salt}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def link_demo_inspectors(conn) -> None:
    """Связать строки демо-реестра с учётными записями и выровнять их район.

    Досвязка нужна, когда реестр засеян раньше учётных записей (порядок
    скриптов при развёртывании с нуля не гарантирован). Связывается только
    строка, совпадающая с демо-записью целиком — ФИО И район из INSPECTORS, —
    и только пока у учётной записи нет своей строки: одно ФИО на настоящем
    реестре может принадлежать тёзке из другого района, и такая связь отдала
    бы ему авторство чужих актов. Строка, уже связанная по FK, переезжает в
    район учётной записи в sync_demo_registry — ФИО там не участвует.
    """
    for name, district, username in INSPECTORS:
        if not username:
            continue
        conn.execute(
            text(
                """
                UPDATE inspectors SET user_id = u.id
                  FROM users u
                 WHERE u.username = :u
                   AND inspectors.user_id IS NULL
                   AND inspectors.name = :n
                   AND inspectors.district = :d
                   AND NOT EXISTS (SELECT 1 FROM inspectors z WHERE z.user_id = u.id)
                """
            ),
            {"u": username, "n": name, "d": district},
        )
    # Район связанной строки = район учётной записи (единый источник — seed_users).
    seed_users.sync_demo_registry(conn)


def main() -> None:
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id, osm_id FROM buildings")
        ).mappings().all()

        for b in rows:
            osm_id = b["osm_id"] or b["id"]
            days_ago = 10 + int(rng(osm_id, "lastcheck") * 420)
            last = TODAY - timedelta(days=days_ago)
            conn.execute(
                text("UPDATE buildings SET last_inspected = :l WHERE id = :id"),
                {"l": last, "id": b["id"]},
            )

        # Район — полигон административной границы, тот же шаг, что в preDeploy:
        # здания нового импорта получают настоящий район, а не хеш osm_id.
        district_stats = seed_districts.run(conn)

        existing = conn.execute(text("SELECT count(*) FROM inspectors")).scalar()
        if not existing:
            for name, district, username in INSPECTORS:
                conn.execute(
                    text(
                        "INSERT INTO inspectors (name, district, user_id) VALUES "
                        "(:n, :d, (SELECT id FROM users WHERE username = :u))"
                    ),
                    {"n": name, "d": district, "u": username},
                )

        link_demo_inspectors(conn)

    seed_districts.print_report(district_stats)
    print(f"seeded last_inspected for {len(rows)} buildings, "
          f"{len(INSPECTORS)} inspectors")


if __name__ == "__main__":
    main()
