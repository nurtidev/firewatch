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
} from "@/components/ui";
import { cn } from "@/lib/cn";

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
};
type Route = {
  inspector: Inspector;
  date: string;
  district: string;
  stops: Stop[];
  done: number;
  total: number;
};
type ChecklistItem = { key: string; label: string };

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

  useEffect(() => {
    apiFetch(`/routes/checklist`)
      .then((r) => r.json())
      .then(setChecklist)
      .catch(() => {});
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
    setRouteLoading(true);
    apiFetch(`/routes/today?inspector_id=${selected}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setRoute(data);
        setRouteLoading(false);
      })
      .catch(() => {
        setRoute(null);
        setRouteLoading(false);
      });
  }, [selected]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

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
}: {
  stop: Stop;
  checklist: ChecklistItem[];
  inspectorId: number;
  canMark: boolean;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(status: "done" | "violation") {
    setSaving(true);
    try {
      await apiFetch(`/routes/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspector_id: inspectorId,
          building_id: stop.building_id,
          status,
          checklist: marks,
          note: note || null,
        }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const hot = stop.score >= 85;
  const isDone = stop.status !== "pending";
  const stopSeverity = STOP_STATUS_SEVERITY[stop.status];
  const scoreSev = scoreSeverity(stop.score);

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
              <SectionLabel className="mb-2">Чек-лист осмотра</SectionLabel>
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
                    {c.label}
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

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="success"
              size="md"
              onClick={() => save("done")}
              disabled={saving}
              aria-label="Отметить как выполнено"
            >
              <ClipboardCheck className="h-4 w-4" />
              Выполнено
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={() => save("violation")}
              disabled={saving}
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
