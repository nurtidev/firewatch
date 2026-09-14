"use client";

import { useEffect, useState } from "react";
import { X, Building2, ServerCrash } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { scoreSeverity, featureLabel } from "@/lib/risk";
import { DEMO_DATA, DEMO_NOTICE_SHORT } from "@/lib/demo";
import { useT } from "@/lib/i18n";
import {
  SectionLabel,
  StatusChip,
  ProgressBar,
  Skeleton,
  EmptyState,
  Button,
} from "@/components/ui";
import { cn } from "@/lib/cn";

type Factor = { feature: string; value: number };

/** Same `GET /buildings/{id}` response as components/BuildingPanel.tsx (see
 *  api/app/routers/buildings.py::building_detail) — this type only lists the
 *  fields actually rendered here. Deliberately NOT reused: BuildingPanel also
 *  renders `card` (the linked ПТП: nearest station, pre-assigned rank, water
 *  sources — ДЧС operational/tactical detail, not a "картина города" concern)
 *  and a model_version footnote. Neither belongs in a read-only panel handed
 *  to an akimat official; this component only ever asks for address, score
 *  and plain-language factors. */
type Detail = {
  id: number;
  address: string;
  type_label: string;
  floors: number | null;
  score: number | null;
  explanation: Factor[];
};

type PanelState = "idle" | "loading" | "loaded" | "error";

export default function CityBuildingPanel({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<Detail | null>(null);
  const [state, setState] = useState<PanelState>("idle");

  const load = () => {
    if (id == null) return;
    setState("loading");
    setData(null);
    apiFetch(`/buildings/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Detail) => {
        setData(d);
        setState("loaded");
      })
      .catch(() => {
        setData(null);
        setState("error");
      });
  };

  useEffect(() => {
    if (id == null) {
      setState("idle");
      setData(null);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (id == null) return null;

  const sev = data?.score != null ? scoreSeverity(data.score) : undefined;
  // Только факторы, повышающие риск — акимату нужна причина внимания к
  // объекту, а не полный разбор SHAP с отрицательными вкладами.
  const topFactors = (data?.explanation ?? [])
    .filter((f) => f.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  return (
    <aside
      className={cn(
        "absolute right-0 top-0 z-20 flex h-full w-[320px] flex-col",
        "border-l border-border bg-surface/80 shadow-pop backdrop-blur",
        "fw-fade-in",
      )}
      aria-label={t("Карточка здания")}
      role="complementary"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Building2 className="h-4 w-4 text-faint" aria-hidden />
          <SectionLabel>{t("Здание")}</SectionLabel>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label={t("Закрыть карточку")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state === "loading" && (
          <div className="space-y-4 p-5">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="mt-6 flex items-end gap-3">
              <Skeleton className="h-12 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="mt-6 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        )}

        {state === "error" && (
          <div className="p-5">
            <EmptyState
              tone="error"
              icon={ServerCrash}
              title={t("Данные недоступны")}
              description={t("Не удалось загрузить карточку здания. Попробуйте ещё раз.")}
              action={
                <Button variant="secondary" size="sm" onClick={load}>
                  {t("Повторить")}
                </Button>
              }
            />
          </div>
        )}

        {state === "loaded" && !data && (
          <div className="p-5">
            <EmptyState
              icon={Building2}
              title={t("Здание не найдено")}
              description={t("Данные по этому зданию отсутствуют в базе.")}
            />
          </div>
        )}

        {state === "loaded" && data && (
          <div className="p-5">
            <h2 className="text-base font-semibold leading-snug text-fg">{data.address}</h2>
            <p className="mt-1 text-xs text-muted">
              {[data.type_label, data.floors != null ? `${data.floors} ${t("эт.")}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {data.score != null && sev && (
              <div className="mt-5">
                <SectionLabel className="mb-2">{t("Оценка уязвимости")}</SectionLabel>
                <div className="flex items-end gap-3">
                  <span className={cn("tabular text-5xl font-bold leading-none", sev.text)}>
                    {data.score}
                  </span>
                  <div className="mb-0.5 flex flex-col gap-1.5">
                    <span className="text-sm text-faint">/ 100</span>
                    <StatusChip severity={sev} />
                  </div>
                </div>
                <ProgressBar className="mt-3" value={data.score} max={100} severity={sev} />
                {DEMO_DATA && (
                  <p className="mt-2 text-2xs text-elevated">{t(DEMO_NOTICE_SHORT)}</p>
                )}
              </div>
            )}

            {topFactors.length > 0 && (
              <div className="mt-6">
                <SectionLabel>{t("Основные причины")}</SectionLabel>
                <ul className="mt-3 space-y-2" aria-label={t("Факторы риска")}>
                  {topFactors.map((f) => (
                    <li
                      key={f.feature}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-xs"
                    >
                      <span className="text-muted">{t(featureLabel(f.feature))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
