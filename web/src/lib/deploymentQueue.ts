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
 *   create + delete      → запись выбрасывается, на сервер не идёт ничего
 *   patch  + move/rotate → тот же patch, поля перезаписываются
 *   patch  + delete      → delete (накопленные правки поглощаются)
 *
 * Из этого следует главное: **для позиции, поставленной без связи, PATCH не
 * существует как класс**. Проблема «drag отправлять некуда» не решается —
 * её просто нет.
 *
 * ─── Как локальная позиция становится серверной ──────────────────────────
 *
 * У каждой позиции есть `client_uid`, выданный устройством. Сервер хранит
 * его (миграция 0021, частичный уникальный индекс по выезду), поэтому:
 *
 *   • повтор доставки не создаёт второй ствол в той же точке;
 *   • после синхронизации своя позиция находится в ответе по своему же uid —
 *     без сопоставления по координатам, которое ломается, когда рядом стоят
 *     два одинаковых ствола.
 *
 * Ключ рендера — `client_uid ?? "srv:<id>"`, и он **не меняется** в момент
 * синхронизации: выделенный маркер не слетает, а следующее перетаскивание
 * само видит, что у позиции уже появился серверный id, и уходит как patch.
 *
 * ─── Гонка «правка во время отправки» ────────────────────────────────────
 *
 * Пока батч в полёте, РТП продолжает работать. Поэтому у записи есть `rev`,
 * и после ответа сервера удаляется только то, что не изменилось. Изменённое
 * не выбрасывается, а понижается: отправленный `create`, который успели
 * подвинуть, становится `patch` на полученный id; тот, который успели снять,
 * становится `delete` на него же. Иначе позиция или потеряла бы правку, или
 * осталась бы на сервере навсегда.
 *
 * Ключи: fw_deployment_queue, fw_deployment_rejected.
 */

