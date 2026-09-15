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
import {
  Flame,
  CloudFog,
  BellRing,
  CircleHelp,
  ShieldHalf,
  Truck,
  Minus,
  Radio,
  Users,
  History,
} from "lucide-react";
import { apiFetch } from "./auth";
import { cachedAtOf } from "./sw";
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

/** Норматив прибытия в городе — 10 минут (Закон «О гражданской защите»).
 *  Показывается как сравнение, а не как оценка работы караула: причина
 *  превышения (перекрытый проезд, пробка) видна не в цифре, а в донесениях. */
export const RESPONSE_NORM_SEC = 600;

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
  /** Расстановка, дошедшая с планшета уже после закрытия выезда: сколько
   *  позиций помечено и когда пришла последняя. null — не приходило ничего.
   *  Необязательное: пакет из офлайн-кэша старой версии API его не содержит. */
  late_sync?: { positions: number; last_synced_at: string | null } | null;
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

/**
 * Стволы на тушение и на защиту разделены не для красоты: методика даёт для
 * них разные величины (Qт и Qз), и сверять факт с расчётом можно только
 * раздельно.
 *
 * Иконка и цвет живут здесь, а не в компоненте схемы: одна и та же позиция
 * рисуется на боевом планшете и в донесении о пожаре, и разойтись они не
 * имеют права — по донесению потом разбирают выезд.
 *
 * `directional` — есть ли у позиции направление работы: у ствола есть, у
 * штаба и рубежа нет, и предлагать поворот там значило бы спрашивать о том,
 * чего не существует.
 */
export const POSITION_KIND_META: Record<
  PositionKind,
  { label: string; short: string; icon: LucideIcon; cssVar: string; directional: boolean }
> = {
  barrel_ext: {
    label: "Ствол на тушение",
    short: "Ств. туш.",
    icon: Flame,
    cssVar: SEVERITY.critical.cssVar,
    directional: true,
  },
  barrel_def: {
    label: "Ствол на защиту",
    short: "Ств. защ.",
    icon: ShieldHalf,
    cssVar: SEVERITY.elevated.cssVar,
    directional: true,
  },
  vehicle: {
    label: "Позиция машины",
    short: "Машина",
    icon: Truck,
    cssVar: SEVERITY.info.cssVar,
    directional: false,
  },
  checkpoint: {
    label: "Рубеж локализации",
    short: "Рубеж",
    icon: Minus,
    cssVar: SEVERITY.high.cssVar,
    directional: false,
  },
  hq: {
    label: "Штаб пожаротушения",
    short: "Штаб",
    icon: Radio,
    cssVar: SEVERITY.normal.cssVar,
    directional: false,
  },
  ladder: {
    label: "Автолестница",
    short: "АЛ",
    icon: Users,
    cssVar: SEVERITY.info.cssVar,
    directional: true,
  },
  other: {
    label: "Прочее",
    short: "Проч.",
    icon: CircleHelp,
    cssVar: SEVERITY.info.cssVar,
    directional: false,
  },
};

/** Порядок инструментов палитры и легенды донесения. `other` ставится не
 *  пальцем по плану, а из формы с описанием — в палитре его нет. */
export const POSITION_TOOL_KINDS: PositionKind[] = [
  "barrel_ext",
  "barrel_def",
  "checkpoint",
  "vehicle",
  "ladder",
  "hq",
];

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
  /** Расстановка внутри здания: этаж и доля от габарита плана (0..1).
   *  Доля, а не пиксели — план рисуется в разном масштабе (планшет РТП,
   *  десктоп, экспорт в донесение), и пиксельная координата уехала бы при
   *  первом изменении размера. */
  floor: string | null;
  plan_x: number | null;
  plan_y: number | null;
  /** Направление работы ствола, градусы (0 = север, по часовой).
   *  null ≠ 0: у штаба и рубежа направления нет, а ствол без heading — это
   *  ствол, направление которому ещё не задали. */
  heading: number | null;
  /** Идентификатор, выданный устройством при постановке (см. deploymentQueue).
   *  По нему позиция, поставленная без связи, узнаётся в ответе сервера как
   *  своя — иначе после синхронизации она выглядела бы как чужая новая. */
  client_uid: string | null;
  /** Когда позицию поставили (часы устройства). Отличается от created_at
   *  только там, где связь пропадала: «подан в 14:32, записан в 14:51». */
  placed_at: string | null;
  /** Не null — позиция дошла из очереди планшета уже после закрытия выезда
   *  (поставлена до закрытия, без связи). Донесение и схема помечают такие
   *  позиции значком и текстом. Необязательное — старый API поля не отдаёт. */
  synced_after_close_at?: string | null;
  created_by: string;
  created_at: string | null;
};

