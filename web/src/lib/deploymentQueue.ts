"use client";

/**
 * Оффлайн-очередь расстановки сил на поэтажном плане.
 *
 * На пожаре связь пропадает именно тогда, когда расстановка идёт активнее
 * всего: первые минуты, подвал, бетон, лифтовая шахта. Раньше схема честно
 * предупреждала «связи нет, расстановка не сохраняется» — и РТП должен был
 * запоминать позиции и ставить их заново. Здесь они копятся на устройстве и
 * уходят пачкой, когда связь появляется.
 *
 * ─── Почему не журнал операций ───────────────────────────────────────────
 *
 * Очередь визитов и донесений (`lib/offline.ts`) — это отправка формы: одно
 * действие, один POST, повтор при неудаче. Расстановка устроена иначе:
 * позицию ставят, потом двигают, потом поворачивают, потом снимают. Журнал
 * таких жестов пришлось бы переигрывать по порядку, и на первом же `move`
 * он упёрся бы в то, что у позиции, поставленной без связи, нет серверного
 * id — PATCH отправлять некуда.
 *
 * Поэтому здесь хранится не журнал, а **одно намерение на позицию**, и новая
 * операция схлопывается в него:
 *
 *   create + move/rotate → тот же create с итоговыми координатами
 *   create + delete      → запись выбрасывается, если постановка ни разу не
 *                          уходила на сервер; иначе — снятие по client_uid
 *   patch  + move/rotate → тот же patch, поля перезаписываются
 *   patch  + delete      → delete (накопленные правки поглощаются)
 *
 * ─── Адрес позиции на сервере ────────────────────────────────────────────
 *
 * Ключ позиции — `client_uid ?? "srv:<id>"`, и он же адрес. Позицию с плана
 * сервер находит по client_uid (правка и снятие), позицию с пульта — по id из
 * ключа. Серверный id позиции с плана поэтому не обязателен: ответ на
 * постановку мог потеряться, и снятие, ждущее этого id, висело бы вечно.
 * Сервер отвечает теми же ключами — отказ по правке находится в очереди.
 *
 * Повтор постановки идемпотентен и **обновляет** позицию (ON CONFLICT DO
 * UPDATE на сервере): очередь шлёт конечное состояние, и перемещение,
 * сделанное после потерянного ответа, не теряется.
 *
 * ─── Гонка «правка во время отправки» ────────────────────────────────────
 *
 * Пока батч в полёте, РТП продолжает работать. Поэтому у записи есть `rev` —
 * монотонный счётчик на каждую мутацию, — и после ответа сервера удаляется
 * только то, что не изменилось. Изменённое не выбрасывается: отправленный
 * `create`, который успели подвинуть, становится `patch`; снятый — `delete`
 * по client_uid.
 *
 * ─── Чья это очередь ─────────────────────────────────────────────────────
 *
 * Планшет в части общий. Очередь и список отвергнутого привязаны к учётной
 * записи, которая их набрала (`fw_user.username` — логин уникален и он же
 * субъект токена). Под другой учётной записью чужая очередь не показывается и
 * не отправляется: она лежит до возвращения владельца или до истечения срока.
 *
 * Отказ 401/403 — это отказ не расстановке, а тому, кто её отправляет, и
 * очередь в обоих случаях остаётся целой. 401 — токен истёк за
 * двенадцатичасовую смену без связи: очередь уйдёт после повторного входа.
 * 403 — у учётной записи нет прав на расстановку в этом выезде: повторный
 * вход и повтор отправки дадут тот же отказ, нужен диспетчер, и сама
 * отправка не повторяется. Окончательны только 404/409/422 для батча и
 * поимённые отказы сервера.
 *
 * Ключи: fw_deployment_queue:<username>, fw_deployment_rejected:<username>.
 */

import { authToken } from "./auth";
import { newClientId } from "./offline";
import {
  SyncError,
  syncDeployment,
  type DeploymentPosition,
  type DeploymentSyncBody,
  type PositionKind,
  type PositionPhase,
} from "./dispatch";

