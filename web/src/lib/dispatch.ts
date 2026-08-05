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

/** Хронология боевых действий. Отметки ставит человек — ни одна не
 *  выставляется автоматически, пока нет доверенного источника (телематика).
 *  Интервалы считает сервер: они же идут в сводку по частям, и расхождение
 *  округления между экраном и сводкой читалось бы как ошибка данных. */
export type CalloutTimeline = {
  reported_at: string | null;
  dispatched_at: string | null;
  arrived_at: string | null;
  first_jet_at: string | null;
  localized_at: string | null;
  extinguished_at: string | null;
  rank_declared: string | null;
  /** Сообщение → прибытие: то, что сверяют с нормативом. */
  response_sec: number | null;
  /** Сообщение → выезд: сбор караула, отдельная зона ответственности. */
  turnout_sec: number | null;
  travel_sec: number | null;
  total_sec: number | null;
};

/** Ключи отметок в порядке реального выезда — им же задан порядок в UI. */
export const TIMELINE_STEPS = [
  "dispatched_at",
  "arrived_at",
  "first_jet_at",
  "localized_at",
  "extinguished_at",
] as const;

export type TimelineStep = (typeof TIMELINE_STEPS)[number];

export const TIMELINE_STEP_LABEL: Record<TimelineStep, string> = {
  dispatched_at: "Выезд",
  arrived_at: "Прибытие",
  first_jet_at: "Первый ствол",
  localized_at: "Локализация",
  extinguished_at: "Ликвидация",
};

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
  timeline: CalloutTimeline;
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

/* ───────────────────────── Техника и расход ────────────────────── */

