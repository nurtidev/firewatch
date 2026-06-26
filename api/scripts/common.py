"""Shared Overpass helpers for OSM import scripts."""

from app.config import settings

# Public Overpass mirrors get overloaded, so importers fail over between them.
MIRRORS = [
    settings.overpass_url,
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

OVERPASS_HEADERS = {
    "User-Agent": "FireWatch/0.1 (DCHS RK pilot; n.asankhan@firewatch.kz)",
    "Accept": "application/json",
}
