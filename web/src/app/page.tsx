"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Flame,
  Droplets,
  ClipboardCheck,
  Users,
  ScanLine,
  FileWarning,
  Gauge,
  RefreshCw,
  ChevronRight,
  ServerCrash,
  Route,
  Activity,
  Map,
  Calculator,
  Sparkles,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, useAuth } from "@/lib/auth";
import { navForRole } from "@/lib/nav";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
import {
  Card,
  PageHeader,
  MetricCard,
  SectionLabel,
  Button,
  Skeleton,
  EmptyState,
  LiveIndicator,
  ProgressBar,
  StatusChip,
} from "@/components/ui";

type Overview = {
  buildings: number;
  high_risk: number;
  mid_risk: number;
  avg_score: number;
  stations: number;
  broken_hydrants: number;
  cards: number;
  prescriptions: number;
  inspectors: number;
};

type ProgressItem = {
  inspector: { id: number; name: string; district: string };
  total: number;
  done: number;
  violations: number;
};

const MODULE_META: Record<string, { desc: string; icon: LucideIcon }> = {
  "/routes": { desc: "Маршрут на день по приоритету риска и срока", icon: Route },
  "/control": { desc: "Выполнение маршрутов инспекторами в реальном времени", icon: Activity },
  "/map": { desc: "Каждое здание — оценка 0–100, фильтры, карточка с SHAP", icon: Map },
  "/cards": { desc: "Скан → извлечение полей → автопредписания", icon: ScanLine },
  "/infra": { desc: "Гидранты, части, зоны покрытия и слепые зоны", icon: Droplets },
  "/forces": { desc: "Стволы, машины, личный состав, ранг пожара", icon: Calculator },
  "/chat": { desc: "Запрос на естественном языке → ответ из данных ДЧС", icon: Sparkles },
};

