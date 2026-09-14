"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { apiFetch } from "@/lib/auth";
import { useLocale } from "@/lib/i18n";
import {
  OSM_STYLE,
  ASTANA_CENTER,
  RISK_SCORE_COLOR,
  MAP_FONT_REGULAR,
  MAP_FONT_BOLD,
} from "@/lib/mapStyle";
import { SEVERITY } from "@/lib/risk";
import {
  getCityDistrictsGeoJSON,
  getCityPriorities,
  isCityRouterMissing,
} from "@/lib/city";
import type {
  CityLayerKey,
  CityLayers,
  CityMapFocus,
  CityDataStatus,
} from "@/lib/cityMapTypes";

// Districts choropleth by attention share (attention_buildings / buildings_total,
// computed client-side — the API returns the two counts, not a ratio). Not a
// per-building severity value, so it stays a smooth interpolation rather than
// the step-banded RISK_SCORE_COLOR — but still reads its endpoint colors off
// SEVERITY so a change to the palette doesn't leave this a stray 4th copy.
const DISTRICT_FILL: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "attention_share"], 0],
  0,
  SEVERITY.normal.hex,
  0.5,
  SEVERITY.elevated.hex,
  1,
  SEVERITY.critical.hex,
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

/** Every layer id that belongs to each toggle — kept next to the layer
 *  definitions below so adding a layer to a group can't be forgotten. */
const LAYER_GROUPS: Record<CityLayerKey, string[]> = {
  districts: ["districts-fill", "districts-line", "districts-label"],
  buildings: ["buildings-fill"],
  coverage: ["coverage-fill", "coverage-line", "blind"],
  hydrants: ["hydrants-ok", "hydrants-broken", "hydrants-broken-mark"],
  stations: ["stations"],
  priorities: ["priorities-hydrant", "priorities-station", "priorities-label"],
};

/** Applies the desired visibility to whichever of LAYER_GROUPS' layers
 *  already exist on the map. Per-layer `getLayer` existence check, NOT
 *  `map.isStyleLoaded()` — the latter can be transiently false any time a
 *  source is mid-`setData` (e.g. right after a pan), which would silently
 *  drop a toggle click that happened at exactly the wrong moment. A layer
 *  that doesn't exist yet (called before the `load` handler added it) is
 *  simply skipped; layersRef below makes sure the `load` handler applies the
 *  latest state once it runs, so no toggle click is ever lost, just deferred. */
