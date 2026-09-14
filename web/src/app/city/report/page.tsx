"use client";

/**
 * Печатная сводка для акимата — тот же паттерн печати через браузер
 * (Ctrl+P → «Сохранить как PDF»), что и донесение о пожаре
 * (app/callout/report/page.tsx), с общими компонентами вместо локальных копий
 * (components/report/Watermark.tsx, components/report/PrintToolbar.tsx —
 * callout/report/page.tsx сам пока не переведён на них, см. отчёт по задаче).
 *
 * Один лист — весь город: КПЭ, таблица районов, топ-5 приоритетов по
 * гидрантам и частям, методика и её ограничения. Никаких ФИО/телефонов/адресов
 * инспекторов — акимат видит только городские агрегаты и точечные приоритеты
 * (адреса подсказок в /city/priorities не персональные данные).
 */

import { useCallback, useEffect, useState } from "react";
import PrintToolbar from "@/components/report/PrintToolbar";
import Watermark from "@/components/report/Watermark";
import { Skeleton, Banner, Button } from "@/components/ui";
import {
  getCitySummary,
  getCityPriorities,
  isCityRouterMissing,
  districtName,
  type CitySummary,
  type CityPriorities,
} from "@/lib/city";
import CoverageSourceNote from "@/components/CoverageSourceNote";
import { scoreBand } from "@/lib/risk";
import { useT, useLocale, intlLocale } from "@/lib/i18n";

