"""Seed demo users with roles.

Run:  docker compose exec api python -m scripts.seed_users

Demo credentials (pilot only — change before any real deployment):
  inspector  / inspector123   — надзорный инспектор (Сарыаркинский р-н)
  supervisor / supervisor123  — руководитель управления (Есильский р-н)
  minister   / minister123    — замминистра (руководство, весь город)
  admin      / admin123       — администратор (все модули, весь город)

District scoping: inspector/supervisor see only their district; leadership/admin
see the whole city (district = NULL).
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
]


def main() -> None:
    with engine.begin() as conn:
        for username, password, name, role, district in USERS:
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
                    """
                ),
                {"u": username, "p": hash_password(password), "n": name, "r": role,
                 "d": district},
            )
    print(f"seeded {len(USERS)} users")


if __name__ == "__main__":
    main()
