"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  Layers as LayersIcon,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  AlertTriangle,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import CityBuildingPanel from "@/components/CityBuildingPanel";
import { DEMO_DATA, DEMO_NOTICE_SHORT } from "@/lib/demo";
import { useT } from "@/lib/i18n";
import { SectionLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DEFAULT_CITY_LAYERS,
  type CityLayers,
  type CityLayerKey,
  type CityMapFocus,
} from "@/components/CityMap";

// MapLibre touches `window`, so render the map client-side only (same pattern
// as RiskMap/InfraMap).
const CityMap = dynamic(() => import("@/components/CityMap"), { ssr: false });

const LAYER_META: { key: CityLayerKey; label: string; color: string }[] = [
  { key: "districts", label: "Районы · доля внимания", color: "var(--color-elevated)" },
  { key: "buildings", label: "Здания по оценке уязвимости", color: "var(--color-high)" },
  { key: "coverage", label: "Зона прибытия и слепые зоны", color: "var(--color-normal)" },
  { key: "hydrants", label: "Гидранты", color: "var(--color-info)" },
  { key: "stations", label: "Пожарные части", color: "var(--color-accent)" },
  { key: "priorities", label: "Точки приоритета вложений", color: "var(--color-critical)" },
];

function CityMapInner() {
  const t = useT();
  const params = useSearchParams();
  const district = params.get("district");
  const lon = params.get("lon");
  const lat = params.get("lat");
  const z = params.get("z");
  const focus: CityMapFocus = lon && lat ? { lon: Number(lon), lat: Number(lat), z: z ? Number(z) : 15 } : null;

  const [layers, setLayers] = useState<CityLayers>(DEFAULT_CITY_LAYERS);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const toggle = (key: CityLayerKey) =>
    setLayers((l) => ({ ...l, [key]: !l[key] }));

  return (
    <AppShell fullBleed>
      {/* ── Layer panel — top-left ────────────────────────────────────────── */}
      <div
        className="absolute left-4 top-4 z-10 w-64 rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur"
        role="complementary"
        aria-label={t("Слои карты уязвимости")}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <LayersIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">{t("Карта уязвимости")}</span>
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-faint hover:bg-surface-2 hover:text-muted"
            aria-label={collapsed ? t("Развернуть панель") : t("Свернуть панель")}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>

        {!collapsed && (
          <div className="border-t border-border px-4 pb-3.5 pt-2.5">
            {DEMO_DATA && (
              <div className="mb-3 flex items-start gap-1.5 rounded-md border border-elevated/40 bg-elevated-bg px-2 py-1.5 text-2xs text-elevated">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                <span>{t(DEMO_NOTICE_SHORT)}</span>
              </div>
            )}

            <SectionLabel className="mb-1.5">{t("Слои")}</SectionLabel>
            <div className="space-y-0.5" role="list" aria-label={t("Переключатели слоёв")}>
              {LAYER_META.map(({ key, label, color }) => {
                const on = layers[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(key)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      on ? "bg-surface-2 text-fg" : "text-faint hover:bg-surface-2/50 hover:text-muted",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color, opacity: on ? 1 : 0.3 }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{t(label)}</span>
                    {on ? (
                      <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-2xs text-faint">
              {t("Нажмите на здание — карточка с оценкой и основными причинами")}
            </p>
          </div>
        )}
      </div>

      {/* ── OSM attribution — required by the districts data license (ODbL) ── */}
      <div className="pointer-events-none absolute bottom-1 right-2 z-10 text-2xs text-faint/80">
        © OpenStreetMap contributors
      </div>

      <CityMap district={district} focus={focus} layers={layers} onSelectBuilding={setSelectedId} />
      <CityBuildingPanel id={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}

export default function CityMapPage() {
  return (
    <Suspense fallback={null}>
      <CityMapInner />
    </Suspense>
  );
}
