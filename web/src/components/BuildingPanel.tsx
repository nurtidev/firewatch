"use client";

import { useEffect, useState } from "react";
import {
  X,
  Building2,
  AlertOctagon,
  ServerCrash,
  BarChart2,
} from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
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
type Detail = {
  id: number;
  address: string;
  type_label: string;
  year_built: number | null;
  floors: number | null;
  score: number | null;
  model_version: string | null;
  explanation: Factor[];
};

type PanelState = "idle" | "loading" | "loaded" | "error";

export default function BuildingPanel({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [state, setState] = useState<PanelState>("idle");

  useEffect(() => {
    if (id == null) {
      setState("idle");
      setData(null);
      return;
    }
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
  }, [id]);

  if (id == null) return null;

  const sev = data?.score != null ? scoreSeverity(data.score) : undefined;
  const maxAbs =
    data?.explanation.reduce((m, f) => Math.max(m, Math.abs(f.value)), 0) || 1;

  return (
    <aside
      className={cn(
        "absolute right-0 top-0 z-20 flex h-full w-[360px] flex-col",
        "border-l border-border bg-surface/80 shadow-pop backdrop-blur",
        "fw-fade-in",
      )}
      aria-label={`Карточка объекта ${id}`}
      role="complementary"
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Building2 className="h-4 w-4 text-faint" aria-hidden />
          <SectionLabel>Объект · {String(id).padStart(4, "0")}</SectionLabel>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Закрыть карточку"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">

        {/* Loading skeleton */}
        {state === "loading" && (
          <div className="space-y-4 p-5">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="mt-6 flex items-end gap-3">
              <Skeleton className="h-14 w-20" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Skeleton className="mt-2 h-1.5 w-full" />
            <div className="mt-6 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        )}

        {/* Error state */}
        {state === "error" && (
          <div className="p-5">
            <EmptyState
              tone="error"
              icon={ServerCrash}
              title="Данные недоступны"
              description="Не удалось загрузить карточку объекта. Попробуйте ещё раз."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (id == null) return;
                    setState("loading");
                    setData(null);
                    apiFetch(`/buildings/${id}`)
                      .then((r) => (r.ok ? r.json() : Promise.reject()))
                      .then((d: Detail) => { setData(d); setState("loaded"); })
                      .catch(() => setState("error"));
                  }}
                >
                  Повторить
                </Button>
              }
            />
          </div>
        )}

        {/* Empty (no data returned) */}
        {state === "loaded" && !data && (
          <div className="p-5">
            <EmptyState
              icon={Building2}
              title="Объект не найден"
              description="Данные по этому объекту отсутствуют в базе."
            />
          </div>
        )}

        {/* Loaded with data */}
        {state === "loaded" && data && (
          <div className="p-5">
            {/* Address + meta */}
            <h2 className="text-base font-semibold leading-snug text-fg">
              {data.address}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {[
                data.type_label,
                data.floors != null ? `${data.floors} эт.` : null,
                data.year_built != null ? `${data.year_built} г.` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            {/* Risk score */}
            {data.score != null && sev && (
              <div className="mt-5">
                <SectionLabel className="mb-2">Оценка риска</SectionLabel>
                <div className="flex items-end gap-3">
                  <span
                    className={cn(
                      "tabular text-5xl font-bold leading-none",
                      sev.text,
                    )}
                  >
                    {data.score}
                  </span>
                  <div className="mb-0.5 flex flex-col gap-1.5">
                    <span className="text-sm text-faint">/ 100</span>
                    <StatusChip severity={sev} />
                  </div>
                </div>
                <ProgressBar
                  className="mt-3"
                  value={data.score}
                  max={100}
                  severity={sev}
                />
              </div>
            )}

            {/* Detail rows */}
            <div className="mt-5 rounded-lg border border-border bg-surface-2/50">
              {[
                ["Тип здания", data.type_label],
                ["Этажей", data.floors != null ? String(data.floors) : "—"],
                ["Год постройки", data.year_built != null ? String(data.year_built) : "—"],
                ["ID объекта", String(id).padStart(4, "0")],
              ].map(([label, value], i, arr) => (
                <div
                  key={label}
                  className={cn(
                    "flex items-baseline justify-between gap-4 px-3.5 py-2.5 text-xs",
                    i < arr.length - 1 && "border-b border-border",
                  )}
                >
                  <span className="text-muted">{label}</span>
                  <span className="tabular text-fg">{value}</span>
                </div>
              ))}
            </div>

            {/* SHAP factors */}
            {data.explanation.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-3.5 w-3.5 text-faint" aria-hidden />
                  <SectionLabel>SHAP · Вклад факторов</SectionLabel>
                </div>
                <ul className="mt-3 space-y-3" aria-label="Факторы риска">
                  {data.explanation.map((f) => {
                    const positive = f.value >= 0;
                    // Positive SHAP = raises risk → high/critical severity color
                    // Negative SHAP = lowers risk → normal color
                    const factorSev = positive ? SEVERITY.high : SEVERITY.normal;
                    return (
                      <li key={f.feature}>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="text-muted">{f.feature}</span>
                          <span
                            className={cn(
                              "tabular font-medium",
                              factorSev.text,
                            )}
                          >
                            {positive ? "+" : ""}
                            {f.value.toFixed(1)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          {/* Centering bar with +/- direction */}
                          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                            {positive ? (
                              <div
                                className="absolute left-0 h-full rounded-full"
                                style={{
                                  width: `${(Math.abs(f.value) / maxAbs) * 100}%`,
                                  background: factorSev.cssVar,
                                }}
                              />
                            ) : (
                              <div
                                className="absolute right-0 h-full rounded-full"
                                style={{
                                  width: `${(Math.abs(f.value) / maxAbs) * 100}%`,
                                  background: factorSev.cssVar,
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* SHAP legend */}
                <div className="mt-3 flex items-center gap-4 text-2xs text-faint">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-1.5 w-4 rounded-full"
                      style={{ background: SEVERITY.high.cssVar }}
                    />
                    повышает риск
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-1.5 w-4 rounded-full"
                      style={{ background: SEVERITY.normal.cssVar }}
                    />
                    снижает риск
                  </span>
                </div>
              </div>
            )}

            {/* Model version */}
            <p className="mt-6 text-2xs text-faint">
              Модель · {data.model_version ?? "—"}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
