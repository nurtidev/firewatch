"""Seed demo users with roles.

Run:  docker compose exec api python -m scripts.seed_users

Demo credentials (pilot only — change before any real deployment):
  inspector  / inspector123   — надзорный инспектор (Сарыаркинский р-н)
  supervisor / supervisor123  — руководитель управления (Есильский р-н)
  minister   / minister123    — замминистра (руководство, весь город)
  admin      / admin123       — администратор (все модули, весь город)
  dispatcher / dispatcher123  — диспетчер ЦОУ/112 (боевой модуль, весь город)
  responder  / responder123   — начальник караула ПЧ-1 (боевой модуль, весь город)
  owner      / owner123       — председатель ОСИ (внешний владелец, портал)

District scoping: inspector/supervisor see only their district; leadership/admin
see the whole city (district = NULL).

Этот скрипт — только начальный набор для пилота/демо. Приём и отключение
сотрудников делаются администратором через продукт (экран «Пользователи»,
POST /auth/users, /auth/users/{username}/disable|enable) — правка списка ниже
для этого больше не нужна и оставляет действие вне журнала аудита.
"""

from sqlalchemy import text

from app.auth import hash_password
from app.db import engine

# (username, password, name, role, district)
USERS = [
    ("inspector", "inspector123", "Ахметов Д.К.", "inspector", "Сарыаркинский"),
    ("supervisor", "supervisor123", "Сулейменова А.Б.", "supervisor", "Есильский"),
    ("minister", "minister123", "Замминистра", "leadership", None),
    ("admin", "admin123", "Администратор", "admin", None),
    # Боевой модуль: citywide by role (district = NULL), not district-scoped.
    ("dispatcher", "dispatcher123", "Диспетчер ЦОУ", "dispatcher", None),
    ("responder", "responder123", "Начальник караула ПЧ-1", "responder", None),
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


def main() -> None:
    with engine.begin() as conn:
        for username, password, name, role, district in [*USERS, OWNER]:
            conn.execute(
                text(
                    """
                    INSERT INTO users (username, password_hash, name, role, district)
                    VALUES (:u, :p, :n, :r, :d)
                    ON CONFLICT (username) DO UPDATE
                    SET password_hash = EXCLUDED.password_hash,
                        name = EXCLUDED.name,
                        role = EXCLUDED.role,
                        district = EXCLUDED.district
                    -- is_active намеренно не трогаем: сиды идемпотентно
                    -- прогоняются при каждом деплое, и сброс признака вернул бы
                    -- доступ учётной записи, отключённой администратором.
                    """
                ),
                {"u": username, "p": hash_password(password), "n": name, "r": role,
                 "d": district},
            )
        _seed_owner_link(conn)
    print(f"seeded {len(USERS) + 1} users")


if __name__ == "__main__":
    main()