export const VEHICLE_TYPES = ["ac", "al", "akp", "anr", "asa", "other"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ["in_service", "on_callout", "repair", "reserve"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

/** Сокращения — те же, что на бортах и в сводках части: РТП читает их быстрее
 *  расшифровки, поэтому в таблице стоит аббревиатура, а полное название — в
 *  подписи (цвет никогда не единственный сигнал). */
export const VEHICLE_TYPE_META: Record<VehicleType, { short: string; label: string }> = {
  ac: { short: "АЦ", label: "Автоцистерна" },
  al: { short: "АЛ", label: "Автолестница" },
  akp: { short: "АКП", label: "Коленчатый подъёмник" },
  anr: { short: "АНР", label: "Насосно-рукавный" },
  asa: { short: "АСА", label: "Аварийно-спасательный" },
  other: { short: "Проч.", label: "Прочая техника" },
};

export const VEHICLE_STATUS_META: Record<
  VehicleStatus,
  { label: string; severity: SeverityMeta }
> = {
  in_service: { label: "В строю", severity: SEVERITY.normal },
  on_callout: { label: "На выезде", severity: SEVERITY.elevated },
  repair: { label: "В ремонте", severity: SEVERITY.critical },
  reserve: { label: "В резерве", severity: SEVERITY.high },
};

export type Vehicle = {
  id: number;
  station_id: number;
  station_name: string | null;
  callsign: string;
  vehicle_type: VehicleType;
  status: VehicleStatus;
  water_l: number | null;
  note: string | null;
  updated_at: string | null;
  /** Только в наряде выезда (GET pack) — когда машина отправлена. */
  assigned_at?: string | null;
};

export type StationAvailability = {
  station_id: number;
  station_name: string | null;
  total: number;
} & Record<VehicleStatus, number>;

/** Номенклатура расхода: 7 позиций, которые реально считают в частях.
 *  Расширять дороже, чем кажется — незаполненная форма хуже отсутствующей. */
export const RESOURCE_ITEMS = [
  "hose",
  "barrel",
  "foam",
  "water",
  "fuel",
  "ladder",
  "scba",
] as const;
export type ResourceItem = (typeof RESOURCE_ITEMS)[number];

export const RESOURCE_META: Record<ResourceItem, { label: string; unit: string }> = {
  hose: { label: "Рукава напорные", unit: "шт" },
  barrel: { label: "Стволы", unit: "шт" },
  foam: { label: "Пенообразователь", unit: "л" },
  water: { label: "Вода", unit: "м³" },
  fuel: { label: "ГСМ", unit: "л" },
  ladder: { label: "Лестницы ручные", unit: "шт" },
  scba: { label: "СИЗОД (использований)", unit: "шт" },
};

export type CalloutResource = {
  item_key: ResourceItem;
  qty: number;
  recorded_by: string | null;
  recorded_at: string | null;
};

/* ─────────────────────── План развёртывания ────────────────────── */

export const POSITION_KINDS = [
  "barrel_ext",
  "barrel_def",
  "vehicle",
  "checkpoint",
  "hq",
  "ladder",
  "other",
] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

/** Стволы на тушение и на защиту разделены не для красоты: методика даёт для
 *  них разные величины (Qт и Qз), и сверять факт с расчётом можно только
 *  раздельно. */
export const POSITION_KIND_META: Record<PositionKind, { label: string; short: string }> = {
  barrel_ext: { label: "Ствол на тушение", short: "Ств. туш." },
  barrel_def: { label: "Ствол на защиту", short: "Ств. защ." },
  vehicle: { label: "Позиция машины", short: "Машина" },
  checkpoint: { label: "Рубеж локализации", short: "Рубеж" },
  hq: { label: "Штаб пожаротушения", short: "Штаб" },
  ladder: { label: "Автолестница", short: "АЛ" },
  other: { label: "Прочее", short: "Проч." },
};

export const POSITION_PHASES = ["localization", "extinguishing"] as const;
export type PositionPhase = (typeof POSITION_PHASES)[number];

export const POSITION_PHASE_LABEL: Record<PositionPhase, string> = {
  localization: "Локализация",
  extinguishing: "Ликвидация",
};

export type DeploymentPosition = {
  id: number;
  kind: PositionKind;
  phase: PositionPhase;
  sector: string | null;
  note: string | null;
  vehicle_id: number | null;
  vehicle_callsign: string | null;
  lat: number | null;
  lng: number | null;
  created_by: string;
  created_at: string | null;
};

export async function addPosition(
  calloutId: number,
  body: {
    kind: PositionKind;
    phase: PositionPhase;
    sector?: string | null;
    note?: string | null;
    lat?: number | null;
    lng?: number | null;
  },
): Promise<DeploymentPosition[]> {
  const r = await apiFetch(`/dispatch/${calloutId}/deployment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось добавить позицию"));
  return r.json();
}

export async function deletePosition(
  calloutId: number,
  positionId: number,
): Promise<DeploymentPosition[]> {
  const r = await apiFetch(`/dispatch/${calloutId}/deployment/${positionId}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось снять позицию"));
  return r.json();
}

export type CalloutPackData = {
  callout: Callout;
  building: PackBuilding | null;
  hydrants: PackHydrant[];
  station: PackStation | null;
  reports: PackReport[];
  forces_hint: ForcesHint | null;
  vehicles: Vehicle[];
  resources: CalloutResource[];
  deployment: DeploymentPosition[];
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

/* ────────────────────── Оперативные действия ───────────────────── */

/** Секунды → «4 мин 30 с». Норматив прибытия обсуждают в минутах, но разница
 *  в десятки секунд между частями существенна — поэтому не округляем до минут. */
export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m} мин ${s} с` : `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}

/** Время отметки в виде ЧЧ:ММ — формат радиообмена и боевых документов. */
export function formatClock(iso: string | null, locale: Locale = "ru"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type TimelinePatch = Partial<Record<TimelineStep, string | null>> & {
  rank_declared?: string | null;
};

export async function patchTimeline(calloutId: number, patch: TimelinePatch): Promise<Callout> {
  const r = await apiFetch(`/dispatch/${calloutId}/timeline`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось сохранить отметку"));
  return r.json();
}

export async function assignVehicles(calloutId: number, vehicleIds: number[]): Promise<Vehicle[]> {
  const r = await apiFetch(`/dispatch/${calloutId}/vehicles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vehicle_ids: vehicleIds }),
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось назначить технику"));
  return r.json();
}

export async function releaseVehicle(calloutId: number, vehicleId: number): Promise<Vehicle[]> {
  const r = await apiFetch(`/dispatch/${calloutId}/vehicles/${vehicleId}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось снять машину с выезда"));
  return r.json();
}

export async function putResources(
  calloutId: number,
  items: { item_key: ResourceItem; qty: number }[],
): Promise<CalloutResource[]> {
  const r = await apiFetch(`/dispatch/${calloutId}/resources`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось сохранить расход"));
  return r.json();
}

/* ──────────────────────── Техника частей ───────────────────────── */

export type VehiclesResponse = {
  vehicles: Vehicle[];
  by_station: StationAvailability[];
  types: VehicleType[];
  statuses: VehicleStatus[];
};

export function useVehicles(stationId?: number | null, pollMs?: number) {
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    const q = stationId != null ? `?station_id=${stationId}` : "";
    apiFetch(`/dispatch/vehicles${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("vehicles"))))
      .then((d: VehiclesResponse) => {
        setData(d);
        setError(null);
      })
      .catch(() => setError("Не удалось загрузить технику частей."));
  }, [stationId]);

  useEffect(() => {
    reload();
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { data, error, reload };
}

export async function createVehicle(
  stationId: number,
  body: { callsign: string; vehicle_type: VehicleType; water_l?: number | null; note?: string | null },
): Promise<{ id: number }> {
  const r = await apiFetch(`/dispatch/stations/${stationId}/vehicles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось поставить машину на учёт"));
  return r.json();
}

export async function patchVehicle(
  vehicleId: number,
  patch: { status?: VehicleStatus; water_l?: number | null; note?: string | null },
): Promise<unknown> {
  const r = await apiFetch(`/dispatch/vehicles/${vehicleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось изменить состояние машины"));
  return r.json();
}

export async function deleteVehicle(vehicleId: number): Promise<unknown> {
  const r = await apiFetch(`/dispatch/vehicles/${vehicleId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось снять машину с учёта"));
  return r.json();
}

/* ─────────────────────────── Статистика ────────────────────────── */

export type StationStat = {
  station_id: number;
  station_name: string | null;
  callouts: number;
  with_arrival: number;
  median_response_sec: number | null;
  median_turnout_sec: number | null;
};

export type DispatchStats = {
  days: number;
  by_station: StationStat[];
  by_type: { callout_type: CalloutType; count: number }[];
  resources: { item_key: ResourceItem; total: number }[];
};

export function useDispatchStats(days: number) {
  const [stats, setStats] = useState<DispatchStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setStats(null);
    setError(null);
    apiFetch(`/dispatch/stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats"))))
      .then((d: DispatchStats) => alive && setStats(d))
      .catch(() => alive && setError("Не удалось загрузить сводку."));
    return () => {
      alive = false;
    };
  }, [days]);

  return { stats, error };
}

/** Текст ошибки из ответа API: сервер объясняет отказ («Позывной уже занят»),
 *  и подменять это общей фразой значит прятать причину от пользователя. */
async function errorText(r: Response, fallback: string): Promise<string> {
  try {
    const body = await r.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === "string") return detail[0].msg;
  } catch {
    /* тело не JSON — остаётся общий текст */
  }
  return fallback;
}