export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [ov, setOv] = useState<Overview | null>(null);
  const [progress, setProgress] = useState<ProgressItem[] | null>(null);
  const [error, setError] = useState(false);
  const [updated, setUpdated] = useState<string>("");

  // Inspectors don't have a dashboard — send them to their route.
  useEffect(() => {
    if (ready && user?.role === "inspector") router.replace("/routes");
  }, [ready, user, router]);

  const load = useCallback(() => {
    setError(false);
    Promise.all([
      apiFetch(`/overview`).then((r) => (r.ok ? r.json() : Promise.reject())),
      apiFetch(`/routes/progress`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([o, p]) => {
        setOv(o);
        setProgress(p);
        setUpdated(new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }));
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loading = !ov && !error;
  const avgSev = ov ? scoreSeverity(ov.avg_score) : undefined;
  const lowRisk = ov ? Math.max(0, ov.buildings - ov.high_risk - ov.mid_risk) : 0;

  const opsTotal = progress?.reduce((a, p) => a + p.total, 0) ?? 0;
  const opsDone = progress?.reduce((a, p) => a + p.done, 0) ?? 0;
  const opsViol = progress?.reduce((a, p) => a + p.violations, 0) ?? 0;

  const modules = user
    ? navForRole(user.role).filter((n) => n.href !== "/" && MODULE_META[n.href])
    : [];

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title="Оперативная сводка · Астана"
          subtitle="Состояние пожарной безопасности города по данным ДЧС и модели риска"
          actions={
            <>
              <LiveIndicator updated={updated} className="hidden sm:inline-flex" />
              <Button variant="secondary" size="sm" onClick={load} aria-label="Обновить">
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Обновить</span>
              </Button>
            </>
          }
        />

        {error ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={ServerCrash}
            title="Сводка недоступна"
            description="Сервис данных ДЧС не отвечает. Проверьте подключение и обновите страницу."
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4" /> Повторить
              </Button>
            }
          />
        ) : (
          <>
            {/* Primary KPIs */}
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label="Средний риск города"
                value={ov?.avg_score ?? "—"}
                unit="/ 100"
                icon={Gauge}
                severity={avgSev}
                loading={loading}
                hint={avgSev && <StatusChip severity={avgSev} />}
              />
              <MetricCard
                label="Здания высокого риска"
                value={ov?.high_risk?.toLocaleString("ru") ?? "—"}
                icon={Flame}
                severity={SEVERITY.high}
                loading={loading}
                hint={ov && `${Math.round((100 * ov.high_risk) / Math.max(1, ov.buildings))}% от всех объектов`}
              />
              <MetricCard
                label="Неисправные гидранты"
                value={ov?.broken_hydrants ?? "—"}
                icon={Droplets}
                severity={SEVERITY.critical}
                loading={loading}
                hint="требуют ремонта"
              />
              <MetricCard
                label="Инспекции сегодня"
                value={loading ? "—" : `${opsDone}`}
                unit={loading ? undefined : `/ ${opsTotal}`}
                icon={ClipboardCheck}
                severity={opsViol > 0 ? SEVERITY.high : SEVERITY.normal}
                loading={loading}
                hint={
                  opsViol > 0
                    ? `${opsViol} нарушений зафиксировано`
                    : "нарушений не зафиксировано"
                }
              />
            </div>

            {/* Secondary strip */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat icon={Building2} value={ov?.buildings} label="зданий в базе" loading={loading} />
              <MiniStat icon={Users} value={ov?.inspectors} label="инспекторов" loading={loading} />
              <MiniStat icon={ScanLine} value={ov?.cards} label="карточек обработано" loading={loading} />
              <MiniStat icon={FileWarning} value={ov?.prescriptions} label="предписаний выдано" loading={loading} />
            </div>

            {/* Risk distribution + live ops */}
            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <SectionLabel>Распределение риска по городу</SectionLabel>
                  <span className="text-2xs text-faint">
                    {ov ? `${ov.buildings.toLocaleString("ru")} объектов` : ""}
                  </span>
                </div>
                {loading ? (
                  <Skeleton className="mt-4 h-3 w-full" />
                ) : ov ? (
                  <RiskDistribution
                    high={ov.high_risk}
                    mid={ov.mid_risk}
                    low={lowRisk}
                    total={ov.buildings}
                  />
                ) : null}
              </Card>

              <Card className="flex flex-col p-5">
                <div className="flex items-center justify-between">
                  <SectionLabel>Инспекции сегодня</SectionLabel>
                  <Link
                    href="/control"
                    className="inline-flex items-center gap-0.5 text-2xs text-muted hover:text-accent"
                  >
                    Контроль <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>

                {loading ? (
                  <div className="mt-4 space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                ) : !progress || progress.length === 0 ? (
                  <EmptyState
                    className="mt-4 border-0 bg-transparent py-6"
                    title="Нет активных маршрутов"
                    description="На сегодня инспекции не назначены."
                  />
                ) : (
                  <div className="mt-4 space-y-3">
                    {progress.slice(0, 5).map((p) => {
                      const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
                      return (
                        <div key={p.inspector.id}>
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="truncate text-fg">{p.inspector.name}</span>
                            <span className="shrink-0 tabular text-muted">
                              {p.done}/{p.total}
                              {p.violations > 0 && (
                                <span className="text-critical"> · {p.violations}!</span>
                              )}
                            </span>
                          </div>
                          <ProgressBar
                            className="mt-1.5"
                            value={p.done}
                            max={p.total}
                            severity={p.violations > 0 ? SEVERITY.high : SEVERITY.normal}
                          />
                          <span className="sr-only">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Modules */}
            <div className="mt-8">
              <SectionLabel>Модули платформы</SectionLabel>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {modules.map((n) => {
                  const meta = MODULE_META[n.href];
                  const Icon = meta.icon;
                  return (
                    <Link key={n.href} href={n.href} className="group">
                      <Card interactive className="flex h-full items-start gap-3.5 p-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted transition-colors group-hover:border-accent/40 group-hover:text-accent">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 text-sm font-medium text-fg">
                            {n.label}
                            <ChevronRight className="h-3.5 w-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                          </div>
                          <div className="mt-0.5 text-xs leading-relaxed text-muted">
                            {meta.desc}
                          </div>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function MiniStat({
  icon: Icon,
  value,
  label,
  loading,
}: {
  icon: LucideIcon;
  value: number | undefined;
  label: string;
  loading?: boolean;
}) {
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-faint">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        {loading ? (
          <Skeleton className="h-6 w-12" />
        ) : (
          <div className="text-lg font-semibold tabular leading-none text-fg">
            {value == null ? "—" : value.toLocaleString("ru")}
          </div>
        )}
        <div className="mt-1 text-2xs text-faint">{label}</div>
      </div>
    </Card>
  );
}

function RiskDistribution({
  high,
  mid,
  low,
  total,
}: {
  high: number;
  mid: number;
  low: number;
  total: number;
}) {
  const segs = [
    { sev: SEVERITY.high, label: "Высокий", band: "71–100", n: high },
    { sev: SEVERITY.elevated, label: "Средний", band: "36–70", n: mid },
    { sev: SEVERITY.normal, label: "Низкий", band: "0–35", n: low },
  ];
  const safeTotal = Math.max(1, total);
  return (
    <div className="mt-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
        {segs.map((s) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(100 * s.n) / safeTotal}%`, background: s.sev.cssVar }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {segs.map((s) => (
          <div key={s.label} className="rounded-md border border-border bg-surface-2/50 p-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.sev.cssVar }} />
              <span className="text-xs text-muted">{s.label}</span>
            </div>
            <div className="mt-1.5 text-lg font-semibold tabular leading-none text-fg">
              {s.n.toLocaleString("ru")}
            </div>
            <div className="mt-1 text-2xs text-faint">
              {Math.round((100 * s.n) / safeTotal)}% · {s.band}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
