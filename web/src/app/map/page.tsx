"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/AppShell";
import BuildingPanel from "@/components/BuildingPanel";

// MapLibre touches `window`, so render the map client-side only.
const RiskMap = dynamic(() => import("@/components/RiskMap"), { ssr: false });

export default function MapPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const handleSelect = useCallback((id: number) => setSelectedId(id), []);

  return (
    <AppShell fullBleed>
      <div className="absolute left-4 top-4 z-10 rounded-md bg-black/70 px-4 py-3 backdrop-blur">
        <h1 className="text-sm font-semibold">Карта риска · Астана</h1>
        <div className="mt-2 flex gap-3 text-xs text-neutral-400">
          <span>● 0–35 низкий</span>
          <span>● 36–70 средний</span>
          <span>● 71–100 высокий</span>
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">
          Клик по зданию — карточка риска
        </p>
      </div>

      <RiskMap onSelect={handleSelect} />
      <BuildingPanel id={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}
