"""Module 06 · AI analyst — natural language → grounded answer over ДЧС data.

Claude generates a single read-only PostgreSQL SELECT against a whitelisted
schema; we validate and execute it inside a READ ONLY transaction with a
timeout and row cap, then Claude summarizes the rows. Answers are bound to the
data — the SQL is returned as the source.
"""

import datetime
import decimal
import re

import anthropic
from sqlalchemy import text

from app.config import settings
from app.db import engine

SCHEMA_DOC = """
Таблицы (PostgreSQL + PostGIS). Не выбирай столбцы geom.

buildings(id, address, building_type ['residential','public','industrial','other'],
          year_built int, floors int, district text ['Сарыаркинский','Алматинский',
          'Есильский','Байконырский','Нуринский'], last_inspected date)
risk_scores(building_id -> buildings.id, score int 0..100, model_version, computed_at)
incidents(building_id -> buildings.id, occurred_at date, severity smallint)
fire_stations(id, name, vehicles int)
hydrants(id, status ['ok','broken'], last_check date)
inspectors(id, name, district)
operational_cards(id, extracted jsonb, created_at)
prescriptions(id, card_id, issue, recommendation, deadline_days, severity)

Подсказки:
- Риск здания: buildings b JOIN risk_scores r ON r.building_id = b.id, поле r.score.
- «Критический/высокий риск» = r.score > 70; «средний» = 36..70; «низкий» = 0..35.
- Текст ищи через ILIKE с '%...%'. Район хранится без слова «район» (напр. 'Сарыаркинский').
- «построенные до 1990» = b.year_built < 1990.
"""

SQL_TOOL = {
    "name": "run_sql",
    "description": "Выполнить один read-only SELECT-запрос к базе ДЧС.",
    "input_schema": {
        "type": "object",
        "properties": {
            "sql": {
                "type": "string",
                "description": "Один SELECT-запрос PostgreSQL, без точки с запятой, "
                "с LIMIT не более 50. Не выбирай столбцы geom.",
            },
            "intent": {
                "type": "string",
                "description": "Кратко на русском, что именно ищет запрос.",
            },
        },
        "required": ["sql", "intent"],
    },
}

BANNED = re.compile(
    r"\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|merge)\b"
    r"|;|--|/\*|\binto\b",
    re.IGNORECASE,
)


class ChatError(Exception):
    pass


def _client() -> anthropic.Anthropic:
    if not settings.anthropic_api_key:
        raise ChatError("ANTHROPIC_API_KEY не задан")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def generate_sql(client: anthropic.Anthropic, question: str) -> dict:
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1024,
        tools=[SQL_TOOL],
        tool_choice={"type": "tool", "name": "run_sql"},
        system=(
            "Ты — аналитик данных ДЧС. По вопросу руководителя построй ОДИН "
            "read-only SELECT строго по схеме ниже. Только данные из базы, "
            "никаких выдумок. Всегда добавляй LIMIT (<=50).\n" + SCHEMA_DOC
        ),
        messages=[{"role": "user", "content": question}],
    )
    for block in msg.content:
        if block.type == "tool_use":
            return block.input
    raise ChatError("Не удалось построить запрос")


def validate_sql(sql: str) -> str:
    s = sql.strip().rstrip(";").strip()
    low = s.lower()
    if not (low.startswith("select") or low.startswith("with")):
        raise ChatError("Разрешены только SELECT-запросы")
    if BANNED.search(s):
        raise ChatError("Запрос содержит недопустимые конструкции")
    if not re.search(r"\blimit\b", low):
        s += " LIMIT 50"
    return s


def _cell(v):
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (dict, list, str, int, float, bool)) or v is None:
        return v
    return str(v)


def run_sql(sql: str) -> tuple[list[str], list[list]]:
    with engine.connect() as conn:
        with conn.begin():
            conn.execute(text("SET TRANSACTION READ ONLY"))
            conn.execute(text("SET LOCAL statement_timeout = '5000'"))
            res = conn.execute(text(sql))
            cols = list(res.keys())
            rows = [[_cell(c) for c in row] for row in res.fetchall()]
    return cols, rows


def summarize(
    client: anthropic.Anthropic, question: str, cols: list[str], rows: list[list]
) -> str:
    preview = [dict(zip(cols, r)) for r in rows[:20]]
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=512,
        system=(
            "Ответь на вопрос руководителя ДЧС по результатам запроса к базе. "
            "Коротко, по-деловому, на русском. Опирайся ТОЛЬКО на данные. "
            "Укажи количество найденных объектов. Не выдумывай."
        ),
        messages=[
            {
                "role": "user",
                "content": f"Вопрос: {question}\n"
                f"Найдено строк: {len(rows)}\nДанные (до 20): {preview}",
            }
        ],
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip()


def ask(question: str) -> dict:
    client = _client()
    gen = generate_sql(client, question)
    sql = validate_sql(gen["sql"])
    try:
        cols, rows = run_sql(sql)
    except ChatError:
        raise
    except Exception as err:  # noqa: BLE001 - surface SQL/exec errors cleanly
        raise ChatError(f"Ошибка выполнения запроса: {err}") from err
    answer = summarize(client, question, cols, rows)
    return {
        "answer": answer,
        "intent": gen.get("intent"),
        "sql": sql,
        "columns": cols,
        "rows": rows,
        "row_count": len(rows),
    }
