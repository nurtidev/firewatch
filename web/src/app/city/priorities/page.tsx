"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Droplets,
  Flame,
  RefreshCw,
  ServerCrash,
  Construction,
  MapPinned,
  type LucideIcon,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import DemoBanner from "@/components/DemoBanner";
import CoverageSourceNote from "@/components/CoverageSourceNote";
import {
  getCityPriorities,
  getCitySummary,
  isAbortError,
  isCityRouterMissing,
  isCityForbidden,
  localizedDistrictName,
  type CityPriorities,
  type CityDistrictSummary,
  type HydrantGapCell,
  type StationGapCell,
} from "@/lib/city";
import { scoreSeverity } from "@/lib/risk";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import {
  PageHeader,
  Card,
  SectionLabel,
  ScoreBadge,
  Button,
  LinkButton,
  Skeleton,
  EmptyState,
  Banner,
} from "@/components/ui";

export default function CityPrioritiesPage() {
  const t = useT();
  const { locale } = useLocale();
  const [data, setData] = useState<CityPriorities | null>(null);
  const [error, setError] = useState<"missing" | "forbidden" | "error" | null>(null);
  // Best-effort only: /city/priorities cells carry a bare Russian district
  // name (no name_kk/name_en of their own — see localizedDistrictName in
  // lib/city.ts); this list is what translates it for kk/en. Its own failure
  // never blocks the page — the Russian name is still a correct fallback.
  const [districts, setDistricts] = useState<CityDistrictSummary[] | null>(null);

  // In-flight requests of the last load(): cancelled by a repeated «Обновить»
  // or by leaving the page, instead of finishing heavy work nobody reads.
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    getCityPriorities(15, controller.signal)
      .then(setData)
      .catch((e) => {
        if (isAbortError(e)) return;
        setData(null);
        setError(isCityRouterMissing(e) ? "missing" : isCityForbidden(e) ? "forbidden" : "error");
      });
    getCitySummary(controller.signal)
      .then((s) => setDistricts(s.districts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const loading = !data && !error;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Приоритеты вложений")}
          subtitle={t("Куда в первую очередь добавить гидранты и пожарные части")}
          actions={
            <Button variant="secondary" size="sm" onClick={load} aria-label={t("Обновить")}>
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">{t("Обновить")}</span>
            </Button>
          }
        />

        <DemoBanner className="mt-6" />

        {error === "missing" ? (
          <EmptyState
            className="mt-8"
            icon={Construction}
            title={t("Городской модуль ещё не подключён")}
            description={t(
              "Сервис данных по городу разворачивается — приоритеты появятся, как только он будет доступен.",
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
            title={t("Данные недоступны")}
            description={t("Сервис данных ДЧС не отвечает. Проверьте подключение и обновите страницу.")}
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4" /> {t("Повторить")}
              </Button>
            }
          />
        ) : (
          <>
            <Banner tone="warning" title={t("Как читать этот список")} className="mt-6">
              {loading ? t("Загрузка методики…") : data?.method}
              {data && (
                <div className="mt-2">
                  <CoverageSourceNote source={data.coverage_source} approximate={data.approximate} />
                </div>
              )}
            </Banner>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <PriorityColumn
                icon={Droplets}
                title={t("Гидранты")}
                loading={loading}
                empty={!!data && data.hydrant_gaps.length === 0}
                emptyText={t("Точек без гидранта в зоне охвата не найдено")}
              >
                {data?.hydrant_gaps.map((c, i) => (
                  <HydrantGapRow key={c.cell_id} rank={i + 1} cell={c} districts={districts} locale={locale} t={t} />
                ))}
              </PriorityColumn>

              <PriorityColumn
                icon={Flame}
                title={t("Пожарные части")}
                loading={loading}
                empty={!!data && data.station_gaps.length === 0}
                emptyText={t("Слепых зон, требующих новой части, не найдено")}
              >
                {data?.station_gaps.map((c, i) => (
                  <StationGapRow key={c.cell_id} rank={i + 1} cell={c} districts={districts} locale={locale} t={t} />
                ))}
              </PriorityColumn>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function PriorityColumn({
  icon: Icon,
  title,
  loading,
  empty,
  emptyText,
  children,
}: {
  icon: LucideIcon;
  title: string;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-faint" aria-hidden />
        <SectionLabel>{title}</SectionLabel>
      </div>
      <div className="mt-3 space-y-2.5">
        {loading ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-3/4" />
          </>
        ) : empty ? (
          <EmptyState className="border-0 bg-transparent py-8" title={emptyText} />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

function HydrantGapRow({
  rank,
  cell,
  districts,
  locale,
  t,
}: {
  rank: number;
  cell: HydrantGapCell;
  districts: CityDistrictSummary[] | null;
  locale: "ru" | "kk" | "en";
  t: (s: string) => string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="tabular font-semibold text-faint">#{rank}</span>
            <span className="font-medium text-fg">{localizedDistrictName(cell.district, districts, locale)}</span>
          </div>
          <p className="mt-1 text-2xs text-muted">
            <span className="tabular">{cell.buildings.toLocaleString(intlLocale(locale))}</span>{" "}
            {t("зданий без исправного гидранта рядом")}
          </p>
        </div>
        <ScoreBadge score={Math.round(cell.avg_score)} severity={scoreSeverity(cell.avg_score)} />
      </div>
      {cell.sample_addresses.length > 0 && (
        <p className="mt-2 truncate text-2xs text-faint" title={cell.sample_addresses.join(", ")}>
          {cell.sample_addresses.join(" · ")}
        </p>
      )}
      <LinkButton
        href={`/city/map?lon=${cell.lon}&lat=${cell.lat}&z=16`}
        variant="secondary"
        size="sm"
        className="mt-2.5"
      >
        <MapPinned className="h-3.5 w-3.5" aria-hidden />
        {t("Показать на карте")}
      </LinkButton>
    </div>
  );
}

function StationGapRow({
  rank,
  cell,
  districts,
  locale,
  t,
}: {
  rank: number;
  cell: StationGapCell;
  districts: CityDistrictSummary[] | null;
  locale: "ru" | "kk" | "en";
  t: (s: string) => string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="tabular font-semibold text-faint">#{rank}</span>
            <span className="font-medium text-fg">{localizedDistrictName(cell.district, districts, locale)}</span>
          </div>
          <p className="mt-1 text-2xs text-muted">
            <span className="tabular">{cell.blind_buildings.toLocaleString(intlLocale(locale))}</span>{" "}
            {t("зданий вне зоны прибытия")}
            {cell.high_risk_blind > 0 && (
              <span className="text-critical">
                {" "}
                · <span className="tabular">{cell.high_risk_blind.toLocaleString(intlLocale(locale))}</span>{" "}
                {t("с высокой оценкой уязвимости")}
              </span>
            )}
          </p>
        </div>
        <ScoreBadge score={Math.round(cell.avg_score)} severity={scoreSeverity(cell.avg_score)} />
      </div>
      {cell.sample_addresses.length > 0 && (
        <p className="mt-2 truncate text-2xs text-faint" title={cell.sample_addresses.join(", ")}>
          {cell.sample_addresses.join(" · ")}
        </p>
      )}
      <LinkButton
        href={`/city/map?lon=${cell.lon}&lat=${cell.lat}&z=15`}
        variant="secondary"
        size="sm"
        className="mt-2.5"
      >
        <MapPinned className="h-3.5 w-3.5" aria-hidden />
        {t("Показать на карте")}
      </LinkButton>
    </div>
  );
}
