"""Module 03 · AI extraction of МЧС operational cards via Claude.

Takes a PDF or image of an operational card (форма ОК-1) and returns structured
fields plus auto-generated prescriptions for detected vulnerabilities. Claude is
instructed to use ONLY what is in the document — no invented data.
"""

import base64
import re

import anthropic

from app.config import settings

# Phone-like runs: an optional leading + and 6+ digits with spaces/dashes/parens.
# Used to strip responsible-person phone numbers out of the extracted `contacts`
# field so they are never stored in clear (ПДн minimisation).
_PHONE_RE = re.compile(r"\+?\d[\d\s\-()]{5,}\d")


# Anthropic caps a single request at 32 MB; base64 inflates raw bytes ~1.37x, so
# the PDF must stay under ~24 MB. Real ДЧС scans run 19–26 MB and would blow the
# limit, so oversized PDFs are re-rendered at progressively lower DPI before
# upload. Only scans (no text layer to lose) ever cross this threshold;
# born-digital PDFs are small and pass through untouched.
_MAX_PDF_BYTES = 20 * 1024 * 1024


def _shrink_pdf_if_needed(data: bytes) -> bytes:
    """Re-render an oversized scanned PDF at lower DPI until it fits Anthropic's
    request limit. Returns the smallest result achieved, or the original bytes if
    already small enough or if PyMuPDF is unavailable."""
    if len(data) <= _MAX_PDF_BYTES:
        return data
    try:
        import fitz  # PyMuPDF — heavy, imported lazily and only for large scans
    except ImportError:
        return data  # best effort: let the API reject it rather than crash import

    src = fitz.open(stream=data, filetype="pdf")
    smallest = data
    try:
        for dpi in (150, 120, 100, 72):
            out = fitz.open()
            try:
                for page in src:
                    pix = page.get_pixmap(dpi=dpi)
                    jpeg = pix.tobytes(output="jpeg", jpg_quality=70)
                    new_page = out.new_page(width=page.rect.width, height=page.rect.height)
                    new_page.insert_image(page.rect, stream=jpeg)
                buf = out.tobytes(deflate=True, garbage=4)
            finally:
                out.close()
            if len(buf) < len(smallest):
                smallest = buf
            if len(buf) <= _MAX_PDF_BYTES:
                break
    finally:
        src.close()
    return smallest


def _mask_contacts(value: str) -> str:
    """Mask phone numbers in a contacts string, keeping the last 2 digits for
    reference (e.g. «Начальник охраны +7 701 234-56-78» → «… +7 ***-**-78»)."""

    def repl(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group())
        if len(digits) < 6:  # too short to be a phone — leave as-is
            return m.group()
        return f"***-**-{digits[-2:]}"

    return _PHONE_RE.sub(repl, value)

EXTRACT_TOOL = {
    "name": "extract_card",
    "description": "Извлечь поля оперативного плана / карточки объекта (форма ДЧС РК).",
    "input_schema": {
        "type": "object",
        "properties": {
            "object_name": {"type": "string", "description": "Наименование объекта (ЖК, здание)"},
            "address": {"type": "string", "description": "Адрес объекта"},
            "object_type": {"type": "string", "description": "Тип объекта"},
            "category": {"type": "string", "description": "Категория здания"},
            "fire_resistance": {"type": "string", "description": "Степень огнестойкости"},
            "floors": {"type": "string", "description": "Этажность / блоки"},
            "year_built": {"type": ["integer", "null"], "description": "Год постройки"},
            "construction": {"type": "string", "description": "Конструктив: фундамент, стены, перекрытия, лестницы"},
            "fire_systems": {"type": "string", "description": "АПС/АУПТ, дымоудаление, системы пожаротушения"},
            "water_source": {"type": "string", "description": "Водоснабжение, гидранты, насосы"},
            "nearest_station": {"type": "string", "description": "Ближайшая пожарная часть"},
            "distance_to_station": {"type": "string", "description": "Расстояние до ближайшей ПЧ"},
            "arrival_time": {"type": "string", "description": "Время прибытия первого подразделения"},
            "fire_rank": {"type": "string", "description": "Ранг (номер) пожара по высылке сил"},
            "contacts": {"type": "string", "description": "Ответственные лица и телефоны"},
            "staff_day": {"type": "string", "description": "Численность персонала днём"},
            "staff_night": {"type": "string", "description": "Численность персонала ночью"},
            "evacuation": {"type": "string", "description": "Эвакуационные пути и выходы, их состояние"},
            "notes": {"type": "string", "description": "Примечания, особенности"},
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
    "Это оперативный план или оперативная карточка объекта (форма ДЧС/МЧС РК; "
    "документ может быть на русском или казахском языке). "
    "Извлеки все поля строго из документа — ничего не выдумывай. "
    "Если поле отсутствует, оставь пустую строку или null. "
    "Затем на основе содержимого сформируй предписания по выявленным уязвимостям "
    "(заблокированные эвакуационные выходы, отсутствие/неисправность АПС/АУПТ, "
    "деревянные перекрытия, складирование в подвалах, неисправный гидрант, "
    "превышение норматива прибытия и т.п.) — с конкретной мерой, сроком "
    "устранения в днях и уровнем критичности. "
    "В поле contacts НЕ приводи телефонные номера полностью — замаскируй их "
    "(оставь только последние 2 цифры, например «+7 ***-**-78»); должность/роль "
    "можно оставить. "
    "Верни результат через инструмент extract_card."
)


def extract_card(data: bytes, media_type: str) -> dict:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY не задан — извлечение недоступно")

    if media_type == "application/pdf":
        data = _shrink_pdf_if_needed(data)
        b64 = base64.standard_b64encode(data).decode()
        source_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    else:
        b64 = base64.standard_b64encode(data).decode()
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
            result = block.input
            # Belt-and-suspenders: even though the prompt asks Claude to mask
            # phones, redact the stored value ourselves so ПДн never lands in the
            # DB in clear if the model returns a full number anyway.
            if settings.mask_pii and isinstance(result.get("contacts"), str):
                result["contacts"] = _mask_contacts(result["contacts"])
            return result
    raise RuntimeError("Claude не вернул структурированный результат")