export type PositionInput = {
  kind: PositionKind;
  phase: PositionPhase;
  sector?: string | null;
  note?: string | null;
  lat?: number | null;
  lng?: number | null;
  floor?: string | null;
  plan_x?: number | null;
  plan_y?: number | null;
  heading?: number | null;
  client_uid?: string;
  placed_at?: string;
};

/** Часы устройства в момент отправки. Сервер сравнивает их со своими и
 *  поправляет `placed_at` на сбитые часы планшета: без этого планшет, у
 *  которого часы спешат, получал отказ по каждой поставленной позиции. Ставится
 *  здесь, вплотную к запросу, а не при постановке в очередь. */
const sentAtNow = () => new Date().toISOString();

/** Правка позиции в очереди синхронизации: адрес строки плюс изменённые поля.
 *  Адрес — серверный id и/или client_uid: у позиции, поставленной на плане,
 *  id может быть ещё неизвестен (ответ на постановку потерялся). */
export type PositionPatchInput = Partial<Omit<PositionInput, "kind" | "client_uid">> & {
  id?: number;
  client_uid?: string;
};

/** Очередь расстановки, накопленная устройством: конечное состояние, а не
 *  журнал жестов (позиция, поставленная и пять раз подвинутая без связи,
 *  уходит одним `create` с итоговыми координатами). */
export type DeploymentSyncBody = {
  creates: (PositionInput & { client_uid: string })[];
  patches: PositionPatchInput[];
  /** Снятие позиций с пульта — по серверному id. */
  deletes: number[];
  /** Снятие позиций с плана — по client_uid. */
  delete_uids: string[];
};

export type DeploymentSyncResult = {
  positions: DeploymentPosition[];
  /** Ключи принятых операций — те же, что у очереди: client_uid у позиций с
   *  плана, `srv:<id>` у позиций с пульта. */
  applied: string[];
  /** Отвергнутое сервером — с причиной, которую показывают РТП, а не глотают. */
  rejected: { key: string; reason: string }[];
};

/** Ошибка синхронизации, различающая «связи нет» и «сервер отказал».
 *  Первое — повод оставить очередь и повторить, второе — повод показать
 *  причину: молчаливый ретрай отказа никогда не закончится. */
export class SyncError extends Error {
  constructor(
    message: string,
    /** HTTP-статус; 0 — до сервера не дошло. */
    readonly status: number,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/** Отправить накопленную очередь расстановки одним запросом.
 *
 *  Один запрос вместо N поштучных — потому что связь на пожаре появляется на
 *  секунды: очередь из пятнадцати запросов успевает уйти наполовину и
 *  оставляет расстановку в состоянии, которого не было ни на плане, ни в
 *  замысле РТП.
 *
 *  `authRedirect: false` — эта отправка уходит в фоне (см. deploymentQueue),
 *  без нажатия РТП, и 401 здесь не повод срывать его с плана расстановки на
 *  /login: вызывающий (runFlush) сам различает 401 через SyncError.status и
 *  оставляет очередь на устройстве с баннером «нужен повторный вход». */
export async function syncDeployment(
  calloutId: number,
  body: DeploymentSyncBody,
): Promise<DeploymentSyncResult> {
  let r: Response;
  try {
    r = await apiFetch(`/dispatch/${calloutId}/deployment/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sent_at: sentAtNow() }),
      authRedirect: false,
    });
  } catch {
    throw new SyncError("Связи нет — расстановка ждёт отправки", 0);
  }
  if (!r.ok) {
    throw new SyncError(await errorText(r, "Не удалось отправить расстановку"), r.status);
  }
  return r.json();
}

export async function addPosition(
  calloutId: number,
  body: PositionInput,
): Promise<DeploymentPosition[]> {
  const r = await apiFetch(`/dispatch/${calloutId}/deployment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, sent_at: sentAtNow() }),
  });
  if (!r.ok) throw new Error(await errorText(r, "Не удалось добавить позицию"));
  return r.json();
}

