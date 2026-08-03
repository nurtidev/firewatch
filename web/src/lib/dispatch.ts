"use client";

/**
 * Боевой модуль (dispatch) — domain types, shared metadata and data hooks for
 * the ЦОУ console (/dispatch) and the responder tablet (/callout). Same
 * convention as lib/reports.ts: category/status → label/icon/severity lives
 * here once, so the pack, the active-callout list and any future surface stay
 * in sync — plus the list/pack polling hooks both pages need.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Flame, CloudFog, BellRing, CircleHelp } from "lucide-react";
import { apiFetch } from "./auth";
import { intlLocale, type Locale } from "./i18n";
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
  /** Народные названия объекта («ЖК «Хайвилл-Астана»») — по ним тоже ищется,
   *  поэтому в выдаче их видно: диспетчер понимает, почему нашлась эта строка. */
  alias: string | null;
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
  /** Этажность, по которой РТП выбирает автолестницу: из карточки ПТП, если она
   *  есть (`floors_source = "card"`), иначе из реестра OSM. `floors_registry`
   *  оставлен рядом, чтобы расхождение документа и реестра было видно, а не
   *  подменялось молча. */
  floors: number | null;
  floors_source: "card" | "registry";
  floors_registry: number | null;
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

/**
 * Силы и средства в пакете вызова. Два источника, и путать их нельзя:
 *   `card`   — расчёт по ПТП объекта (человек, реальный документ) — цифры;
 *   `preset` — черновая прикидка по типу здания (эвристика) — только пресет.
 * Пресет приходит всегда: им параметризуется ссылка на калькулятор /forces.
 */
export type ForcesHint = {
  source: "card" | "preset";
  preset_key: string;
  label: string;
  card_id: number | null;
  rank: string | null;
  barrels_ext: number | null;
  barrels_def: number | null;
  squads: number | null;
  personnel: number | null;
  trucks: number | null;
  q_req_l_s: number | null;
  q_req_ext_l_s: number | null;
  q_req_def_l_s: number | null;
  q_act_l_s: number | null;
  s_fire_m2: number | null;
  s_ext_m2: number | null;
  scenario: string | null;
};

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
 *  plural declension (1 минуту / 2 минуты / 5 минут) without looking clipped.
 *  Not a component — a caller that needs it localized passes its own
 *  `locale` (for the Intl fallback) and `t` (for the three fixed suffixes)
 *  instead of this helper importing the i18n hooks itself. Defaults keep the
 *  original Russian-only behaviour for callers that don't pass them. */
export function relativeTimeRu(
  iso: string,
  locale: Locale = "ru",
  t: (ru: string) => string = (ru) => ru,
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return t("только что");
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${t("мин назад")}`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ${t("ч назад")}`;
  return new Date(iso).toLocaleString(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ───────────────────────────── Data hooks ──────────────────────── */

/** Polls the callout list for the ЦОУ console (/dispatch, tabbed) and the
 *  responder tablet (/callout, active-only) — same endpoint, same shape. */
export function useCalloutList(status: string, pollMs: number) {
  const [callouts, setCallouts] = useState<Callout[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    apiFetch(`/dispatch?status=${status}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("list"))))
      .then((d: Callout[]) => {
        setCallouts(d);
        setError(null);
      })
      .catch(() => setError("Не удалось загрузить выезды. Проверьте связь."));
  }, [status]);

  useEffect(() => {
    setCallouts(null);
    reload();
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { callouts, error, reload };
}

/** Боевой пакет for the selected callout, with a stale-response guard: if the
 *  selection moves on before a fetch resolves (fast clicks between rows,
 *  slow network), the outdated response is dropped instead of clobbering the
 *  pack of whatever is selected by the time it arrives. */
export function useCalloutPack(selectedId: number | null, pollMs?: number) {
  const [pack, setPackState] = useState<CalloutPackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the id the in-flight (or most recent) request/seed was for — a
  // response only applies if it still matches this.
  const requestedRef = useRef<number | null>(null);

  const load = useCallback((id: number) => {
    requestedRef.current = id;
    setLoading(true);
    setError(null);
    apiFetch(`/dispatch/${id}/pack`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("pack"))))
      .then((d: CalloutPackData) => {
        if (requestedRef.current !== id) return; // stale — selection moved on
        setPackState(d);
      })
      .catch(() => {
        if (requestedRef.current !== id) return;
        setError("Не удалось загрузить боевой пакет.");
      })
      .finally(() => {
        if (requestedRef.current === id) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      // Nothing selected (e.g. responder went back to the list) — drop any
      // previously loaded pack instead of leaving stale data mounted.
      requestedRef.current = null;
      setPackState(null);
      setError(null);
      setLoading(false);
      return;
    }
    load(selectedId);
    if (!pollMs) return;
    const t = setInterval(() => load(selectedId), pollMs);
    return () => clearInterval(t);
  }, [selectedId, pollMs, load]);

  // Seed the pack directly from a response that already carries it (e.g. the
  // POST /dispatch response on creation) — skips a redundant round-trip while
  // staying under the same stale-guard as `load`.
  const setPack = useCallback((next: CalloutPackData) => {
    requestedRef.current = next.callout.id;
    setPackState(next);
    setError(null);
  }, []);

  return {
    pack,
    loading,
    error,
    reload: () => {
      if (selectedId != null) load(selectedId);
    },
    setPack,
  };
}
