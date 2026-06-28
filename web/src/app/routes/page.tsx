"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MapPin,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Route,
  AlertOctagon,
  CalendarDays,
  User,
  Camera,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, useAuth } from "@/lib/auth";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
import {
  Card,
  PageHeader,
  SectionLabel,
  Button,
  Field,
  Select,
  Textarea,
  ProgressBar,
  Skeleton,
  EmptyState,
  ScoreBadge,
  StatusChip,
  Banner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  cacheRoute,
  cacheChecklist,
  readCachedRoute,
  readCachedChecklist,
  enqueueVisit,
  queueCount,
  flushQueue,
  fileToDataUrl,
  isOnline,
  MAX_PHOTO_BYTES,
  type VisitPayload,
} from "@/lib/offline";

/* ───────────────────────────── Types ───────────────────────────── */

type Inspector = { id: number; name: string; district: string };
type Stop = {
  order: number;
  time: string;
  building_id: number;
  address: string;
  type_label: string;
  year_built: number | null;
  score: number;
  last_inspected: string | null;
  note: string | null;
  status: "pending" | "done" | "violation";
  overdue?: boolean;
  overdue_label?: string;
};
type Route = {
  inspector: Inspector;
  date: string;
  district: string;
  stops: Stop[];
  done: number;
  total: number;
};
type ChecklistItem = { key: string; label: string; code?: string; group?: string };

/* ───────────────────────────── Status map ───────────────────────── */

const STOP_STATUS_SEVERITY = {
  pending: SEVERITY.info,
  done: SEVERITY.normal,
  violation: SEVERITY.critical,
} as const;

const STOP_STATUS_LABEL = {
  pending: "Не проверено",
  done: "Выполнено",
  violation: "Нарушение",
} as const;

/* ───────────────────────────── Page ────────────────────────────── */