/* ───────────────────────────── Types ───────────────────────────── */

/** Поля позиции, которыми распоряжается схема расстановки. */
export type PositionDraft = {
  kind: PositionKind;
  phase: PositionPhase;
  floor: string | null;
  plan_x: number;
  plan_y: number;
  heading?: number | null;
  sector?: string | null;
  note?: string | null;
};

/** Изменяемые поля — то, что даёт перетаскивание и поворот. */
export type PositionFields = Partial<Omit<PositionDraft, "kind">>;

/** Какой была позиция в момент жеста — только чтобы назвать её в отказе. */
export type PositionLabel = {
  kind: PositionKind;
  floor: string | null;
  sector: string | null;
};

type PendingBase = {
  key: string;
  seq: number;
  rev: number;
  /** Вкладка, выдавшая `rev` (см. sameRevision). У записей до этого поля — нет. */
  tab?: string;
  at: number;
};

export type Pending =
  | (PendingBase & {
      op: "create";
      placedAt: string;
      draft: PositionDraft;
      /** Уходила на сервер хотя бы раз: принята она или нет, уже неизвестно. */
      attempted?: boolean;
    })
  | (PendingBase & {
      op: "patch";
      /** Серверный id, если известен; у позиции с плана адрес — client_uid. */
      id: number | null;
      fields: PositionFields;
      label?: PositionLabel;
    })
  | (PendingBase & { op: "delete"; id: number | null; label?: PositionLabel });

/** Позиция для отрисовки: серверная, локальная или серверная с неотправленной
 *  правкой — на схеме они выглядят одинаково по месту и по-разному по виду. */
export type PlanPosition = {
  /** Стабильный ключ: `client_uid ?? "srv:<id>"`. Переживает синхронизацию. */
  key: string;
  /** id на сервере; null — позиция ещё не доехала. */
  serverId: number | null;
  /** Ждёт отправки — целиком или правкой. */
  pending: boolean;
  kind: PositionKind;
  phase: PositionPhase;
  floor: string | null;
  plan_x: number | null;
  plan_y: number | null;
  heading: number | null;
  sector: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  vehicle_callsign: string | null;
  /** Когда поставили (часы устройства), если известно. */
  placed_at: string | null;
};

/** Отвергнутое сервером. Не удаляется само: РТП должен увидеть, что именно
 *  не записалось, и решить — поставить заново или внести в донесение.
 *  Подпись собирает интерфейс (с переводом), здесь — только факты. */
export type RejectedEntry = {
  key: string;
  reason: string;
  /** null — сервер отверг ключ, которого в отправке не было. */
  op: Pending["op"] | null;
  kind: PositionKind | null;
  /** Этаж или участок. */
  where: string | null;
  at: number;
};

export type FlushOutcome = {
  applied: number;
  rejected: number;
  /** Причина, по которой очередь осталась на устройстве (связи нет, 5xx). */
  retryReason?: string;
  /** Сервер не принял учётную запись (401) или её сменили: очередь цела
   *  и уйдёт после входа под той же учётной записью. */
  authRequired?: boolean;
  /** Сервер отказал в правах на расстановку в этом выезде (403). Очередь
   *  цела, но повтор получит тот же отказ: отправку не повторяют сами. */
  forbidden?: boolean;
  /** Расстановка, какой её видит сервер сразу после отправки. Нужна, чтобы
   *  принятая позиция не мигнула: локальная запись уже убрана, а свежий
   *  боевой пакет ещё едет. */
  positions?: DeploymentPosition[];
};

/* ───────────────────────────── Keys ───────────────────────────── */

const QUEUE_PREFIX = "fw_deployment_queue:";
const REJECTED_PREFIX = "fw_deployment_rejected:";
/** Хранилища до привязки к учётной записи. Чьи они — неизвестно, поэтому они
 *  не читаются и не отправляются никогда; уборка сносит их по сроку. */
const LEGACY_QUEUE_KEY = "fw_deployment_queue";
const LEGACY_REJECTED_KEY = "fw_deployment_rejected";

