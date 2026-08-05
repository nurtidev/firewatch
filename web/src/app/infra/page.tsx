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
import { Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, useAuth } from "@/lib/auth";
import { SEVERITY } from "@/lib/risk";
import { useT, useLocale, intlLocale } from "@/lib/i18n";
import { SectionLabel, Skeleton, Button, StatusChip } from "@/components/ui";

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
  const t = useT();
  const { locale } = useLocale();
  const { user } = useAuth();
  // Право менять состояние гидранта сервер даёт боевым ролям и начальнику
  // отдела ГПК; leadership смотрит покрытие, но состоянием не распоряжается.
  // Список обязан совпадать с require_roles в api/app/routers/infra.py.
  const canMarkHydrant = user?.role === "supervisor" || user?.role === "admin";
  const [selected, setSelected] = useState<{ id: number; status: string } | null>(null);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  useEffect(() => {
    apiFetch(`/infra/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  const loading = stats === null;

  const markHydrant = async (status: "ok" | "broken") => {
    if (!selected) return;
    setMarking(true);
    setMarkError(null);
    try {
      const r = await apiFetch(`/infra/hydrants/${selected.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error();
      setSelected({ ...selected, status });
      // Счётчик неисправных в шапке обязан обновиться сразу: ради него
      // отметку и ставят.
      const s = await apiFetch("/infra/stats");
      if (s.ok) setStats(await s.json());
    } catch {
      setMarkError(t("Не удалось изменить состояние гидранта"));
    } finally {
      setMarking(false);
    }
  };

  return (
    <AppShell fullBleed>
      {/* ── Legend panel — top-left ─────────────────────────────────────── */}
      <div
        className="absolute left-4 top-4 z-10 w-60 rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur"
        role="complementary"
        aria-label={t("Легенда карты инфраструктуры")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">{t("Инфраструктура")}</span>
          </div>
          <button
            onClick={() => setLegendCollapsed((c) => !c)}
            className="rounded p-1 text-faint hover:bg-surface-2 hover:text-muted"
            aria-label={legendCollapsed ? t("Развернуть легенду") : t("Свернуть легенду")}
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
              {t("Норматив прибытия:")}{" "}
              <span className="tabular text-muted">
                {stats?.normative_min ?? 10} {t("мин")}
              </span>
            </p>

            {/* Legend items */}
            <div
              className="mt-3 space-y-2"
              role="list"
              aria-label={t("Условные обозначения")}
            >
              <SectionLabel className="mb-1.5">{t("Обозначения")}</SectionLabel>
              {LEGEND_ITEMS.map(({ color, label, shape }) => (
                <div key={label} role="listitem" className="flex items-center gap-2.5">
                  <LegendSwatch color={color} shape={shape} />
                  <span className="text-xs text-muted">{t(label)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Stat bar — bottom-left ────────────────────────────────────────── */}
      <div
        className="absolute bottom-4 left-4 right-4 z-10 rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur sm:right-auto"
        role="region"
        aria-label={t("Статистика инфраструктуры")}
      >
        <div className="grid grid-cols-2 divide-border sm:flex sm:divide-x">
          <InfraStat
            icon={Flame}
            value={stats?.stations}
            label={t("Пож. части")}
            loading={loading}
          />
          <InfraStat
            icon={Droplets}
            value={stats?.hydrants}
            label={t("Гидрантов")}
            loading={loading}
          />
          <InfraStat
            icon={AlertTriangle}
            value={stats?.broken_hydrants}
            label={t("Неисправных")}
            loading={loading}
            severity="high"
          />
          <InfraStat
            icon={EyeOff}
            value={
              stats
                ? `${stats.blind_zone_buildings.toLocaleString(intlLocale(locale))} · ${stats.blind_pct}%`
                : undefined
            }
            label={t("В слепых зонах")}
            loading={loading}
            severity="critical"
          />
        </div>
      </div>

      <InfraMap onSelectHydrant={canMarkHydrant ? setSelected : undefined} />
      {canMarkHydrant && selected && (
        <div className="border-t border-border bg-surface px-4 py-3">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <StatusChip
                severity={selected.status === "broken" ? SEVERITY.critical : SEVERITY.normal}
                label={t(selected.status === "broken" ? "Неисправен" : "Исправен")}
              />
              <span className="text-sm text-fg">
                {t("Гидрант")} <span className="tabular">#{selected.id}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {markError && <span className="text-xs text-critical">{markError}</span>}
              <Button
                size="sm"
                variant={selected.status === "broken" ? "success" : "danger"}
                onClick={() => markHydrant(selected.status === "broken" ? "ok" : "broken")}
                disabled={marking}
              >
                {marking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t(selected.status === "broken" ? "Отметить исправным" : "Отметить неисправным")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                {t("Закрыть")}
              </Button>
            </div>
          </div>
        </div>
      )}

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
  const { locale } = useLocale();
  const colorClass =
    severity === "critical"
      ? "text-critical"
      : severity === "high"
        ? "text-high"
        : "text-fg";

  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${severity ? colorClass : "text-faint"}`} />
        <SectionLabel>{label}</SectionLabel>
      </div>
      {loading ? (
        <Skeleton className="mt-1 h-6 w-16" />
      ) : (
        <div className={`tabular text-lg font-semibold leading-tight ${colorClass}`}>
          {value == null
            ? "—"
            : typeof value === "number"
              ? value.toLocaleString(intlLocale(locale))
              : value}
        </div>
      )}
    </div>
  );
}
