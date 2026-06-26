"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { apiFetch } from "@/lib/auth";

const CENTER: [number, number] = [71.42, 51.13];

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

async function geojson(path: string) {
  try {
    const r = await apiFetch(path);
    return r.ok ? await r.json() : { type: "FeatureCollection", features: [] };
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

export default function InfraMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: CENTER,
      zoom: 10.5,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", async () => {
      const [coverage, blind, hydrants, stations] = await Promise.all([
        geojson("/infra/coverage"),
        geojson("/infra/blind-zones"),
        geojson("/infra/hydrants"),
        geojson("/infra/stations"),
      ]);

      // Coverage (≈10-min reach) — green fill + outline
      map.addSource("coverage", { type: "geojson", data: coverage });
      map.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "coverage-line",
        type: "line",
        source: "coverage",
        paint: { "line-color": "#22c55e", "line-opacity": 0.4, "line-width": 1 },
      });

      // Blind-zone buildings — red
      map.addSource("blind", { type: "geojson", data: blind });
      map.addLayer({
        id: "blind",
        type: "circle",
        source: "blind",
        paint: {
          "circle-radius": 3,
          "circle-color": "#ef4444",
          "circle-opacity": 0.55,
        },
      });

      // Hydrants — blue (ok) / amber (broken)
      map.addSource("hydrants", { type: "geojson", data: hydrants });
      map.addLayer({
        id: "hydrants",
        type: "circle",
        source: "hydrants",
        paint: {
          "circle-radius": 2.5,
          "circle-color": [
            "match",
            ["get", "status"],
            "broken",
            "#f59e0b",
            "#3b82f6",
          ],
        },
      });

      // Fire stations — large orange squares
      map.addSource("stations", { type: "geojson", data: stations });
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

      const popup = new maplibregl.Popup({ closeButton: false, offset: 12 });
      map.on("mouseenter", "stations", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const p = e.features?.[0]?.properties;
        if (p) {
          popup
            .setLngLat(e.lngLat)
            .setHTML(`<b>${p.name}</b><br/>${p.vehicles} маш.`)
            .addTo(map);
        }
      });
      map.on("mouseleave", "stations", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    });

    return () => map.remove();
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
