"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  AlertTriangle,
  EyeOff,
  Droplets,
  Clock,
  RefreshCw,
  ServerCrash,
  Construction,
  ChevronRight,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import DemoBanner from "@/components/DemoBanner";
import CoverageSourceNote from "@/components/CoverageSourceNote";
import {
  getCitySummary,
  isCityRouterMissing,
  districtName,
  type CitySummary,
  type CityDistrictSummary,
} from "@/lib/city";
import { scoreSeverity, scoreBand, SEVERITY } from "@/lib/risk";
import { intlLocale, useLocale, useT, type Locale } from "@/lib/i18n";
import {
  PageHeader,
  Card,
  SectionLabel,
  MetricCard,
  ScoreBadge,
  Button,
  LinkButton,
  Skeleton,
  EmptyState,
  Collapsible,
  LiveIndicator,
} from "@/components/ui";

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

// Band order fixed to critical → low, matching the stacked bar direction
// used everywhere else risk bands appear (dashboard's RiskDistribution).
// `minScore` is a representative score for each band, fed into `scoreBand()`
// (lib/risk.ts) so the label text is single-sourced — never a second copy of
// "Критический"/"Высокий"/… hardcoded here.
const BAND_ORDER = [
  { key: "critical" as const, sev: SEVERITY.critical, minScore: 60 },
  { key: "high" as const, sev: SEVERITY.high, minScore: 40 },
  { key: "elevated" as const, sev: SEVERITY.elevated, minScore: 20 },
  { key: "low" as const, sev: SEVERITY.normal, minScore: 0 },
];