export default function RoutesPage() {
  const { user } = useAuth();
  const isInspector = user?.role === "inspector";

  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [openStop, setOpenStop] = useState<number | null>(null);
  // Offline UX: whether the shown route came from cache, how many visits are
  // pending sync, and a transient "synced" flash after a successful flush.
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [justSynced, setJustSynced] = useState(false);

  const refreshPending = useCallback(() => {
    setPending(queueCount(selected ?? undefined));
  }, [selected]);

  useEffect(() => {
    apiFetch(`/routes/checklist`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("checklist"))))
      .then((data: ChecklistItem[]) => {
        setChecklist(data);
        cacheChecklist(data);
      })
      .catch(() => {
        // Offline / failed — fall back to the last cached checklist.
        const cached = readCachedChecklist<ChecklistItem[]>();
        if (cached) setChecklist(cached);
      });
  }, []);

  useEffect(() => {
    apiFetch(`/inspectors`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Inspector[]) => {
        setInspectors(list);
        const mine = list.find((i) => i.name === user?.name);
        setSelected((isInspector && mine ? mine : list[0])?.id ?? null);
      })
      .catch(() => {});
  }, [user, isInspector]);

  const loadRoute = useCallback(() => {
    if (selected == null) return;
    const inspectorId = selected;
    setRouteLoading(true);
    refreshPending();
    apiFetch(`/routes/today?inspector_id=${inspectorId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("route"))))
      .then((data: Route | null) => {
        setRoute(data);
        setOffline(false);
        if (data) cacheRoute(inspectorId, data);
        setRouteLoading(false);
      })
      .catch(() => {
        // Network failed — show the last cached route, if any, in offline mode.
        const cached = readCachedRoute<Route>(inspectorId);
        setRoute(cached);
        setOffline(Boolean(cached) || !isOnline());
        setRouteLoading(false);
      });
  }, [selected, refreshPending]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  // Sync queued visits on page load and whenever connectivity returns.
  useEffect(() => {
    if (selected == null) return;
    let cancelled = false;

    async function sync() {
      if (queueCount() === 0) return;
      const { synced } = await flushQueue();
      if (cancelled) return;
      refreshPending();
      if (synced > 0) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 3000);
        loadRoute(); // pull authoritative state after a successful flush
      }
    }

    void sync();
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [selected, loadRoute, refreshPending]);

  const progressSeverity =
    route && route.stops.some((s) => s.status === "violation")
      ? SEVERITY.critical
      : SEVERITY.normal;

  const formattedDate = route
    ? new Date(route.date).toLocaleDateString("ru", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={isInspector ? "Мой маршрут" : "План инспекций"}
          subtitle="Маршрут на день · приоритет по риску, сроку проверки и географии"
          actions={
            !isInspector && inspectors.length > 0 ? (
              <Field label="Инспектор">
                <Select
                  value={selected ?? ""}
                  onChange={(e) => setSelected(Number(e.target.value))}
                  className="min-w-[220px]"
                >
                  {inspectors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {i.district} р-н
                    </option>
                  ))}
                </Select>
              </Field>
            ) : undefined
          }
        />

        {/* Offline notice — shown route is from the local cache */}
        {offline && (
          <Banner tone="warning" className="mt-4">
            Офлайн-режим · показан сохранённый маршрут
          </Banner>
        )}

        {/* Loading state */}
        {routeLoading && (
          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
            <Skeleton className="h-3 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {/* No route */}
        {!routeLoading && !route && (
          <EmptyState
            className="mt-8"
            icon={Route}
            title="Маршрут не назначен"
            description="На сегодня маршрут для выбранного инспектора не сформирован. Попробуйте выбрать другого инспектора или обратитесь к диспетчеру."
          />
        )}

        {/* Route */}
        {!routeLoading && route && (
          <div className="mt-6 fw-fade-in">
            {/* Route meta card */}
            <Card className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-faint" aria-hidden />
                    <span className="text-sm capitalize text-fg">{formattedDate}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-faint" aria-hidden />
                    <span className="text-sm text-muted">{route.district} р-н</span>
                  </div>
                  {!isInspector && (
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-faint" aria-hidden />
                      <span className="text-sm text-muted">{route.inspector.name}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* Sync status — pending visits awaiting upload / fresh-sync flash */}
                  {pending > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-elevated/30 bg-elevated-bg px-2 py-0.5 text-xs font-medium text-elevated">
                      Не синхронизировано · {pending}
                    </span>
                  )}
                  {justSynced && pending === 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-normal/30 bg-normal-bg px-2 py-0.5 text-xs font-medium text-normal">
                      Синхронизировано
                    </span>
                  )}
                  <SectionLabel>Прогресс</SectionLabel>
                  <span className="tabular text-lg font-semibold text-fg">
                    <span style={{ color: progressSeverity.cssVar }}>{route.done}</span>
                    <span className="text-faint"> / {route.total}</span>
                  </span>
                </div>
              </div>

              <ProgressBar
                className="mt-3"
                value={route.done}
                max={route.total}
                severity={progressSeverity}
              />
            </Card>

            {/* Empty stops */}
            {route.stops.length === 0 && (
              <EmptyState
                className="mt-4"
                icon={ClipboardCheck}
                title="Нет объектов в маршруте"
                description="Список объектов для проверки пуст."
              />
            )}

            {/* Stops list */}
            {route.stops.length > 0 && (
              <ol className="mt-4 space-y-2" aria-label="Список объектов маршрута">
                {route.stops.map((s) => (
                  <StopRow
                    key={s.building_id}
                    stop={s}
                    checklist={checklist}
                    inspectorId={route.inspector.id}
                    canMark={isInspector}
                    open={openStop === s.building_id}
                    onToggle={() =>
                      setOpenStop(openStop === s.building_id ? null : s.building_id)
                    }
                    onSaved={() => {
                      setOpenStop(null);
                      loadRoute();
                    }}
                    onQueued={(status) => {
                      // Offline: mark the stop locally and bump the pending counter
                      // without touching the network.
                      setOpenStop(null);
                      setRoute((prev) =>
                        prev
                          ? {
                              ...prev,
                              done: prev.done + 1,
                              stops: prev.stops.map((st) =>
                                st.building_id === s.building_id
                                  ? { ...st, status }
                                  : st,
                              ),
                            }
                          : prev,
                      );
                      refreshPending();
                    }}
                  />
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ───────────────────────────── StopRow ─────────────────────────── */

function StopRow({
  stop,
  checklist,
  inspectorId,
  canMark,
  open,
  onToggle,
  onSaved,
  onQueued,
}: {
  stop: Stop;
  checklist: ChecklistItem[];
  inspectorId: number;
  canMark: boolean;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
  onQueued: (status: "done" | "violation") => void;
}) {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  // Photos already uploaded to the server (online path) and their evidence ids.
  const [photos, setPhotos] = useState<string[]>([]);
  // Photos captured while offline, held as data URLs until the queue flushes.
  const [offlinePhotos, setOfflinePhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoCount = photos.length + offlinePhotos.length;

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_PHOTO_BYTES) {
          setError("Фото больше 2 МБ — уменьшите размер перед добавлением.");
          continue;
        }
        // Offline: stash the photo locally; it uploads on reconnect.
        if (!isOnline()) {
          const dataUrl = await fileToDataUrl(file);
          setOfflinePhotos((p) => [...p, dataUrl]);
          continue;
        }
        try {
          const fd = new FormData();
          fd.append("file", file);
          const r = await apiFetch(`/routes/visit/photo`, { method: "POST", body: fd });
          if (!r.ok) throw new Error("upload failed");
          const d = await r.json();
          setPhotos((p) => [...p, d.id as string]);
        } catch {
          // Network died mid-session — fall back to offline storage.
          const dataUrl = await fileToDataUrl(file);
          setOfflinePhotos((p) => [...p, dataUrl]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки фото");
    } finally {
      setUploading(false);
    }
  }

  async function save(status: "done" | "violation") {
    setError(null);
    let violations: { code: string }[] | undefined;
    if (status === "violation") {
      // Unchecked checklist items become coded violations.
      violations = checklist
        .filter((c) => c.code && !marks[c.key])
        .map((c) => ({ code: c.code as string }));
      if (!violations.length) {
        setError(
          "Отметьте галочками пройденные пункты — непройденные станут нарушениями. Сейчас нарушений нет.",
        );
        return;
      }
      if (!photoCount) {
        setError("Приложите хотя бы одно фото-доказательство нарушения.");
        return;
      }
    }

    const payload: VisitPayload = {
      inspector_id: inspectorId,
      building_id: stop.building_id,
      status,
      checklist: marks,
      violations,
      note: note || null,
    };

    // Offline (or photos captured offline still pending upload): queue + mark.
    if (!isOnline() || offlinePhotos.length > 0) {
      const ok = enqueueVisit(payload, offlinePhotos, photos);
      if (!ok) {
        setError("Не удалось сохранить офлайн — переполнено хранилище устройства.");
        return;
      }
      onQueued(status);
      return;
    }

    setSaving(true);
    try {
      const r = await apiFetch(`/routes/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          evidence_photos: photos.length ? photos : undefined,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || "Не удалось сохранить визит");
      }
      onSaved();
    } catch {
      // POST failed (likely network) — queue it instead of losing the visit.
      // Already-uploaded photo ids ride along so evidence is preserved on flush.
      const ok = enqueueVisit(payload, offlinePhotos, photos);
      if (!ok) {
        setError("Не удалось сохранить — переполнено хранилище устройства.");
        return;
      }
      onQueued(status);
    } finally {
      setSaving(false);
    }
  }

  const scoreSev = scoreSeverity(stop.score);
  const hot = scoreSev.key === "critical";
  const isDone = stop.status !== "pending";
  const stopSeverity = STOP_STATUS_SEVERITY[stop.status];

  return (
    <li
      className={cn(
        "rounded-lg border transition-colors duration-[var(--dur-fast)]",
        isDone
          ? "border-border bg-surface/50"
          : hot
            ? "border-border bg-surface"
            : "border-border bg-surface",
      )}
      style={
        hot && !isDone
          ? { borderLeftWidth: "3px", borderLeftColor: scoreSev.cssVar }
          : undefined
      }
    >
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Order badge */}
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular",
            isDone
              ? cn(stopSeverity.bg, stopSeverity.text)
              : hot
                ? "bg-critical-bg text-critical"
                : "bg-surface-3 text-muted",
          )}
          aria-label={`Объект №${stop.order}`}
        >
          {isDone
            ? stop.status === "done"
              ? "✓"
              : "!"
            : stop.order}
        </span>

        {/* Address + meta */}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              isDone ? "text-muted" : "text-fg",
            )}
          >
            {stop.address}
          </p>
          <p className="mt-0.5 truncate text-xs text-faint">
            {[stop.type_label, stop.note].filter(Boolean).join(" · ")}
            {stop.last_inspected && (
              <span> · посл. {stop.last_inspected}</span>
            )}
            {stop.overdue && stop.overdue_label && (
              <span className="text-elevated"> · {stop.overdue_label}</span>
            )}
          </p>
        </div>

        {/* Score badge */}
        <ScoreBadge score={stop.score} severity={scoreSev} className="hidden sm:inline-flex" />

        {/* Status chip */}
        <StatusChip
          severity={stopSeverity}
          label={STOP_STATUS_LABEL[stop.status]}
          className="hidden md:inline-flex"
        />

        {/* Time */}
        <span className="w-11 shrink-0 text-right text-xs tabular text-faint">
          {stop.time}
        </span>

        {/* Toggle button */}
        {canMark && !isDone && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Свернуть форму" : "Отметить объект"}
          >
            {open ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Свернуть</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Отметить</span>
              </>
            )}
          </Button>
        )}

        {/* Completed — show status on mobile */}
        {isDone && (
          <StatusChip
            severity={stopSeverity}
            label={STOP_STATUS_LABEL[stop.status]}
            className="md:hidden"
          />
        )}
      </div>

      {/* Expanded form */}
      {canMark && open && (
        <div className="border-t border-border px-4 pb-4 pt-3 fw-fade-in">
          {checklist.length > 0 && (
            <>
              <SectionLabel className="mb-1">Чек-лист осмотра</SectionLabel>
              <p className="mb-2 text-2xs text-faint">
                Отметьте пройденные пункты. Непройденные при фиксации нарушения
                станут нарушениями с кодом нормы.
              </p>
              <div className="space-y-2">
                {checklist.map((c) => (
                  <label
                    key={c.key}
                    className="flex cursor-pointer items-center gap-2.5 text-sm text-fg"
                  >
                    <input
                      type="checkbox"
                      checked={!!marks[c.key]}
                      onChange={(e) =>
                        setMarks((m) => ({ ...m, [c.key]: e.target.checked }))
                      }
                      className="h-4 w-4 cursor-pointer rounded accent-[var(--color-accent)]"
                    />
                    <span className="flex-1">{c.label}</span>
                    {c.code && (
                      <span className="shrink-0 text-2xs tabular text-faint">{c.code}</span>
                    )}
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="mt-3">
            <Field label="Примечание">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Описание результатов осмотра или нарушения"
                rows={2}
              />
            </Field>
          </div>

          {/* Photo evidence — required for a violation (legal protocol attachment) */}
          <div className="mt-3">
            <SectionLabel className="mb-1.5">
              Фото-доказательства {photoCount > 0 && `· ${photoCount}`}
            </SectionLabel>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-xs text-fg hover:bg-surface-3">
              <Camera className="h-3.5 w-3.5" aria-hidden />
              {uploading ? "Загрузка…" : "Добавить фото"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void uploadPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {photoCount > 0 && (
              <span className="ml-2 text-2xs text-normal">
                ✓ приложено {photoCount}
                {offlinePhotos.length > 0 && " · будет загружено при связи"}
              </span>
            )}
          </div>

          {error && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-critical">
              <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="success"
              size="md"
              onClick={() => save("done")}
              disabled={saving || uploading}
              aria-label="Отметить как выполнено"
            >
              <ClipboardCheck className="h-4 w-4" />
              Выполнено
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => save("violation")}
              disabled={saving || uploading}
              aria-label="Зафиксировать нарушение"
            >
              <AlertOctagon className="h-4 w-4" />
              Зафиксировать нарушение
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
