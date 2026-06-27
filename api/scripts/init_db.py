"""Bring the database schema to head via Alembic migrations.

Run:  docker compose exec api python -m scripts.init_db
Equivalent to `alembic upgrade head`, but keeps a stable module entrypoint.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import settings

API_ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")
    print("migrations applied (head)")


if __name__ == "__main__":
    main()