const SRV_PREFIX = "srv:";

/** Очередь старше этого — от выезда, который давно закончился (или от
 *  устройства, которое неделю не включали). Отправлять её в живой выезд
 *  вреднее, чем потерять. */
const QUEUE_TTL_MS = 48 * 60 * 60 * 1000;
/** Отвергнутое держим дольше очереди: по нему составляют донесение. */
const REJECTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Потолок батча — совпадает с SYNC_MAX_ITEMS на сервере. Остаток уходит
 *  следующей отправкой, а не теряется. */
const SYNC_MAX_ITEMS = 200;

/** Отказ всему батчу, который не пройдёт и в следующий раз: выезд не найден,
 *  закрыт, батч не прошёл проверку. Всё прочее — повтор. */
const TERMINAL_STATUSES = new Set([404, 409, 422]);

type QueueStore = Record<string, Record<string, Pending>>;
type RejectedStore = Record<string, RejectedEntry[]>;

/* ───────────────────────────── Safe storage ───────────────────────────── */

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Квота или запрет хранилища — падать нельзя: расстановка на экране
    // остаётся верной, просто не переживёт перезагрузку.
    return false;
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* хранилище недоступно — убирать нечего */
  }
}

/* ───────────────────────────── Владелец ───────────────────────────── */

/** Учётная запись, под которой сейчас работает устройство; null — вход не
 *  выполнен (или токен только что сброшен ответом 401). */
function currentOwner(): string | null {
  const user = read<{ username?: unknown }>("fw_user");
  return typeof user?.username === "string" && user.username ? user.username : null;
}

const queueKey = (owner: string) => `${QUEUE_PREFIX}${owner}`;
const rejectedKey = (owner: string) => `${REJECTED_PREFIX}${owner}`;

/* ───────────────────────────── Хранилище очереди ───────────────────────────── */

function pruneQueue(all: QueueStore | null): QueueStore {
  const cutoff = Date.now() - QUEUE_TTL_MS;
  const fresh: QueueStore = {};
  for (const [calloutId, entries] of Object.entries(all ?? {})) {
    const kept: Record<string, Pending> = {};
    for (const [key, entry] of Object.entries(entries ?? {})) {
      if (entry && typeof entry.at === "number" && entry.at >= cutoff) kept[key] = entry;
    }
    if (Object.keys(kept).length) fresh[calloutId] = kept;
  }
  return fresh;
}

function pruneRejected(all: RejectedStore | null): RejectedStore {
  const cutoff = Date.now() - REJECTED_TTL_MS;
  const fresh: RejectedStore = {};
  for (const [cid, list] of Object.entries(all ?? {})) {
    const kept = (Array.isArray(list) ? list : []).filter(
      (r) => r && typeof r.at === "number" && r.at >= cutoff,
    );
    if (kept.length) fresh[cid] = kept;
  }
  return fresh;
}

/** Прочитать очередь владельца, попутно выбросив протухшие выезды. */
function readQueue(owner: string): QueueStore {
  return pruneQueue(read<QueueStore>(queueKey(owner)));
}

function writeQueue(owner: string, store: QueueStore): void {
  if (Object.keys(store).length) write(queueKey(owner), store);
  else remove(queueKey(owner));
}

function readRejected(owner: string): RejectedStore {
  return pruneRejected(read<RejectedStore>(rejectedKey(owner)));
}

function writeRejected(owner: string, store: RejectedStore): void {
  if (Object.keys(store).length) write(rejectedKey(owner), store);
  else remove(rejectedKey(owner));
}

/**
 * Уборка чужих и ничьих очередей по сроку — раз за загрузку страницы.
 * Очередь другой учётной записи читается только её владельцем, и без уборки
 * очередь РТП, который больше не вошёл на этом планшете, лежала бы вечно.
 */
