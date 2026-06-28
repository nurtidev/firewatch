"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { Box, Square } from "lucide-react";
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
