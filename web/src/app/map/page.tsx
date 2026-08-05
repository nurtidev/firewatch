"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, ChevronDown, ChevronUp, Search, SearchX } from "lucide-react";
import AppShell from "@/components/AppShell";
import BuildingPanel from "@/components/BuildingPanel";
import type { MapFilters, MapFocus } from "@/components/RiskMap";
import { apiFetch, useAuth } from "@/lib/auth";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
import { DEMO_DATA, DEMO_NOTICE_SHORT } from "@/lib/demo";
import { useT } from "@/lib/i18n";
import { Field, Select, Input, ScoreBadge, SectionLabel } from "@/components/ui";
import { AlertTriangle } from "lucide-react";

// MapLibre touches `window`, so render the map client-side only.
const RiskMap = dynamic(() => import("@/components/RiskMap"), { ssr: false });

// Same isomorphic-effect trick as components/landing/reveal.tsx: useLayoutEffect
// on the client (runs before paint — no flash of the expanded panel), plain
// useEffect during SSR (useLayoutEffect is a no-op there and warns).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
// Same four bands as LEGEND and api RISK_BANDS — filter and legend must match,
// otherwise "Высокий" silently includes critical objects and looks broken.
const RISKS = [
  ["", "Любой риск"],
  ["critical", "Критический (60+)"],
  ["high", "Высокий (40–59)"],
  ["mid", "Средний (20–39)"],
  ["low", "Низкий (0–19)"],
];

// Legend items derived from SEVERITY tokens — color IS data.
// Bands align to scoreBand/scoreSeverity thresholds (lib/risk.ts).
const LEGEND = [
  { sev: SEVERITY.normal,   range: "0–19",   label: "Низкий" },
  { sev: SEVERITY.elevated, range: "20–39",  label: "Средний" },
  { sev: SEVERITY.high,     range: "40–59",  label: "Высокий" },
  { sev: SEVERITY.critical, range: "60–100", label: "Критический" },
] as const;

type BuildingSearchResult = {
  id: number;
  address: string;
  alias: string | null;
  district: string;
  building_type: string | null;
  floors: number | null;
  risk_score: number | null;
  lat: number;
  lng: number;
};

/** Поиск объекта по адресу — начальник отдела, которому позвонили «почему на
 *  Тәуелсіздік 33 не закрыты нарушения», раньше не мог найти здание нигде,
 *  кроме пульта ЦОУ (три `<select>`, ни одного поля ввода). `GET
 *  /buildings/search` — тот же слой нормализации диакритики, что у ЦОУ
 *  (переиспользован из `app.routers.dispatch`), но со скоупом по району и
 *  координатами для центрирования карты. Debounce + generation-счётчик +
 *  «answered»-состояние (пусто-ещё-не-искали ≠ пусто-ничего-нет) — тот же
 *  praised паттерн, что в `BuildingSearch` пульта ЦОУ. */
