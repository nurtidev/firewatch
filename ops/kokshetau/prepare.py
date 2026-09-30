"""Данные для 3D-проезда по Кокшетау: здания OSM, маршрут OSRM, MapLibre.

    python3 ops/kokshetau/prepare.py

- area.osm        — OSM API /map по центру города (bbox ниже; лимит API — 50 000 узлов)
- buildings.geojson — полигоны зданий: адрес, этажность (tagged — этажность указана в OSM,
                    иначе оценка по типу здания), название, тип
- route.json      — OSRM: ПЧ-3 (узел OSM amenity=fire_station) → ЖК «Капитал», Сабатаева 82
- maplibre-gl.js/.css — та же версия, что в web/ (4.7.x)

Overpass в среде разработки может быть закрыт сетевой политикой — поэтому OSM API.
Гидрантов в OSM по Кокшетау нет: в ролике они условные и так подписаны.
"""
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

DIR = Path(__file__).parent
BBOX = "69.370,53.275,69.405,53.300"  # центр Кокшетау
STATION = (69.3919072, 53.2955771)     # «Пожарная часть -3» в OSM
TARGET = (69.37820562, 53.27880074)    # ЖК «Капитал», ул. Сабатаева 82 (9 этажей в OSM)
UA = "firewatch-demo"


def curl(url: str, out: Path) -> None:
    subprocess.run(["curl", "-sfL", "-m", "120", "-A", UA, "-o", str(out), url], check=True)


def main() -> None:
    osm = DIR / "area.osm"
    if not osm.exists():
        curl(f"https://api.openstreetmap.org/api/0.6/map?bbox={BBOX}", osm)
    for f in ("maplibre-gl.js", "maplibre-gl.css"):
        if not (DIR / f).exists():
            curl(f"https://unpkg.com/maplibre-gl@4.7.1/dist/{f}", DIR / f)

    root = ET.parse(osm).getroot()
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in root.findall("node")}
    feats = []
    for w in root.findall("way"):
        tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
        if "building" not in tags:
            continue
        ring = [nodes[nd.get("ref")] for nd in w.findall("nd") if nd.get("ref") in nodes]
        if len(ring) < 4 or ring[0] != ring[-1]:
            continue
        try:
            levels = float(tags["building:levels"])
            tagged = True
        except (KeyError, ValueError):
            levels = 1 if tags["building"] in ("house", "garage", "garages", "shed") else 2
            tagged = False
        addr = " ".join(x for x in (tags.get("addr:street"), tags.get("addr:housenumber")) if x)
        feats.append({
            "type": "Feature",
            "properties": {"levels": levels, "tagged": tagged, "addr": addr,
                           "name": tags.get("name", ""), "type": tags["building"]},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    (DIR / "buildings.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False))

    route = (f"https://router.project-osrm.org/route/v1/driving/{STATION[0]},{STATION[1]};"
             f"{TARGET[0]},{TARGET[1]}?overview=full&geometries=geojson")
    curl(route, DIR / "route.json")
    r = json.loads((DIR / "route.json").read_text())["routes"][0]
    print(f"зданий: {len(feats)}, с адресом: {sum(bool(f['properties']['addr']) for f in feats)}, "
          f"этажность в OSM: {sum(f['properties']['tagged'] for f in feats)}; "
          f"маршрут {r['distance'] / 1000:.1f} км, {r['duration'] / 60:.1f} мин")


if __name__ == "__main__":
    main()
