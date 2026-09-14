/**
 * Typed client for the city track's `/city/*` API (section C of the Phase 2
 * contract — new backend router, implemented in parallel and not necessarily
 * deployed yet). Every response mirrors the exact JSON shape the backend
 * returns; nothing here recomputes risk bands or coverage — those come
 * straight from the API (single source: api RISK_BANDS / lib/risk.ts on the
 * frontend).
 *
 * Mirrors the shape of lib/portal.ts (types + small shared metadata next to
 * them) rather than a full request-wrapper layer — there isn't one elsewhere
 * in the app to match (pages call `apiFetch` directly, see app/portal/page.tsx,
 * app/dashboard/page.tsx). `cityFetch` below is the one addition: it turns a
 * non-2xx response into a typed `CityApiError` so pages can special-case 404
 * ("the /city/* router isn't deployed yet") from every other failure.
 */
import type { LucideIcon } from "lucide-react";
import { Route, CircleDot, Shuffle } from "lucide-react";
import { apiFetch } from "./auth";
import { apiErrorText } from "./api-error";

/** Thrown by every `getCity*` call below on a non-2xx response. `status` lets
 *  a page tell "the router doesn't exist yet" (404 — backend not deployed)
 *  apart from "it exists but refused/broke" (403/500/…). */
export class CityApiError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `city api error ${status}`);
    this.name = "CityApiError";
    this.status = status;
  }
}

async function cityFetch<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      detail = apiErrorText(body?.detail);
    } catch {
      /* body wasn't JSON (e.g. a bare 404 from an unregistered route) */
    }
    throw new CityApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

/** True for a 404 specifically — the most likely reason on this branch: the
 *  `/city/*` router hasn't been deployed yet, not a "this object doesn't
 *  exist" 404 (there's no per-id lookup on these endpoints). */
export function isCityRouterMissing(err: unknown): boolean {
  return err instanceof CityApiError && err.status === 404;
}

/* ── Coverage source (how the "zone d'arrivée" / arrival zone was computed) ──
 * Contract update from the coordinator (supersedes the "isochrone"|"buffer"
 * pair in the original brief): a city-wide number can legitimately mix
 * districts computed by real road routing (osrm) and districts that fell
 * back to a straight-line buffer — hence "mixed". Shown next to the demo-data
 * plaque, in "Методика", and on the printed report — icon + text always,
 * color is a secondary reinforcement only (hard rule 4: never color alone),
 * see components/CoverageSourceNote.tsx. */
export type CoverageSource = "osrm" | "buffer" | "mixed";

export const COVERAGE_SOURCE_LABEL: Record<CoverageSource, string> = {
  osrm: "Зоны прибытия по дорогам",
  buffer: "Зоны прибытия по прямой (оценка сверху)",
  mixed: "Частично по дорогам, частично по прямой",
};

export const COVERAGE_SOURCE_ICON: Record<CoverageSource, LucideIcon> = {
  osrm: Route,
  buffer: CircleDot,
  mixed: Shuffle,
};

/* ── /city/summary ───────────────────────────────────────────────────────── */

export type CityBands = {
  critical: number;
  high: number;
  elevated: number;
  low: number;
};

/** The same metric shape appears at city level and per-district — a district
 *  row is "the city metrics, scoped to one district" plus its identity. */
export type CityMetrics = {
  buildings_total: number;
  avg_score: number;
  bands: CityBands;
  attention_buildings: number;
  blind_zone_buildings: number;
  blind_pct: number;
  hydrant_gap_buildings: number;
  hydrants_total: number;
  hydrants_broken: number;
  stations_total: number;
  open_prescriptions: number;
  callouts_90d: number;
  median_arrival_min: number | null;
};

export type CityDistrictSummary = CityMetrics & {
  name: string;
  name_kk: string;
  name_en: string;
  area_km2: number;
  /** 1..5, sorted by attention_buildings desc (tie-break avg_score desc). */
  rank: number;
};

export type CitySummary = {
  computed_at: string;
  demo_data: boolean;
  coverage_source: CoverageSource;
  /** True when at least part of the coverage figure is a straight-line
   *  estimate rather than real road routing — an upper bound, not a measured
   *  value. Shown alongside coverage_source, not folded into its label. */
  approximate: boolean;
  method: string;
  city: CityMetrics;
  districts: CityDistrictSummary[];
};

export function getCitySummary(): Promise<CitySummary> {
  return cityFetch<CitySummary>("/city/summary");
}

/* ── /city/districts.geojson ─────────────────────────────────────────────── */

export type CityDistrictProperties = {
  name: string;
  name_kk: string;
  name_en: string;
  rank: number;
  attention_buildings: number;
  buildings_total: number;
};

export type CityDistrictsGeoJSON = GeoJSON.FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  CityDistrictProperties
>;

export function getCityDistrictsGeoJSON(): Promise<CityDistrictsGeoJSON> {
  return cityFetch<CityDistrictsGeoJSON>("/city/districts.geojson");
}

/* ── /city/priorities ────────────────────────────────────────────────────── */

export type HydrantGapCell = {
  cell_id: string;
  lon: number;
  lat: number;
  district: string;
  buildings: number;
  avg_score: number;
  max_score: number;
  sample_addresses: string[];
};

export type StationGapCell = {
  cell_id: string;
  lon: number;
  lat: number;
  district: string;
  blind_buildings: number;
  high_risk_blind: number;
  avg_score: number;
};

export type CityPriorities = {
  computed_at: string;
  demo_data: boolean;
  coverage_source: CoverageSource;
  approximate: boolean;
  cell_m: number;
  hydrant_radius_m: number;
  method: string;
  hydrant_gaps: HydrantGapCell[];
  station_gaps: StationGapCell[];
};

export function getCityPriorities(limit = 10): Promise<CityPriorities> {
  const n = Math.min(50, Math.max(1, Math.round(limit)));
  return cityFetch<CityPriorities>(`/city/priorities?limit=${n}`);
}

/* ── Localized district name ─────────────────────────────────────────────── */

/** District names are not translated word-for-word (KZ toponyms don't have an
 *  English gloss) — the API sends the KK/EN spelling directly, this just picks
 *  the right field for the active locale. Falls back to the Russian `name`
 *  (canonical) when the requested field is missing. */
export function districtName(
  d: { name: string; name_kk?: string | null; name_en?: string | null },
  locale: "ru" | "kk" | "en",
): string {
  if (locale === "kk") return d.name_kk || d.name;
  if (locale === "en") return d.name_en || d.name;
  return d.name;
}