export default function CityOverviewPage() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [summary, setSummary] = useState<CitySummary | null>(null);
  const [error, setError] = useState<"missing" | "error" | null>(null);

  const load = useCallback(() => {
    setError(null);
    getCitySummary()
      .then(setSummary)
      .catch((e) => {
        setSummary(null);
        setError(isCityRouterMissing(e) ? "missing" : "error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loading = !summary && !error;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Обзор города")}
          subtitle={t("Пожарная уязвимость Астаны по районам — оценка на основе данных ДЧС")}
          actions={
            <>
              {summary && (
                <LiveIndicator
                  updated={formatComputedAt(summary.computed_at, locale)}
                  className="hidden sm:inline-flex"
                />
              )}
              <Button variant="secondary" size="sm" onClick={load} aria-label={t("Обновить")}>
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">{t("Обновить")}</span>
              </Button>
              <LinkButton href="/city/report" size="sm">
                {t("Отчёт для акимата")}
              </LinkButton>
            </>
          }
        />

        <DemoBanner className="mt-6" />
        {summary && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <CoverageSourceNote source={summary.coverage_source} approximate={summary.approximate} />
          </div>
        )}

        {error === "missing" ? (
          <EmptyState
            className="mt-8"
            icon={Construction}
            title={t("Городской модуль ещё не подключён")}
            description={t(
              "Сервис данных по городу разворачивается — раздел «Город» появится, как только он будет доступен. Попробуйте обновить страницу позже.",
            )}
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4" /> {t("Повторить")}
              </Button>
            }
          />
        ) : error === "error" ? (
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
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCard
                label={t("Зданий в базе")}
                value={summary ? summary.city.buildings_total.toLocaleString(intlLocale(locale)) : "—"}
                icon={Building2}
                loading={loading}
              />
              <MetricCard
                label={t("Требуют внимания")}
                value={summary ? summary.city.attention_buildings.toLocaleString(intlLocale(locale)) : "—"}
                icon={AlertTriangle}
                severity={SEVERITY.high}
                loading={loading}
                hint={
                  summary
                    ? `${Math.round((100 * summary.city.attention_buildings) / Math.max(1, summary.city.buildings_total))}% ${t("от всех объектов")}`
                    : undefined
                }
              />
              <MetricCard
                label={t("В слепой зоне прибытия")}
                value={
                  summary
                    ? `${summary.city.blind_zone_buildings.toLocaleString(intlLocale(locale))} · ${summary.city.blind_pct}%`
                    : "—"
                }
                icon={EyeOff}
                severity={SEVERITY.critical}
                loading={loading}
              />
              <MetricCard
                label={t("Неисправные гидранты")}
                value={
                  summary
                    ? `${summary.city.hydrants_broken} / ${summary.city.hydrants_total}`
                    : "—"
                }
                icon={Droplets}
                severity={summary && summary.city.hydrants_broken > 0 ? SEVERITY.high : SEVERITY.normal}
                loading={loading}
              />
              <MetricCard
                label={t("Медианное прибытие")}
                value={
                  summary
                    ? summary.city.median_arrival_min != null
                      ? summary.city.median_arrival_min
                      : t("нет данных")
                    : "—"
                }
                unit={summary?.city.median_arrival_min != null ? t("мин") : undefined}
                icon={Clock}
                loading={loading}
              />
            </div>

            <div className="mt-8">
              <div className="flex items-center justify-between">
                <SectionLabel>{t("Районы по вниманию")}</SectionLabel>
              </div>

              <Card className="mt-3 overflow-hidden p-0">
                {loading ? (
                  <div className="space-y-3 p-5">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-3/4" />
                  </div>
                ) : !summary || summary.districts.length === 0 ? (
                  <EmptyState
                    className="border-0 bg-transparent py-10"
                    title={t("Нет данных по районам")}
                    description={t("Районные границы ещё не загружены.")}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-faint">
                          <th className="px-4 py-2.5 font-medium">#</th>
                          <th className="px-4 py-2.5 font-medium">{t("Район")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("Зданий")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("Внимание")}</th>
                          <th className="w-40 px-4 py-2.5 font-medium">{t("Риск-профиль")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("Средний балл")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("Слепая зона")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("Гидранты неиспр.")}</th>
                          <th className="px-4 py-2.5 font-medium">{t("Предписаний")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.districts.map((d: CityDistrictSummary) => (
                          <tr
                            key={d.name}
                            onClick={() =>
                              router.push(`/city/map?district=${encodeURIComponent(d.name)}`)
                            }
                            className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/60"
                          >
                            <td className="tabular px-4 py-2.5 text-faint">{d.rank}</td>
                            <td className="px-4 py-2.5 font-medium text-fg">
                              <span className="inline-flex items-center gap-1">
                                {districtName(d, locale)}
                                <ChevronRight className="h-3.5 w-3.5 text-faint" aria-hidden />
                              </span>
                            </td>
                            <td className="tabular px-4 py-2.5 text-muted">
                              {d.buildings_total.toLocaleString(intlLocale(locale))}
                            </td>
                            <td className="tabular px-4 py-2.5 text-high">
                              {d.attention_buildings.toLocaleString(intlLocale(locale))}
                            </td>
                            <td className="px-4 py-2.5">
                              <BandBar bands={d.bands} total={d.buildings_total} />
                            </td>
                            <td className="px-4 py-2.5">
                              <ScoreBadge score={Math.round(d.avg_score)} severity={scoreSeverity(d.avg_score)} />
                            </td>
                            <td className="tabular px-4 py-2.5 text-muted">{d.blind_pct}%</td>
                            <td className="tabular px-4 py-2.5 text-muted">{d.hydrants_broken}</td>
                            <td className="tabular px-4 py-2.5 text-muted">{d.open_prescriptions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Legend for the compact risk-profile bar */}
              {!loading && summary && summary.districts.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {BAND_ORDER.map(({ key, sev, minScore }) => (
                    <span key={key} className="inline-flex items-center gap-1.5 text-2xs text-faint">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sev.cssVar }} />
                      {t(scoreBand(minScore))}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {summary && (
              <Collapsible className="mt-6" title={t("Методика")}>
                <p>{summary.method}</p>
              </Collapsible>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function BandBar({
  bands,
  total,
}: {
  bands: CitySummary["districts"][number]["bands"];
  total: number;
}) {
  const t = useT();
  const safeTotal = Math.max(1, total);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      {BAND_ORDER.map(({ key, sev, minScore }) => (
        <div
          key={key}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(100 * bands[key]) / safeTotal}%`, background: sev.cssVar }}
          title={`${t(scoreBand(minScore))}: ${bands[key]}`}
        />
      ))}
    </div>
  );
}
