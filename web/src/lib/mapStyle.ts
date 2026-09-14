import type { StyleSpecification, ExpressionSpecification } from "maplibre-gl";
import { SEVERITY, ELEVATED_MIN_SCORE, HIGH_MIN_SCORE, CRITICAL_MIN_SCORE } from "./risk";

/**
 * Shared MapLibre base style — a single OSM raster tile source. Was copy-pasted
 * identically into RiskMap, InfraMap and now CityMap; a change to the tile
 * source or attribution previously had to be made in every copy. Pure data,
 * no behavior — safe to import into any client-only map component.
 *
 * `glyphs` — verified with curl (2026-09-14): fonts.openmaptiles.org returns
 * HTTP 200 but `text/html` (a 2725-byte error page), which MapLibre's PBF
 * parser chokes on ("Unimplemented type") — every symbol layer (district/
 * hydrant/priority-cell labels) silently failed to render. demotiles.
 * maplibre.org/font/{fontstack}/{range}.pbf returns real
 * application/octet-stream glyph PBFs, including the Cyrillic block
 * (1024-1279 — checked, ~125 KB): required for district-name labels.
 */
export const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

/** The one fontstack used by every symbol layer across every map component —
 *  keep it to a single pair so there is only one name to verify against
 *  GLYPHS_URL (see mapStyle.test note above). */
export const MAP_FONT_REGULAR = "Noto Sans Regular";
export const MAP_FONT_BOLD = "Noto Sans Bold";

export const OSM_STYLE: StyleSpecification = {
  version: 8,
  // Needed only by consumers that add a `symbol` layer (e.g. CityMap's
  // district/hydrant/priority-cell labels). RiskMap and InfraMap define no
  // symbol layers, so this addition doesn't change what they render — the
  // base tile source/layer below is untouched.
  glyphs: GLYPHS_URL,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/** Astana city center, used as the default map camera target. */
export const ASTANA_CENTER: [number, number] = [71.43, 51.13];

/**
 * Risk-score choropleth as a MapLibre `step` expression — thresholds and
 * colors single-sourced from lib/risk.ts `SEVERITY` (≥60 critical, ≥40 high,
 * ≥20 elevated, else normal — the exact same cuts as `scoreSeverity()`).
 *
 * Deliberately `step`, not `interpolate`: RiskMap and CityMap both used to
 * interpolate a smooth gradient between four hand-picked stops (0/35/70/100),
 * which doesn't line up with the real thresholds — a score of 62 painted a
 * yellow-orange blend on the map while `scoreSeverity(62)` (the panel, the
 * badge, the table row for the SAME building) says "critical" red. `step`
 * paints the exact SEVERITY color for the whole band, so the map always
 * agrees with every other surface for the same score (hard rule 2).
 *
 * WebGL paint properties can't resolve `var(--color-*)`, so this reads
 * `SEVERITY[key].hex` — the one place that resolution happens now, instead
 * of a third hand-copied palette (previously duplicated verbatim in
 * RiskMap/InfraMap/CityMap).
 */
export const RISK_SCORE_COLOR: ExpressionSpecification = [
  "step",
  ["coalesce", ["get", "score"], 0],
  SEVERITY.normal.hex,
  ELEVATED_MIN_SCORE,
  SEVERITY.elevated.hex,
  HIGH_MIN_SCORE,
  SEVERITY.high.hex,
  CRITICAL_MIN_SCORE,
  SEVERITY.critical.hex,
];
