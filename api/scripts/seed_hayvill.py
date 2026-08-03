"""Seed the ЖК «Хайвилл-Астана» operational plan (ПТП) as the first real object.

Run:  docker compose exec api python -m scripts.seed_hayvill

Takes the structured card extracted from the real ДЧС ПТП
(scripts/seed_data/hayvill.json) and:
  * attaches it to a representative building on ул. Сарайшык (the complex's area),
  * sets that building's domain fire-hazard features from the plan (детсад →
    vulnerable_occupancy, торговые помещения → mass_occupancy, gas, occupancy),
  * inserts the ring-main hydrants (Ø150, those with a known distance in the
    plan) around it with specs,
  * inserts the operational_card with the extracted JSON,
  * seeds demo prescriptions for the owner portal, one with a submitted
    remediation claim + photo (see PRESCRIPTIONS below).

Idempotent. Re-run after `import_osm`/`seed_ops`; run `compute_risk` afterwards to
rescore the building with its real features. Demo data — replace at pilot.
"""

import base64
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.extraction import mask_contacts_field

DATA = Path(__file__).resolve().parent / "seed_data" / "hayvill.json"
# Preferred building to represent the complex (high-rise on Сарайшык, Сарыаркинский
# district — same scope as the demo inspector). Falls back to the tallest
# residential building in that district if the exact address isn't present.
PREFERRED_ADDRESS = "%Сарайшық%7/1%"
HYDRANT_OSM_BASE = -9000  # sentinel ids so re-runs upsert instead of duplicating

# Demo prescriptions for the owner portal (docs/ux_audit_2026-08-03.md #18):
# owner/owner123 had zero prescriptions on either building, so the "review an
# ОСИ remediation claim with a photo" scenario had nothing to review. Issues
# are grounded in real hazards named in the extracted ПТП itself (Н-1
# stairwells, ДИП/С2000 automatics, parking egress, hydrant signage), not
# placeholder text. The last one gets a submitted (pending) remediation claim
# with a photo, so both the owner-submits and inspector-reviews sides of the
# flow have something real to work with.
PRESCRIPTIONS = [
    {
        "issue": "Доводчики дверей лестничных клеток типа Н-1 блока A демонтированы, "
        "двери фиксируются в открытом положении",
        "recommendation": "Восстановить самозакрывание и уплотнение притворов дверей "
        "лестничных клеток Н-1, убрать фиксирующие клинья",
        "deadline_days": 15,
        "severity": "high",
        "age_days": 6,
    },
    {
        "issue": "В подземном паркинге блока A эвакуационные проезды для пожарной "
        "техники заставлены личным транспортом жильцов",
        "recommendation": "Обеспечить нормативную ширину проезда пожарных автомобилей "
        "в паркинге, организовать контроль стоянки вдоль путей эвакуации",
        "deadline_days": 20,
        "severity": "medium",
        "age_days": 10,
    },
    {
        "issue": "Часть дымовых извещателей автоматической пожарной сигнализации в "
        "местах общего пользования блока B закрашена либо демонтирована при отделке",
        "recommendation": "Восстановить дымовые извещатели ДИП, проверить шлейфы "
        "С2000 на работоспособность, составить акт проверки",
        "deadline_days": 10,
        "severity": "high",
        "age_days": 4,
    },
    {
        "issue": "Информационные указатели пожарных гидрантов ПГ-3 – ПГ-5 на "
        "территории комплекса утрачены",
        "recommendation": "Восстановить информационные указатели наружных пожарных "
        "гидрантов на территории комплекса",
        "deadline_days": 30,
        "severity": "low",
        "age_days": 20,
        "remediation": {
            "note": "Установили новые таблички-указатели на гидрантах ПГ-3, ПГ-4 и "
            "ПГ-5, фото прилагаем.",
            "age_days": 2,
        },
    },
]

# 1x1 PNG placeholder for the remediation evidence photo (no real photo in the
# demo dataset) — a valid image so the owner/inspector photo viewer renders
# something, not a 0-byte stub. Deterministic filename (fixed hex, not
# uuid4()) so reruns don't pile up orphan files in uploads_dir.
_REMEDIATION_PHOTO_HEX = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
REMEDIATION_PHOTO_NAME = f"owner_{_REMEDIATION_PHOTO_HEX}.png"
_REMEDIATION_PHOTO_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _target_building(conn) -> dict:
    row = conn.execute(
        text("SELECT id, address, district FROM buildings WHERE address ILIKE :a LIMIT 1"),
        {"a": PREFERRED_ADDRESS},
    ).mappings().first()
    if row:
        return dict(row)
    row = conn.execute(
        text(
            "SELECT id, address, district FROM buildings "
            "WHERE building_type = 'residential' AND district = 'Сарыаркинский' "
            "ORDER BY floors DESC NULLS LAST LIMIT 1"
        )
    ).mappings().first()
    if not row:
        raise RuntimeError("No buildings — run import_osm/seed_ops first")
    return dict(row)


