"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/AppShell";
import BuildingPanel from "@/components/BuildingPanel";
import type { MapFilters } from "@/components/RiskMap";

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

export default function MapPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<MapFilters>({});
  const handleSelect = useCallback((id: number) => setSelectedId(id), []);

  const set = (k: keyof MapFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }));

  const sel =
    "rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200";

  return (
    <AppShell fullBleed>
      <div className="absolute left-4 top-4 z-10 w-64 rounded-md bg-black/75 px-4 py-3 backdrop-blur">
        <h1 className="text-sm font-semibold">Карта риска · Астана</h1>
        <div className="mt-2 flex gap-3 text-xs text-neutral-400">
          <span>● 0–35</span>
          <span>● 36–70</span>
          <span>● 71–100</span>
        </div>

        <div className="mt-3 space-y-2">
          <select
            className={sel + " w-full"}
            value={filters.type ?? ""}
            onChange={(e) => set("type", e.target.value)}
          >
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            className={sel + " w-full"}
            value={filters.district ?? ""}
            onChange={(e) => set("district", e.target.value)}
          >
            <option value="">Все районы</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d} р-н
              </option>
            ))}
          </select>
          <select
            className={sel + " w-full"}
            value={filters.risk ?? ""}
            onChange={(e) => set("risk", e.target.value)}
          >
            {RISKS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-2 text-[10px] text-neutral-500">
          Клик по зданию — карточка риска
        </p>
      </div>

      <RiskMap onSelect={handleSelect} filters={filters} />
      <BuildingPanel id={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}
