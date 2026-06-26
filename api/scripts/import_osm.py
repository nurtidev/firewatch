"""Import OSM building footprints for Astana into PostGIS.

Run:  docker compose exec api python -m scripts.import_osm
Env:  FW_BBOX="west,south,east,north"  (default: central Astana)
      FW_MAX_BUILDINGS=6000            (dev cap; raise for full coverage)

Phase 1 uses a bounded central area so the pipeline stays fast to iterate.
Widen FW_BBOX / FW_MAX_BUILDINGS toward the full ~250K city later.
"""

import os

import httpx
from sqlalchemy import text

from app.config import settings
from app.db import engine

# west, south, east, north  (central Astana by default)
DEFAULT_BBOX = "71.40,51.11,71.47,51.16"
BBOX = os.getenv("FW_BBOX", DEFAULT_BBOX)
MAX_BUILDINGS = int(os.getenv("FW_MAX_BUILDINGS", "6000"))

RESIDENTIAL = {"apartments", "house", "residential", "dormitory", "detached", "terrace"}
PUBLIC = {
    "school", "hospital", "public", "civic", "commercial", "retail", "office",
    "university", "government", "kindergarten", "college", "clinic", "mall",
}
INDUSTRIAL = {"industrial", "warehouse", "factory", "manufacture"}


def classify(tag: str) -> str:
    if tag in RESIDENTIAL:
        return "residential"
    if tag in PUBLIC:
        return "public"
    if tag in INDUSTRIAL:
        return "industrial"
    return "other"


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(str(value).strip()[:4])
    except ValueError:
        return None


def to_wkt(geometry: list[dict]) -> str | None:
    pts = [(p["lon"], p["lat"]) for p in geometry]
    if len(pts) < 3:
        return None
    if pts[0] != pts[-1]:
        pts.append(pts[0])  # close ring
    coords = ", ".join(f"{lon} {lat}" for lon, lat in pts)
    return f"POLYGON(({coords}))"


# Tried in order; public mirrors get overloaded, so we fail over between them.
MIRRORS = [
    settings.overpass_url,
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def fetch() -> list[dict]:
    west, south, east, north = BBOX.split(",")
    query = (
        f"[out:json][timeout:180];"
        f'way["building"]({south},{west},{north},{east});'
        f"out geom tags;"
    )
    headers = {
        "User-Agent": "FireWatch/0.1 (DCHS RK pilot; n.asankhan@firewatch.kz)",
        "Accept": "application/json",
    }
    last_err: Exception | None = None
    seen = set()
    for url in MIRRORS:
        if url in seen:
            continue
        seen.add(url)
        try:
            print(f"querying Overpass {url} for bbox {BBOX} ...")
            resp = httpx.post(
                url, data={"data": query}, headers=headers, timeout=200
            )
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except Exception as err:  # noqa: BLE001 - try next mirror
            print(f"  mirror failed: {err}")
            last_err = err
    raise RuntimeError(f"all Overpass mirrors failed; last error: {last_err}")


def main() -> None:
    elements = fetch()
    print(f"received {len(elements)} ways")

    rows = []
    for el in elements:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        wkt = to_wkt(el["geometry"])
        if not wkt:
            continue
        tags = el.get("tags", {})
        b_tag = tags.get("building", "yes")
        street = tags.get("addr:street")
        house = tags.get("addr:housenumber")
        address = " ".join(p for p in (street, house) if p) or None
        rows.append(
            {
                "osm_id": el["id"],
                "address": address,
                "building_type": classify(b_tag),
                "osm_tag": b_tag,
                "year_built": parse_int(tags.get("start_date") or tags.get("year_built")),
                "floors": parse_int(tags.get("building:levels")),
                "wkt": wkt,
            }
        )
        if len(rows) >= MAX_BUILDINGS:
            break

    print(f"inserting {len(rows)} buildings ...")
    insert = text(
        """
        INSERT INTO buildings
            (osm_id, address, building_type, osm_tag, year_built, floors, geom)
        VALUES
            (:osm_id, :address, :building_type, :osm_tag, :year_built, :floors,
             ST_GeomFromText(:wkt, 4326))
        ON CONFLICT (osm_id) DO NOTHING
        """
    )
    with engine.begin() as conn:
        conn.execute(insert, rows)
        total = conn.execute(text("SELECT count(*) FROM buildings")).scalar()
    print(f"done. buildings in DB: {total}")


if __name__ == "__main__":
    main()
