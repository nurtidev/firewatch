/**
 * Боевой модуль (dispatch) — domain types and shared metadata for the ЦОУ
 * console (/dispatch) and the responder tablet (/callout). Same convention
 * as lib/reports.ts: category/status → label/icon/severity lives here once,
 * so the pack, the active-callout list and any future surface stay in sync.
 */
import type { LucideIcon } from "lucide-react";
import { Flame, CloudFog, BellRing, CircleHelp } from "lucide-react";
import { SEVERITY, type SeverityMeta } from "./risk";
import type { ReportCategory, ReportStatus } from "./reports";

/* ───────────────────────────── Callout ─────────────────────────── */

export type CalloutType = "fire" | "smoke" | "alarm" | "other";
export type CalloutStatus = "active" | "closed";

export const CALLOUT_TYPES: CalloutType[] = ["fire", "smoke", "alarm", "other"];

/** Type → label/icon/severity. Fire is the worst case (critical), smoke a
 *  step down (high), an alarm sounding with nothing confirmed yet (elevated),
 *  anything else informational until triaged on scene. */
export const CALLOUT_TYPE_META: Record<
  CalloutType,
  { label: string; icon: LucideIcon; severity: SeverityMeta }
> = {
  fire: { label: "Пожар", icon: Flame, severity: SEVERITY.critical },
  smoke: { label: "Задымление", icon: CloudFog, severity: SEVERITY.high },
  alarm: { label: "Сработка сигнализации", icon: BellRing, severity: SEVERITY.elevated },
  other: { label: "Другое", icon: CircleHelp, severity: SEVERITY.info },
};

export type Station = { id: number; name: string };

export type Callout = {
  id: number;
  address: string | null;
  district: string | null;
  callout_type: CalloutType;
  note: string | null;
  status: CalloutStatus;
  lat: number;
  lng: number;
  station: Station | null;
  building_id: number | null;
  created_by: string;
  created_at: string;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
};

/* ───────────────────────────── Search ──────────────────────────── */

export type BuildingSearchResult = {
  id: number;
  address: string;
  district: string | null;
  building_type: string | null;
  floors: number | null;
  risk_score: number | null;
};

/* ───────────────────────────── Pack ────────────────────────────── */

export type PackBuilding = {
  id: number;
  address: string;
  district: string | null;
  building_type: string | null;
  floors: number | null;
  year_built: number | null;
  risk_score: number | null;
  card_id: number | null;
};

export type HydrantStatus = "ok" | "broken";

export type PackHydrant = {
  id: number;
  status: HydrantStatus;
  hydrant_type: string | null;
  pressure_bar: number | null;
  diameter_mm: number | null;
  distance_m: number;
  lat: number;
  lng: number;
};

export const HYDRANT_STATUS_META: Record<HydrantStatus, { label: string; severity: SeverityMeta }> = {
  ok: { label: "Исправен", severity: SEVERITY.normal },
  broken: { label: "Неисправен", severity: SEVERITY.critical },
};

export type PackStation = Station & { vehicles: number | null; distance_m: number | null };

/** Field report near the callout, in the shape /dispatch/{id}/pack returns —
 *  category/status labels resolve through lib/reports.ts (CATEGORY_META /
 *  STATUS_META), same single source as the /reports page. */
export type PackReport = {
  id: number;
  category: ReportCategory;
  status: ReportStatus;
  description: string | null;
  distance_m: number;
  photos: string[];
};

export type ForcesHint = { preset_key: string; label: string };

export type CalloutPackData = {
  callout: Callout;
  building: PackBuilding | null;
  hydrants: PackHydrant[];
  station: PackStation | null;
  reports: PackReport[];
  forces_hint: ForcesHint | null;
};

/** Field-report categories that block a truck reaching the fire — the ones
 *  the callout pack must surface with contrast, before the crew arrives. */
export const BLOCKING_REPORT_CATEGORIES: ReportCategory[] = ["blocked_access", "parking_barrier"];

/* ───────────────────────────── Time ────────────────────────────── */

/** Coarse relative time ("7 мин назад") — abbreviated units sidestep Russian
 *  plural declension (1 минуту / 2 минуты / 5 минут) without looking clipped. */
export function relativeTimeRu(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "только что";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ч назад`;
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
