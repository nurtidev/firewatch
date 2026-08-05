"""ПДн masking in operational-card contacts (Module 03 + seed data).

Two independent things are covered here:

1. The classifier + masking functions in `app.extraction` behave correctly —
   a personal role (director, chief engineer, medical staff, …) gets its
   phone/email redacted and name cleared; a shared organisational/service
   line (dispatch desk, reception, "object phone") stays open because a crew
   needs it on arrival.
2. Regression guard: the hand-edited seed JSON that ships as demo/pilot data
   (real ДЧС documents — Хайвилл, Аланда, Евразия) must not contain an open
   phone for a contact classified as personal. `seed_hayvill.py` /
   `seed_extra_objects.py` also re-run the masking programmatically at import
   time (belt-and-suspenders — see those scripts), but the source JSON itself
   must not regress either, since `docs/docs_tg/hayvill.extracted.json` is
   read directly as project documentation, not just imported into the DB.
"""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.extraction import is_personal_contact_role, mask_contacts_field

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parent
SEED_DIR = API_DIR / "scripts" / "seed_data"
SEED_FILES = ["hayvill.json", "alanda.json", "evraziya.json"]


# --- classifier: role text -> personal vs organisational --------------------


@pytest.mark.parametrize(
    "role",
    [
        "Главный инженер (2020)",
        "Директор ТОО «High Vill Servis», тел (A,B,C,D) (2020)",
        "Генеральный директор ТОО «High Vill Kazakhstan» (2020)",
        "Управляющая — гостиница «Аланда»",
        "Директор медицинского центра",
        "Старшая медсестра",
        "Заместитель директора медцентра",
        "Email объекта",  # personal-shaped (имя@домен) unless proven organisational
        "",  # unknown/blank role — fail-closed
        None,
    ],
)
def test_personal_roles_are_masked(role):
    assert is_personal_contact_role(role) is True


@pytest.mark.parametrize(
    "role",
    [
        "Приемная (2020)",
        "Диспетчерская — блок A (2020)",
        "Диспетчерская — блок G (2020)",
        "Телефоны объекта (ред. 2007)",
        "Ресепшн гостиницы",
        "Негосударственная противопожарная служба",
    ],
)
def test_organisational_roles_stay_unmasked(role):
    assert is_personal_contact_role(role) is False


# --- entry-level masking -----------------------------------------------------


def test_mask_contacts_field_masks_personal_phone_and_clears_name():
    contacts = [
        {"role": "Директор ТОО «High Vill Servis»", "name": "Иванов И.И.", "phone": "68-07-35"},
    ]
    out = mask_contacts_field(contacts)
    assert out[0]["name"] is None
    assert out[0]["phone"] == "***-**-35"
    # original must not be mutated in place
    assert contacts[0]["phone"] == "68-07-35"


def test_mask_contacts_field_leaves_dispatch_and_reception_open():
    contacts = [
        {"role": "Диспетчерская — блок A", "name": None, "phone": "51-32-67"},
        {"role": "Ресепшн гостиницы", "name": None, "phone": "+7 (7172) 72-93-28"},
        {"role": "Телефоны объекта", "name": None, "phone": "74-13-43, 51-31-33"},
    ]
    out = mask_contacts_field(contacts)
    assert out == contacts  # untouched


def test_mask_contacts_field_masks_personal_email_local_part():
    contacts = [{"role": "Email управляющей", "name": None, "phone": "ivan.petrov@alanda-hotel.kz"}]
    out = mask_contacts_field(contacts)
    assert out[0]["phone"] == "***@alanda-hotel.kz"


def test_mask_contacts_field_handles_plain_string_shape():
    # The live Claude extraction pipeline's `contacts` field is a free-text
    # string, not a structured list — mask_contacts_field must still redact it.
    masked = mask_contacts_field("Начальник охраны +7 701 234-56-78")
    assert "234-56-78" not in masked
    assert masked.endswith("78")


def test_mask_contacts_field_passthrough_for_unknown_shapes():
    assert mask_contacts_field(None) is None
    assert mask_contacts_field(42) == 42


# --- regression guard: seed JSON must ship pre-masked -----------------------


@pytest.mark.parametrize("filename", SEED_FILES)
def test_seed_json_has_no_open_personal_phone(filename):
    """Masking the seed file's `contacts` list must be a no-op: if it isn't,
    some entry classified as personal still carries a raw phone/email in the
    committed JSON — the exact regression that shipped an open director phone
    in the Хайвилл card (one bug for the mobile, none for the landline)."""
    card = json.loads((SEED_DIR / filename).read_text(encoding="utf-8"))
    contacts = card.get("contacts", [])
    assert mask_contacts_field(deepcopy(contacts)) == contacts, (
        f"{filename}: found an unmasked phone/name on a contact classified as "
        "personal — mask it in the seed JSON (see api/app/extraction.py "
        "is_personal_contact_role for the org/personal boundary)"
    )


_DOCS_TG_HAYVILL = REPO_ROOT / "docs" / "docs_tg" / "hayvill.extracted.json"


@pytest.mark.skipif(
    not _DOCS_TG_HAYVILL.exists(),
    reason=(
        "docs/ isn't inside this container's build context (docker-compose.yml "
        "only bind-mounts ./api:/app) — runs on a full checkout, e.g. in CI"
    ),
)
def test_docs_tg_hayvill_extract_matches_seed():
    """docs/docs_tg/hayvill.extracted.json is read as project documentation,
    not just imported into the DB — it must carry the same masking as the
    seed it mirrors, not just rely on the seed script's import-time pass."""
    seed = json.loads((SEED_DIR / "hayvill.json").read_text(encoding="utf-8"))
    doc = json.loads(_DOCS_TG_HAYVILL.read_text(encoding="utf-8"))
    assert doc.get("contacts") == seed.get("contacts")
