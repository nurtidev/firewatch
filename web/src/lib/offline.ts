/**
 * Offline support for the field pages (/routes visits and /reports field
 * reports).
 *
 * Inspectors and duty crews work on phones with flaky 4G. This module gives
 * those pages everything they need, all backed by localStorage (no extra deps):
 *
 *   1. A read-through cache of the assigned route + checklist, so a dropped
 *      connection shows the last-known route instead of an empty state.
 *   2. A write-behind queue for visit submissions (POST /routes/visit) and for
 *      field reports (POST /reports). Anything that fails to POST is stored
 *      locally and replayed on reconnect, so field work is never lost.
 *   3. Photo handling: a captured photo is downscaled/re-encoded in the browser
 *      (real camera shots are 2–8 MB, the upload budget is 2 MB) and, when
 *      offline, stored as a base64 data URL in the queue, uploaded on flush.
 *   4. Per-object visit drafts: checklist marks are written to the device as
 *      they are made, so an interrupted inspection (a call, a mis-tap on
 *      "back", a dead battery) can be resumed instead of redone.
 *
 * Keys:
 *   fw_route_<inspectorId>  — cached Route JSON
 *   fw_checklist            — cached ChecklistItem[] JSON
 *   fw_visit_queue          — QueuedVisit[] awaiting sync
 *   fw_report_queue         — QueuedReport[] awaiting sync
 *   fw_visit_drafts         — in-progress checklist marks, keyed inspector:building
 */

import { apiFetch } from "@/lib/auth";

/* ───────────────────────────── Types ───────────────────────────── */

/** Explicit three-state checklist mark; an unset item is absent from the map. */
export type MarkValue = "pass" | "violation" | "na";

/** Visit payload as POSTed to /routes/visit, minus the resolved photo ids. */
export type VisitPayload = {
  inspector_id: number;
  building_id: number;
  status: "done" | "violation";
  checklist: Record<string, MarkValue>;
  violations?: { code: string; note?: string }[];
  note: string | null;
};

/** Field-report payload as POSTed to /reports, minus the resolved photo ids. */
export type ReportPayload = {
  category: string;
  description?: string;
  lat: number;
  lng: number;
  building_id?: number;
};

/** A submission queued while offline, with photos captured but not yet uploaded. */
export type QueuedItem<P> = {
  /** Local id for dedupe/removal — not sent to the API. */
  localId: string;
  queuedAt: number;
  payload: P;
  /** Base64 data URLs of evidence photos captured offline, uploaded on flush. */
  photos: string[];
  /** Photo ids already uploaded online before the submission POST failed. */
  uploadedPhotoIds?: string[];
};

export type QueuedVisit = QueuedItem<VisitPayload>;
export type QueuedReport = QueuedItem<ReportPayload>;

/* ───────────────────────────── Keys ───────────────────────────── */

const ROUTE_KEY = (inspectorId: number) => `fw_route_${inspectorId}`;
const CHECKLIST_KEY = "fw_checklist";
const MY_INSPECTOR_KEY = "fw_my_inspector";
const QUEUE_KEY = "fw_visit_queue";
const REPORT_QUEUE_KEY = "fw_report_queue";
const DRAFT_KEY = "fw_visit_drafts";

/** Upload budget per photo. Bigger shots are re-encoded down to fit (see
 *  `preparePhoto`) — the field never sees "reduce it yourself". */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

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
    // Quota exceeded or storage disabled — fail soft.
    return false;
  }
}

/* ───────────────────────────── Connectivity ───────────────────────────── */

/** Treat an undefined navigator (SSR) as online so we never block the happy path. */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/* ───────────────────────────── Route / checklist cache ───────────────────────────── */

export function cacheRoute(inspectorId: number, route: unknown): void {
  write(ROUTE_KEY(inspectorId), route);
}

export function readCachedRoute<T>(inspectorId: number): T | null {
  return read<T>(ROUTE_KEY(inspectorId));
}

