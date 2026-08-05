"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { Box, Square } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { CATEGORY_META, CATEGORY_MAP_COLOR, STATUS_META, type ReportCategory, type ReportStatus } from "@/lib/reports";

export type MapFilters = {
  type?: string;
  district?: string;
  risk?: string;
};

const CENTER: [number, number] = [71.43, 51.13];

const STYLE: StyleSpecification = {
  version: 8,
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

// Risk gradient mirrors the severity scale (lib/risk + @theme tokens) so the
// map markers and the legend/badges read as one system.
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

// Field-report category → color, single-sourced from lib/reports.ts (which in
// turn mirrors the SEVERITY tokens — WebGL paint can't resolve CSS vars).
const REPORT_COLOR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "category"],
  "blocked_access",
  CATEGORY_MAP_COLOR.blocked_access,
  "blocked_exit",
  CATEGORY_MAP_COLOR.blocked_exit,
  "hydrant_defect",
  CATEGORY_MAP_COLOR.hydrant_defect,
  "parking_barrier",
  CATEGORY_MAP_COLOR.parking_barrier,
  "ptp_mismatch",
  CATEGORY_MAP_COLOR.ptp_mismatch,
  CATEGORY_MAP_COLOR.other,
];

// Only unresolved reports clutter the risk map — resolved/dismissed ones are
// history, not something an inspector needs to act on right now.
const OPEN_REPORT_FILTER: maplibregl.ExpressionSpecification = [
  "any",
  ["==", ["get", "status"], "open"],
  ["==", ["get", "status"], "in_progress"],
];

async function loadReports(map: maplibregl.Map) {
  try {
    const res = await apiFetch(`/reports/geojson`);
    if (!res.ok) return;
    const geojson = await res.json();
    const source = map.getSource("reports") as maplibregl.GeoJSONSource | undefined;
    source?.setData(geojson);
  } catch {
    /* leave layer empty */
  }
}

function queryString(filters: MapFilters, bbox: string): string {
  const p = new URLSearchParams({ bbox });
  if (filters.type) p.set("type", filters.type);
  if (filters.district) p.set("district", filters.district);
  if (filters.risk) p.set("risk", filters.risk);
  return p.toString();
}

/** Точка, к которой карта обязана долететь по внешней команде (выбор из
 *  поиска адреса) — не связана с фильтрами: смена фильтров не должна дёргать
 *  камеру, а выбор результата поиска должен, даже если координаты те же, что
 *  и в прошлый раз (поэтому новый объект-литерал при каждом клике). */
export type MapFocus = { id: number; lat: number; lng: number };

export default function RiskMap({
  onSelect,
  filters,
  focus,
}: {
  onSelect?: (id: number) => void;
  filters: MapFilters;
  focus?: MapFocus | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const filtersRef = useRef<MapFilters>(filters);
  const [is3d, setIs3d] = useState(false);

  function toggle3d() {
    const map = mapRef.current;
    if (!map) return;
    const next = !is3d;
    setIs3d(next);
    map.setLayoutProperty("buildings-fill", "visibility", next ? "none" : "visible");
    map.setLayoutProperty("buildings-3d", "visibility", next ? "visible" : "none");
    map.easeTo({ pitch: next ? 55 : 0, duration: 600 });
  }

  async function loadBuildings(map: maplibregl.Map) {
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    try {
      const res = await apiFetch(`/buildings?${queryString(filtersRef.current, bbox)}`);
      if (!res.ok) return;
      const geojson = await res.json();
      const source = map.getSource("buildings") as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(geojson);
    } catch {
      /* leave map as-is */
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: CENTER,
      zoom: 12,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("buildings", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        paint: { "fill-color": RISK_COLOR, "fill-opacity": 0.75 },
      });
      map.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        paint: { "line-color": "rgba(0,0,0,0.35)", "line-width": 0.5 },
      });
      // 2.5D massing: extrude footprints by floor count (≈3 m/floor), coloured by
      // risk. Hidden until the user toggles 3D. Gives a city/quarter walk-around.
      map.addLayer({
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "buildings",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": RISK_COLOR,
          "fill-extrusion-height": [
            "*",
            ["coalesce", ["get", "floors"], 3],
            3,
          ],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.85,
        },
      });

      void loadBuildings(map);
      map.on("moveend", () => void loadBuildings(map));

      for (const layer of ["buildings-fill", "buildings-3d"]) {
        map.on("click", layer, (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id != null) onSelect?.(Number(id));
        });
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // Field reports — open/in_progress obstacles, on top of the risk layer.
      map.addSource("reports", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "reports",
        type: "circle",
        source: "reports",
        filter: OPEN_REPORT_FILTER,
        paint: {
          "circle-radius": 6,
          "circle-color": REPORT_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
          "circle-opacity": 0.92,
        },
      });
      void loadReports(map);

      const reportPopup = new maplibregl.Popup({ closeButton: true, offset: 10 });
      map.on("click", "reports", (e) => {
        const p = e.features?.[0]?.properties as
          | { id: number; category: ReportCategory; status: ReportStatus }
          | undefined;
        if (!p) return;
        const cat = CATEGORY_META[p.category]?.label ?? p.category;
        const status = STATUS_META[p.status]?.label ?? p.status;
        reportPopup
          .setLngLat(e.lngLat)
          .setHTML(`<b>${cat}</b><br/>${status}`)
          .addTo(map);
      });
      map.on("mouseenter", "reports", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "reports", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onSelect]);

  // Reload when filters change.
  useEffect(() => {
    filtersRef.current = filters;
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) void loadBuildings(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.type, filters.district, filters.risk]);

  // Найденный поиском объект центрирует карту — тот самый шаг «нашли адрес →
  // оказались на месте», которого не хватало (аудит: три `<select>`, ни одного
  // поля ввода). Building-уровень зума (17) — виден конкретный дом, а не квартал.
  useEffect(() => {
    if (!focus) return;
    const map = mapRef.current;
    if (!map) return;
    const flyThere = () =>
      map.flyTo({
        center: [focus.lng, focus.lat],
        zoom: Math.max(map.getZoom(), 17),
        duration: 900,
      });
    if (map.isStyleLoaded()) flyThere();
    else map.once("load", flyThere);
  }, [focus]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <button
        onClick={toggle3d}
        className="absolute bottom-6 right-3 z-10 inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface/90 px-2.5 py-1.5 text-xs font-medium text-fg shadow-pop backdrop-blur transition-colors hover:bg-surface-2"
        aria-pressed={is3d}
        aria-label={is3d ? "Перейти в 2D" : "Перейти в 3D"}
      >
        {is3d ? <Square className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
        {is3d ? "2D" : "3D"}
      </button>
    </div>
  );
}