/* Перемещение, поворот и снятие позиции идут не отсюда, а через очередь
 * (`lib/deploymentQueue.ts`): на схеме эти жесты делают в поле, где связь
 * пропадает посреди работы. Поштучные PATCH/DELETE на сервере остаются —
 * ими пользуются интеграции и тесты, — но в интерфейсе путь записи один. */

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
  /** Непусто — список отдан офлайн-кэшем воркера; строка ISO — время снимка.
   *  Диспетчер по такому списку не увидит вызов, пришедший после снимка, и
   *  обязан знать, что смотрит на прошлое. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const reload = useCallback(() => {
    apiFetch(`/dispatch?status=${status}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("list");
        const stamp = cachedAtOf(r);
        return { data: (await r.json()) as Callout[], stamp };
      })
      .then(({ data, stamp }) => {
        setCallouts(data);
        setCachedAt(stamp);
        setError(null);
      })
      .catch(() => setError("Не удалось загрузить выезды. Проверьте связь."));
  }, [status]);

  useEffect(() => {
    setCallouts(null);
    setCachedAt(null);
    reload();
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs]);

  return { callouts, error, cachedAt, reload };
}

/** Боевой пакет for the selected callout, with a stale-response guard: if the
 *  selection moves on before a fetch resolves (fast clicks between rows,
 *  slow network), the outdated response is dropped instead of clobbering the
 *  pack of whatever is selected by the time it arrives. */
export function useCalloutPack(selectedId: number | null, pollMs?: number) {
  const [pack, setPackState] = useState<CalloutPackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Непусто — пакет отдан офлайн-кэшем; строка ISO — когда снят снимок. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // Tracks the id the in-flight (or most recent) request/seed was for — a
  // response only applies if it still matches this.
  const requestedRef = useRef<number | null>(null);

  const load = useCallback((id: number) => {
    requestedRef.current = id;
    setLoading(true);
    setError(null);
    apiFetch(`/dispatch/${id}/pack`)
      .then(async (r) => {
        if (!r.ok) throw new Error("pack");
        // Отметку снимка читаем до тела: пакет мог прийти из офлайн-кэша
        // (Service Worker), и распоряжаться силами по снимку часовой
        // давности, считая его живым, нельзя.
        const stamp = cachedAtOf(r);
        return { data: (await r.json()) as CalloutPackData, stamp };
      })
      .then(({ data, stamp }) => {
        if (requestedRef.current !== id) return; // stale — selection moved on
        setPackState(data);
        setCachedAt(stamp);
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
      setCachedAt(null);
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
    setCachedAt(null);
  }, []);

  // Стабильная ссылка обязательна: reload уходит в CalloutOps как onChanged,
  // и новая функция на каждый рендер пересоздавала бы там отправку очереди
  // расстановки, а эффект — переподписывался и слал её заново каждый рендер.
  const reload = useCallback(() => {
    if (selectedId != null) load(selectedId);
  }, [selectedId, load]);

  return {
    pack,
    loading,
    error,
    cachedAt,
    reload,
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

/** Значок пометки «досинхронизировано после закрытия» — один на схеме,
 *  в списке, в донесении и на пульте: цвет пометки не единственный сигнал,
 *  и разойтись по поверхностям она не должна. */
export const LATE_SYNC_ICON: LucideIcon = History;

/** Время досинхронизации после закрытия: ЧЧ:ММ, а если это уже другие сутки,
 *  чем закрытие выезда, — с датой («16.09 08:12»). Без даты «08:12» на
 *  следующий день читалось бы как время того же боевого дня. */
export function lateSyncStamp(
  iso: string | null | undefined,
  closedAt: string | null | undefined,
  locale: Locale = "ru",
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const clock = formatClock(iso, locale);
  const closed = closedAt ? new Date(closedAt) : null;
  if (!closed || Number.isNaN(closed.getTime()) || d.toDateString() === closed.toDateString()) {
    return clock;
  }
  const day = d.toLocaleDateString(intlLocale(locale), { day: "2-digit", month: "2-digit" });
  return `${day} ${clock}`;
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

/** Справочник техники частей.
 *
 *  `enabled` существует ради планшета РТП: там этот справочник нужен только в
 *  момент назначения наряда, а грузится он по всему городу. Тянуть его при
 *  каждом открытии боевого пакета — лишний трафик на мобильной сети в поле,
 *  где пакет и открывают. */
export function useVehicles(
  stationId?: number | null,
  pollMs?: number,
  enabled: boolean = true,
) {
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!enabled) return;
    const q = stationId != null ? `?station_id=${stationId}` : "";
    apiFetch(`/dispatch/vehicles${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("vehicles"))))
      .then((d: VehiclesResponse) => {
        setData(d);
        setError(null);
      })
      .catch(() => setError("Не удалось загрузить технику частей."));
  }, [stationId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [reload, pollMs, enabled]);

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