export function cacheChecklist(checklist: unknown): void {
  write(CHECKLIST_KEY, checklist);
}

export function readCachedChecklist<T>(): T | null {
  return read<T>(CHECKLIST_KEY);
}

/** Own inspector id as resolved by the server on the last successful load.
 *  Only a cache/queue key — never sent as an identity claim. */
export function cacheMyInspectorId(id: number): void {
  write(MY_INSPECTOR_KEY, id);
}

export function readMyInspectorId(): number | null {
  return read<number>(MY_INSPECTOR_KEY);
}

/* ───────────────────────────── Queues ───────────────────────────── */

function readItems<P>(key: string): QueuedItem<P>[] {
  return read<QueuedItem<P>[]>(key) ?? [];
}

/** Id of one submission attempt — also the server-side idempotency key. */
export function newClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Append a submission to a queue. Returns false if storage rejected the write. */
function enqueueItem<P>(
  key: string,
  payload: P,
  photos: string[],
  uploadedPhotoIds: string[],
  localId: string = newClientId(),
): boolean {
  const queue = readItems<P>(key);
  queue.push({
    localId,
    queuedAt: Date.now(),
    payload,
    photos,
    uploadedPhotoIds,
  });
  return write(key, queue);
}

function removeFromQueue(key: string, localId: string): void {
  write(
    key,
    readItems(key).filter((v) => v.localId !== localId),
  );
}

/* ── Visits ── */

export function readQueue(): QueuedVisit[] {
  return readItems<VisitPayload>(QUEUE_KEY);
}

/** Number of visits awaiting sync, optionally scoped to one inspector. */
export function queueCount(inspectorId?: number): number {
  const q = readQueue();
  return inspectorId == null
    ? q.length
    : q.filter((v) => v.payload.inspector_id === inspectorId).length;
}

export function enqueueVisit(
  payload: VisitPayload,
  photos: string[],
  uploadedPhotoIds: string[] = [],
): boolean {
  return enqueueItem(QUEUE_KEY, payload, photos, uploadedPhotoIds);
}

/* ── Field reports ── */

export function readReportQueue(): QueuedReport[] {
  return readItems<ReportPayload>(REPORT_QUEUE_KEY);
}

/** Number of field reports awaiting sync. */
export function reportQueueCount(): number {
  return readReportQueue().length;
}

/** `clientId` — pass the id already used for a failed direct POST, so a replay
 *  is recognised by the server as the same attempt instead of a second report. */
export function enqueueReport(
  payload: ReportPayload,
  photos: string[],
  uploadedPhotoIds: string[] = [],
  clientId?: string,
): boolean {
  return enqueueItem(REPORT_QUEUE_KEY, payload, photos, uploadedPhotoIds, clientId);
}

/* ───────────────────────────── Photo helpers ───────────────────────────── */

/** Read a File as a base64 data URL (for queuing while offline). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

/* ── Client-side downscale ──
 *
 * The camera input (`capture="environment"`) hands us the phone's full-res
 * shot — 2–8 MB is normal, the upload budget is 2 MB. Rejecting it means the
 * inspector cannot attach evidence at all while standing in the yard, so we
 * re-encode instead: scale the long edge down and step JPEG quality until the
 * result fits. The ladder starts generous on purpose — an inspection photo has
 * to stay legible as evidence in court (a wall plate, a unit number, a blocked
 * exit), so we lose pixels before we lose quality, and never go below
 * PHOTO_MIN_EDGE.
 */

/** Long edge (px) a captured photo is scaled down to before upload. */
const PHOTO_MAX_EDGE = 2560;
/** Never scale below this long edge — evidence has to stay readable. */
const PHOTO_MIN_EDGE = 1600;
/** JPEG quality ladder; 0.82 already keeps small text on a plate readable. */
const PHOTO_QUALITY_STEPS = [0.82, 0.72, 0.62];

export type PreparedPhoto =
  | { ok: true; file: File; compressed: boolean }
  /** `unreadable` — not a decodable image; `too_large` — won't fit even at the
   *  smallest allowed size (a legitimately gigantic non-photo image). */
  | { ok: false; reason: "too_large" | "unreadable" };

