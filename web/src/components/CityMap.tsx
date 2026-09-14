"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { apiFetch } from "@/lib/auth";
import { OSM_STYLE } from "@/lib/mapStyle";
import { getCityDistrictsGeoJSON, getCityPriorities } from "@/lib/city";

const CENTER: [number, number] = [71.43, 51.13];

// Same risk gradient as RiskMap — buildings colored by score must read the
// same everywhere (hard rule 2: severity is single-sourced).
const RISK_COLOR: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "score"], 0],
  0,
  "#2fce7e", // normal
  35,
  "#ffd029", // elevated
  70,
  "#ff8c1a", // high
  100,
  "#ff453a", // critical
];

// Districts choropleth by attention share (attention_buildings / buildings_total,
// computed client-side — the API returns the two counts, not a ratio).
const DISTRICT_FILL: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "attention_share"], 0],
  0,
  "#2fce7e",
  0.5,
  "#ffd029",
  1,
  "#ff453a",
];

async function geojson<T = GeoJSON.FeatureCollection>(path: string): Promise<T> {
  try {
    const r = await apiFetch(path);
    return r.ok ? await r.json() : ({ type: "FeatureCollection", features: [] } as unknown as T);
  } catch {
    return { type: "FeatureCollection", features: [] } as unknown as T;
  }
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Extends a LngLatBounds over every coordinate pair in a Polygon/MultiPolygon
 *  geometry — used to fit the map to one district's outline. No turf
 *  dependency for a single recursive walk. */
function extendBoundsWithGeometry(bounds: maplibregl.LngLatBounds, geom: GeoJSON.Geometry) {
  const walk = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === "number" && typeof node[1] === "number") {
      bounds.extend(node as [number, number]);
      return;
    }
    if (Array.isArray(node)) node.forEach(walk);
  };
  if ("coordinates" in geom) walk(geom.coordinates);
}

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

const LAYER_GROUPS: Record<CityLayerKey, string[]> = {
  districts: ["districts-fill", "districts-line", "districts-label"],
  buildings: ["buildings-fill"],
  coverage: ["coverage-fill", "coverage-line", "blind"],
  hydrants: ["hydrants-ok", "hydrants-broken", "hydrants-broken-mark"],
  stations: ["stations"],
  priorities: ["priorities-hydrant", "priorities-station", "priorities-label"],
};

export type CityMapFocus = { lon: number; lat: number; z: number } | null;

