"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, AlertTriangle, Users, Activity } from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
import {
  Card,
  PageHeader,
  SectionLabel,
  MetricCard,
  Badge,
  ScoreBadge,
  ProgressBar,
  Skeleton,
  EmptyState,
  LiveIndicator,
} from "@/components/ui";
import { cn } from "@/lib/cn";

/* ───────────────────────────── Types ───────────────────────────── */

type Stop = {
  building_id: number;
  address: string;
  score: number;
  status: "pending" | "done" | "violation";
};
type Progress = {
  inspector: { id: number; name: string; district: string };
  total: number;
  done: number;
  violations: number;
  stops: Stop[];
};

/* ───────────────────────────── Status map ───────────────────────── */

const STOP_STATUS_LABEL: Record<string, string> = {
  pending: "Не проверено",
  done: "Выполнено",
  violation: "Нарушение",
};

function stopDotSeverity(status: string) {
  if (status === "violation") return SEVERITY.critical;
  if (status === "done") return SEVERITY.normal;
  return SEVERITY.info;
}

/* ───────────────────────────── Page ────────────────────────────── */

export default function ControlPage() {
  const [data, setData] = useState<Progress[] | null>(null);
  const [updated, setUpdated] = useState<string>("");

  const load = useCallback(() => {
    apiFetch(`/routes/progress`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Progress[]) => {
        setData(d);
        setUpdated(
          new Date().toLocaleTimeString("ru", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live refresh
    return () => clearInterval(t);
  }, [load]);

  const loading = data === null;
  const safeData = data ?? [];

  const totalDone = safeData.reduce((a, p) => a + p.done, 0);
  const totalAll = safeData.reduce((a, p) => a + p.total, 0);
  const totalViol = safeData.reduce((a, p) => a + p.violations, 0);
  const activeInspectors = safeData.length;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title="Контроль выполнения"
          subtitle="Маршруты инспекторов — статус в реальном времени"
          actions={
            <LiveIndicator updated={updated || undefined} />
          }
        />

        {/* Summary metric cards */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MetricCard
            label="Всего выполнено"
            value={loading ? "—" : totalDone}
            unit={loading ? undefined : `/ ${totalAll}`}
            icon={ClipboardCheck}
            severity={totalViol > 0 ? SEVERITY.high : SEVERITY.normal}
            loading={loading}
            hint={
              !loading
                ? totalAll > 0
                  ? `${Math.round((100 * totalDone) / totalAll)}% объектов проверено`
                  : "Нет объектов"
                : undefined
            }
          />
          <MetricCard
            label="Нарушений выявлено"
            value={loading ? "—" : totalViol}
            icon={AlertTriangle}
            severity={totalViol > 0 ? SEVERITY.critical : SEVERITY.normal}
            loading={loading}
            hint={
              !loading
                ? totalViol > 0
                  ? "требуют оформления предписания"
                  : "нарушений не зафиксировано"
                : undefined
            }
          />
          <MetricCard
            label="Инспекторов на маршруте"
            value={loading ? "—" : activeInspectors}
            icon={Users}
            severity={SEVERITY.info}
            loading={loading}
            hint={!loading ? "активных маршрутов сегодня" : undefined}
            className="col-span-2 lg:col-span-1"
          />
        </div>

        {/* Per-inspector grid */}
        <div className="mt-6">
          <SectionLabel className="mb-3">Маршруты инспекторов</SectionLabel>

          {/* Loading */}
          {loading && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-4">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-2 h-8 w-20" />
                  <Skeleton className="mt-3 h-1.5 w-full" />
                  <div className="mt-4 space-y-2">
                    {Array.from({ length: 4 }).map((__, j) => (
                      <Skeleton key={j} className="h-4 w-full" />
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Empty */}
          {!loading && safeData.length === 0 && (
            <EmptyState
              icon={Activity}
              title="Нет активных маршрутов"
              description="На сегодня маршруты инспекторов не сформированы или ещё не начаты."
            />
          )}

          {/* Inspector cards */}
          {!loading && safeData.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {safeData.map((p) => (
                <InspectorCard key={p.inspector.id} progress={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* ───────────────────────────── Inspector card ───────────────────── */

function InspectorCard({ progress: p }: { progress: Progress }) {
  const hasViol = p.violations > 0;
  const barSeverity = hasViol ? SEVERITY.high : SEVERITY.normal;
  const pct = p.total > 0 ? Math.round((100 * p.done) / p.total) : 0;

  return (
    <Card className="flex flex-col p-4 fw-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">
            {p.inspector.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Badge>{p.inspector.district} р-н</Badge>
            {hasViol && (
              <Badge
                className={cn(
                  "border-critical/40 bg-critical-bg text-critical",
                )}
              >
                {p.violations} наруш.
              </Badge>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-baseline gap-1 tabular">
            <span
              className="text-2xl font-semibold leading-none"
              style={{ color: barSeverity.cssVar }}
            >
              {p.done}
            </span>
            <span className="text-sm text-faint">/ {p.total}</span>
          </div>
          <div className="mt-0.5 text-2xs tabular text-muted">{pct}%</div>
        </div>
      </div>

      {/* Progress */}
      <ProgressBar className="mt-3" value={p.done} max={p.total} severity={barSeverity} />

      {/* Stops list */}
      {p.stops.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <SectionLabel className="mb-1.5">Объекты маршрута</SectionLabel>
          {p.stops.map((s) => {
            const dotSev = stopDotSeverity(s.status);
            const scoreSev = scoreSeverity(s.score);

            return (
              <div
                key={s.building_id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                  s.status === "violation" ? "bg-critical-bg" : "hover:bg-surface-2",
                )}
              >
                {/* Status dot */}
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotSev.dot)}
                  aria-label={STOP_STATUS_LABEL[s.status]}
                  title={STOP_STATUS_LABEL[s.status]}
                />

                {/* Address */}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    s.status === "violation"
                      ? "text-critical"
                      : s.status === "done"
                        ? "text-muted"
                        : "text-fg",
                  )}
                >
                  {s.address}
                </span>

                {/* Score badge */}
                <ScoreBadge score={s.score} severity={scoreSev} className="text-2xs" />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
