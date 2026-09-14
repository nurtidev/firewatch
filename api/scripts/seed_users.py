"""Seed demo users with roles.

Run:  docker compose exec api python -m scripts.seed_users

Demo credentials (pilot only — change before any real deployment):
  inspector  / inspector123   — надзорный инспектор (Есильский р-н)
  supervisor / supervisor123  — руководитель управления (Есильский р-н)
  minister   / minister123    — замминистра (руководство, весь город)
  admin      / admin123       — администратор (все модули, весь город)
  dispatcher / dispatcher123  — диспетчер ЦОУ/112 (боевой модуль, весь город)
  responder  / responder123   — начальник караула ПЧ-1 (боевой модуль, весь город)
  akimat     / akimat123      — акимат г. Астаны (городской трек, только чтение, без ПДн)
  owner      / owner123       — председатель ОСИ (внешний владелец, портал)

District scoping: inspector/supervisor see only their district; leadership/admin
see the whole city (district = NULL).

Пароли существующих учётных записей скрипт НЕ переписывает (только новым):
сброс на демо — явно, `python -m scripts.seed_users --reset-demo-passwords`
(локально). На проде скрипт не запускать никогда — см. скилл deploy-railway.

Этот скрипт — только начальный набор для пилота/демо. Приём и отключение
сотрудников делаются администратором через продукт (экран «Пользователи»,
POST /auth/users, /auth/users/{username}/disable|enable) — правка списка ниже
для этого больше не нужна и оставляет действие вне журнала аудита.
"""

import os
import sys

from sqlalchemy import text

from app.auth import hash_password
from app.config import settings
from app.db import engine

# (username, password, name, role, district)
USERS = [
    # Есильский — тот же район, что у supervisor: по настоящим границам OSM там
    # ЖК «Хайвилл», а в Сарыаркинском осталось 65 зданий из 4523. Связанная
    # строка реестра выравнивается ниже (sync_demo_registry).
    ("inspector", "inspector123", "Ахметов Д.К.", "inspector", "Есильский"),
    ("supervisor", "supervisor123", "Сулейменова А.Б.", "supervisor", "Есильский"),
    ("minister", "minister123", "Замминистра", "leadership", None),
    ("admin", "admin123", "Администратор", "admin", None),
    # Боевой модуль: citywide by role (district = NULL), not district-scoped.
    ("dispatcher", "dispatcher123", "Диспетчер ЦОУ", "dispatcher", None),
    ("responder", "responder123", "Начальник караула ПЧ-1", "responder", None),
    # Городской трек: только чтение картины города, без ПДн (app/access.py).
    ("akimat", "akimat123", "Акимат г. Астаны", "akimat", None),
]


# Demo external owner (an ОСИ chairman). District is NULL — owners are scoped by
# owner_buildings, not by district. Linked below to the Хайвилл building.
OWNER = ("owner", "owner123", "Председатель ОСИ (демо)", "owner", None)


def _seed_owner_link(conn) -> None:
    """Link the demo owner to the Хайвилл operational card's building, if seeded.

    Uses the same building the ПТП seed attaches its card to (filename
    'hayvill_ptp.json'); if that card isn't present yet, skip the link with a
    warning instead of failing the whole seed."""
    owner_id = conn.execute(
        text("SELECT id FROM users WHERE username = :u"), {"u": OWNER[0]}
    ).scalar()
    building_id = conn.execute(
        text(
            "SELECT building_id FROM operational_cards "
            "WHERE filename = 'hayvill_ptp.json' AND building_id IS NOT NULL "
            "LIMIT 1"
        )
    ).scalar()
    if building_id is None:
        print("warning: Хайвилл card not found — skipped owner→building link "
              "(run scripts.seed_hayvill first)")
        return
    conn.execute(
        text(
            "INSERT INTO owner_buildings (user_id, building_id) "
            "VALUES (:uid, :bid) ON CONFLICT DO NOTHING"
        ),
        {"uid": owner_id, "bid": building_id},
    )
    print(f"linked owner → building #{building_id} (Хайвилл)")


def sync_demo_registry(conn) -> int:
    """Строка реестра демо-инспектора живёт в районе его учётной записи.

    Район демо-инспектора сменился (Сарыаркинский → Есильский) вместе с
    переходом на настоящие границы районов. Учётная запись обновляется upsert'ом
    в main(), а связанная с ней строка `inspectors` — нет, и без этого шага
    маршрут строился бы по одному району (route_today берёт район из реестра),
    а объекты проверялись бы по другому (скоупинг берёт район учётной записи).
    Трогает только строки, связанные FK с демо-учётками роли inspector.
    """
    usernames = [u for u, _p, _n, role, _d in USERS if role == "inspector"]
    return conn.execute(
        text(
            """
            UPDATE inspectors i
               SET district = u.district
              FROM users u
             WHERE i.user_id = u.id
               AND u.username = ANY(:names)
               AND i.district IS DISTINCT FROM u.district
            """
        ),
        {"names": usernames},
    ).rowcount


RESET_FLAG = "--reset-demo-passwords"
RESET_ENV = "FW_RESET_DEMO_PASSWORDS"


def main(reset_passwords: bool = False) -> None:
    """Завести недостающие демо-учётки; пароли существующих НЕ трогаются.

    Раньше upsert переписывал `password_hash` у всех демо-учёток, включая admin
    и minister: один прогон на базе, где пароли уже сменены, возвращал
    `admin123`/`minister123`, опубликованные в этом репозитории. Теперь пароль
    ставится только новой учётной записи, а сброс паролей существующих —
    явным флагом `--reset-demo-passwords` (или FW_RESET_DEMO_PASSWORDS=1), и
    никогда в production-контуре (FW_ENV=production).

    На проде этот скрипт не запускается вовсе — см. скилл deploy-railway.
    """
    if reset_passwords and settings.is_production:
        raise SystemExit(
            "Отказ: сброс демо-паролей в production-контуре (FW_ENV=production) запрещён"
        )
    created = kept = 0
    with engine.begin() as conn:
        for username, password, name, role, district in [*USERS, OWNER]:
            existed = conn.execute(
                text("SELECT 1 FROM users WHERE username = :u"), {"u": username}
            ).scalar()
            conn.execute(
                text(
                    """
                    INSERT INTO users (username, password_hash, name, role, district)
                    VALUES (:u, :p, :n, :r, :d)
                    ON CONFLICT (username) DO UPDATE
                    SET password_hash = CASE WHEN :reset THEN EXCLUDED.password_hash
                                             ELSE users.password_hash END,
                        name = EXCLUDED.name,
                        role = EXCLUDED.role,
                        district = EXCLUDED.district
                    -- is_active намеренно не трогаем: сброс признака вернул бы
                    -- доступ учётной записи, отключённой администратором.
                    """
                ),
                {"u": username, "p": hash_password(password), "n": name, "r": role,
                 "d": district, "reset": reset_passwords},
            )
            if existed and not reset_passwords:
                kept += 1
            elif not existed:
                created += 1
        moved = sync_demo_registry(conn)
        if moved:
            print(f"inspectors: район {moved} строк(и) реестра выровнен по учётной записи")
        _seed_owner_link(conn)
    print(
        f"seeded {len(USERS) + 1} users: создано {created}, "
        + (f"пароли существующих сохранены у {kept} (сброс — {RESET_FLAG})"
           if not reset_passwords else "пароли существующих СБРОШЕНЫ на демо")
    )


if __name__ == "__main__":
    main(reset_passwords=RESET_FLAG in sys.argv[1:] or os.getenv(RESET_ENV) == "1")