def main() -> None:
    card = json.loads(DATA.read_text(encoding="utf-8"))
    # Belt-and-suspenders (see api/app/extraction.py): the seed JSON is hand-edited,
    # so re-mask ПДн in structured contacts here rather than trust the file — a
    # future edit that reopens a personal phone still gets caught on import.
    if settings.mask_pii and "contacts" in card:
        card["contacts"] = mask_contacts_field(card["contacts"])
    water = [w for w in card.get("water_sources", []) if w.get("distance_m")]

    with engine.begin() as conn:
        b = _target_building(conn)
        bid = b["id"]
        print(f"target building: #{bid} {b['address']} ({b['district']})")

        # 1) Domain fire-hazard features from the real plan.
        conn.execute(
            text(
                """
                UPDATE buildings SET
                    mass_occupancy = TRUE,         -- торговые помещения / массовое пребывание
                    vulnerable_occupancy = TRUE,   -- детский сад в составе комплекса
                    has_gas = TRUE,
                    hazard_category = 0,           -- не производственный объект
                    occupancy_capacity = 3000
                WHERE id = :id
                """
            ),
            {"id": bid},
        )

        # 2) Operational card with the extracted ПТП JSON (idempotent by filename).
        conn.execute(
            text("DELETE FROM operational_cards WHERE filename = 'hayvill_ptp.json'")
        )
        card_id = conn.execute(
            text(
                """
                INSERT INTO operational_cards
                    (building_id, filename, media_type, file_path, status, extracted)
                VALUES (:bid, 'hayvill_ptp.json', 'application/json', NULL,
                        'extracted', CAST(:ex AS JSONB))
                RETURNING id
                """
            ),
            {"bid": bid, "ex": json.dumps(card, ensure_ascii=False)},
        ).scalar()

        # 3) Ring-main hydrants (Ø150) placed around the building by their plan
        #    distances, spread evenly by azimuth. Upsert on sentinel osm_id.
        n = max(len(water), 1)
        for i, w in enumerate(water):
            osm_id = HYDRANT_OSM_BASE - i
            azimuth = (360.0 / n) * i  # degrees, spread around the object
            conn.execute(
                text(
                    """
                    INSERT INTO hydrants
                        (osm_id, status, last_check, pressure_bar, diameter_mm,
                         hydrant_type, geom)
                    VALUES (
                        :osm_id, 'ok', CURRENT_DATE, 4.0, 150, 'подземный',
                        ST_Project(
                            ST_Centroid((SELECT geom FROM buildings WHERE id = :bid))::geography,
                            :dist, radians(:az)
                        )::geometry
                    )
                    ON CONFLICT (osm_id) DO UPDATE SET
                        status = EXCLUDED.status,
                        last_check = EXCLUDED.last_check,
                        pressure_bar = EXCLUDED.pressure_bar,
                        diameter_mm = EXCLUDED.diameter_mm,
                        hydrant_type = EXCLUDED.hydrant_type,
                        geom = EXCLUDED.geom
                    """
                ),
                {"osm_id": osm_id, "bid": bid, "dist": float(w["distance_m"]), "az": azimuth},
            )

        # 4) Demo prescriptions for the owner portal (see PRESCRIPTIONS above).
        #    Idempotent via the card recreation above: the old card's
        #    prescriptions/remediations cascade-delete with it (schema.sql:
        #    prescriptions.card_id / remediations.prescription_id are both
        #    ON DELETE CASCADE), so this always leaves exactly the set below.
        Path(settings.uploads_dir).mkdir(parents=True, exist_ok=True)
        (Path(settings.uploads_dir) / REMEDIATION_PHOTO_NAME).write_bytes(
            _REMEDIATION_PHOTO_PNG
        )
        now = datetime.now(timezone.utc)
        for p in PRESCRIPTIONS:
            created_at = now - timedelta(days=p["age_days"])
            reviewed_at = created_at + timedelta(days=1)
            presc_id = conn.execute(
                text(
                    """
                    INSERT INTO prescriptions
                        (card_id, issue, recommendation, deadline_days, severity,
                         created_at, status, reviewed_by, reviewed_at)
                    VALUES (:cid, :issue, :rec, :dd, :sev,
                            :created_at, 'approved', 'inspector', :reviewed_at)
                    RETURNING id
                    """
                ),
                {
                    "cid": card_id,
                    "issue": p["issue"],
                    "rec": p["recommendation"],
                    "dd": p["deadline_days"],
                    "sev": p["severity"],
                    "created_at": created_at,
                    "reviewed_at": reviewed_at,
                },
            ).scalar()

            rem = p.get("remediation")
            if rem:
                conn.execute(
                    text(
                        """
                        INSERT INTO remediations
                            (prescription_id, submitted_by, note, photos,
                             status, created_at)
                        VALUES (:pid, 'owner', :note, CAST(:photos AS JSONB),
                                'pending', :created_at)
                        """
                    ),
                    {
                        "pid": presc_id,
                        "note": rem["note"],
                        "photos": json.dumps([REMEDIATION_PHOTO_NAME]),
                        "created_at": now - timedelta(days=rem["age_days"]),
                    },
                )

    print(
        f"seeded: card '{card['object']['name']}' -> building #{bid}, "
        f"{len(water)} hydrants (Ø150), {len(PRESCRIPTIONS)} prescriptions "
        f"(1 with a pending remediation claim). Run compute_risk to rescore."
    )


if __name__ == "__main__":
    main()