export default function CityMap({
  district,
  focus,
  layers,
  onSelectBuilding,
}: {
  /** District name (Russian, matches the API's `name` field) to fit bounds
   *  to on load/change — from `?district=` on the page. */
  district?: string | null;
  /** Explicit camera target — from `?lon&lat&z` on the page (e.g. "Показать
   *  на карте" from /city/priorities). Takes priority over `district`. */
  focus?: CityMapFocus;
  layers: CityLayers;
  onSelectBuilding?: (id: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const districtsRef = useRef<GeoJSON.FeatureCollection | null>(null);

  async function loadBuildings(map: maplibregl.Map) {
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    try {
      const res = await apiFetch(`/buildings?bbox=${bbox}`);
      if (!res.ok) return;
      const gj = await res.json();
      (map.getSource("buildings") as maplibregl.GeoJSONSource | undefined)?.setData(gj);
    } catch {
      /* leave the layer as-is */
    }
  }

  // ── Mount: build the map once ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: CENTER,
      zoom: 10.5,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", async () => {
      // ── Sources ────────────────────────────────────────────────────────
      map.addSource("districts", { type: "geojson", data: EMPTY_FC });
      map.addSource("buildings", { type: "geojson", data: EMPTY_FC });
      map.addSource("coverage", { type: "geojson", data: EMPTY_FC });
      map.addSource("blind", { type: "geojson", data: EMPTY_FC });
      map.addSource("hydrants", { type: "geojson", data: EMPTY_FC });
      map.addSource("stations", { type: "geojson", data: EMPTY_FC });
      map.addSource("priorities", { type: "geojson", data: EMPTY_FC });

      // ── Districts: choropleth + outline + label ──────────────────────────
      map.addLayer({
        id: "districts-fill",
        type: "fill",
        source: "districts",
        paint: { "fill-color": DISTRICT_FILL, "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "districts-line",
        type: "line",
        source: "districts",
        paint: { "line-color": "#8b93a7", "line-width": 1.2 },
      });
      map.addLayer({
        id: "districts-label",
        type: "symbol",
        source: "districts",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
        },
        paint: {
          "text-color": "#e8e8ec",
          "text-halo-color": "#0b0d12",
          "text-halo-width": 1.2,
        },
      });

      // ── Arrival coverage + blind zones (reused /infra endpoints) ─────────
      map.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage",
        paint: { "fill-color": "#2fce7e", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "coverage-line",
        type: "line",
        source: "coverage",
        paint: { "line-color": "#2fce7e", "line-opacity": 0.35, "line-width": 1 },
      });
      map.addLayer({
        id: "blind",
        type: "circle",
        source: "blind",
        paint: { "circle-radius": 3, "circle-color": "#ff453a", "circle-opacity": 0.5 },
      });

      // ── Buildings by score ────────────────────────────────────────────────
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        paint: { "fill-color": RISK_COLOR, "fill-opacity": 0.75 },
      });

      // ── Hydrants: ok (plain dot) vs broken (larger dot + "!" mark) —
      // shape/mark difference, not color alone (hard rule 4). ──────────────
      map.addLayer({
        id: "hydrants-ok",
        type: "circle",
        source: "hydrants",
        filter: ["==", ["get", "status"], "ok"],
        paint: {
          "circle-radius": 2.5,
          "circle-color": "#3d9bff",
        },
      });
      map.addLayer({
        id: "hydrants-broken",
        type: "circle",
        source: "hydrants",
        filter: ["!=", ["get", "status"], "ok"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#ff8c1a",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
      map.addLayer({
        id: "hydrants-broken-mark",
        type: "symbol",
        source: "hydrants",
        filter: ["!=", ["get", "status"], "ok"],
        layout: {
          "text-field": "!",
          "text-size": 9,
          "text-font": ["Noto Sans Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#fff" },
      });

      // ── Fire stations ─────────────────────────────────────────────────────
      map.addLayer({
        id: "stations",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": 8,
          "circle-color": "#ff5a1f",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });

      // ── Priority cells: where to add a hydrant (Г) or a station (Ч) —
      // letters double as the shape/icon cue, color reinforces. ────────────
      map.addLayer({
        id: "priorities-hydrant",
        type: "circle",
        source: "priorities",
        filter: ["==", ["get", "kind"], "hydrant"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#ff8c1a",
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
      map.addLayer({
        id: "priorities-station",
        type: "circle",
        source: "priorities",
        filter: ["==", ["get", "kind"], "station"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#ff453a",
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
      map.addLayer({
        id: "priorities-label",
        type: "symbol",
        source: "priorities",
        layout: {
          "text-field": ["get", "mark"],
          "text-size": 10,
          "text-font": ["Noto Sans Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#fff" },
      });

      // Apply the initial toggle state before the first paint settles.
      for (const key of Object.keys(LAYER_GROUPS) as CityLayerKey[]) {
        const visible = layers[key];
        for (const id of LAYER_GROUPS[key]) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }

      void loadBuildings(map);
      map.on("moveend", () => void loadBuildings(map));

      // ── Building click → compact read-only panel ─────────────────────────
      map.on("click", "buildings-fill", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) onSelectBuilding?.(Number(id));
      });
      map.on("mouseenter", "buildings-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "buildings-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      // ── Data: infra layers (allowed for akimat — GET /infra/* except
      // /infra/routing/calibration, see Phase 2 brief section A) ──────────
      const [coverage, blind, hydrants, stations] = await Promise.all([
        geojson("/infra/coverage"),
        geojson("/infra/blind-zones"),
        geojson("/infra/hydrants"),
        geojson("/infra/stations"),
      ]);
      (map.getSource("coverage") as maplibregl.GeoJSONSource).setData(coverage);
      (map.getSource("blind") as maplibregl.GeoJSONSource).setData(blind);
      (map.getSource("hydrants") as maplibregl.GeoJSONSource).setData(hydrants);
      (map.getSource("stations") as maplibregl.GeoJSONSource).setData(stations);

      // ── Data: districts choropleth (also drives ?district= fit-bounds) ───
      try {
        const dgj = await getCityDistrictsGeoJSON();
        const withShare: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: dgj.features.map((f) => {
            const total = f.properties?.buildings_total ?? 0;
            const attn = f.properties?.attention_buildings ?? 0;
            return {
              ...f,
              properties: {
                ...f.properties,
                attention_share: total > 0 ? attn / total : 0,
              },
            };
          }),
        };
        districtsRef.current = withShare;
        (map.getSource("districts") as maplibregl.GeoJSONSource).setData(withShare);
        if (district) fitToDistrict(map, withShare, district);
      } catch {
        /* districts choropleth stays empty — page-level error state covers this */
      }

      // ── Data: priority cells (points, for the toggleable overlay) ────────
      try {
        const pr = await getCityPriorities(20);
        const features: GeoJSON.Feature[] = [
          ...pr.hydrant_gaps.map((c) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
            properties: { kind: "hydrant", mark: "Г", ...c },
          })),
          ...pr.station_gaps.map((c) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
            properties: { kind: "station", mark: "Ч", ...c },
          })),
        ];
        (map.getSource("priorities") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features,
        });
      } catch {
        /* priorities overlay stays empty — /city/priorities page covers the list */
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-only: layer toggles/district/focus are separate effects below so
    // changing them doesn't tear down and rebuild the whole map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Layer visibility toggles ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const key of Object.keys(LAYER_GROUPS) as CityLayerKey[]) {
      const visible = layers[key];
      for (const id of LAYER_GROUPS[key]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.districts, layers.buildings, layers.coverage, layers.hydrants, layers.stations, layers.priorities]);

  // ── `?district=` fit-bounds ──────────────────────────────────────────────
  useEffect(() => {
    if (!district) return;
    const map = mapRef.current;
    const fc = districtsRef.current;
    if (!map || !fc) return;
    if (map.isStyleLoaded()) fitToDistrict(map, fc, district);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

  // ── `?lon&lat&z` explicit focus (e.g. "Показать на карте" from priorities) ──
  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    if (!map) return;
    const flyThere = () =>
      map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.z, duration: 900 });
    if (map.isStyleLoaded()) flyThere();
    else map.once("load", flyThere);
  }, [focus]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function fitToDistrict(map: maplibregl.Map, fc: GeoJSON.FeatureCollection, districtName: string) {
  const feature = fc.features.find((f) => f.properties?.name === districtName);
  if (!feature) return;
  const bounds = new maplibregl.LngLatBounds();
  extendBoundsWithGeometry(bounds, feature.geometry);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, duration: 600 });
}
