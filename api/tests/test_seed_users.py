"""seed_users не возвращает демо-пароли учёткам, у которых их сменили.

Демо-пароли (`admin123`, `minister123`, …) опубликованы в репозитории. Прогон
сида на базе со сменёнными паролями раньше молча откатывал их обратно.

Отказ сброса в production-контуре проверяется без базы; сохранение/сброс
пароля — на выделенной тестовой базе (FW_RUN_DB_TESTS=1 и «test» в имени).
"""

import os
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from scripts import seed_users


def _is_dedicated_test_db() -> bool:
    url = os.getenv("DATABASE_URL", "")
    return "test" in url.rsplit("/", 1)[-1].split("?", 1)[0].lower()


db_only = pytest.mark.skipif(
    not (os.getenv("FW_RUN_DB_TESTS") and _is_dedicated_test_db()),
    reason="нужна выделенная тестовая база (FW_RUN_DB_TESTS=1, «test» в имени)",
)


def test_reset_is_refused_in_production(monkeypatch):
    monkeypatch.setattr(seed_users, "settings", SimpleNamespace(is_production=True))
    with pytest.raises(SystemExit):
        seed_users.main(reset_passwords=True)


def _hash(username: str) -> str:
    from app.db import engine

    with engine.connect() as conn:
        return conn.execute(
            text("SELECT password_hash FROM users WHERE username = :u"), {"u": username}
        ).scalar()


@db_only
def test_existing_password_survives_reseed_and_resets_only_on_flag():
    from app.auth import hash_password, verify_password
    from app.db import engine
    from scripts import init_db

    init_db.main()
    seed_users.main()
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET password_hash = :p WHERE username = 'minister'"),
            {"p": hash_password("сменённый-пароль-1")},
        )
    try:
        seed_users.main()
        assert verify_password("сменённый-пароль-1", _hash("minister"))
        assert not verify_password("minister123", _hash("minister"))

        seed_users.main(reset_passwords=True)
        assert verify_password("minister123", _hash("minister"))
    finally:
        seed_users.main(reset_passwords=True)  # демо-пароль для следующих модулей


@db_only
def test_new_demo_account_gets_its_password():
    from app.auth import verify_password
    from app.db import engine
    from scripts import init_db

    init_db.main()
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM users WHERE username = 'akimat'"))
    seed_users.main()
    assert verify_password("akimat123", _hash("akimat"))