import { newClientId } from "./offline";
import {
  SyncError,
  syncDeployment,
  POSITION_KIND_META,
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

type PendingBase = { key: string; seq: number; rev: number; at: number };

export type Pending =
  | (PendingBase & { op: "create"; placedAt: string; draft: PositionDraft })
  | (PendingBase & { op: "patch"; id: number; fields: PositionFields })
  /** `id: null` — позицию сняли, пока её постановка была в полёте: серверный
   *  id ещё не известен и подставится из ответа на ту отправку. */
  | (PendingBase & { op: "delete"; id: number | null });

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
 *  не записалось, и решить — поставить заново или внести в донесение. */
export type RejectedEntry = {
  key: string;
  reason: string;
  /** Человеческое имя позиции: «Ствол на тушение · 5 этаж». */
  label: string;
  at: number;
};

export type FlushOutcome = {
  applied: number;
  rejected: number;
  /** Причина, по которой очередь осталась на устройстве (связи нет, 5xx). */
  retryReason?: string;
  /** Расстановка, какой её видит сервер сразу после отправки. Нужна, чтобы
   *  принятая позиция не мигнула: локальная запись уже убрана, а свежий
   *  боевой пакет ещё едет. */
  positions?: DeploymentPosition[];
};

/* ───────────────────────────── Keys ───────────────────────────── */

const QUEUE_KEY = "fw_deployment_queue";
const REJECTED_KEY = "fw_deployment_rejected";

/** Очередь старше этого — от выезда, который давно закончился (или от
 *  устройства, которое неделю не включали). Отправлять её в живой выезд
 *  вреднее, чем потерять. */
const QUEUE_TTL_MS = 48 * 60 * 60 * 1000;
/** Отвергнутое держим дольше очереди: по нему составляют донесение. */
const REJECTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Потолок батча — совпадает с SYNC_MAX_ITEMS на сервере. Остаток уходит
 *  следующей отправкой, а не теряется. */
const SYNC_MAX_ITEMS = 200;

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

/** Прочитать очередь, попутно выбросив протухшие выезды. */
function readQueue(): QueueStore {
  const all = read<QueueStore>(QUEUE_KEY) ?? {};
  const cutoff = Date.now() - QUEUE_TTL_MS;
  const fresh: QueueStore = {};
  for (const [calloutId, entries] of Object.entries(all)) {
    const kept: Record<string, Pending> = {};
    for (const [key, entry] of Object.entries(entries ?? {})) {
      if (entry && typeof entry.at === "number" && entry.at >= cutoff) kept[key] = entry;
    }
    if (Object.keys(kept).length) fresh[calloutId] = kept;
  }
  return fresh;
}

function writeQueue(store: QueueStore): void {
  write(QUEUE_KEY, store);
}

/* ───────────────────────────── Мутации очереди ───────────────────────────── */

/** Порядковый номер операции. Только для стабильного порядка отправки —
 *  внутри батча позиции независимы, но воспроизводимость упрощает разбор.
 *  После перезагрузки продолжается с максимума в хранилище, иначе новые
 *  позиции встали бы в очереди перед пережившими перезагрузку. */
let seqCounter: number | null = null;
function nextSeq(): number {
  if (seqCounter == null) {
    seqCounter = 0;
    for (const entries of Object.values(readQueue())) {
      for (const entry of Object.values(entries)) {
        if (entry.seq > seqCounter) seqCounter = entry.seq;
      }
    }
  }
  return ++seqCounter;
}

/** Ключи, отправленные и ещё не подтверждённые: `calloutId → key → rev`.
 *  Живёт только в памяти — после перезагрузки страницы в полёте ничего нет. */
const inflight = new Map<string, Map<string, number>>();

function inflightRev(calloutId: number, key: string): number | undefined {
  return inflight.get(String(calloutId))?.get(key);
}

function mutate(calloutId: number, fn: (entries: Record<string, Pending>) => void): void {
  const store = readQueue();
  const cid = String(calloutId);
  const entries = { ...(store[cid] ?? {}) };
  fn(entries);
  if (Object.keys(entries).length) store[cid] = entries;
  else delete store[cid];
  writeQueue(store);
}

/** Список неотправленного по выезду, в порядке постановки. */
export function pendingFor(calloutId: number): Pending[] {
  const entries = readQueue()[String(calloutId)] ?? {};
  return Object.values(entries).sort((a, b) => a.seq - b.seq);
}

export function pendingCount(calloutId: number): number {
  return Object.keys(readQueue()[String(calloutId)] ?? {}).length;
}

/** Поставить позицию. Возвращает ключ, по которому её потом двигают. */
export function queueCreate(calloutId: number, draft: PositionDraft): string {
  const key = newClientId();
  mutate(calloutId, (entries) => {
    entries[key] = {
      op: "create",
      key,
      seq: nextSeq(),
      rev: 1,
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
): void {
  mutate(calloutId, (entries) => {
    const prev = entries[key];
    if (prev?.op === "create") {
      entries[key] = {
        ...prev,
        rev: prev.rev + 1,
        at: Date.now(),
        draft: { ...prev.draft, ...fields } as PositionDraft,
      };
      return;
    }
    if (prev?.op === "delete") return; // снятую позицию не двигают
    if (serverId == null) return; // ни записи, ни серверного id — двигать нечего
    entries[key] =
      prev?.op === "patch"
        ? { ...prev, rev: prev.rev + 1, at: Date.now(), fields: { ...prev.fields, ...fields } }
        : {
            op: "patch",
            key,
            id: serverId,
            seq: nextSeq(),
            rev: 1,
            at: Date.now(),
            fields,
          };
  });
}

/** Снять позицию. Локальная, которую ещё не отправляли, просто исчезает. */
export function queueDelete(calloutId: number, key: string, serverId: number | null): void {
  mutate(calloutId, (entries) => {
    const prev = entries[key];
    if (prev?.op === "create") {
      // Отправленную постановку отменить локально нельзя: сервер её уже
      // принимает. Оставляем снятие без id — он подставится из ответа.
      if (inflightRev(calloutId, key) != null) {
        entries[key] = { op: "delete", key, id: null, seq: nextSeq(), rev: 1, at: Date.now() };
      } else {
        delete entries[key];
      }
      return;
    }
    if (serverId == null && prev == null) return;
    entries[key] = {
      op: "delete",
      key,
      id: serverId ?? (prev && "id" in prev ? prev.id : null),
      seq: nextSeq(),
      rev: (prev?.rev ?? 0) + 1,
      at: Date.now(),
    };
  });
}

/** Забыть очередь выезда целиком — например, когда он закрыт и всё отвергнуто. */
export function dropQueue(calloutId: number): void {
  const store = readQueue();
  delete store[String(calloutId)];
  writeQueue(store);
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
    const key = p.client_uid ?? `srv:${p.id}`;
    byKey.set(key, planFromServer(p, key));
  }
  for (const entry of pending) {
    if (entry.op === "create") {
      // Сервер уже вернул эту позицию — постановка доехала, запись очереди
      // вот-вот исчезнет. Рисовать её вторым маркером нельзя.
      if (byKey.has(entry.key)) continue;
      byKey.set(entry.key, planFromDraft(entry));
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

function readRejected(): RejectedStore {
  const all = read<RejectedStore>(REJECTED_KEY) ?? {};
  const cutoff = Date.now() - REJECTED_TTL_MS;
  const fresh: RejectedStore = {};
  for (const [cid, list] of Object.entries(all)) {
    const kept = (list ?? []).filter((r) => r && typeof r.at === "number" && r.at >= cutoff);
    if (kept.length) fresh[cid] = kept;
  }
  return fresh;
}

export function rejectedFor(calloutId: number): RejectedEntry[] {
  return readRejected()[String(calloutId)] ?? [];
}

export function clearRejected(calloutId: number): void {
  const store = readRejected();
  delete store[String(calloutId)];
  write(REJECTED_KEY, store);
}

function pushRejected(calloutId: number, entries: RejectedEntry[]): void {
  if (!entries.length) return;
  const store = readRejected();
  const cid = String(calloutId);
  store[cid] = [...(store[cid] ?? []), ...entries];
  write(REJECTED_KEY, store);
}

/** Имя позиции для сообщения об отказе: тип и место, а не «операция #3». */
function labelOf(entry: Pending): string {
  if (entry.op === "create") {
    const kind = POSITION_KIND_META[entry.draft.kind]?.label ?? entry.draft.kind;
    // Названия этажей в карточках уже человеческие («5-й этаж», «Цокольный
    // этаж — 1-й уровень») — дописывать «этаж» значит получить его дважды.
    const where = entry.draft.floor || entry.draft.sector;
    return where ? `${kind} · ${where}` : kind;
  }
  return entry.op === "patch" ? "Перемещение позиции" : "Снятие позиции";
}

/* ───────────────────────────── Flush ───────────────────────────── */

/** Одна отправка на выезд за раз: возврат связи поднимает и событие `online`,
 *  и перерисовку — без этого один и тот же батч ушёл бы дважды. */
const inFlightFlush = new Map<string, Promise<FlushOutcome>>();

/** Отказ, который не пройдёт и в следующий раз: повторять его бессмысленно,
 *  и очередь надо показать человеку, а не крутить вечно. */
function isTerminal(status: number): boolean {
  if (status === 0) return false; // до сервера не дошло
  if (status === 408 || status === 429) return false; // таймаут и троттлинг — повторим
  return status >= 400 && status < 500;
}

export function flushDeployment(calloutId: number): Promise<FlushOutcome> {
  const cid = String(calloutId);
  const running = inFlightFlush.get(cid);
  if (running) return running;
  const started = runFlush(calloutId).finally(() => {
    inFlightFlush.delete(cid);
    inflight.delete(cid);
  });
  inFlightFlush.set(cid, started);
  return started;
}

async function runFlush(calloutId: number): Promise<FlushOutcome> {
  const cid = String(calloutId);
  const queue = pendingFor(calloutId);
  // Снятие позиции, чья постановка ещё в полёте, ждёт серверного id.
  const sendable = queue.filter((e) => !(e.op === "delete" && e.id == null));
  if (!sendable.length) return { applied: 0, rejected: 0 };

  const batch = sendable.slice(0, SYNC_MAX_ITEMS);
  const sentRevs = new Map(batch.map((e) => [e.key, e.rev]));
  inflight.set(cid, sentRevs);

  const body: DeploymentSyncBody = {
    creates: batch
      .filter((e): e is Extract<Pending, { op: "create" }> => e.op === "create")
      .map((e) => ({
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
      })),
    patches: batch
      .filter((e): e is Extract<Pending, { op: "patch" }> => e.op === "patch")
      .map((e) => ({ id: e.id, ...e.fields })),
    deletes: batch
      .filter((e): e is Extract<Pending, { op: "delete" }> => e.op === "delete")
      .map((e) => e.id)
      .filter((id): id is number => id != null),
  };

  let result;
  try {
    result = await syncDeployment(calloutId, body);
  } catch (err) {
    const status = err instanceof SyncError ? err.status : 0;
    const reason = err instanceof Error ? err.message : "Не удалось отправить расстановку";
    if (!isTerminal(status)) return { applied: 0, rejected: 0, retryReason: reason };
    // Сервер отказал окончательно (выезд закрыли, пока связи не было):
    // очередь уходит в отвергнутое целиком — с именами позиций, чтобы РТП
    // мог перенести их в донесение.
    pushRejected(
      calloutId,
      batch.map((e) => ({ key: e.key, reason, label: labelOf(e), at: Date.now() })),
    );
    mutate(calloutId, (entries) => {
      for (const e of batch) delete entries[e.key];
    });
    return { applied: 0, rejected: batch.length };
  }

  const rejectedKeys = new Map(result.rejected.map((r) => [r.key, r.reason]));
  const serverIdByUid = new Map(
    result.positions.filter((p) => p.client_uid).map((p) => [p.client_uid as string, p.id]),
  );

  pushRejected(
    calloutId,
    batch
      .filter((e) => rejectedKeys.has(e.key))
      .map((e) => ({
        key: e.key,
        reason: rejectedKeys.get(e.key) ?? "Позиция не принята",
        label: labelOf(e),
        at: Date.now(),
      })),
  );

  mutate(calloutId, (entries) => {
    for (const sent of batch) {
      const cur = entries[sent.key];
      if (!cur) continue;
      // Отвергнутое убираем всегда: повтор дал бы тот же отказ.
      if (rejectedKeys.has(sent.key)) {
        delete entries[sent.key];
        continue;
      }
      if (cur.rev === sent.rev) {
        delete entries[sent.key];
        continue;
      }
      // Запись изменилась, пока батч был в полёте. Отправленное уже принято,
      // поэтому её нужно не выбросить и не повторить, а понизить до правки
      // той позиции, которая теперь существует на сервере.
      const serverId = sent.op === "create" ? serverIdByUid.get(sent.key) : sent.id ?? undefined;
      if (serverId == null) continue; // id не пришёл — оставляем как есть, повторим
      if (cur.op === "create") {
        const { kind: _kind, ...fields } = cur.draft;
        entries[sent.key] = {
          op: "patch",
          key: sent.key,
          id: serverId,
          seq: cur.seq,
          rev: cur.rev,
          at: cur.at,
          fields,
        };
      } else if (cur.op === "delete" && cur.id == null) {
        entries[sent.key] = { ...cur, id: serverId };
      }
    }
  });

  return {
    applied: result.applied.length,
    rejected: result.rejected.length,
    positions: result.positions,
  };
}
