"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  isAbortError,
  isCityRouterMissing,
  isCityForbidden,
  districtName,
  type CitySummary,
  type CityDistrictSummary,
} from "@/lib/city";
import { useNow } from "@/lib/dispatch";
import {
  scoreSeverity,
  scoreBand,
  SEVERITY,
  CRITICAL_MIN_SCORE,
  HIGH_MIN_SCORE,
  ELEVATED_MIN_SCORE,
} from "@/lib/risk";
import { FW_TIME_ZONE, fwDateKey, intlLocale, useLocale, useT, type Locale } from "@/lib/i18n";
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

/** "14:32" today, "15.09, 14:32" otherwise — in FW_TIME_ZONE, never the
 *  runtime's own zone, and against a `now` from useNow() instead of reading
 *  the clock during render (the #418 hazards named in lib/i18n.tsx). */
function formatComputedAt(iso: string, locale: Locale, now: number): string {
  const d = new Date(iso);
  const sameDay = fwDateKey(d) === fwDateKey(new Date(now));
  return sameDay
    ? d.toLocaleTimeString(intlLocale(locale), {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: FW_TIME_ZONE,
      })
    : d.toLocaleString(intlLocale(locale), {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: FW_TIME_ZONE,
      });
}

// Band order fixed to critical → low, matching the stacked bar direction
// used everywhere else risk bands appear (dashboard's RiskDistribution).
// `minScore` is a representative score for each band, fed into `scoreBand()`
// (lib/risk.ts) so the label text is single-sourced — never a second copy of
// "Критический"/"Высокий"/… hardcoded here.
const BAND_ORDER = [
  { key: "critical" as const, sev: SEVERITY.critical, minScore: CRITICAL_MIN_SCORE },
  { key: "high" as const, sev: SEVERITY.high, minScore: HIGH_MIN_SCORE },
  { key: "elevated" as const, sev: SEVERITY.elevated, minScore: ELEVATED_MIN_SCORE },
  { key: "low" as const, sev: SEVERITY.normal, minScore: 0 },
];

export default function CityOverviewPage() {
  const t = useT();
  const { locale } = useLocale();
  const [summary, setSummary] = useState<CitySummary | null>(null);
  const [error, setError] = useState<"missing" | "forbidden" | "error" | null>(null);
  const now = useNow(60_000);
  // The in-flight summary request: a repeated «Обновить» or leaving the page
  // cancels it instead of leaving a heavy request nobody will read.
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    getCitySummary(controller.signal)
      .then(setSummary)
      .catch((e) => {
        if (isAbortError(e)) return;
        setSummary(null);
        setError(isCityRouterMissing(e) ? "missing" : isCityForbidden(e) ? "forbidden" : "error");
      });
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
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
              {summary && now != null && (
                <LiveIndicator
                  updated={formatComputedAt(summary.computed_at, locale, now)}
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
        ) : error === "forbidden" ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={ServerCrash}
            title={t("Нет доступа")}
            description={t("У вашей роли нет доступа к этому разделу.")}
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
                severity={summary && summary.city.attention_buildings > 0 ? SEVERITY.high : SEVERITY.normal}
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
                severity={summary && summary.city.blind_zone_buildings > 0 ? SEVERITY.critical : SEVERITY.normal}
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
                label={t("Время прибытия (медиана)")}
                value={
                  summary
                    ? summary.city.median_response_min != null
                      ? summary.city.median_response_min
                      : t("нет данных")
                    : "—"
                }
                unit={summary?.city.median_response_min != null ? t("мин") : undefined}
                icon={Clock}
                loading={loading}
                hint={
                  summary &&
                  [
                    `${t("норматив")} ${summary.normative_min ?? 10} ${t("мин")}`,
                    summary.city.median_travel_min != null
                      ? `${t("в пути")} ${summary.city.median_travel_min} ${t("мин")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                }
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
                            className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/40"
                          >
                            <td className="tabular px-4 py-2.5 text-faint">{d.rank}</td>
                            <td className="px-4 py-2.5 font-medium text-fg">
                              <Link
                                href={`/city/map?district=${encodeURIComponent(d.name)}`}
                                className="inline-flex items-center gap-1 rounded-sm hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                              >
                                {districtName(d, locale)}
                                <ChevronRight className="h-3.5 w-3.5 text-faint" aria-hidden />
                              </Link>
                              {d.stations_total === 0 && (
                                <span
                                  className="ml-1.5 inline-flex items-center"
                                  title={t("Нет пожарной части в данных — ограничение исходных данных, не факт реального отсутствия")}
                                >
                                  <AlertTriangle className="h-3 w-3 text-elevated" aria-hidden />
                                  <span className="sr-only">
                                    {t("Нет пожарной части в данных")}
                                  </span>
                                </span>
                              )}
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
                              {d.avg_score != null ? (
                                <ScoreBadge score={Math.round(d.avg_score)} severity={scoreSeverity(d.avg_score)} />
                              ) : (
                                <span className="text-2xs text-faint">{t("нет данных")}</span>
                              )}
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
                {summary.response_method && <p className="mt-2">{summary.response_method}</p>}
                {summary.travel_method && <p className="mt-2">{summary.travel_method}</p>}
                <p className="mt-2">
                  {t(
                    "Исходные данные содержат немного пожарных частей на весь город — у отдельных районов их может не быть вовсе. Это ограничение исходных данных, а не факт реального отсутствия части.",
                  )}
                </p>
                {!!summary.stations_stale_isochrones && summary.stations_stale_isochrones > 0 && (
                  <p className="mt-2 text-elevated">
                    <span className="tabular">{summary.stations_stale_isochrones}</span>{" "}
                    {t(
                      "пожарных частей: зоны прибытия рассчитаны по устаревшим изохронам — слепые зоны и покрытие могут не отражать текущую дорожную сеть.",
                    )}
                  </p>
                )}
                {summary.unassigned.buildings > 0 && (
                  <p className="mt-2">
                    <span className="tabular">{summary.unassigned.buildings}</span>{" "}
                    {t(
                      "зданий не отнесены ни к одному району (вне контуров), поэтому сумма по районам меньше итога по городу на эту величину.",
                    )}
                  </p>
                )}
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
    <>
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
      {/* The bar above is aria-hidden (a screen reader can't read a color
          gradient) — this is the actual content for it, same numbers as the
          per-segment `title` tooltips. */}
      <span className="sr-only">
        {BAND_ORDER.map(({ key, minScore }) => `${t(scoreBand(minScore))}: ${bands[key]}`).join(", ")}
      </span>
    </>
  );
}