export default function CityReportPage() {
  const t = useT();
  const { locale } = useLocale();
  const [summary, setSummary] = useState<CitySummary | null>(null);
  const [priorities, setPriorities] = useState<CityPriorities | null>(null);
  const [error, setError] = useState<"missing" | "error" | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([getCitySummary(), getCityPriorities(5)])
      .then(([s, p]) => {
        setSummary(s);
        setPriorities(p);
      })
      .catch((e) => {
        setSummary(null);
        setPriorities(null);
        setError(isCityRouterMissing(e) ? "missing" : "error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loading = !summary && !error;

  return (
    <div className="fw-report-root light min-h-screen bg-bg text-fg">
      <PrintToolbar />

      <div className="relative mx-auto max-w-[210mm] px-4 pb-10">
        {loading && <Skeleton className="h-[240mm] w-full" />}

        {error === "missing" && (
          <Banner tone="warning">
            {t(
              "Городской модуль ещё не подключён — отчёт появится, как только сервис данных по городу будет доступен.",
            )}
          </Banner>
        )}
        {error === "error" && (
          <Banner tone="critical">{t("Не удалось загрузить данные для отчёта. Попробуйте ещё раз.")}</Banner>
        )}
        {(error === "missing" || error === "error") && (
          <Button variant="secondary" size="sm" className="fw-no-print mt-3" onClick={load}>
            {t("Повторить")}
          </Button>
        )}

        {summary?.demo_data && <Watermark label={t("Демо-данные")} />}
        {summary && priorities && (
          <Report summary={summary} priorities={priorities} locale={locale} t={t} />
        )}
      </div>
    </div>
  );
}

function Report({
  summary,
  priorities,
  locale,
  t,
}: {
  summary: CitySummary;
  priorities: CityPriorities;
  locale: "ru" | "kk" | "en";
  t: (s: string) => string;
}) {
  const dateStr = new Date(summary.computed_at).toLocaleString(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article className="fw-sheet relative mx-auto bg-surface p-[10mm] text-xs shadow-sm">
      <header className="border-b-2 border-border-strong pb-2 text-center">
        <h1 className="text-base font-bold uppercase tracking-wide">
          {t("Сводка пожарной безопасности")} · {t("г. Астана")}
        </h1>
        <p className="mt-0.5 text-2xs text-muted">
          {t("Данные по состоянию на")} {dateStr}
          {summary.demo_data && ` · ${t("демо-данные")}`}
        </p>
      </header>

      <Section title={t("1. Показатели города")}>
        <Rows
          rows={[
            [t("Зданий в базе"), String(summary.city.buildings_total)],
            [t("Требуют внимания"), String(summary.city.attention_buildings)],
            [t("Средняя оценка уязвимости"), String(Math.round(summary.city.avg_score))],
            [
              t("В слепой зоне прибытия"),
              `${summary.city.blind_zone_buildings} (${summary.city.blind_pct}%)`,
            ],
            [
              t("Неисправные гидранты"),
              `${summary.city.hydrants_broken} ${t("из")} ${summary.city.hydrants_total}`,
            ],
            [t("Пожарных частей"), String(summary.city.stations_total)],
            [t("Открытых предписаний"), String(summary.city.open_prescriptions)],
            [
              t("Медианное время прибытия"),
              summary.city.median_arrival_min != null
                ? `${summary.city.median_arrival_min} ${t("мин")}`
                : t("нет данных"),
            ],
          ]}
        />
      </Section>

      <Section title={t("2. Районы")}>
        <table className="fw-keep w-full border-collapse text-2xs">
          <thead>
            <tr className="border-b border-border text-left text-faint">
              <th className="w-8 py-1 font-medium">#</th>
              <th className="py-1 font-medium">{t("Район")}</th>
              <th className="py-1 font-medium">{t("Зданий")}</th>
              <th className="py-1 font-medium">{t("Внимание")}</th>
              <th className="py-1 font-medium">{t("Балл")}</th>
              <th className="py-1 font-medium">{t("Слепая зона")}</th>
              <th className="py-1 font-medium">{t("Гидранты неиспр.")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.districts.map((d) => (
              <tr key={d.name} className="border-b border-border/60">
                <td className="tabular py-1">{d.rank}</td>
                <td className="py-1 font-medium">{districtName(d, locale)}</td>
                <td className="tabular py-1">{d.buildings_total}</td>
                <td className="tabular py-1">{d.attention_buildings}</td>
                <td className="tabular py-1">
                  {Math.round(d.avg_score)} · {t(scoreBand(d.avg_score))}
                </td>
                <td className="tabular py-1">{d.blind_pct}%</td>
                <td className="tabular py-1">{d.hydrants_broken}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t("3. Приоритеты: гидранты")}>
        {priorities.hydrant_gaps.length === 0 ? (
          <p className="text-2xs text-muted">{t("Точек без гидранта в зоне охвата не найдено.")}</p>
        ) : (
          <Rows
            rows={priorities.hydrant_gaps.slice(0, 5).map((c, i) => [
              `#${i + 1} · ${c.district}`,
              `${c.buildings} ${t("зданий")} · ${t("балл")} ${Math.round(c.avg_score)}${
                c.sample_addresses.length ? ` · ${c.sample_addresses.slice(0, 2).join(", ")}` : ""
              }`,
            ])}
          />
        )}
      </Section>

      <Section title={t("4. Приоритеты: пожарные части")}>
        {priorities.station_gaps.length === 0 ? (
          <p className="text-2xs text-muted">{t("Слепых зон, требующих новой части, не найдено.")}</p>
        ) : (
          <Rows
            rows={priorities.station_gaps.slice(0, 5).map((c, i) => [
              `#${i + 1} · ${c.district}`,
              `${c.blind_buildings} ${t("зданий вне зоны прибытия")} · ${t("балл")} ${Math.round(c.avg_score)}`,
            ])}
          />
        )}
      </Section>

      <Section title={t("5. Методика и ограничения")}>
        <p className="leading-relaxed text-muted">{summary.method}</p>
        <p className="mt-1.5 leading-relaxed text-muted">{priorities.method}</p>
        <div className="mt-2">
          <CoverageSourceNote source={summary.coverage_source} approximate={summary.approximate} />
        </div>
        {summary.demo_data && (
          <p className="mt-2 leading-relaxed text-elevated">
            {t(
              "Оценка уязвимости рассчитана на демонстрационных (синтетических) данных и не отражает реальное состояние объектов — до загрузки исторических данных ДЧС.",
            )}
          </p>
        )}
        <p className="mt-2 text-faint">© OpenStreetMap contributors</p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="fw-section-title mb-1.5 border-b border-border pb-0.5 text-2xs font-bold uppercase tracking-wider text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,42%)_minmax(0,58%)] gap-x-3 text-2xs">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="contents">
          <dt className="border-b border-border/50 py-1 text-muted">{k}</dt>
          <dd className="tabular border-b border-border/50 py-1 text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
