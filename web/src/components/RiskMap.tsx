"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { apiFetch } from "@/lib/auth";

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

const RISK_COLOR: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "score"], 0],
  0,
  "#2ecc71",
  35,
  "#f1c40f",
  70,
  "#e67e22",
  100,
  "#e74c3c",
];

function queryString(filters: MapFilters, bbox: string): string {
  const p = new URLSearchParams({ bbox });
  if (filters.type) p.set("type", filters.type);
  if (filters.district) p.set("district", filters.district);
  if (filters.risk) p.set("risk", filters.risk);
  return p.toString();
}

export default function RiskMap({
  onSelect,
  filters,
}: {
  onSelect?: (id: number) => void;
  filters: MapFilters;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const filtersRef = useRef<MapFilters>(filters);

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

      void loadBuildings(map);
      map.on("moveend", () => void loadBuildings(map));

      map.on("click", "buildings-fill", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) onSelect?.(Number(id));
      });
      map.on("mouseenter", "buildings-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "buildings-fill", () => {
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

  return <div ref={containerRef} className="h-full w-full" />;
}