function BuildingSearch({ onPick }: { onPick: (b: BuildingSearchResult) => void }) {
  const t = useT();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuildingSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [answered, setAnswered] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  // Клик по результату переписывает query на выбранный адрес — это не должно
  // запускать новый поиск (иначе выпадашка тут же открывается снова).
  const justPickedRef = useRef(false);

  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      setAnswered(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const gen = ++searchGenRef.current;
      setSearching(true);
      apiFetch(`/buildings/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d: BuildingSearchResult[]) => {
          if (searchGenRef.current !== gen) return;
          setResults(d);
          setAnswered(true);
        })
        .catch(() => {
          if (searchGenRef.current !== gen) return;
          setResults([]);
          setAnswered(true);
        })
        .finally(() => {
          if (searchGenRef.current === gen) setSearching(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const nothingFound = !searching && answered && results.length === 0;

  function pick(b: BuildingSearchResult) {
    justPickedRef.current = true;
    setQuery(b.address);
    setResults([]);
    setAnswered(false);
    onPick(b);
  }

  return (
    <div className="relative">
      <Field label={t("Поиск объекта")}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Начните вводить адрес…")}
            className="pl-8"
            aria-describedby={statusId}
          />
        </div>
      </Field>
      {searching && <p className="mt-1 text-xs text-faint">{t("Поиск…")}</p>}
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border-strong bg-surface shadow-pop">
          {results.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => pick(b)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="min-w-0 truncate">
                <span className="text-fg">{b.address}</span>
                <span className="text-faint"> · {t(b.district)} {t("р-н")}</span>
                {/* Нашлось по народному названию — видно, почему эта строка */}
                {b.alias && (
                  <span className="block truncate text-xs text-faint">{b.alias}</span>
                )}
              </span>
              {b.risk_score != null && (
                <ScoreBadge
                  score={b.risk_score}
                  severity={scoreSeverity(b.risk_score)}
                  className="shrink-0"
                />
              )}
            </button>
          ))}
        </div>
      )}
      <p id={statusId} className="sr-only" role="status">
        {searching
          ? t("Поиск…")
          : nothingFound
            ? t("Ничего не найдено")
            : results.length > 0
              ? `${results.length}`
              : ""}
      </p>
      {nothingFound && (
        <div className="mt-2 rounded-lg border border-dashed border-border bg-surface/40 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            <SearchX className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            {t("Ничего не найдено")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t(
              "Проверьте адрес или наберите иначе — казахские буквы можно заменить русскими (тауелсиздик 33). Ищется и по названию комплекса.",
            )}
          </p>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  const t = useT();
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<MapFilters>({});
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Свой район — только для того, чтобы честно задизейблить чужие в фильтре
  // (сервер и так режет по району независимо от этого запроса, см.
  // enforce_building_scope в api). /auth/me — единственное место, где район
  // текущей учётки виден фронту (auth.User в контексте его не несёт).
  const [ownDistrict, setOwnDistrict] = useState<string | null>(null);
  useEffect(() => {
    if (user?.role !== "inspector" && user?.role !== "supervisor") return;
    apiFetch(`/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { district?: string | null } | null) => setOwnDistrict(d?.district ?? null))
      .catch(() => {});
  }, [user?.role]);
  const isScopedRole = user?.role === "inspector" || user?.role === "supervisor";

  // On a phone the panel covers most of the map at its default (expanded)
  // size — start collapsed there so the map is visible on first paint.
  useIsomorphicLayoutEffect(() => {
    if (window.innerWidth < 640) setCollapsed(true);
  }, []);
  const handleSelect = useCallback((id: number) => setSelectedId(id), []);

  // Найденный поиском объект приводит к цели: карта долетает до здания
  // (RiskMap.focus), а карточка открывается — тот же handleSelect, что и клик
  // по зданию на карте.
  const handlePick = useCallback((b: BuildingSearchResult) => {
    setFocus({ id: b.id, lat: b.lat, lng: b.lng });
    setSelectedId(b.id);
  }, []);

  const set = (k: keyof MapFilters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }));

  return (
    <AppShell fullBleed>
      {/* ── Control panel — glassy, top-left ────────────────────────────── */}
      <div
        className="absolute left-4 top-4 z-10 w-64 rounded-lg border border-border bg-surface/80 shadow-pop backdrop-blur"
        role="complementary"
        aria-label={t("Панель управления картой")}
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span className="text-sm font-semibold text-fg">{t("Карта риска")}</span>
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 text-faint hover:bg-surface-2 hover:text-muted"
            aria-label={collapsed ? t("Развернуть панель") : t("Свернуть панель")}
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Поиск объекта — всегда виден, даже при свёрнутой панели: это
            основной способ найти здание, а не второстепенный фильтр. */}
        <div className="border-t border-border px-4 pb-3 pt-3">
          <BuildingSearch onPick={handlePick} />
        </div>

        {!collapsed && (
          <div className="border-t border-border px-4 pb-4 pt-3">
            {/* Subtitle */}
            <p className="text-2xs text-faint">{t("ДЧС Астаны")}</p>

            {/* Demo-data notice — synthetic risk, must be visible on the map */}
            {DEMO_DATA && (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-elevated/40 bg-elevated-bg px-2 py-1.5 text-2xs text-elevated">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
                <span>{t(DEMO_NOTICE_SHORT)}</span>
              </div>
            )}

            {/* Risk legend */}
            <div className="mt-3" role="list" aria-label={t("Легенда риска")}>
              <SectionLabel className="mb-2">{t("Уровень риска")}</SectionLabel>
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
                    <span className="text-xs text-muted">{t(label)}</span>
                  </div>
                  <span className="tabular text-2xs text-faint">{range}</span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="my-3 h-px bg-border" />

            {/* Field reports layer — open/in_progress obstacles */}
            <div role="list" aria-label={t("Легенда донесений")}>
              <SectionLabel className="mb-2">{t("Донесения")}</SectionLabel>
              <div role="listitem" className="flex items-center gap-2 py-1">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/60"
                  style={{ background: SEVERITY.critical.cssVar }}
                  aria-hidden
                />
                <span className="text-xs text-muted">
                  {t("Открытые и в работе · цвет по категории, клик — детали")}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="my-3 h-px bg-border" />

            {/* Filters */}
            <div className="space-y-2.5">
              <Field label={t("Тип объекта")}>
                <Select
                  value={filters.type ?? ""}
                  onChange={(e) => set("type", e.target.value)}
                >
                  {TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {t(l)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t("Район")}>
                <Select
                  value={filters.district ?? ""}
                  onChange={(e) => set("district", e.target.value)}
                >
                  <option value="">{isScopedRole ? t("Мой район") : t("Все районы")}</option>
                  {DISTRICTS.map((d) => {
                    // Сервер и так режет по своему району для inspector/
                    // supervisor независимо от этого значения
                    // (enforce_building_scope) — раньше это было не видно:
                    // все 5 районов выглядели доступными, а выбор чужого
                    // молча возвращал те же данные, что и «свой». Задизейбленный
                    // пункт с подписью честно объясняет, почему выбрать нельзя.
                    const locked = isScopedRole && d !== ownDistrict;
                    return (
                      <option key={d} value={d} disabled={locked}>
                        {t(d)} {t("р-н")}
                        {locked ? ` — ${t("недоступно")}` : ""}
                      </option>
                    );
                  })}
                </Select>
              </Field>
              {isScopedRole && (
                <p className="-mt-1 text-2xs text-faint">
                  {ownDistrict
                    ? `${t("Доступ ограничен вашим районом")}: ${t(ownDistrict)}`
                    : t("Район не назначен — обратитесь к администратору")}
                </p>
              )}

              <Field label={t("Уровень риска")}>
                <Select
                  value={filters.risk ?? ""}
                  onChange={(e) => set("risk", e.target.value)}
                >
                  {RISKS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {t(l)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Hint */}
            <p className="mt-3 text-2xs text-faint">
              {t("Нажмите на здание — карточка риска с разбором факторов")}
            </p>
          </div>
        )}
      </div>

      <RiskMap onSelect={handleSelect} filters={filters} focus={focus} />
      <BuildingPanel id={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}
