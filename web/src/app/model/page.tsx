"use client";

import { useEffect, useState } from "react";
import { Brain, Target, Gauge, Layers, TrendingUp } from "lucide-react";
import AppShell from "@/components/AppShell";
import DemoBanner from "@/components/DemoBanner";
import { apiFetch } from "@/lib/auth";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { featureLabel } from "@/lib/risk";
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  MetricCard,
  PageHeader,
  ProgressBar,
  SectionLabel,
  Skeleton,
} from "@/components/ui";

type Lift = {
  fraction: number;
  k: number;
  precision: number;
  lift: number;
  recall_captured: number;
};
type Calib = {
  bin: string;
  count: number;
  mean_predicted: number;
  observed_frequency: number;
};
type Metrics = {
  n: number;
  base_rate: number;
  roc_auc: number;
  pr_auc: number;
  brier_raw: number;
  brier_calibrated: number;
  lift: Lift[];
  calibration: Calib[];
  feature_importance_gain: Record<string, number>;
};
type ModelCard = { model_version: string; metrics: Metrics };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function ModelPage() {
  const t = useT();
  const { locale } = useLocale();
  const [data, setData] = useState<ModelCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/model")
      .then(async (r) =>
        r.ok ? r.json() : Promise.reject(await r.json().catch(() => ({}))),
      )
      .then(setData)
      .catch((d) => setError(d?.detail || t("Метрики модели недоступны")));
  }, [t]);

  const m = data?.metrics;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] space-y-6 p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Модель ИИ")}
          subtitle={t("Предиктивная модель риска пожара — валидация на отложенной выборке")}
          actions={
            data ? (
              <div className="flex items-center gap-2">
                <Badge tone="accent">{data.model_version}</Badge>
                <Badge>{t("метрики сборки")}</Badge>
              </div>
            ) : null
          }
        />

        <DemoBanner />

        {error && (
          <EmptyState
            tone="error"
            icon={Brain}
            title={t("Метрики недоступны")}
            description={error}
          />
        )}

        {!error && !m && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        )}

        {m && (
          <>
            {/* Management summary — translates the headline Lift into a sentence
                a commander can act on, instead of leaving them with raw AUC. */}
            <ManagementSummary metrics={m} />

            {/* Headline metrics */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label="ROC-AUC"
                value={m.roc_auc.toFixed(3)}
                icon={Target}
                hint={t("0.5 — случайно · 1.0 — идеал")}
              />
              <MetricCard
                label="PR-AUC"
                value={m.pr_auc.toFixed(3)}
                icon={TrendingUp}
                hint={t("Точность на редком классе")}
              />
              <MetricCard
                label={t("Brier (калибр.)")}
                value={m.brier_calibrated.toFixed(3)}
                icon={Gauge}
                hint={`${t("до калибровки")} ${m.brier_raw.toFixed(3)}`}
              />
              <MetricCard
                label={t("Базовая частота")}
                value={pct(m.base_rate)}
                icon={Layers}
                hint={`${t("тест:")} ${m.n.toLocaleString(intlLocale(locale))} ${t("объектов")}`}
              />
            </div>

            {/* Lift — operational value */}
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <SectionLabel>{t("Приоритизация проверок · Lift")}</SectionLabel>
              </div>
              <p className="mt-1 text-xs text-muted">
                {t("Во сколько раз проверка топ-N% самых рисковых объектов находит больше пожаров, чем случайная выборка.")}
              </p>
              <div className="mt-4 space-y-3">
                {m.lift.map((l) => (
                  <div key={l.fraction} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3">
                    <span className="text-sm font-medium text-fg">
                      {t("Топ")} {Math.round(l.fraction * 100)}%
                    </span>
                    <div>
                      <ProgressBar value={l.recall_captured * 100} />
                      <div className="mt-1 text-2xs text-faint">
                        {t("захват")} {pct(l.recall_captured)} {t("пожаров")} · {t("точность")} {pct(l.precision)}
                      </div>
                    </div>
                    <span className="tabular text-lg font-semibold text-accent">
                      ×{l.lift.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Calibration + feature importance */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <SectionLabel>{t("Калибровка · прогноз vs факт")}</SectionLabel>
                <p className="mt-1 text-xs text-muted">
                  {t("Чем ближе предсказанная вероятность к наблюдаемой частоте, тем надёжнее интерпретировать риск как процент.")}
                </p>
                <div className="mt-4 space-y-1.5">
                  <div className="grid grid-cols-[1fr_4rem_4rem] gap-2 text-2xs uppercase tracking-wider text-faint">
                    <span>{t("Диапазон")}</span>
                    <span className="text-right">{t("Прогноз")}</span>
                    <span className="text-right">{t("Факт")}</span>
                  </div>
                  {m.calibration.map((c) => (
                    <div
                      key={c.bin}
                      className="grid grid-cols-[1fr_4rem_4rem] gap-2 text-sm"
                    >
                      <span className="text-muted">{c.bin}</span>
                      <span className="tabular text-right text-faint">
                        {pct(c.mean_predicted)}
                      </span>
                      <span className="tabular text-right text-fg">
                        {pct(c.observed_frequency)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <SectionLabel>{t("Вклад факторов · gain")}</SectionLabel>
                <p className="mt-1 text-xs text-muted">
                  {t("Какие признаки модель использует сильнее всего при ранжировании риска.")}
                </p>
                <FeatureImportance data={m.feature_importance_gain} />
              </Card>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function ManagementSummary({ metrics }: { metrics: Metrics }) {
  const t = useT();
  // Use the smallest reported fraction (the most selective top-N%) — that is the
  // operating point a leader cares about: "if we inspect the top X%, how many
  // fires do we catch?"
  const top = [...metrics.lift].sort((a, b) => a.fraction - b.fraction)[0];
  if (!top) return null;
  const coverage = Math.round(top.fraction * 100);
  const caught = Math.round(top.recall_captured * 10);
  return (
    <Banner tone="info" icon={Target} title={t("Что это даёт службе")}>
      {t("Проверяя")} {coverage}% {t("самых рисковых объектов, модель выявляет")}{" "}
      <span className="font-semibold text-fg">{caught} {t("из 10")}</span> {t("зданий, где случится пожар — в")}{" "}
      <span className="font-semibold text-fg">×{top.lift.toFixed(1)}</span> {t("раз результативнее случайного обхода. Это позволяет сфокусировать инспекторов там, где риск выше всего.")}
    </Banner>
  );
}

function FeatureImportance({ data }: { data: Record<string, number> }) {
  const t = useT();
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 1;
  return (
    <div className="mt-4 space-y-2.5">
      {entries.map(([name, value]) => (
        <div key={name}>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted">{t(featureLabel(name))}</span>
            <span className="tabular text-faint">{value.toFixed(1)}</span>
          </div>
          <ProgressBar value={(value / max) * 100} className="mt-1" />
        </div>
      ))}
    </div>
  );
}
