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
import DemoBanner from "@/components/DemoBanner";
import { apiFetch, useAuth } from "@/lib/auth";
import { intlLocale, useLocale, useT, type Locale } from "@/lib/i18n";
import { navForRole } from "@/lib/nav";
import { scoreBand, scoreSeverity, SEVERITY } from "@/lib/risk";
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

// Same four canonical bands as the map. `key` is literally the `risk=` value
// GET /buildings accepts (see api RISK_BANDS in routers/buildings.py) — the
// backend derives `min`/`max`/`count` from that same SQL, so a count here is
// guaranteed to match GET /buildings?risk=<key> for the same user. Label and
// color are read off lib/risk.ts (scoreBand/scoreSeverity) by `min`; never
// hardcode a competing threshold or range label here.
type RiskBand = {
  key: "critical" | "high" | "mid" | "low";
  min: number;
  max: number | null;
  count: number;
};

type Overview = {
  buildings: number;
  risk_bands: RiskBand[];
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

// Настоящая метка свежести риск-модели (GET /buildings/freshness) — не
// `new Date()` в момент рендера. Раньше «LIVE · обновлено HH:MM» показывал бы
// текущее время, даже если ежедневный пересчёт риска сломался неделю назад.
type Freshness = { computed_at: string | null };
// Телеметрия сервиса (GET /health) — существовала, но не была выведена ни на
// один экран; здесь превращается в предупреждение рядом с меткой свежести.
type Health = { status: string; db: boolean; ml: boolean; ml_model_loaded: boolean | null };

/** HH:MM, если метка сегодняшняя; иначе дата+время — стало видно, что бейдж
 *  показывает вчерашний (или более старый) пересчёт, а не текущее время. */
function formatComputedAt(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString(intlLocale(locale), {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const MODULE_META: Record<string, { desc: string; icon: LucideIcon }> = {
  "/routes": { desc: "Маршрут на день по приоритету риска и срока", icon: Route },
  "/control": { desc: "Выполнение маршрутов инспекторами в реальном времени", icon: Activity },
  "/map": { desc: "Каждое здание — оценка 0–100, фильтры, карточка с SHAP", icon: Map },
  "/cards": { desc: "Скан → извлечение полей → автопредписания", icon: ScanLine },
  "/infra": { desc: "Гидранты, части, зоны покрытия и слепые зоны", icon: Droplets },
  "/forces": { desc: "Стволы, машины, личный состав, ранг пожара", icon: Calculator },
  "/chat": { desc: "Запрос на естественном языке → ответ из данных ДЧС", icon: Sparkles },
};

export default function Dashboard() {
  const t = useT();
  const { locale } = useLocale();
  const { user, ready } = useAuth();
  const router = useRouter();
  const [ov, setOv] = useState<Overview | null>(null);
  const [progress, setProgress] = useState<ProgressItem[] | null>(null);
  const [error, setError] = useState(false);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

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
      // Реальная метка пересчёта риска и телеметрия сервиса — не критичны для
      // самой сводки, поэтому падают тихо (null), а не валят всю страницу.
      apiFetch(`/buildings/freshness`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      apiFetch(`/health`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([o, p, fr, h]) => {
        setOv(o);
        setProgress(p);
        setFreshness(fr);
        setHealth(h);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    // Inspectors get redirected to /routes above and have no /overview access —
    // fetching here would just flash a false "Сводка недоступна" (403) first.
    // Wait for auth to resolve so the role is known before deciding to fetch.
    if (!ready) return;
    if (user?.role === "inspector") return;
    load();
  }, [ready, user, load]);

  const loading = !ov && !error;
  const avgSev = ov ? scoreSeverity(ov.avg_score) : undefined;
  // Canonical "Высокий" band (score 40–59, exclusive of "Критический") — the
  // exact same number GET /buildings?risk=high returns for this user.
  const highRisk = ov?.risk_bands.find((b) => b.key === "high")?.count ?? 0;

  // Честный "обновлено": реальный MAX(risk_scores.computed_at), а не время
  // рендера страницы. Формат — при желании читай как локальное время; для
  // локали используется тот же intlLocale, что и остальные числа страницы.
  const updatedLabel = freshness?.computed_at
    ? formatComputedAt(freshness.computed_at, locale)
    : undefined;
  // Предупреждение рядом с меткой — та самая телеметрия из /health, которая
  // раньше не была выведена ни на один экран. Молчит, пока всё в порядке.
  const staleWarning = health && health.status !== "ok"
    ? { severity: SEVERITY.critical, label: t("Нет связи с базой данных") }
    : health && health.ml === false
      ? { severity: SEVERITY.high, label: t("Модель риска недоступна") }
      : freshness && !freshness.computed_at
        ? { severity: SEVERITY.high, label: t("Риск ни разу не рассчитывался") }
        : freshness?.computed_at &&
            Date.now() - new Date(freshness.computed_at).getTime() > 48 * 3_600_000
          ? { severity: SEVERITY.critical, label: t("Пересчёт риска не запускался больше суток") }
          : freshness?.computed_at &&
              Date.now() - new Date(freshness.computed_at).getTime() > 30 * 3_600_000
            ? { severity: SEVERITY.high, label: t("Пересчёт риска задерживается") }
            : null;

  const opsTotal = progress?.reduce((a, p) => a + p.total, 0) ?? 0;
  const opsDone = progress?.reduce((a, p) => a + p.done, 0) ?? 0;
  const opsViol = progress?.reduce((a, p) => a + p.violations, 0) ?? 0;

  const modules = user
    ? navForRole(user.role).filter((n) => n.href !== "/" && MODULE_META[n.href])
    : [];
  // `/control` — supervisor/admin в общей навигации (lib/nav.ts), leadership
  // туда тихо не пускают (AppShell редиректит обратно на /dashboard). Раньше
  // ссылка рендерилась всем безусловно — ровно в момент, когда из «1/18»
  // руководству нужна детализация, клик вёл в никуда. Тот же источник
  // доступа, что и у общей навигации — задваивать список ролей здесь не нужно.
  const canOpenControl = user ? navForRole(user.role).some((n) => n.href === "/control") : false;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Оперативная сводка · Астана")}
          subtitle={t("Состояние пожарной безопасности города по данным ДЧС и модели риска")}
          actions={
            <>
              <LiveIndicator updated={updatedLabel} className="hidden sm:inline-flex" />
              {staleWarning && (
                <StatusChip
                  severity={staleWarning.severity}
                  label={staleWarning.label}
                  className="hidden sm:inline-flex"
                />
              )}
              <Button variant="secondary" size="sm" onClick={load} aria-label={t("Обновить")}>
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">{t("Обновить")}</span>
              </Button>
            </>
          }
        />

        <DemoBanner className="mt-6" />

        {error ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={ServerCrash}
            title={t("Сводка недоступна")}
            description={t("Сервис данных ДЧС не отвечает. Проверьте подключение и обновите страницу.")}
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4" /> {t("Повторить")}
              </Button>
            }
          />
        ) : (
          <>
            {/* Primary KPIs */}
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label={t("Средний риск города")}
                value={ov?.avg_score ?? "—"}
                unit="/ 100"
                icon={Gauge}
                severity={avgSev}
                loading={loading}
                hint={avgSev && <StatusChip severity={avgSev} label={t(avgSev.label)} />}
              />
              <MetricCard
                label={t("Здания высокого риска")}
                value={ov ? highRisk.toLocaleString(intlLocale(locale)) : "—"}
                icon={Flame}
                severity={SEVERITY.high}
                loading={loading}
                hint={ov && `${Math.round((100 * highRisk) / Math.max(1, ov.buildings))}% ${t("от всех объектов")}`}
              />
              <MetricCard
                label={t("Неисправные гидранты")}
                value={ov?.broken_hydrants ?? "—"}
                icon={Droplets}
                severity={SEVERITY.critical}
                loading={loading}
                hint={t("требуют ремонта")}
              />
              <MetricCard
                label={t("Инспекции сегодня")}
                value={loading ? "—" : `${opsDone}`}
                unit={loading ? undefined : `/ ${opsTotal}`}
                icon={ClipboardCheck}
                severity={opsViol > 0 ? SEVERITY.high : SEVERITY.normal}
                loading={loading}
                hint={
                  opsViol > 0
                    ? `${opsViol} ${t("нарушений зафиксировано")}`
                    : t("нарушений не зафиксировано")
                }
              />
            </div>

            {/* Secondary strip */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat icon={Building2} value={ov?.buildings} label={t("зданий в базе")} loading={loading} />
              <MiniStat icon={Users} value={ov?.inspectors} label={t("инспекторов")} loading={loading} />
              <MiniStat icon={ScanLine} value={ov?.cards} label={t("карточек обработано")} loading={loading} />
              <MiniStat icon={FileWarning} value={ov?.prescriptions} label={t("предписаний выдано")} loading={loading} />
            </div>

            {/* Risk distribution + live ops */}
            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <SectionLabel>{t("Распределение риска по городу")}</SectionLabel>
                  <span className="text-2xs text-faint">
                    {ov ? `${ov.buildings.toLocaleString(intlLocale(locale))} ${t("объектов")}` : ""}
                  </span>
                </div>
                {loading ? (
                  <Skeleton className="mt-4 h-3 w-full" />
                ) : ov ? (
                  <RiskDistribution bands={ov.risk_bands} total={ov.buildings} />
                ) : null}
              </Card>

              <Card className="flex flex-col p-5">
                <div className="flex items-center justify-between">
                  <SectionLabel>{t("Инспекции сегодня")}</SectionLabel>
                  {canOpenControl && (
                    <Link
                      href="/control"
                      className="inline-flex items-center gap-0.5 text-2xs text-muted hover:text-accent"
                    >
                      {t("Контроль")} <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  )}
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
                    title={t("Нет активных маршрутов")}
                    description={t("На сегодня инспекции не назначены.")}
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
              <SectionLabel>{t("Модули платформы")}</SectionLabel>
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
                            {t(n.label)}
                            <ChevronRight className="h-3.5 w-3.5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                          </div>
                          <div className="mt-0.5 text-xs leading-relaxed text-muted">
                            {t(meta.desc)}
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
  const { locale } = useLocale();
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
            {value == null ? "—" : value.toLocaleString(intlLocale(locale))}
          </div>
        )}
        <div className="mt-1 text-2xs text-faint">{label}</div>
      </div>
    </Card>
  );
}

function RiskDistribution({ bands, total }: { bands: RiskBand[]; total: number }) {
  const t = useT();
  const { locale } = useLocale();
  const safeTotal = Math.max(1, total);
  // Label/color come from lib/risk.ts (scoreBand/scoreSeverity), the numeric
  // range comes straight from the API response — nothing here is a second
  // copy of the thresholds.
  const segs = bands.map((b) => ({
    key: b.key,
    sev: scoreSeverity(b.min),
    label: t(scoreBand(b.min)),
    range: b.max == null ? `${b.min}+` : `${b.min}–${b.max}`,
    n: b.count,
  }));
  return (
    <div className="mt-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
        {segs.map((s) => (
          <div
            key={s.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(100 * s.n) / safeTotal}%`, background: s.sev.cssVar }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {segs.map((s) => (
          <div key={s.key} className="rounded-md border border-border bg-surface-2/50 p-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.sev.cssVar }} />
              <span className="text-xs text-muted">{s.label}</span>
            </div>
            <div className="mt-1.5 text-lg font-semibold tabular leading-none text-fg">
              {s.n.toLocaleString(intlLocale(locale))}
            </div>
            <div className="mt-1 text-2xs text-faint">
              {Math.round((100 * s.n) / safeTotal)}% · {s.range}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