function applyLayerVisibility(map: maplibregl.Map, layers: CityLayers) {
  for (const key of Object.keys(LAYER_GROUPS) as CityLayerKey[]) {
    const visible = layers[key];
    for (const id of LAYER_GROUPS[key]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
  }
}

export default function CityMap({
  district,
  focus,
  layers,
  onSelectBuilding,
  onDistrictsStatus,
  onPrioritiesStatus,
}: {
  /** District name (Russian, matches the API's `name` field) to fit bounds
   *  to on load/change — from `?district=` on the page. */
  district?: string | null;
  /** Explicit camera target — from `?lon&lat&z` on the page (e.g. "Показать
   *  на карте" from /city/priorities). Takes priority over `district`. */
  focus?: CityMapFocus;
  layers: CityLayers;
  onSelectBuilding?: (id: number) => void;
  /** Status of CityMap's own background fetches, for the page to render a
   *  real loading/error/"module not deployed" state instead of the districts
   *  choropleth or priority-cell overlay just staying silently empty. */
  onDistrictsStatus?: (status: CityDataStatus) => void;
  onPrioritiesStatus?: (status: CityDataStatus) => void;
}) {
  const { locale } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const districtsRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const buildingsAbortRef = useRef<AbortController | null>(null);
  // True once the map has fired "load" at least once. `map.once("load", …)`
  // only ever fires ONE time in a Map's lifetime — code that re-subscribes to
  // it after the map has already loaded (e.g. a `focus` effect re-running)
  // would wait forever. This ref is the correct "has it loaded yet" check;
  // `map.isStyleLoaded()` is NOT (it flips back to false during any source
  // reload, unrelated to whether the map loaded once already).
  const loadedRef = useRef(false);
  // Always the latest `layers` prop, readable from the async `load` handler
  // (whose own closure over `layers` is frozen at mount time) and from event
  // handlers — never read during render, so mutating it here is safe.
  const layersRef = useRef<CityLayers>(layers);
  layersRef.current = layers;

  async function loadBuildings(map: maplibregl.Map) {
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    // A fast pan/zoom fires `moveend` repeatedly; cancel whatever the
    // previous call was still waiting on so an old, larger bbox response
    // can't land after a newer one and paint stale buildings.
    buildingsAbortRef.current?.abort();
    const controller = new AbortController();
    buildingsAbortRef.current = controller;
    try {
      const res = await apiFetch(`/buildings?bbox=${bbox}`, { signal: controller.signal });
      if (!res.ok) return;
      const gj = await res.json();
      (map.getSource("buildings") as maplibregl.GeoJSONSource | undefined)?.setData(gj);
    } catch {
      /* aborted, or a network hiccup — leave the layer as-is */
    }
  }

  // ── Mount: build the map once ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: ASTANA_CENTER,
      zoom: 10.5,
      // Custom attribution below (page-level, "© OpenStreetMap contributors"
      // — the ODbL-required wording for the district polygon data) replaces
      // MapLibre's own control entirely, so there's exactly one attribution
      // on screen instead of two overlapping bottom-right labels.
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", async () => {
      loadedRef.current = true;
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
          // Language-dependent field is set right after this by the locale
          // effect below (it needs `locale` at the time of the call, which
          // isn't available inside this async style-load callback in a
          // meaningful way across re-renders) — this default covers first
          // paint for the ru locale.
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-font": [MAP_FONT_REGULAR],
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
        paint: { "fill-color": SEVERITY.normal.hex, "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "coverage-line",
        type: "line",
        source: "coverage",
        paint: { "line-color": SEVERITY.normal.hex, "line-opacity": 0.35, "line-width": 1 },
      });
      map.addLayer({
        id: "blind",
        type: "circle",
        source: "blind",
        paint: { "circle-radius": 3, "circle-color": SEVERITY.critical.hex, "circle-opacity": 0.5 },
      });

      // ── Buildings by score — step expression, single-sourced from
      // lib/risk.ts via lib/mapStyle.ts (see RISK_SCORE_COLOR) ─────────────
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        paint: { "fill-color": RISK_SCORE_COLOR, "fill-opacity": 0.75 },
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
          "circle-color": SEVERITY.info.hex,
        },
      });
      map.addLayer({
        id: "hydrants-broken",
        type: "circle",
        source: "hydrants",
        filter: ["!=", ["get", "status"], "ok"],
        paint: {
          "circle-radius": 5,
          "circle-color": SEVERITY.high.hex,
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
          "text-font": [MAP_FONT_BOLD],
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
          "circle-color": "#ff5a1f", // brand accent, not a severity color
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
          "circle-color": SEVERITY.high.hex,
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
          "circle-color": SEVERITY.critical.hex,
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
          "text-font": [MAP_FONT_BOLD],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#fff" },
      });

      // Apply whatever the latest desired toggle state is (layersRef, not the
      // `layers` this callback closed over at mount — a toggle click that
      // happened before this "load" callback ran would otherwise be lost).
      applyLayerVisibility(map, layersRef.current);

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
      // /infra/routing/calibration, see Phase 2 brief section A), the
      // districts choropleth and the priority-cell overlay — all fetched
      // IN PARALLEL (previously sequential: infra, then districts, then
      // priorities — each waited for the one before it for no reason). ────
      onDistrictsStatus?.("loading");
      onPrioritiesStatus?.("loading");

      const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
      const infraP = Promise.all([
        geojson("/infra/coverage"),
        geojson("/infra/blind-zones"),
        geojson("/infra/hydrants"),
        geojson("/infra/stations"),
      ]);
      const districtsP = getCityDistrictsGeoJSON().catch(toError);
      const prioritiesP = getCityPriorities(20).catch(toError);

      const [[coverage, blind, hydrants, stations], districtsResult, prioritiesResult] =
        await Promise.all([infraP, districtsP, prioritiesP]);

      (map.getSource("coverage") as maplibregl.GeoJSONSource).setData(coverage);
      (map.getSource("blind") as maplibregl.GeoJSONSource).setData(blind);
      (map.getSource("hydrants") as maplibregl.GeoJSONSource).setData(hydrants);
      (map.getSource("stations") as maplibregl.GeoJSONSource).setData(stations);

      if (districtsResult instanceof Error) {
        onDistrictsStatus?.(isCityRouterMissing(districtsResult) ? "missing" : "error");
      } else {
        const dgj = districtsResult;
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
        setDistrictLabelField(map, locale);
        if (district) fitToDistrict(map, withShare, district);
        onDistrictsStatus?.("ok");
      }

      if (prioritiesResult instanceof Error) {
        onPrioritiesStatus?.(isCityRouterMissing(prioritiesResult) ? "missing" : "error");
      } else {
        const pr = prioritiesResult;
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
        onPrioritiesStatus?.("ok");
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-only: layer toggles/district/focus/locale are separate effects
    // below so changing them doesn't tear down and rebuild the whole map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Layer visibility toggles ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyLayerVisibility(map, layers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.districts, layers.buildings, layers.coverage, layers.hydrants, layers.stations, layers.priorities]);

  // ── `?district=` fit-bounds ──────────────────────────────────────────────
  useEffect(() => {
    if (!district) return;
    const map = mapRef.current;
    const fc = districtsRef.current;
    // `fc` is only set once the districts source has real data — a more
    // reliable "is this ready" gate than `map.isStyleLoaded()`, which can be
    // false even after everything needed here already exists.
    if (!map || !fc) return;
    fitToDistrict(map, fc, district);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

  // ── `?lon&lat&z` explicit focus (e.g. "Показать на карте" from priorities) ──
  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    if (!map) return;
    const flyThere = () =>
      map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.z, duration: 900 });
    // `map.once("load", …)` only ever fires once in the map's lifetime — after
    // the map has already loaded, re-subscribing here would wait forever.
    if (loadedRef.current) flyThere();
    else map.once("load", flyThere);
  }, [focus]);

  // ── District labels follow the active locale ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("districts-label")) return;
    setDistrictLabelField(map, locale);
  }, [locale]);

  return <div ref={containerRef} className="h-full w-full" />;
}

/** Points the district-label symbol layer at the field for the active
 *  locale — /city/districts.geojson carries name/name_kk/name_en per
 *  feature, same as the summary table. */
function setDistrictLabelField(map: maplibregl.Map, locale: "ru" | "kk" | "en") {
  const field = locale === "kk" ? "name_kk" : locale === "en" ? "name_en" : "name";
  map.setLayoutProperty("districts-label", "text-field", ["coalesce", ["get", field], ["get", "name"]]);
}

function fitToDistrict(map: maplibregl.Map, fc: GeoJSON.FeatureCollection, districtName: string) {
  const feature = fc.features.find((f) => f.properties?.name === districtName);
  if (!feature) return;
  const bounds = new maplibregl.LngLatBounds();
  extendBoundsWithGeometry(bounds, feature.geometry);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, duration: 600 });
}
