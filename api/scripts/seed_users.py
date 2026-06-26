"""Seed demo users with roles.

Run:  docker compose exec api python -m scripts.seed_users

Demo credentials (pilot only — change before any real deployment):
  inspector  / inspector123   — надзорный инспектор
  supervisor / supervisor123  — руководитель управления
  minister   / minister123    — замминистра (руководство)
  admin      / admin123       — администратор (все модули)
"""

from sqlalchemy import text

from app.auth import hash_password
from app.db import engine

USERS = [
    ("inspector", "inspector123", "Ахметов Д.К.", "inspector"),
    ("supervisor", "supervisor123", "Сулейменова А.Б.", "supervisor"),
    ("minister", "minister123", "Замминистра", "leadership"),
    ("admin", "admin123", "Администратор", "admin"),
]


def main() -> None:
    with engine.begin() as conn:
        for username, password, name, role in USERS:
            conn.execute(
                text(
                    """
                    INSERT INTO users (username, password_hash, name, role)
                    VALUES (:u, :p, :n, :r)
                    ON CONFLICT (username) DO UPDATE
                    SET password_hash = EXCLUDED.password_hash,
                        name = EXCLUDED.name,
                        role = EXCLUDED.role
                    """
                ),
                {"u": username, "p": hash_password(password), "n": name, "r": role},
            )
    print(f"seeded {len(USERS)} users")


if __name__ == "__main__":
    main()