let swept = false;
function sweepExpired(): void {
  if (swept || typeof window === "undefined") return;
  swept = true;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys) {
      if (k === LEGACY_QUEUE_KEY || k.startsWith(QUEUE_PREFIX)) {
        const fresh = pruneQueue(read<QueueStore>(k));
        if (Object.keys(fresh).length) write(k, fresh);
        else remove(k);
      } else if (k === LEGACY_REJECTED_KEY || k.startsWith(REJECTED_PREFIX)) {
        const fresh = pruneRejected(read<RejectedStore>(k));
        if (Object.keys(fresh).length) write(k, fresh);
        else remove(k);
      }
    }
  } catch {
    /* хранилище недоступно — убирать нечего */
  }
}

/* ───────────────────────────── Мутации очереди ───────────────────────────── */

/**
 * Монотонный счётчик владельца: порядок постановки (`seq`) и версия записи
 * (`rev`) берутся из него. Версия обязана расти при любой смене операции:
 * снятие, выданное с `rev: 1` поверх отправленной постановки с `rev: 1`,
 * совпало бы с ней и было бы выброшено ответом на ту отправку как
 * «подтверждённое».
 *
 * Максимум перечитывается из хранилища на **каждом** шаге, а не один раз:
 * очередь общая для всех вкладок владельца. Счётчик, прочитанный при первой
 * мутации и дальше живущий в памяти, во второй вкладке выдавал версию, равную
 * версии записи, которая сейчас в полёте у первой, — и ответ на ту отправку
 * удалял правку второй вкладки как подтверждённую. Выданный максимум ещё и
 * записывается отдельным ключом: снятая из очереди запись (dropQueue) не
 * должна освобождать свой номер для повторной выдачи.
 *
 * localStorage не даёт взаимоисключения между вкладками, и две вкладки в одну
 * миллисекунду всё же могут прочитать один максимум. Поэтому версия
 * сравнивается вместе с вкладкой, которая её выдала (`tab`, см. sameRevision).
 */
const counters = new Map<string, number>();
const REV_PREFIX = "fw_deployment_rev:";
const revKey = (owner: string) => `${REV_PREFIX}${owner}`;
function tick(owner: string): number {
  let n = Math.max(counters.get(owner) ?? 0, Number(read<number>(revKey(owner))) || 0);
  for (const entries of Object.values(readQueue(owner))) {
    for (const entry of Object.values(entries)) {
      n = Math.max(n, entry.seq ?? 0, entry.rev ?? 0);
    }
  }
  n += 1;
  counters.set(owner, n);
  write(revKey(owner), n);
  return n;
}

/** Вкладка, в которой выполняется этот модуль. Ставится на каждую мутацию
 *  рядом с `rev`: одинаковый номер из двух вкладок — всё равно разные версии. */
const TAB_ID = newClientId();

/** Запись не менялась с момента отправки — ни здесь, ни в другой вкладке. */
function sameRevision(cur: Pending | undefined, sent: Pending): boolean {
  return cur != null && cur.rev === sent.rev && cur.tab === sent.tab;
}

/** Отправленные и ещё не подтверждённые ключи: `owner|callout → key → rev`.
 *  Живёт только в памяти — после перезагрузки страницы в полёте ничего нет. */
const inflight = new Map<string, Map<string, number>>();
const flightKey = (owner: string, calloutId: number) => `${owner}|${calloutId}`;

function mutate(
  owner: string,
  calloutId: number,
  fn: (entries: Record<string, Pending>) => void,
): void {
  const store = readQueue(owner);
  const cid = String(calloutId);
  const entries = { ...(store[cid] ?? {}) };
  fn(entries);
  if (Object.keys(entries).length) store[cid] = entries;
  else delete store[cid];
  writeQueue(owner, store);
}

function pendingOf(owner: string, calloutId: number): Pending[] {
  const entries = readQueue(owner)[String(calloutId)] ?? {};
  return Object.values(entries).sort((a, b) => a.seq - b.seq);
}

/** Список неотправленного по выезду, в порядке постановки — только своё. */
export function pendingFor(calloutId: number): Pending[] {
  sweepExpired();
  const owner = currentOwner();
  return owner ? pendingOf(owner, calloutId) : [];
}

export function pendingCount(calloutId: number): number {
  return pendingFor(calloutId).length;
}

