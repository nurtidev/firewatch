/**
 * Typed client for the city track's `/city/*` API (see api/app/routers/city.py
 * for the actual implementation — this mirrors its response shape exactly).
 * Nothing here recomputes risk bands or coverage — those come straight from
 * the API (single source: api RISK_BANDS / lib/risk.ts on the frontend).
 *
 * Mirrors the shape of lib/portal.ts (types + small shared metadata next to
 * them) rather than a full request-wrapper layer — there isn't one elsewhere
 * in the app to match (pages call `apiFetch` directly, see app/portal/page.tsx,
 * app/dashboard/page.tsx). `cityFetch` below is the one addition: it turns a
 * non-2xx response into a typed `CityApiError` so pages can special-case 404.
 * The 404 handling stays even though the router is deployed now — web and api
 * ship on separate release cadences (see deploy-railway), so a web build can
 * still land before the matching api build, and the same 404 path also covers
 * an akimat account whose api hasn't been redeployed yet after an incident.
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

/** True for a 403 — the role isn't allowed on this endpoint. Distinct from
 *  "the router doesn't exist" (404) and from a generic backend failure:
 *  shown as "Нет доступа" rather than "сервис не отвечает". AppShell-wrapped
 *  pages redirect before this can normally happen, but a print page without
 *  AppShell (e.g. /city/report) has no such guard on its own — see
 *  lib/useRoleGuard.ts. */
export function isCityForbidden(err: unknown): boolean {
  return err instanceof CityApiError && err.status === 403;
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
 *  row is "the city metrics, scoped to one district" plus its identity.
 *
 *  Contract update (superseded the original single `median_arrival_min`):
 *  arrival time splits into two comparable-to-different-things numbers —
 *  `median_response_min` (вызов зарегистрирован → прибытие; this is the one
 *  comparable against the 10-minute normative, `CitySummary.normative_min`)
 *  and `median_travel_min` (выезд → прибытие; time actually on the road —
 *  never compare this one against the normative, it excludes turnout time). */
export type CityMetrics = {
  buildings_total: number;
  /** Null when the district/city has zero SCORED buildings (city.py:157 —
   *  `acc["scored"]` is 0) — distinct from a real low score. Render as "нет
   *  данных" with no ScoreBadge, never `Math.round(null)` (→ 0, a false
   *  "critical is fine" reading) or `scoreBand(null)` (→ "Низкий"). */
  avg_score: number | null;
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
  median_response_min: number | null;
  median_travel_min: number | null;
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
  /** How `median_response_min` was computed — shown in "Методика" next to
   *  `method` (city.py: RESPONSE_METHOD). Comparable against `normative_min`. */
  response_method?: string;
  /** How `median_travel_min` was computed (city.py: TRAVEL_METHOD) — pure
   *  road time, excludes turnout; never compared against `normative_min`. */
  travel_method?: string;
  city: CityMetrics;
  districts: CityDistrictSummary[];
  /** Buildings and open prescriptions that exist city-wide but couldn't be
   *  resolved to any district (city.py: assemble_summary's `unassigned` —
   *  always present, a top-level sibling of `city`/`districts`, not a field
   *  inside CityMetrics). When `buildings > 0`, district sums in the table
   *  legitimately fall short of the city total by that many objects — show
   *  a note, don't leave it looking like the numbers don't add up. */
  unassigned: { buildings: number; open_prescriptions: number };
  /** Arrival normative in minutes (currently always 10) — the number
   *  `median_response_min` is judged against. Falls back to 10 (the
   *  citywide constant used elsewhere, e.g. InfraMap's `normative_min`) if
   *  the backend hasn't started sending this yet. */
  normative_min?: number;
  /** Informational fields the backend may send; not all are surfaced in the
   *  UI yet — typed so a response that includes them doesn't need an `any`
   *  cast, and so a future screen can read them without touching this type
   *  again. */
  hydrant_radius_m?: number;
  callout_window_days?: number;
  /** OSM attribution string from the backend, if sent — the hardcoded
   *  "© OpenStreetMap contributors" on every city screen already satisfies
   *  the ODbL requirement on its own, so this is read opportunistically
   *  (not required for the attribution to be correct). */
  attribution?: string;
  /** Count of fire stations whose arrival isochrone is stale/missing (city.py
   *  `_envelope`: `len(...)`, NOT a boolean) — an accuracy caveat on
   *  `coverage_source`/`blind_zone_buildings`, not a hard error. Render only
   *  when > 0, with the count; `0 && …` would otherwise print a stray "0". */
  stations_stale_isochrones?: number;
  stations_missing_isochrones?: number;
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
  // Added alongside hydrant_gaps' — same "not PII, just a few nearby
  // addresses to orient by" reasoning applies here too.
  sample_addresses: string[];
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
  /** Informational, tolerated but not required to be shown everywhere. */
  attribution?: string;
  /** Count, not a boolean — see CitySummary.stations_stale_isochrones. */
  stations_stale_isochrones?: number;
  stations_missing_isochrones?: number;
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

/** `/city/priorities` cells carry only a bare Russian `district` string (the
 *  section C contract has no name_kk/name_en there, unlike /city/summary and
 *  /city/districts.geojson) — this looks the name up in a district summary
 *  list that DOES carry them (pass `summary.districts`) and localizes it.
 *  Falls back to the Russian name when no summary is loaded yet or nothing
 *  matches (e.g. a stale/partial fetch) — never throws, never blank. */
export function localizedDistrictName(
  name: string,
  districts: CityDistrictSummary[] | null | undefined,
  locale: "ru" | "kk" | "en",
): string {
  if (locale === "ru") return name;
  const match = districts?.find((d) => d.name === name);
  return match ? districtName(match, locale) : name;
}
