/**
 * Plain types/constants shared between app/city/map/page.tsx and
 * components/CityMap.tsx — deliberately NOT exported from CityMap.tsx itself.
 *
 * CityMap.tsx `import maplibregl from "maplibre-gl"` at module scope; the
 * page only ever reaches the actual component through
 * `dynamic(() => import("@/components/CityMap"), { ssr: false })`, which
 * code-splits it into its own chunk. But the page ALSO used to statically
 * `import { DEFAULT_CITY_LAYERS } from "@/components/CityMap"` for the plain
 * constant — a regular (non-dynamic) import of any binding from that module
 * pulls the whole module, maplibre-gl included, into the page's own eager
 * chunk, defeating the code-split. Living here instead, this file has zero
 * runtime dependencies and is safe to import from the page directly.
 */

export type CityLayerKey =
  | "districts"
  | "buildings"
  | "coverage"
  | "hydrants"
  | "stations"
  | "priorities";

export type CityLayers = Record<CityLayerKey, boolean>;

export const DEFAULT_CITY_LAYERS: CityLayers = {
  districts: true,
  buildings: true,
  coverage: false,
  hydrants: true,
  stations: true,
  priorities: false,
};

export type CityMapFocus = { lon: number; lat: number; z: number } | null;

/** Status of one of CityMap's own background fetches (districts choropleth,
 *  priority cells) — reported to the page via callback props so the page can
 *  render a real loading/error/"module not deployed" state instead of the
 *  map silently staying empty (see CityMap's onDistrictsStatus/
 *  onPrioritiesStatus). */
export type CityDataStatus = "loading" | "ok" | "missing" | "error";