/** id из ключа позиции с пульта; null — ключ позиции с плана (client_uid). */
function serverIdOfKey(key: string): number | null {
  if (!key.startsWith(SRV_PREFIX)) return null;
  const n = Number(key.slice(SRV_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

const uidOfKey = (key: string): string | null => (key.startsWith(SRV_PREFIX) ? null : key);

/** Поставить позицию. Возвращает ключ, по которому её потом двигают. */
export function queueCreate(calloutId: number, draft: PositionDraft): string {
  const key = newClientId();
  const owner = currentOwner();
  if (!owner) return key;
  mutate(owner, calloutId, (entries) => {
    const n = tick(owner);
    entries[key] = {
      op: "create",
      key,
      seq: n,
      rev: n,
      tab: TAB_ID,
      at: Date.now(),
      placedAt: new Date().toISOString(),
      draft,
    };
  });
  return key;
}

/**
 * Подвинуть или повернуть позицию — схлопывая в уже накопленное намерение.
 * `serverId` берётся из отрисованной позиции: null у той, что ещё не уехала.
 */
export function queueUpdate(
  calloutId: number,
  key: string,
  serverId: number | null,
  fields: PositionFields,
  label?: PositionLabel,
): void {
  const owner = currentOwner();
  if (!owner || Object.keys(fields).length === 0) return;
  mutate(owner, calloutId, (entries) => {
    const prev = entries[key];
    const now = Date.now();
    if (prev?.op === "create") {
      entries[key] = {
        ...prev,
        rev: tick(owner),
        tab: TAB_ID,
        at: now,
        draft: { ...prev.draft, ...fields } as PositionDraft,
      };
      return;
    }
    if (prev?.op === "delete") return; // снятую позицию не двигают
    if (prev == null && serverId == null) return; // ни записи, ни позиции на сервере
    const id = serverId ?? serverIdOfKey(key) ?? (prev?.op === "patch" ? prev.id : null);
    entries[key] =
      prev?.op === "patch"
        ? {
            ...prev,
            id: prev.id ?? id,
            rev: tick(owner),
            tab: TAB_ID,
            at: now,
            fields: { ...prev.fields, ...fields },
            label: prev.label ?? label,
          }
        : {
            op: "patch",
            key,
            id,
            seq: tick(owner),
            rev: tick(owner),
            tab: TAB_ID,
            at: now,
            fields,
            label,
          };
  });
}

/** Снять позицию. Локальная, которую ещё ни разу не отправляли, просто исчезает. */
export function queueDelete(
  calloutId: number,
  key: string,
  serverId: number | null,
  label?: PositionLabel,
): void {
  const owner = currentOwner();
  if (!owner) return;
  mutate(owner, calloutId, (entries) => {
    const prev = entries[key];
    if (prev?.op === "create") {
      // Постановку, которая хоть раз уходила на сервер (в полёте сейчас или
      // ответ на неё потерялся), молча выбросить нельзя: сервер мог её
      // принять. Снятие по client_uid идемпотентно — лишнее безвредно,
      // пропущенное оставило бы ствол на сервере.
      const sent =
        prev.attempted || inflight.get(flightKey(owner, calloutId))?.has(key) === true;
      if (sent) {
        entries[key] = {
          op: "delete",
          key,
          id: null,
          seq: prev.seq,
          rev: tick(owner),
          tab: TAB_ID,
          at: Date.now(),
          label: { kind: prev.draft.kind, floor: prev.draft.floor, sector: prev.draft.sector ?? null },
        };
      } else {
        delete entries[key];
      }
      return;
    }
    if (serverId == null && prev == null) return;
    entries[key] = {
      op: "delete",
      key,
      id: serverId ?? serverIdOfKey(key) ?? (prev ? prev.id : null),
      seq: prev?.seq ?? tick(owner),
      rev: tick(owner),
      tab: TAB_ID,
      at: Date.now(),
      label: prev?.label ?? label,
    };
  });
}

/** Забыть очередь выезда целиком — например, когда он закрыт и всё отвергнуто. */
export function dropQueue(calloutId: number): void {
  const owner = currentOwner();
  if (!owner) return;
  const store = readQueue(owner);
  delete store[String(calloutId)];
  writeQueue(owner, store);
}

/* ───────────────────────────── Merge ───────────────────────────── */

function planFromServer(p: DeploymentPosition, key: string): PlanPosition {
  return {
    key,
    serverId: p.id,
    pending: false,
    kind: p.kind,
    phase: p.phase,
    floor: p.floor,
    plan_x: p.plan_x,
    plan_y: p.plan_y,
    heading: p.heading,
    sector: p.sector,
    note: p.note ?? null,
    lat: p.lat,
    lng: p.lng,
    vehicle_callsign: p.vehicle_callsign,
    placed_at: p.placed_at ?? p.created_at,
  };
}

function planFromDraft(entry: Extract<Pending, { op: "create" }>): PlanPosition {
  const d = entry.draft;
  return {
    key: entry.key,
    serverId: null,
    pending: true,
    kind: d.kind,
    phase: d.phase,
    floor: d.floor,
    plan_x: d.plan_x,
    plan_y: d.plan_y,
    heading: d.heading ?? null,
    sector: d.sector ?? null,
    note: d.note ?? null,
    lat: null,
    lng: null,
    vehicle_callsign: null,
    placed_at: entry.placedAt,
  };
}

/**
 * Что на самом деле стоит на плане: серверная расстановка плюс то, что ещё
 * не уехало. Единственный источник для отрисовки — иначе РТП без связи видел
 * бы «0 из 4 стволов», расставив четыре.
 */
export function mergePositions(
  server: DeploymentPosition[],
  pending: Pending[],
): PlanPosition[] {
  const byKey = new Map<string, PlanPosition>();
  for (const p of server) {
    const key = p.client_uid ?? `${SRV_PREFIX}${p.id}`;
    byKey.set(key, planFromServer(p, key));
  }
  for (const entry of pending) {
    if (entry.op === "create") {
      const cur = byKey.get(entry.key);
      // Сервер уже знает эту позицию (постановка доехала, ответ мог
      // потеряться), но у устройства более свежая точка: рисуем её, и не
      // вторым маркером, а поверх серверной.
      const draft = planFromDraft(entry);
      byKey.set(
        entry.key,
        cur
          ? {
              ...draft,
              serverId: cur.serverId,
              lat: cur.lat,
              lng: cur.lng,
              vehicle_callsign: cur.vehicle_callsign,
            }
          : draft,
      );
    } else if (entry.op === "patch") {
      const cur = byKey.get(entry.key);
      if (!cur) continue; // позицию сняли с пульта — правке некуда лечь
      byKey.set(entry.key, { ...cur, ...entry.fields, pending: true });
    } else {
      byKey.delete(entry.key);
    }
  }
  return [...byKey.values()];
}

/* ───────────────────────────── Отвергнутое ───────────────────────────── */

export function rejectedFor(calloutId: number): RejectedEntry[] {
  const owner = currentOwner();
  if (!owner) return [];
  return (readRejected(owner)[String(calloutId)] ?? []).filter(
    // Записи старого формата (до привязки к учётной записи) без `op` не
    // показываем: подписать их нечем.
    (r) => typeof r.reason === "string" && "op" in r,
  );
}

export function clearRejected(calloutId: number): void {
  const owner = currentOwner();
  if (!owner) return;
  const store = readRejected(owner);
  delete store[String(calloutId)];
  writeRejected(owner, store);
}

function pushRejected(owner: string, calloutId: number, entries: RejectedEntry[]): void {
  if (!entries.length) return;
  const store = readRejected(owner);
  const cid = String(calloutId);
  // Один ключ — одна запись: повторный отказ той же позиции заменяет прежний.
  const fresh = new Set(entries.map((e) => e.key));
  store[cid] = [...(store[cid] ?? []).filter((r) => !fresh.has(r.key)), ...entries];
  writeRejected(owner, store);
}

/** Факты об отвергнутой позиции для подписи в интерфейсе. */
function rejectedEntry(entry: Pending, reason: string): RejectedEntry {
  const base = { key: entry.key, reason, op: entry.op, at: Date.now() };
  if (entry.op === "create") {
    return {
      ...base,
      kind: entry.draft.kind,
      where: entry.draft.floor || entry.draft.sector || null,
    };
  }
  return {
    ...base,
    kind: entry.label?.kind ?? null,
    where: entry.label ? entry.label.floor || entry.label.sector || null : null,
  };
}

/* ───────────────────────────── Flush ───────────────────────────── */

/** Одна отправка на выезд за раз: возврат связи поднимает и событие `online`,
 *  и перерисовку — без этого один и тот же батч ушёл бы дважды. */
const inFlightFlush = new Map<string, Promise<FlushOutcome>>();

export function flushDeployment(calloutId: number): Promise<FlushOutcome> {
  sweepExpired();
  const owner = currentOwner();
  if (!owner) return Promise.resolve({ applied: 0, rejected: 0 });
  const fk = flightKey(owner, calloutId);
  const running = inFlightFlush.get(fk);
  if (running) return running;
  const started = runFlush(owner, calloutId).finally(() => {
    inFlightFlush.delete(fk);
    inflight.delete(fk);
  });
  inFlightFlush.set(fk, started);
  return started;
}

function buildBody(batch: Pending[]): DeploymentSyncBody {
  const body: DeploymentSyncBody = { creates: [], patches: [], deletes: [], delete_uids: [] };
  for (const e of batch) {
    if (e.op === "create") {
      body.creates.push({
        client_uid: e.key,
        placed_at: e.placedAt,
        kind: e.draft.kind,
        phase: e.draft.phase,
        floor: e.draft.floor,
        plan_x: e.draft.plan_x,
        plan_y: e.draft.plan_y,
        heading: e.draft.heading ?? null,
        sector: e.draft.sector ?? null,
        note: e.draft.note ?? null,
      });
      continue;
    }
    const uid = uidOfKey(e.key);
    const id = e.id ?? serverIdOfKey(e.key);
    if (e.op === "patch") {
      if (uid == null && id == null) continue;
      body.patches.push({
        ...e.fields,
        ...(id != null ? { id } : {}),
        ...(uid != null ? { client_uid: uid } : {}),
      });
    } else if (uid != null) {
      body.delete_uids.push(uid);
    } else if (id != null) {
      body.deletes.push(id);
    }
  }
  return body;
}

async function runFlush(owner: string, calloutId: number): Promise<FlushOutcome> {
  const fk = flightKey(owner, calloutId);
  const queue = pendingOf(owner, calloutId);
  if (!queue.length) return { applied: 0, rejected: 0 };

  // Очередь уходит только под учётной записью, которая её набрала: снятый с
  // плана ствол одного РТП, отправленный под токеном другого, записался бы в
  // журнал выезда чужим именем. Проверка стоит вплотную к отправке — между
  // ними нет ни одного await, и токен читается тем же синхронным шагом.
  if (currentOwner() !== owner || !authToken()) {
    return { applied: 0, rejected: 0, authRequired: true };
  }

  const batch = queue.slice(0, SYNC_MAX_ITEMS);
  const body = buildBody(batch);
  const total =
    body.creates.length + body.patches.length + body.deletes.length + body.delete_uids.length;
  if (total === 0) return { applied: 0, rejected: 0 };

  inflight.set(fk, new Map(batch.map((e) => [e.key, e.rev])));
  // Отметка «уходила на сервер» — до ответа: ответ может не прийти никогда, а
  // снимать такую позицию потом надо уже на сервере (см. queueDelete).
  if (batch.some((e) => e.op === "create" && !e.attempted)) {
    mutate(owner, calloutId, (entries) => {
      for (const e of batch) {
        const cur = entries[e.key];
        if (cur?.op === "create") entries[e.key] = { ...cur, attempted: true };
      }
    });
  }

  let result;
  try {
    result = await syncDeployment(calloutId, body);
  } catch (err) {
    const status = err instanceof SyncError ? err.status : 0;
    const reason = err instanceof Error ? err.message : "Не удалось отправить расстановку";
    if (status === 401) {
      // Токен истёк за долгую смену без связи. Отказ не про расстановку, а
      // про того, кто её отправляет: очередь остаётся целой и уйдёт после
      // повторного входа.
      return { applied: 0, rejected: 0, authRequired: true, retryReason: reason };
    }
    if (status === 403) {
      // Прав на расстановку в этом выезде у учётной записи нет. «Нужен
      // повторный вход» здесь неправда — тот же вход даст тот же отказ.
      // Очередь не выбрасывается: права выдаст диспетчер, и расстановка,
      // сделанная на пожаре, не должна пропасть из-за настройки ролей.
      return { applied: 0, rejected: 0, forbidden: true, retryReason: reason };
    }
    if (!TERMINAL_STATUSES.has(status)) return { applied: 0, rejected: 0, retryReason: reason };
    // Сервер отказал окончательно (выезд закрыли, пока связи не было):
    // отправленное уходит в отвергнутое — с именами позиций, чтобы РТП мог
    // перенести их в донесение. То, что успели изменить в полёте, остаётся:
    // следующая отправка получит свой ответ.
    pushRejected(owner, calloutId, batch.map((e) => rejectedEntry(e, reason)));
    mutate(owner, calloutId, (entries) => {
      for (const e of batch) {
        if (sameRevision(entries[e.key], e)) delete entries[e.key];
      }
    });
    return { applied: 0, rejected: batch.length };
  }

  const rejectedByKey = new Map(result.rejected.map((r) => [r.key, r.reason]));
  const appliedKeys = new Set(result.applied);
  const sentKeys = new Set(batch.map((e) => e.key));
  const serverIdByUid = new Map(
    result.positions.filter((p) => p.client_uid).map((p) => [p.client_uid as string, p.id]),
  );

  pushRejected(owner, calloutId, [
    ...batch
      .filter((e) => rejectedByKey.has(e.key))
      .map((e) => rejectedEntry(e, rejectedByKey.get(e.key) ?? "Позиция не принята")),
    // Отказ под ключом, которого в отправке не было, — рассинхрон схем ключей.
    // Молча выбросить его нельзя: ровно так правки и пропадали незаметно.
    ...result.rejected
      .filter((r) => !sentKeys.has(r.key))
      .map((r) => ({ key: r.key, reason: r.reason, op: null, kind: null, where: null, at: Date.now() })),
  ]);

  mutate(owner, calloutId, (entries) => {
    for (const sent of batch) {
      const cur = entries[sent.key];
      if (!cur) continue;
      // Отвергнутое убираем всегда: повтор дал бы тот же отказ.
      if (rejectedByKey.has(sent.key)) {
        delete entries[sent.key];
        continue;
      }
      // Сервер не упомянул ключ ни в принятом, ни в отвергнутом — не
      // считаем доставленным, повторим.
      if (!appliedKeys.has(sent.key)) continue;
      if (sameRevision(cur, sent)) {
        delete entries[sent.key];
        continue;
      }
      // Запись изменилась, пока батч был в полёте. Отправленное уже принято,
      // поэтому постановку нужно не выбросить и не повторить, а понизить до
      // правки позиции, которая теперь существует на сервере. Правка и снятие
      // уже адресованы (id или client_uid) и уйдут следующей отправкой как есть.
      if (cur.op === "create") {
        const { kind, ...fields } = cur.draft;
        entries[sent.key] = {
          op: "patch",
          key: sent.key,
          id: serverIdByUid.get(sent.key) ?? null,
          seq: cur.seq,
          rev: cur.rev,
          tab: cur.tab,
          at: cur.at,
          fields,
          label: { kind, floor: cur.draft.floor, sector: cur.draft.sector ?? null },
        };
      }
    }
  });

  return {
    applied: result.applied.length,
    rejected: result.rejected.length,
    positions: result.positions,
  };
}
