"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MapPin,
  ChevronRight,
  ClipboardCheck,
  Route,
  AlertOctagon,
  CalendarDays,
  User,
  Camera,
  ArrowLeft,
  Check,
  X,
  Minus,
  CloudOff,
  RefreshCw,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, useAuth } from "@/lib/auth";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
import {
  Card,
  PageHeader,
  SectionLabel,
  Button,
  Field,
  Select,
  Input,
  Textarea,
  ProgressBar,
  Skeleton,
  EmptyState,
  ScoreBadge,
  StatusChip,
  Banner,
  Tabs,
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
/** Explicit three-state checklist mark; an unset item is simply absent from the map. */
type MarkValue = "pass" | "violation" | "na";

type Filter = "all" | "pending" | "done";

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
  const t = useT();
  const { locale } = useLocale();
  const { user } = useAuth();
  const isInspector = user?.role === "inspector";

  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [openStop, setOpenStop] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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

  const hasViolation = route?.stops.some((s) => s.status === "violation") ?? false;
  const progressSeverity = hasViolation ? SEVERITY.critical : SEVERITY.normal;

  const formattedDate = route
    ? new Date(route.date).toLocaleDateString(intlLocale(locale), {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  const pendingCount = route?.stops.filter((s) => s.status === "pending").length ?? 0;
  const doneCount = route ? route.total - pendingCount : 0;
  const visibleStops =
    route?.stops.filter((s) =>
      filter === "all"
        ? true
        : filter === "pending"
          ? s.status === "pending"
          : s.status !== "pending",
    ) ?? [];

  const activeStop =
    openStop != null ? route?.stops.find((s) => s.building_id === openStop) ?? null : null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-7 lg:p-8">
        <PageHeader
          title={isInspector ? t("Мой маршрут") : t("План инспекций")}
          subtitle={t("Маршрут на день · приоритет по риску, сроку проверки и географии")}
          actions={
            !isInspector && inspectors.length > 0 ? (
              <Field label={t("Инспектор")}>
                <Select
                  value={selected ?? ""}
                  onChange={(e) => setSelected(Number(e.target.value))}
                  className="min-w-[220px]"
                >
                  {inspectors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {i.district} {t("р-н")}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : undefined
          }
        />

        {/* Offline notice — shown route is from the local cache */}
        {offline && (
          <Banner tone="warning" icon={CloudOff} className="mt-4">
            {t(
              "Офлайн-режим · показан сохранённый маршрут. Отметки сохранятся на устройстве и отправятся при связи.",
            )}
          </Banner>
        )}

        {/* Loading state */}
        {routeLoading && (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full" />
            ))}
          </div>
        )}

        {/* No route */}
        {!routeLoading && !route && (
          <EmptyState
            className="mt-8"
            icon={Route}
            title={t("Маршрут не назначен")}
            description={t(
              "На сегодня маршрут для выбранного инспектора не сформирован. Попробуйте выбрать другого инспектора или обратитесь к диспетчеру.",
            )}
          />
        )}

        {/* Route */}
        {!routeLoading && route && (
          <div className="mt-4 fw-fade-in sm:mt-6">
            {/* Sticky progress header — always visible while scrolling the list */}
            <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:mb-4 sm:rounded-lg sm:border sm:bg-surface sm:px-4 sm:shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1.5 text-sm capitalize text-fg">
                    <CalendarDays className="h-4 w-4 text-faint" aria-hidden />
                    {formattedDate}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm text-muted">
                    <MapPin className="h-4 w-4 text-faint" aria-hidden />
                    {route.district} {t("р-н")}
                  </span>
                  {!isInspector && (
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                      <User className="h-4 w-4 text-faint" aria-hidden />
                      {route.inspector.name}
                    </span>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold tabular leading-none">
                    <span style={{ color: progressSeverity.cssVar }}>{route.done}</span>
                    <span className="text-faint"> / {route.total}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-faint">{t("проверено")}</div>
                </div>
              </div>
              <ProgressBar
                className="mt-2.5"
                value={route.done}
                max={route.total}
                severity={progressSeverity}
              />
              {/* Sync status */}
              {(pending > 0 || (justSynced && pending === 0)) && (
                <div className="mt-2 flex items-center gap-2 text-2xs">
                  {pending > 0 ? (
                    <span className="inline-flex items-center gap-1 font-medium text-elevated">
                      <CloudOff className="h-3.5 w-3.5" aria-hidden /> {t("Не отправлено")} · {pending}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-normal">
                      <Check className="h-3.5 w-3.5" aria-hidden /> {t("Синхронизировано")}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Empty stops */}
            {route.stops.length === 0 ? (
              <EmptyState
                className="mt-4"
                icon={ClipboardCheck}
                title={t("Нет объектов в маршруте")}
                description={t("Список объектов для проверки пуст.")}
              />
            ) : (
              <>
                {/* Filter */}
                <Tabs
                  className="mb-3"
                  active={filter}
                  onChange={(id) => setFilter(id as Filter)}
                  tabs={[
                    { id: "all", label: t("Все"), count: route.total },
                    { id: "pending", label: t("Осталось"), count: pendingCount },
                    { id: "done", label: t("Готово"), count: doneCount },
                  ]}
                />

                {/* Stops list */}
                {visibleStops.length === 0 ? (
                  <EmptyState
                    className="mt-4"
                    icon={filter === "done" ? ClipboardCheck : Check}
                    title={filter === "done" ? t("Пока ничего не проверено") : t("Всё проверено")}
                    description={
                      filter === "done"
                        ? t("Отмеченные объекты появятся здесь.")
                        : t("Все объекты маршрута отмечены. Отличная работа!")
                    }
                  />
                ) : (
                  <ol className="space-y-2.5" aria-label={t("Список объектов маршрута")}>
                    {visibleStops.map((s) => (
                      <StopCard
                        key={s.building_id}
                        stop={s}
                        canMark={isInspector}
                        onOpen={() => setOpenStop(s.building_id)}
                      />
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Full-screen object sheet — inspector marks the object here */}
      {isInspector && activeStop && activeStop.status === "pending" && route && (
        <ObjectSheet
          stop={activeStop}
          checklist={checklist}
          inspectorId={route.inspector.id}
          onClose={() => setOpenStop(null)}
          onSaved={() => {
            setOpenStop(null);
            loadRoute();
          }}
          onQueued={(status) => {
            // Offline: mark the stop locally and bump the pending counter
            // without touching the network.
            const bid = activeStop.building_id;
            setOpenStop(null);
            setRoute((prev) =>
              prev
                ? {
                    ...prev,
                    done: prev.done + 1,
                    stops: prev.stops.map((st) =>
                      st.building_id === bid ? { ...st, status } : st,
                    ),
                  }
                : prev,
            );
            refreshPending();
          }}
        />
      )}
    </AppShell>
  );
}

/* ───────────────────────────── StopCard ────────────────────────── */

function StopCard({
  stop,
  canMark,
  onOpen,
}: {
  stop: Stop;
  canMark: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const scoreSev = scoreSeverity(stop.score);
  const hot = scoreSev.key === "critical";
  const isDone = stop.status !== "pending";
  const stopSeverity = STOP_STATUS_SEVERITY[stop.status];
  const actionable = canMark && !isDone;

  const meta = [stop.type_label, stop.last_inspected && `${t("посл.")} ${stop.last_inspected}`]
    .filter(Boolean)
    .join(" · ");

  const inner = (
    <>
      {/* Order / status badge */}
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular",
          isDone
            ? cn(stopSeverity.bg, stopSeverity.text)
            : hot
              ? "bg-critical-bg text-critical"
              : "bg-surface-3 text-muted",
        )}
        aria-hidden
      >
        {isDone ? (stop.status === "done" ? <Check className="h-5 w-5" /> : "!") : stop.order}
      </span>

      {/* Address + meta */}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[15px] font-medium", isDone ? "text-muted" : "text-fg")}>
          {stop.address}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-faint">
          <span className="tabular text-muted">{stop.time}</span>
          {meta && <span className="truncate">· {meta}</span>}
          {stop.overdue && stop.overdue_label && (
            <span className="font-medium text-elevated">· {stop.overdue_label}</span>
          )}
        </p>
      </div>

      {/* Right rail — always-visible score + status */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <ScoreBadge score={stop.score} severity={scoreSev} />
        <StatusChip
          severity={stopSeverity}
          label={t(STOP_STATUS_LABEL[stop.status])}
          icon={false}
          className="px-1.5 py-0 text-2xs"
        />
      </div>

      {actionable && (
        <ChevronRight className="h-5 w-5 shrink-0 text-faint" aria-hidden />
      )}
    </>
  );

  const base =
    "flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors duration-[var(--dur-fast)]";
  const tone = isDone ? "border-border bg-surface/50" : "border-border bg-surface";
  const accent =
    hot && !isDone
      ? { borderLeftWidth: "3px", borderLeftColor: scoreSev.cssVar }
      : undefined;

  return (
    <li>
      {actionable ? (
        <button
          type="button"
          onClick={onOpen}
          style={accent}
          className={cn(base, tone, "min-h-[68px] hover:border-border-strong hover:bg-surface-2 active:bg-surface-3")}
          aria-label={`${t("Открыть объект:")} ${stop.address}`}
        >
          {inner}
        </button>
      ) : (
        <div style={accent} className={cn(base, tone, "min-h-[68px]")}>
          {inner}
        </div>
      )}
    </li>
  );
}

/* ───────────────────────────── ObjectSheet ─────────────────────── */

function ObjectSheet({
  stop,
  checklist,
  inspectorId,
  onClose,
  onSaved,
  onQueued,
}: {
  stop: Stop;
  checklist: ChecklistItem[];
  inspectorId: number;
  onClose: () => void;
  onSaved: () => void;
  onQueued: (status: "done" | "violation") => void;
}) {
  const t = useT();
  const [marks, setMarks] = useState<Record<string, MarkValue>>({});
  const [violationNotes, setViolationNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  // Photos already uploaded to the server (online path) and their evidence ids.
  const [photos, setPhotos] = useState<string[]>([]);
  // Photos captured while offline, held as data URLs until the queue flushes.
  const [offlinePhotos, setOfflinePhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoCount = photos.length + offlinePhotos.length;
  const scoreSev = scoreSeverity(stop.score);

  /** Set (or, on repeat click, unset) a checklist item's mark. */
  function setMark(key: string, value: MarkValue | null) {
    setMarks((m) => {
      const next = { ...m };
      if (value == null) delete next[key];
      else next[key] = value;
      return next;
    });
    // Stale violation notes shouldn't resurrect (or leak into the payload) once
    // the item is no longer marked as a violation.
    if (value !== "violation") {
      setViolationNotes((n) => {
        if (!(key in n)) return n;
        const next = { ...n };
        delete next[key];
        return next;
      });
    }
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_PHOTO_BYTES) {
          setError(t("Фото больше 2 МБ — уменьшите размер перед добавлением."));
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
      setError(e instanceof Error ? e.message : t("Ошибка загрузки фото"));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setError(null);
    const status: "done" | "violation" = hasViolation ? "violation" : "done";
    let violations: { code: string; note?: string }[] | undefined;
    if (status === "violation") {
      violations = checklist
        .filter((c) => marks[c.key] === "violation" && c.code)
        .map((c) => {
          const noteText = violationNotes[c.key]?.trim();
          return noteText ? { code: c.code as string, note: noteText } : { code: c.code as string };
        });
      if (!violations.length) {
        setError(t("У отмеченных нарушений нет кода нормы — уточните чек-лист."));
        return;
      }
      if (!photoCount) {
        setError(t("Приложите хотя бы одно фото-доказательство нарушения."));
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
        setError(t("Не удалось сохранить офлайн — переполнено хранилище устройства."));
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
        throw new Error(d.detail || t("Не удалось сохранить визит"));
      }
      onSaved();
    } catch {
      // POST failed (likely network) — queue it instead of losing the visit.
      // Already-uploaded photo ids ride along so evidence is preserved on flush.
      const ok = enqueueVisit(payload, offlinePhotos, photos);
      if (!ok) {
        setError(t("Не удалось сохранить — переполнено хранилище устройства."));
        return;
      }
      onQueued(status);
    } finally {
      setSaving(false);
    }
  }

  const markedCount = checklist.filter((c) => marks[c.key]).length;
  const allMarked = checklist.length === 0 || markedCount === checklist.length;
  const hasViolation = checklist.some((c) => marks[c.key] === "violation");
  const busy = saving || uploading;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg fw-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`${t("Осмотр объекта:")} ${stop.address}`}
    >
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="flex items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
            aria-label={t("Назад к маршруту")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-fg">{stop.address}</p>
            <p className="truncate text-xs text-faint">
              {[stop.type_label, stop.year_built && `${stop.year_built} ${t("г.")}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <ScoreBadge score={stop.score} severity={scoreSev} className="shrink-0" />
        </div>
      </header>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-5">
          {/* Checklist */}
          {checklist.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>{t("Чек-лист осмотра")}</SectionLabel>
                <span className="text-2xs tabular text-faint">
                  {markedCount} / {checklist.length} {t("отмечено")}
                </span>
              </div>
              <p className="mb-2.5 text-2xs leading-relaxed text-faint">
                {t("Отметьте каждый пункт: соответствует, нарушение или не применимо.")}
              </p>
              <div className="space-y-2">
                {checklist.map((c) => {
                  const value = marks[c.key];
                  return (
                    <div
                      key={c.key}
                      className={cn(
                        "rounded-lg border px-3.5 py-2.5 transition-colors",
                        value === "violation"
                          ? "border-critical/40 bg-critical-bg"
                          : "border-border bg-surface-2",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-fg">{c.label}</p>
                          {c.code && (
                            <p className="mt-0.5 text-2xs tabular text-faint">{c.code}</p>
                          )}
                        </div>
                        <ChecklistMarkControl
                          value={value}
                          onChange={(v) => setMark(c.key, v)}
                        />
                      </div>
                      {value === "violation" && (
                        <Input
                          value={violationNotes[c.key] ?? ""}
                          onChange={(e) =>
                            setViolationNotes((n) => ({ ...n, [c.key]: e.target.value }))
                          }
                          placeholder={t("Что именно нарушено — детали для предписания")}
                          className="mt-2.5 h-10"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Note */}
          <section>
            <Field label={t("Примечание")}>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("Описание результатов осмотра или нарушения")}
                rows={3}
              />
            </Field>
          </section>

          {/* Photo evidence */}
          <section>
            <SectionLabel className="mb-2">
              {t("Фото-доказательства")} {photoCount > 0 && `· ${photoCount}`}
            </SectionLabel>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2.5">
              {/* Offline photos — real thumbnails */}
              {offlinePhotos.map((url, i) => (
                <PhotoTile key={`off-${i}`} pending onRemove={() => setOfflinePhotos((p) => p.filter((_, j) => j !== i))}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${t("Фото")} ${i + 1}`} className="h-full w-full object-cover" />
                </PhotoTile>
              ))}
              {/* Server-uploaded photos — confirmed tile */}
              {photos.map((id, i) => (
                <PhotoTile key={`up-${id}`} onRemove={() => setPhotos((p) => p.filter((_, j) => j !== i))}>
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-normal-bg text-normal">
                    <Check className="h-5 w-5" />
                    <span className="text-2xs">{t("загружено")}</span>
                  </div>
                </PhotoTile>
              ))}
              {/* Add button */}
              <label
                className={cn(
                  "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-surface-2 text-faint hover:border-faint hover:text-muted",
                  uploading && "pointer-events-none opacity-60",
                )}
              >
                {uploading ? (
                  <RefreshCw className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Camera className="h-5 w-5" aria-hidden />
                )}
                <span className="text-2xs">{uploading ? t("Загрузка") : t("Добавить")}</span>
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
            </div>
            {offlinePhotos.length > 0 && (
              <p className="mt-2 text-2xs text-elevated">
                {t("Часть фото будет загружена при появлении связи.")}
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Sticky action bar */}
      <footer
        className="shrink-0 border-t border-border bg-surface px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto max-w-2xl">
          {error && (
            <p className="mb-2.5 flex items-start gap-1.5 text-xs text-critical" role="alert">
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <Button
            variant={hasViolation ? "danger" : "success"}
            size="xl"
            onClick={() => void save()}
            disabled={busy || !allMarked}
            className="w-full"
          >
            {hasViolation ? (
              <AlertOctagon className="h-5 w-5" />
            ) : (
              <ClipboardCheck className="h-5 w-5" />
            )}
            {allMarked
              ? t("Зафиксировать результат")
              : `${t("Отмечено")} ${markedCount} ${t("из")} ${checklist.length}`}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/* ─────────────────────── ChecklistMarkControl ──────────────────── */

/** Compact three-state segment control: pass / violation / not applicable. */
function ChecklistMarkControl({
  value,
  onChange,
}: {
  value: MarkValue | undefined;
  /** Clicking the already-active option unsets it (passes `null`). */
  onChange: (value: MarkValue | null) => void;
}) {
  const t = useT();
  const options: { value: MarkValue; label: string; icon: typeof Check; active: string }[] = [
    { value: "pass", label: "Соответствует", icon: Check, active: "border-normal/40 bg-normal-bg text-normal" },
    { value: "violation", label: "Нарушение", icon: X, active: "border-critical/40 bg-critical-bg text-critical" },
    { value: "na", label: "Не применимо", icon: Minus, active: "border-border-strong bg-surface-3 text-fg" },
  ];

  return (
    <div className="flex shrink-0 gap-1.5" role="group" aria-label={t("Отметка по пункту")}>
      {options.map(({ value: v, label, icon: Icon, active }) => {
        const isActive = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(isActive ? null : v)}
            aria-pressed={isActive}
            aria-label={t(label)}
            title={t(label)}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors duration-[var(--dur-fast)]",
              isActive
                ? active
                : "border-border bg-surface text-faint hover:border-border-strong hover:text-muted",
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
}

/* Photo thumbnail tile with a remove control. */
function PhotoTile({
  children,
  pending,
  onRemove,
}: {
  children: React.ReactNode;
  pending?: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border border-border">
      {children}
      {pending && (
        <span className="absolute bottom-1 left-1 rounded bg-bg/80 px-1 text-2xs text-elevated backdrop-blur">
          {t("ожидает")}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-bg/80 text-fg backdrop-blur hover:bg-critical hover:text-white"
        aria-label={t("Удалить фото")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
