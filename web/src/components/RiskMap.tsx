"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";

// `||` (not `??`) so an empty build-time value also falls back.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

// Astana center.
const CENTER: [number, number] = [71.43, 51.13];

// Raster OSM base style (dev only — replace with a vector tile provider for prod).
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

export default function RiskMap({
  onSelect,
}: {
  onSelect?: (id: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: CENTER,
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("buildings", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "buildings-risk",
        type: "circle",
        source: "buildings",
        paint: {
          // grow dots with zoom so they read clearly at city scale
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            3,
            14,
            6,
            17,
            10,
          ],
          // green → yellow → red by risk score
          "circle-color": [
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
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.4)",
        },
      });

      void loadBuildings(map);
      map.on("moveend", () => void loadBuildings(map));

      map.on("click", "buildings-risk", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) onSelect?.(Number(id));
      });
      map.on("mouseenter", "buildings-risk", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "buildings-risk", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => map.remove();
  }, [onSelect]);

  return <div ref={containerRef} className="h-full w-full" />;
}

async function loadBuildings(map: maplibregl.Map) {
  const b = map.getBounds();
  const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
  try {
    const res = await fetch(`${API_URL}/buildings?bbox=${bbox}`);
    if (!res.ok) return;
    const geojson = await res.json();
    const source = map.getSource("buildings") as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(geojson);
  } catch {
    // API not reachable yet — leave the map empty.
  }
}
