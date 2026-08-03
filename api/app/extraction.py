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

# Local part of an email address (kept masked, domain kept for triage).
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")

# Structured `contacts` entries ({role, name, phone}) whose `role` matches one of
# these substrings (case-insensitive) are a shared organisational/service line —
# dispatch desk, reception, a generic "phone(s) of the object" — not a specific
# person's own number. The fire crew needs these open on arrival, so they are the
# only lines left unmasked. Everything else is fail-closed: any role not matched
# here is treated as a named individual's contact (director, chief engineer,
# manager, medical staff, …) and gets masked, even if the pattern list is
# incomplete for a future object.
_ORG_CONTACT_ROLE_KEYWORDS = (
    "диспетчер",  # диспетчерская блока/объекта — dispatch desk
    "приемн",
    "приёмн",  # приёмная — front desk
    "ресепшн",  # ресепшн — hotel reception
    "телефон объект",
    "телефоны объект",  # «телефон(ы) объекта» — shared object line(s)
    "противопожарная служба",  # НГПС — departmental service line, not a person
)


# Anthropic caps a single request at 32 MB; base64 inflates raw bytes ~1.37x, so
# the PDF must stay under ~24 MB. Real ДЧС scans run 19–26 MB and would blow the
# limit, so oversized PDFs are re-rendered at progressively lower DPI before
# upload. Only scans (no text layer to lose) ever cross this threshold;
# born-digital PDFs are small and pass through untouched.
_MAX_PDF_BYTES = 20 * 1024 * 1024


def _shrink_pdf_if_needed(data: bytes) -> bytes:
    """Re-render an oversized scanned PDF at lower DPI until it fits Anthropic's
    request limit. Returns the smallest result achieved, or the original bytes if
    already small enough or if PyMuPDF is unavailable. Raises ValueError if the
    PDF is still too big for the API after the lowest-DPI pass."""
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
    if len(smallest) > _MAX_PDF_BYTES:
        raise ValueError(
            "PDF слишком большой даже после сжатия — уменьшите файл вручную "
            "или пересканируйте документ с более низким разрешением"
        )
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


def _mask_email(value: str) -> str:
    """Mask the local part of an email address, keeping the domain so a
    dispatcher can still tell who owns it («ivan.petrov@alanda-hotel.kz» →
    «***@alanda-hotel.kz»)."""

    def repl(m: re.Match) -> str:
        return "***@" + m.group().split("@", 1)[1]

    return _EMAIL_RE.sub(repl, value)


def is_personal_contact_role(role: str | None) -> bool:
    """True if a structured contact's `role` names an individual (their phone
    is ПДн and must be masked); False if it is a shared organisational/service
    line (dispatch desk, reception, object phone) that stays open for the
    crew. Fail-closed: unrecognised roles are treated as personal."""
    r = (role or "").lower()
    return not any(kw in r for kw in _ORG_CONTACT_ROLE_KEYWORDS)


def _mask_contact_entry(entry: dict) -> dict:
    """Mask ПДн in one structured contact ({role, name, phone}). Personal
    roles get their phone/email redacted and `name` cleared; organisational
    lines are returned unchanged. Never trusts that `name` already arrived
    empty — clears it defensively even if a future seed forgets to."""
    if not is_personal_contact_role(entry.get("role")):
        return entry
    masked = dict(entry)
    masked["name"] = None
    phone = masked.get("phone")
    if isinstance(phone, str) and phone:
        masked["phone"] = _mask_email(_mask_contacts(phone))
    return masked


def mask_contacts_field(value):
    """Mask ПДн in a card's `contacts` field, whichever of the two shapes it
    comes in: the plain-text field the live Claude extraction pipeline
    produces (`str`), or the structured `[{role, name, phone}, …]` list used
    by the digitised flagship cards (Хайвилл, Аланда, …). Anything else
    (missing/None/already-wrong-type) passes through untouched."""
    if isinstance(value, str):
        return _mask_contacts(value)
    if isinstance(value, list):
        return [_mask_contact_entry(c) if isinstance(c, dict) else c for c in value]
    return value


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
            # DB in clear if the model returns a full number anyway. Handles both
            # the plain-string shape this tool schema declares and the structured
            # list shape used elsewhere, in case that ever changes.
            if settings.mask_pii and "contacts" in result:
                result["contacts"] = mask_contacts_field(result["contacts"])
            return result
    raise RuntimeError("Claude не вернул структурированный результат")
