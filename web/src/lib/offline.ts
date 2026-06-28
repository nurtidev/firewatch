/**
 * Offline support for the field-inspector route page.
 *
 * Inspectors work in the field on phones with flaky 4G. This module gives the
 * route page three things, all backed by localStorage (no extra deps):
 *
 *   1. A read-through cache of the assigned route + checklist, so a dropped
 *      connection shows the last-known route instead of an empty state.
 *   2. A write-behind queue for visit submissions (POST /routes/visit). A visit
 *      that fails to POST is stored locally and replayed on reconnect, so an
 *      inspector never loses a completed check.
 *   3. Photo handling for offline violations: a captured photo is stored as a
 *      base64 data URL in the queue and uploaded on flush, before the visit.
 *
 * Keys:
 *   fw_route_<inspectorId>  — cached Route JSON
 *   fw_checklist            — cached ChecklistItem[] JSON
 *   fw_visit_queue          — QueuedVisit[] awaiting sync
 */

import { apiFetch } from "@/lib/auth";

/* ───────────────────────────── Types ───────────────────────────── */

/** Visit payload as POSTed to /routes/visit, minus the resolved photo ids. */
export type VisitPayload = {
  inspector_id: number;
  building_id: number;
  status: "done" | "violation";
  checklist: Record<string, boolean>;
  violations?: { code: string }[];
  note: string | null;
};

/** A visit queued while offline, with any photos captured but not yet uploaded. */
export type QueuedVisit = {
  /** Local id for dedupe/removal — not sent to the API. */
  localId: string;
  queuedAt: number;
  payload: VisitPayload;
  /** Base64 data URLs of evidence photos captured offline, uploaded on flush. */
  photos: string[];
  /** Photo ids already uploaded online before the visit POST failed. */
  uploadedPhotoIds?: string[];
};

/* ───────────────────────────── Keys ───────────────────────────── */

const ROUTE_KEY = (inspectorId: number) => `fw_route_${inspectorId}`;
const CHECKLIST_KEY = "fw_checklist";
const QUEUE_KEY = "fw_visit_queue";

/** Photos larger than this (decoded bytes) are rejected to keep storage sane. */
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

/* ───────────────────────────── Visit queue ───────────────────────────── */

export function readQueue(): QueuedVisit[] {
  return read<QueuedVisit[]>(QUEUE_KEY) ?? [];
}

/** Number of visits awaiting sync, optionally scoped to one inspector. */
export function queueCount(inspectorId?: number): number {
  const q = readQueue();
  return inspectorId == null
    ? q.length
    : q.filter((v) => v.payload.inspector_id === inspectorId).length;
}

/** Append a visit to the queue. Returns false if storage rejected the write. */
export function enqueueVisit(
  payload: VisitPayload,
  photos: string[],
  uploadedPhotoIds: string[] = [],
): boolean {
  const queue = readQueue();
  queue.push({
    localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: Date.now(),
    payload,
    photos,
    uploadedPhotoIds,
  });
  return write(QUEUE_KEY, queue);
}

function removeFromQueue(localId: string): void {
  write(
    QUEUE_KEY,
    readQueue().filter((v) => v.localId !== localId),
  );
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

/**
 * Replay every queued visit: upload its photos first, then POST the visit with
 * the returned photo ids as evidence. A visit stays queued if any step fails
 * (e.g. still offline), so a partial flush never loses data. Stops early once a
 * network error is hit to avoid hammering a dead connection.
 */
export async function flushQueue(): Promise<FlushResult> {
  let synced = 0;
  let failed = 0;

  for (const visit of readQueue()) {
    try {
      // 1. Upload any queued photos, collecting their server ids. Photos already
      //    uploaded online (before the visit POST failed) are reused as-is.
      const photoIds: string[] = [...(visit.uploadedPhotoIds ?? [])];
      for (let i = 0; i < visit.photos.length; i++) {
        const file = dataUrlToFile(visit.photos[i], `evidence-${visit.localId}-${i}.jpg`);
        const fd = new FormData();
        fd.append("file", file);
        const pr = await apiFetch(`/routes/visit/photo`, { method: "POST", body: fd });
        if (!pr.ok) throw new Error("photo upload failed");
        const pd = await pr.json();
        photoIds.push(pd.id as string);
      }

      // 2. POST the visit with the freshly uploaded evidence.
      const r = await apiFetch(`/routes/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...visit.payload,
          evidence_photos: photoIds.length ? photoIds : undefined,
        }),
      });
      if (!r.ok) throw new Error("visit POST failed");

      removeFromQueue(visit.localId);
      synced++;
    } catch {
      failed++;
      // Network looks down — stop so we don't churn through the rest offline.
      if (!isOnline()) break;
    }
  }

  return { synced, failed };
}
