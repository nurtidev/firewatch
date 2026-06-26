"""Apply the core schema. Run: docker compose exec api python -m scripts.init_db"""

from pathlib import Path

from sqlalchemy import text

from app.db import engine

SCHEMA = Path(__file__).resolve().parent.parent / "app" / "schema.sql"


def main() -> None:
    sql = SCHEMA.read_text(encoding="utf-8")
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        for statement in filter(str.strip, sql.split(";")):
            conn.execute(text(statement))
    print("schema applied")


if __name__ == "__main__":
    main()
