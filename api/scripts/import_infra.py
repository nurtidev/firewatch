"""Import firefighting infrastructure (fire stations + hydrants) from OSM.

Run:  docker compose exec api python -m scripts.import_infra
Env:  FW_INFRA_BBOX="west,south,east,north" (default: Astana city-wide)

Station vehicle counts and hydrant status/last-check are not in OSM, so they
are deterministically synthesized from osm_id (replace with ДЧС data at pilot).
"""

import hashlib
import os
from datetime import date, timedelta

import httpx
from sqlalchemy import text

from app.db import engine
from scripts.common import MIRRORS, OVERPASS_HEADERS

# Wider than the building bbox — stations/hydrants span the whole city.
BBOX = os.getenv("FW_INFRA_BBOX", "71.20,51.00,71.70,51.25")
TODAY = date(2026, 6, 26)


def rng(osm_id: int, salt: str) -> float:
    h = hashlib.md5(f"{osm_id}:{salt}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


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
            }
        )

    # OSM barely maps hydrants in Astana. If the real count is negligible,
    # synthesize a plausible network from building locations (clearly marked
    # with NULL osm_id) so the infrastructure map is meaningful for the demo.
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
        for b in bs[::4]:  # ~1 hydrant per 4 buildings
            jx = (rng(b["id"], "jx") - 0.5) * 0.0006
            jy = (rng(b["id"], "jy") - 0.5) * 0.0006
            broken = rng(b["id"], "hstatus") < 0.03
            days = int(rng(b["id"], "hcheck") * 730)
            synth_hydrants.append(
                {
                    "osm_id": None,
                    "status": "broken" if broken else "ok",
                    "last_check": TODAY - timedelta(days=days),
                    "lon": b["lon"] + jx,
                    "lat": b["lat"] + jy,
                }
            )
        hy_rows = hy_rows + synth_hydrants
        print(f"synthesized {len(synth_hydrants)} hydrants")

    with engine.begin() as conn:
        if st_rows:
            conn.execute(
                text(
                    "INSERT INTO fire_stations (osm_id, name, vehicles, geom) "
                    "VALUES (:osm_id, :name, :vehicles, "
                    "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) "
                    "ON CONFLICT (osm_id) DO NOTHING"
                ),
                st_rows,
            )
        if hy_rows:
            conn.execute(
                text(
                    "INSERT INTO hydrants (osm_id, status, last_check, geom) "
                    "VALUES (:osm_id, :status, :last_check, "
                    "ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) "
                    "ON CONFLICT (osm_id) DO NOTHING"
                ),
                hy_rows,
            )
        st_total = conn.execute(text("SELECT count(*) FROM fire_stations")).scalar()
        hy_total = conn.execute(text("SELECT count(*) FROM hydrants")).scalar()
    print(f"done. fire_stations: {st_total}, hydrants: {hy_total}")


if __name__ == "__main__":
    main()
