"""Import firefighting infrastructure (fire stations + hydrants) from OSM.

Run:  docker compose exec api python -m scripts.import_infra
Env:  FW_INFRA_BBOX="west,south,east,north" (default: Astana city-wide)

Station vehicle counts and hydrant status/last-check/pressure_bar/diameter_mm
are not in OSM, so they are deterministically synthesized from an identity key
(osm_id for real OSM elements, building id for the synthesized network below)
— replace with ДЧС/water-utility data at pilot.

Idempotency note (docs/ux_audit_2026-08-03.md #19): the synthesized hydrant
network used to insert `osm_id = NULL`, relying on `ON CONFLICT (osm_id) DO
NOTHING` to dedupe reruns. That never worked — Postgres treats every NULL as
distinct in a unique index (NULL <> NULL), so each rerun added a full second
copy of the network. Every synthesized hydrant now gets a deterministic
negative `osm_id` derived from its source building id (see `synth_osm_id`),
so `ON CONFLICT (osm_id)` actually matches on rerun. The sentinel range is
chosen to never collide with real (always-positive) OSM ids, nor with the
`seed_hayvill.py`/`seed_extra_objects.py` sentinel ranges (-9000..-9203).
"""

import hashlib
import os
from datetime import date, timedelta

import httpx
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.db import engine
from scripts.common import MIRRORS, OVERPASS_HEADERS

# Wider than the building bbox — stations/hydrants span the whole city.
BBOX = os.getenv("FW_INFRA_BBOX", "71.20,51.00,71.70,51.25")
TODAY = date(2026, 6, 26)

# Base for the synthesized-network sentinel osm_ids. Far below both real OSM
# node ids (always positive) and the -9000..-9203 range used by
# seed_hayvill.py/seed_extra_objects.py, so the ranges can never collide even
# as the building table grows.
SYNTH_HYDRANT_OSM_BASE = -2_000_000