/**
 * Decode a File into something drawable. `createImageBitmap` with
 * `imageOrientation: "from-image"` applies the EXIF rotation tag — without it a
 * portrait shot from a phone lands sideways in the canvas. The `<img>` fallback
 * is for engines without createImageBitmap options; there the browser applies
 * EXIF orientation itself (CSS `image-orientation: from-image` is the default).
 */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older engine or unsupported option — fall through to <img>.
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось декодировать изображение"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** `IMG_20260803.heic` → `IMG_20260803.jpg` (we always re-encode to JPEG). */
function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.jpg`;
}

/**
 * Make a captured photo fit MAX_PHOTO_BYTES. Files already within budget are
 * returned untouched (no needless quality loss); anything bigger is downscaled
 * and re-encoded to JPEG.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.size <= MAX_PHOTO_BYTES) return { ok: true, file, compressed: false };
  if (typeof document === "undefined" || !file.type.startsWith("image/")) {
    return { ok: false, reason: "too_large" };
  }

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeImage(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || !source.width || !source.height) {
    if ("close" in source) source.close();
    return { ok: false, reason: "unreadable" };
  }
  ctx.imageSmoothingQuality = "high";

  try {
    let edge = PHOTO_MAX_EDGE;
    // Bounded loop: the edge shrinks by 25% each pass and stops at the floor.
    for (let pass = 0; pass < 8; pass++) {
      const scale = Math.min(1, edge / Math.max(source.width, source.height));
      const w = Math.max(1, Math.round(source.width * scale));
      const h = Math.max(1, Math.round(source.height * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);

      for (const quality of PHOTO_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob && blob.size <= MAX_PHOTO_BYTES) {
          return {
            ok: true,
            compressed: true,
            file: new File([blob], jpegName(file.name), {
              type: "image/jpeg",
              lastModified: file.lastModified,
            }),
          };
        }
      }
      if (edge <= PHOTO_MIN_EDGE) break;
      edge = Math.max(PHOTO_MIN_EDGE, Math.round(edge * 0.75));
    }
    return { ok: false, reason: "too_large" };
  } finally {
    if ("close" in source) source.close();
  }
}

/** Convert a `data:` URL back into a File for multipart upload. */
function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, body] = dataUrl.split(",");
  const mimeMatch = /data:([^;]+)/.exec(head);
  const mime = mimeMatch?.[1] ?? "image/jpeg";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/* ───────────────────────────── Flush ───────────────────────────── */

export type FlushResult = { synced: number; failed: number };

/** One flush per queue at a time. Reconnecting fires both the `online` event
 *  and a re-render's sync pass; without this they would each read the same
 *  queue and submit it twice. */
const inFlight = new Map<string, Promise<FlushResult>>();

/**
 * Replay every queued submission: upload its photos first, then POST the
 * payload with the returned photo ids as evidence. An item stays queued if any
 * step fails (e.g. still offline), so a partial flush never loses data, and is
 * removed only after the POST is confirmed. Stops early once a network error is
 * hit to avoid hammering a dead connection.
 *
 * Delivery is at-least-once by design (a POST that commits but never answers is
 * retried), so the receiving endpoint has to be idempotent: visits upsert on
 * (inspector, building, date), reports carry `client_id` — the queue item's own
 * id — which the server rejects as a duplicate.
 */
function flushItems<P>(
  key: string,
  submit: (item: QueuedItem<P>, photoIds: string[]) => Promise<Response>,
): Promise<FlushResult> {
  const running = inFlight.get(key);
  if (running) return running;
  const started = runFlush(key, submit).finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

async function runFlush<P>(
  key: string,
  submit: (item: QueuedItem<P>, photoIds: string[]) => Promise<Response>,
): Promise<FlushResult> {
  let synced = 0;
  let failed = 0;

  for (const item of readItems<P>(key)) {
    try {
      // 1. Upload any queued photos, collecting their server ids. Photos already
      //    uploaded online (before the payload POST failed) are reused as-is.
      const photoIds: string[] = [...(item.uploadedPhotoIds ?? [])];
      for (let i = 0; i < item.photos.length; i++) {
        const file = dataUrlToFile(item.photos[i], `evidence-${item.localId}-${i}.jpg`);
        const fd = new FormData();
        fd.append("file", file);
        const pr = await apiFetch(`/routes/visit/photo`, { method: "POST", body: fd });
        if (!pr.ok) throw new Error("photo upload failed");
        const pd = await pr.json();
        photoIds.push(pd.id as string);
      }

      // 2. POST the payload with the freshly uploaded evidence.
      const r = await submit(item, photoIds);
      if (!r.ok) throw new Error("submit failed");

      removeFromQueue(key, item.localId);
      synced++;
    } catch {
      failed++;
      // Network looks down — stop so we don't churn through the rest offline.
      if (!isOnline()) break;
    }
  }

  return { synced, failed };
}

/** Replay queued inspection visits (POST /routes/visit). */
export function flushQueue(): Promise<FlushResult> {
  return flushItems<VisitPayload>(QUEUE_KEY, (item, photoIds) =>
    apiFetch(`/routes/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...item.payload,
        evidence_photos: photoIds.length ? photoIds : undefined,
      }),
    }),
  );
}

