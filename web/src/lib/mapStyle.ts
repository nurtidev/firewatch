import type { StyleSpecification } from "maplibre-gl";

/**
 * Shared MapLibre base style — a single OSM raster tile source. Was copy-pasted
 * identically into RiskMap, InfraMap and now CityMap; a change to the tile
 * source or attribution previously had to be made in every copy. Pure data,
 * no behavior — safe to import into any client-only map component.
 */
export const OSM_STYLE: StyleSpecification = {
  version: 8,
  // Public, keyless glyphs CDN — needed only by consumers that add a `symbol`
  // layer (e.g. CityMap's district/hydrant/priority-cell labels). RiskMap and
  // InfraMap define no symbol layers, so this addition doesn't change what
  // they render — the base tile source/layer below is untouched.
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
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
