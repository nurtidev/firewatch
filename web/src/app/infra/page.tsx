"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Flame,
  Droplets,
  AlertTriangle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { SEVERITY } from "@/lib/risk";
import { SectionLabel, Skeleton } from "@/components/ui";

const InfraMap = dynamic(() => import("@/components/InfraMap"), { ssr: false });

type Stats = {
  stations: number;
  hydrants: number;
  broken_hydrants: number;
  blind_zone_buildings: number;
  blind_pct: number;
  normative_min: number;
};

// Legend rows: label + swatch color (cssVar from SEVERITY where possible, else
// direct map color via inline style — this is the EXCEPTION in hard rule 1).
// Map colors from InfraMap:
//   stations   → #ff5a1f = var(--color-accent)
//   hydrants   → #3b82f6 ≈ var(--color-info)
//   broken     → #f59e0b ≈ var(--color-high)
//   coverage   → #22c55e ≈ var(--color-normal)
//   blind      → #ef4444 ≈ var(--color-critical)
const LEGEND_ITEMS = [
  {
    color: "var(--color-accent)",
    label: "Пожарные части",
    shape: "square" as const,
  },
  {
    color: "var(--color-info)",
    label: "Гидранты (исправные)",
    shape: "circle" as const,
  },
  {
    color: "var(--color-high)",
    label: "Гидранты (неисправные)",
    shape: "circle" as const,
  },
  {
    color: "var(--color-normal)",
    label: "Зона покрытия (≈10 мин)",
    shape: "fill" as const,
  },
  {
    color: "var(--color-critical)",
    label: "Слепые зоны (вне норматива)",
    shape: "circle" as const,
  },
] as const;

export default function InfraPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  useEffect(() => {
    apiFetch(`/infra/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  const loading = stats === null;

  return (
    <AppShell fullBleed>
      {/* ── Legend panel — top-left ─────────────────────────────────────── */}
      <div
        className="absolute left-4 top-4 z-10 w-60 rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur"
        role="complementary"
        aria-label="Легенда карты инфраструктуры"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">Инфраструктура</span>
          </div>
          <button
            onClick={() => setLegendCollapsed((c) => !c)}
            className="rounded p-1 text-faint hover:bg-surface-2 hover:text-muted"
            aria-label={legendCollapsed ? "Развернуть легенду" : "Свернуть легенду"}
          >
            {legendCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </div>

        {!legendCollapsed && (
          <div className="border-t border-border px-4 pb-3 pt-2.5">
            {/* Normative */}
            <p className="text-2xs text-faint">
              Норматив прибытия:{" "}
              <span className="tabular text-muted">
                {stats?.normative_min ?? 10} мин
              </span>
            </p>

            {/* Legend items */}
            <div
              className="mt-3 space-y-2"
              role="list"
              aria-label="Условные обозначения"
            >
              <SectionLabel className="mb-1.5">Обозначения</SectionLabel>
              {LEGEND_ITEMS.map(({ color, label, shape }) => (
                <div key={label} role="listitem" className="flex items-center gap-2.5">
                  <LegendSwatch color={color} shape={shape} />
                  <span className="text-xs text-muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Stat bar — bottom-left ────────────────────────────────────────── */}
      <div
        className="absolute bottom-4 left-4 z-10 rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur"
        role="region"
        aria-label="Статистика инфраструктуры"
      >
        <div className="flex divide-x divide-border">
          <InfraStat
            icon={Flame}
            value={stats?.stations}
            label="Пож. части"
            loading={loading}
          />
          <InfraStat
            icon={Droplets}
            value={stats?.hydrants}
            label="Гидрантов"
            loading={loading}
          />
          <InfraStat
            icon={AlertTriangle}
            value={stats?.broken_hydrants}
            label="Неисправных"
            loading={loading}
            severity="high"
          />
          <InfraStat
            icon={EyeOff}
            value={
              stats
                ? `${stats.blind_zone_buildings.toLocaleString("ru")} · ${stats.blind_pct}%`
                : undefined
            }
            label="В слепых зонах"
            loading={loading}
            severity="critical"
          />
        </div>
      </div>

      <InfraMap />
    </AppShell>
  );
}

/* ── Shared swatch helper ───────────────────────────────────────────────── */

function LegendSwatch({
  color,
  shape,
}: {
  color: string;
  shape: "circle" | "square" | "fill";
}) {
  if (shape === "fill") {
    // Translucent fill rect representing coverage zone
    return (
      <span
        className="h-3 w-5 shrink-0 rounded-sm border"
        style={{
          backgroundColor: color,
          borderColor: color,
          opacity: 0.45,
        }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={shape === "square" ? "h-3 w-3 shrink-0 rounded-sm" : "h-2.5 w-2.5 shrink-0 rounded-full"}
      style={{ background: color }}
      aria-hidden
    />
  );
}

/* ── Compact stat cell ─────────────────────────────────────────────────── */

function InfraStat({
  icon: Icon,
  value,
  label,
  loading,
  severity,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number | undefined;
  label: string;
  loading?: boolean;
  severity?: "high" | "critical";
}) {
  const colorClass =
    severity === "critical"
      ? "text-critical"
      : severity === "high"
        ? "text-high"
        : "text-fg";

  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 first:pl-4 last:pr-4">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${severity ? colorClass : "text-faint"}`} />
        <SectionLabel>{label}</SectionLabel>
      </div>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-16" />
      ) : (
        <div className={`tabular text-lg font-semibold leading-tight ${colorClass}`}>
          {value == null ? "—" : typeof value === "number" ? value.toLocaleString("ru") : value}
        </div>
      )}
    </div>
  );
}
