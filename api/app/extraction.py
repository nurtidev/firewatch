"""Module 03 · AI extraction of МЧС operational cards via Claude.

Takes a PDF or image of an operational card (форма ОК-1) and returns structured
fields plus auto-generated prescriptions for detected vulnerabilities. Claude is
instructed to use ONLY what is in the document — no invented data.
"""

import base64

import anthropic

from app.config import settings

EXTRACT_TOOL = {
    "name": "extract_card",
    "description": "Извлечь поля оперативной карточки объекта по форме МЧС РК (ОК-1).",
    "input_schema": {
        "type": "object",
        "properties": {
            "address": {"type": "string", "description": "Адрес объекта"},
            "object_type": {"type": "string", "description": "Тип объекта"},
            "year_built": {"type": ["integer", "null"], "description": "Год постройки"},
            "floors": {"type": ["integer", "null"], "description": "Этажность"},
            "construction": {"type": "string", "description": "Конструкция / материалы"},
            "floors_material": {"type": "string", "description": "Перекрытия"},
            "fire_systems": {"type": "string", "description": "АПС/АУПТ, системы пожаротушения"},
            "water_source": {"type": "string", "description": "Источники водоснабжения"},
            "hydrant": {"type": "string", "description": "Гидрант: расстояние, состояние"},
            "responsible_person": {"type": "string", "description": "Ответственное лицо"},
            "phone": {"type": "string", "description": "Телефон"},
            "evacuation": {"type": "string", "description": "Эвакуационные выходы и их состояние"},
            "notes": {"type": "string", "description": "Примечания"},
            "prescriptions": {
                "type": "array",
                "description": "Предписания по выявленным уязвимостям",
                "items": {
                    "type": "object",
                    "properties": {
                        "issue": {"type": "string", "description": "Выявленная уязвимость"},
                        "recommendation": {"type": "string", "description": "Что сделать"},
                        "deadline_days": {"type": "integer", "description": "Срок в днях"},
                        "severity": {
                            "type": "string",
                            "enum": ["low", "medium", "high"],
                        },
                    },
                    "required": ["recommendation", "severity"],
                },
            },
        },
        "required": ["address", "object_type", "prescriptions"],
    },
}

PROMPT = (
    "Это скан оперативной карточки объекта по форме МЧС РК (ОК-1). "
    "Извлеки все поля строго из документа — ничего не выдумывай. "
    "Если поле отсутствует, оставь пустую строку или null. "
    "Затем на основе содержимого сформируй предписания по выявленным уязвимостям "
    "(заблокированные эвакуационные выходы, отсутствие АПС/АУПТ, деревянные "
    "перекрытия, складирование в подвалах, неисправный гидрант и т.п.) — "
    "с конкретной мерой, сроком устранения в днях и уровнем критичности. "
    "Верни результат через инструмент extract_card."
)


def extract_card(data: bytes, media_type: str) -> dict:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY не задан — извлечение недоступно")

    b64 = base64.standard_b64encode(data).decode()
    if media_type == "application/pdf":
        source_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    else:
        source_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        }

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=2048,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_card"},
        messages=[{"role": "user", "content": [source_block, {"type": "text", "text": PROMPT}]}],
    )

    for block in msg.content:
        if block.type == "tool_use":
            return block.input
    raise RuntimeError("Claude не вернул структурированный результат")