def rng(osm_id: int, salt: str) -> float:
    h = hashlib.md5(f"{osm_id}:{salt}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def synth_osm_id(building_id: int) -> int:
    """Deterministic sentinel osm_id for a hydrant synthesized from a building.

    Same building -> same osm_id on every run, which is the whole point: it
    lets `ON CONFLICT (osm_id) DO NOTHING` actually dedupe reruns instead of
    silently doubling the network (see module docstring).
    """
    return SYNTH_HYDRANT_OSM_BASE - building_id


def hydrant_specs(key: int) -> dict:
    """Plausible working pressure / main diameter / type for a hydrant, until
    the real ДЧС/water-utility feed is wired (migration 0008_hydrant_specs).

    Deterministic in `key` (osm_id for real hydrants, building id for the
    synthesized network) so reruns don't reshuffle values that are already on
    screen. Diameter skews toward the common 100/150 mm street mains
    (150 mm also matches the real ring main from the Хайвилл ПТП); pressure is
    a plausible 1.5-4.5 bar working range; underground (подземный) hydrants
    dominate, as in CIS city networks.
    """
    diam_r = rng(key, "diameter_mm")
    diameter_mm = 100 if diam_r < 0.30 else (150 if diam_r < 0.85 else 200)
    pressure_bar = round(1.5 + rng(key, "pressure_bar") * 3.0, 1)
    hydrant_type = "надземный" if rng(key, "hydrant_type") < 0.1 else "подземный"
    return {
        "pressure_bar": pressure_bar,
        "diameter_mm": diameter_mm,
        "hydrant_type": hydrant_type,
    }


def run_query(query: str) -> list[dict]:
    last_err: Exception | None = None
    for url in MIRRORS:
        try:
            print(f"querying {url} ...")
            resp = httpx.post(
                url, data={"data": query}, headers=OVERPASS_HEADERS, timeout=200
            )
            resp.raise_for_status()
            return resp.json().get("elements", [])
        except Exception as err:  # noqa: BLE001 - try next mirror
            print(f"  mirror failed: {err}")
            last_err = err
    raise RuntimeError(f"all Overpass mirrors failed; last: {last_err}")


def coords(el: dict) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return el["lon"], el["lat"]
    if "center" in el:
        return el["center"]["lon"], el["center"]["lat"]
    return None


def synth_hydrants_from_buildings(buildings: list[dict]) -> list[dict]:
    """Deterministic hydrant network derived from building locations, used when
    OSM barely maps hydrants for the bbox (see main()) so the infrastructure
    map is meaningful for the demo. `buildings` rows need `id`/`lon`/`lat`.

    Pure function (no DB/network) so it can be unit-tested directly: same
    input -> same rows, including `osm_id`, every time.
    """
    rows = []
    for b in buildings[::4]:  # ~1 hydrant per 4 buildings
        jx = (rng(b["id"], "jx") - 0.5) * 0.0006
        jy = (rng(b["id"], "jy") - 0.5) * 0.0006
        broken = rng(b["id"], "hstatus") < 0.03
        days = int(rng(b["id"], "hcheck") * 730)
        rows.append(
            {
                "osm_id": synth_osm_id(b["id"]),
                "status": "broken" if broken else "ok",
                "last_check": TODAY - timedelta(days=days),
                "lon": b["lon"] + jx,
                "lat": b["lat"] + jy,
                **hydrant_specs(b["id"]),
            }
        )
    return rows


def upsert_stations(conn: Connection, st_rows: list[dict]) -> None:
    if not st_rows:
        return
    conn.execute(
        text(
            "INSERT INTO fire_stations (osm_id, name, vehicles, geom) "
            "VALUES (:osm_id, :name, :vehicles, "
            "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) "
            "ON CONFLICT (osm_id) DO NOTHING"
        ),
        st_rows,
    )


def upsert_hydrants(conn: Connection, hy_rows: list[dict]) -> None:
    """Insert hydrants, skipping any osm_id already present.

    Requires every row to carry a non-NULL, deterministic `osm_id` — NULL
    defeats `ON CONFLICT (osm_id)` in Postgres (NULL <> NULL in a unique
    index), which is exactly the bug this dedupes against (see module
    docstring). Real OSM hydrants use their OSM node id; synthesized ones use
    `synth_osm_id()`.
    """
    if not hy_rows:
        return
    conn.execute(
        text(
            "INSERT INTO hydrants "
            "(osm_id, status, last_check, pressure_bar, diameter_mm, "
            "hydrant_type, geom) "
            "VALUES (:osm_id, :status, :last_check, :pressure_bar, "
            ":diameter_mm, :hydrant_type, "
            "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) "
            "ON CONFLICT (osm_id) DO NOTHING"
        ),
        hy_rows,
    )


def main() -> None:
    west, south, east, north = BBOX.split(",")
    bbox = f"{south},{west},{north},{east}"

    stations = run_query(
        f'[out:json][timeout:120];nwr["amenity"="fire_station"]({bbox});out center tags;'
    )
    hydrants = run_query(
        f'[out:json][timeout:120];node["emergency"="fire_hydrant"]({bbox});out;'
    )
    print(f"stations: {len(stations)}, hydrants: {len(hydrants)}")

    st_rows = []
    for el in stations:
        c = coords(el)
        if not c:
            continue
        osm_id = el["id"]
        name = el.get("tags", {}).get("name") or f"ПЧ ({osm_id})"
        st_rows.append(
            {
                "osm_id": osm_id,
                "name": name,
                "vehicles": 4 + int(rng(osm_id, "veh") * 5),
                "lon": c[0],
                "lat": c[1],
            }
        )

    hy_rows = []
    for el in hydrants:
        c = coords(el)
        if not c:
            continue
        osm_id = el["id"]
        broken = rng(osm_id, "status") < 0.03
        days = int(rng(osm_id, "check") * 730)
        hy_rows.append(
            {
                "osm_id": osm_id,
                "status": "broken" if broken else "ok",
                "last_check": TODAY - timedelta(days=days),
                "lon": c[0],
                "lat": c[1],
                **hydrant_specs(osm_id),
            }
        )

    # OSM barely maps hydrants in Astana. If the real count is negligible,
    # synthesize a plausible network from building locations so the
    # infrastructure map is meaningful for the demo.
    synth_hydrants: list[dict] = []
    if len(hy_rows) < 50:
        print("few OSM hydrants — synthesizing from buildings ...")
        with engine.begin() as conn:
            bs = conn.execute(
                text(
                    "SELECT id, ST_X(ST_Centroid(geom)) AS lon, "
                    "ST_Y(ST_Centroid(geom)) AS lat FROM buildings ORDER BY id"
                )
            ).mappings().all()
        synth_hydrants = synth_hydrants_from_buildings(bs)
        hy_rows = hy_rows + synth_hydrants
        print(f"synthesized {len(synth_hydrants)} hydrants")

    with engine.begin() as conn:
        upsert_stations(conn, st_rows)
        upsert_hydrants(conn, hy_rows)
        st_total = conn.execute(text("SELECT count(*) FROM fire_stations")).scalar()
        hy_total = conn.execute(text("SELECT count(*) FROM hydrants")).scalar()
    print(f"done. fire_stations: {st_total}, hydrants: {hy_total}")


if __name__ == "__main__":
    main()
