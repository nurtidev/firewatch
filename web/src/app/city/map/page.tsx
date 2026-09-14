"use client";

import { Suspense, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  Layers as LayersIcon,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  AlertTriangle,
  Construction,
  ServerCrash,
  RefreshCw,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import CityBuildingPanel from "@/components/CityBuildingPanel";
import { DEMO_DATA, DEMO_NOTICE_SHORT } from "@/lib/demo";
import { useT } from "@/lib/i18n";
import { SectionLabel, Button } from "@/components/ui";
import { SEVERITY, scoreBand } from "@/lib/risk";
import { cn } from "@/lib/cn";
import {
  DEFAULT_CITY_LAYERS,
  type CityLayers,
  type CityLayerKey,
  type CityMapFocus,
  type CityDataStatus,
} from "@/lib/cityMapTypes";

// MapLibre touches `window`, so render the map client-side only (same pattern
// as RiskMap/InfraMap). Imported from the light lib/cityMapTypes module
// above, NOT from "@/components/CityMap" — a plain (non-dynamic) import of a
// binding from that file would pull maplibre-gl into this page's own eager
// chunk regardless of the dynamic() below, defeating the code-split.
const CityMap = dynamic(() => import("@/components/CityMap"), { ssr: false });

const LAYER_META: { key: CityLayerKey; label: string; color: string }[] = [
  { key: "districts", label: "Районы · доля внимания", color: "var(--color-elevated)" },
  { key: "buildings", label: "Здания по оценке уязвимости", color: "var(--color-high)" },
  { key: "coverage", label: "Зона прибытия и слепые зоны", color: "var(--color-normal)" },
  { key: "hydrants", label: "Гидранты", color: "var(--color-info)" },
  { key: "stations", label: "Пожарные части", color: "var(--color-accent)" },
  { key: "priorities", label: "Точки приоритета вложений", color: "var(--color-critical)" },
];

/** `?lon&lat&z` → a validated camera target, or null if absent/malformed —
 *  never trust query params blindly (NaN, out-of-range coordinates). */
function parseFocus(lon: string | null, lat: string | null, z: string | null): CityMapFocus {
  if (lon == null || lat == null) return null;
  const lonN = Number(lon);
  const latN = Number(lat);
  const zN = z != null ? Number(z) : 15;
  if (!Number.isFinite(lonN) || !Number.isFinite(latN) || !Number.isFinite(zN)) return null;
  if (lonN < -180 || lonN > 180) return null;
  if (latN < -90 || latN > 90) return null;
  if (zN < 0 || zN > 22) return null;
  return { lon: lonN, lat: latN, z: zN };
}

function CityMapInner() {
  const t = useT();
  const params = useSearchParams();
  const district = params.get("district");
  const lon = params.get("lon");
  const lat = params.get("lat");
  const z = params.get("z");
  // useMemo on the raw param strings (primitives — stable across re-renders
  // unless the URL itself changes), not a fresh object literal every render:
  // CityMap's focus-effect keys off object identity, and the page re-renders
  // on every layer toggle / building selection — without this, the camera
  // would fly back to ?lon&lat&z on every unrelated click.
  const focus = useMemo(() => parseFocus(lon, lat, z), [lon, lat, z]);

  const [layers, setLayers] = useState<CityLayers>(DEFAULT_CITY_LAYERS);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [districtsStatus, setDistrictsStatus] = useState<CityDataStatus>("loading");
  const [prioritiesStatus, setPrioritiesStatus] = useState<CityDataStatus>("loading");
  // Bumped to force CityMap to remount (and re-run its fetches) on retry —
  // simplest correct way to retry a fetch that lives inside a mounted map
  // component, without threading a re-fetch callback through it.
  const [retryKey, setRetryKey] = useState(0);

  const toggle = (key: CityLayerKey) =>
    setLayers((l) => ({ ...l, [key]: !l[key] }));

  // Reset the banner to "loading" immediately on click — CityMap's remount
  // will call onDistrictsStatus/onPrioritiesStatus again once its own
  // `load` event fires, but that's a moment away; without this the old
  // "missing"/"error" banner would keep showing until then.
  const retry = () => {
    setDistrictsStatus("loading");
    setPrioritiesStatus("loading");
    setRetryKey((k) => k + 1);
  };

  const dataStatus: CityDataStatus =
    districtsStatus === "missing" || prioritiesStatus === "missing"
      ? "missing"
      : districtsStatus === "error" || prioritiesStatus === "error"
        ? "error"
        : districtsStatus === "loading" || prioritiesStatus === "loading"
          ? "loading"
          : "ok";

  return (
    <AppShell fullBleed>
      {/* ── Layer panel — top-left ────────────────────────────────────────── */}
      <div
        className="absolute left-4 top-4 z-10 w-64 max-h-[calc(100%-2rem)] overflow-y-auto rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur"
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

            {/* Districts/priorities module status — buildings, hydrants,
                stations, coverage keep working from /buildings and /infra/*
                regardless; only these two data sets depend on /city/*. */}
            {dataStatus === "missing" && (
              <div className="mb-3 flex items-start gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-2xs text-muted">
                <Construction className="mt-px h-3 w-3 shrink-0 text-faint" aria-hidden />
                <div className="min-w-0 flex-1">
                  <span>
                    {t("Городской модуль не подключён — районы и приоритеты вложений недоступны.")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-auto px-0 py-0 text-2xs text-accent"
                    onClick={retry}
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden /> {t("Повторить")}
                  </Button>
                </div>
              </div>
            )}
            {dataStatus === "error" && (
              <div className="mb-3 flex items-start gap-1.5 rounded-md border border-critical/40 bg-critical-bg px-2 py-1.5 text-2xs text-critical">
                <ServerCrash className="mt-px h-3 w-3 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <span>{t("Не удалось загрузить районы и приоритеты вложений.")}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-auto px-0 py-0 text-2xs text-critical"
                    onClick={retry}
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden /> {t("Повторить")}
                  </Button>
                </div>
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

            {/* ── Legend ───────────────────────────────────────────────────── */}
            <div className="mt-4 border-t border-border pt-3">
              <SectionLabel className="mb-1.5">{t("Условные обозначения")}</SectionLabel>
              <div className="space-y-1.5" role="list" aria-label={t("Условные обозначения")}>
                {[SEVERITY.normal, SEVERITY.elevated, SEVERITY.high, SEVERITY.critical].map((sev) => (
                  <LegendRow key={sev.key} color={sev.cssVar} shape="fill">
                    {t(scoreBand(sev.key === "critical" ? 60 : sev.key === "high" ? 40 : sev.key === "elevated" ? 20 : 0))}
                  </LegendRow>
                ))}
                <LegendRow color="var(--color-info)" shape="dot">
                  {t("Гидрант исправен")}
                </LegendRow>
                <LegendRow color="var(--color-high)" shape="dot-mark">
                  {t("Гидрант неисправен")}
                </LegendRow>
                <LegendRow color="var(--color-accent)" shape="square">
                  {t("Пожарная часть")}
                </LegendRow>
                <LegendRow color="var(--color-critical)" shape="dot">
                  {t("Слепая зона (вне норматива прибытия)")}
                </LegendRow>
                <LegendRow color="var(--color-normal)" shape="fill">
                  {t("Зона прибытия по нормативу")}
                </LegendRow>
                <LegendRow color="var(--color-high)" shape="letter-g">
                  {t("Приоритет: не хватает гидранта (Г)")}
                </LegendRow>
                <LegendRow color="var(--color-critical)" shape="letter-ch">
                  {t("Приоритет: нужна пожарная часть (Ч)")}
                </LegendRow>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── OSM attribution — required by the districts data license (ODbL);
          CityMap disables MapLibre's own AttributionControl so this is the
          only one on screen (no overlap). ─────────────────────────────────── */}
      <div className="pointer-events-none absolute bottom-1 right-2 z-10 text-2xs text-faint/80">
        © OpenStreetMap contributors
      </div>

      <CityMap
        key={retryKey}
        district={district}
        focus={focus}
        layers={layers}
        onSelectBuilding={setSelectedId}
        onDistrictsStatus={setDistrictsStatus}
        onPrioritiesStatus={setPrioritiesStatus}
      />
      <CityBuildingPanel id={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}

function LegendRow({
  color,
  shape,
  children,
}: {
  color: string;
  shape: "fill" | "dot" | "dot-mark" | "square" | "letter-g" | "letter-ch";
  children: React.ReactNode;
}) {
  return (
    <div role="listitem" className="flex items-center gap-2.5">
      {shape === "fill" && (
        <span
          className="h-2.5 w-4 shrink-0 rounded-sm"
          style={{ background: color, opacity: 0.5 }}
          aria-hidden
        />
      )}
      {shape === "dot" && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      )}
      {shape === "dot-mark" && (
        <span
          className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
          style={{ background: color }}
          aria-hidden
        >
          !
        </span>
      )}
      {shape === "square" && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />
      )}
      {(shape === "letter-g" || shape === "letter-ch") && (
        <span
          className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
          style={{ background: color }}
          aria-hidden
        >
          {shape === "letter-g" ? "Г" : "Ч"}
        </span>
      )}
      <span className="text-xs text-muted">{children}</span>
    </div>
  );
}

export default function CityMapPage() {
  return (
    <Suspense fallback={null}>
      <CityMapInner />
    </Suspense>
  );
}
