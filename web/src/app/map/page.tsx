"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, ChevronDown, ChevronUp } from "lucide-react";
import AppShell from "@/components/AppShell";
import BuildingPanel from "@/components/BuildingPanel";
import type { MapFilters } from "@/components/RiskMap";
import { SEVERITY } from "@/lib/risk";
import { Field, Select, SectionLabel } from "@/components/ui";

// MapLibre touches `window`, so render the map client-side only.
const RiskMap = dynamic(() => import("@/components/RiskMap"), { ssr: false });

const TYPES = [
  ["", "Все типы"],
  ["residential", "Жилое"],
  ["public", "Общественное"],
  ["industrial", "Производственное"],
  ["other", "Прочее"],
];
const DISTRICTS = [
  "Сарыаркинский",
  "Алматинский",
  "Есильский",
  "Байконырский",
  "Нуринский",
];
const RISKS = [
  ["", "Любой риск"],
  ["high", "Высокий (71–100)"],
  ["mid", "Средний (36–70)"],
  ["low", "Низкий (0–35)"],
];

// Legend items derived from SEVERITY tokens — color IS data.
// Bands align to scoreBand/scoreSeverity thresholds.
const LEGEND = [
  { sev: SEVERITY.normal,   range: "0–35",   label: "Низкий" },
  { sev: SEVERITY.elevated, range: "36–70",  label: "Средний" },
  { sev: SEVERITY.high,     range: "71–100", label: "Высокий" },
] as const;

export default function MapPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<MapFilters>({});
  const [collapsed, setCollapsed] = useState(false);
  const handleSelect = useCallback((id: number) => setSelectedId(id), []);

  const set = (k: keyof MapFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }));

  return (
    <AppShell fullBleed>
      {/* ── Control panel — glassy, top-left ────────────────────────────── */}
      <div
        className="absolute left-4 top-4 z-10 w-64 rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur"
        role="complementary"
        aria-label="Панель управления картой"
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">Карта риска</span>
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-faint hover:bg-surface-2 hover:text-muted"
            aria-label={collapsed ? "Развернуть панель" : "Свернуть панель"}
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </div>

        {!collapsed && (
          <div className="border-t border-border px-4 pb-4 pt-3">
            {/* Subtitle */}
            <p className="text-2xs text-faint">Астана · ДЧС РК</p>

            {/* Risk legend */}
            <div className="mt-3" role="list" aria-label="Легенда риска">
              <SectionLabel className="mb-2">Уровень риска</SectionLabel>
              {LEGEND.map(({ sev, range, label }) => (
                <div
                  key={sev.key}
                  role="listitem"
                  className="flex items-center justify-between py-1"
                >
                  <div className="flex items-center gap-2">
                    {/* Swatch uses cssVar so it stays aligned with the map layer */}
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: sev.cssVar }}
                      aria-hidden
                    />
                    <span className="text-xs text-muted">{label}</span>
                  </div>
                  <span className="tabular text-2xs text-faint">{range}</span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="my-3 h-px bg-border" />

            {/* Filters */}
            <div className="space-y-2.5">
              <Field label="Тип объекта">
                <Select
                  value={filters.type ?? ""}
                  onChange={(e) => set("type", e.target.value)}
                >
                  {TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Район">
                <Select
                  value={filters.district ?? ""}
                  onChange={(e) => set("district", e.target.value)}
                >
                  <option value="">Все районы</option>
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d} р-н
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Уровень риска">
                <Select
                  value={filters.risk ?? ""}
                  onChange={(e) => set("risk", e.target.value)}
                >
                  {RISKS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Hint */}
            <p className="mt-3 text-2xs text-faint">
              Нажмите на здание — карточка риска с SHAP-анализом
            </p>
          </div>
        )}
      </div>

      <RiskMap onSelect={handleSelect} filters={filters} />
      <BuildingPanel id={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}