/** Replay queued field reports (POST /reports). */
export function flushReportQueue(): Promise<FlushResult> {
  return flushItems<ReportPayload>(REPORT_QUEUE_KEY, (item, photoIds) =>
    apiFetch(`/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item.payload, photos: photoIds, client_id: item.localId }),
    }),
  );
}

/* ───────────────────────────── Visit drafts ───────────────────────────── */

/**
 * Checklist marks for one object, persisted as they are made.
 *
 * Photos are deliberately NOT part of a draft: a single 2 MB shot becomes
 * ~2.7 MB as a data URL and localStorage holds ~5 MB in total — draft photos
 * would crowd out the offline visit queue, which is the one thing that must
 * never fail to write. Drafts stay a few KB, and the close dialog says photos
 * have to be re-taken.
 */
export type VisitDraft = {
  inspectorId: number;
  buildingId: number;
  savedAt: number;
  marks: Record<string, MarkValue>;
  violationNotes: Record<string, string>;
  note: string;
};

/** Drafts older than this are pruned — a week-old inspection is redone, not resumed. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const draftId = (inspectorId: number, buildingId: number) => `${inspectorId}:${buildingId}`;

function readDrafts(): Record<string, VisitDraft> {
  const all = read<Record<string, VisitDraft>>(DRAFT_KEY) ?? {};
  const cutoff = Date.now() - DRAFT_TTL_MS;
  const fresh: Record<string, VisitDraft> = {};
  for (const [k, d] of Object.entries(all)) {
    if (d && typeof d.savedAt === "number" && d.savedAt >= cutoff) fresh[k] = d;
  }
  return fresh;
}

export function readDraft(inspectorId: number, buildingId: number): VisitDraft | null {
  return readDrafts()[draftId(inspectorId, buildingId)] ?? null;
}

/** Building ids with a saved draft, so the route list can flag them. */
export function draftBuildingIds(inspectorId: number): number[] {
  return Object.values(readDrafts())
    .filter((d) => d.inspectorId === inspectorId)
    .map((d) => d.buildingId);
}

export function saveDraft(draft: Omit<VisitDraft, "savedAt">): boolean {
  const drafts = readDrafts();
  drafts[draftId(draft.inspectorId, draft.buildingId)] = { ...draft, savedAt: Date.now() };
  return write(DRAFT_KEY, drafts);
}

export function clearDraft(inspectorId: number, buildingId: number): void {
  const drafts = readDrafts();
  delete drafts[draftId(inspectorId, buildingId)];
  write(DRAFT_KEY, drafts);
}
