"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Calculator,
  Flame,
  Users,
  Truck,
  Crosshair,
  Clock,
  Layers,
  Droplets,
  BarChart3,
  ChevronDown,
  ScanLine,
  type LucideIcon,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { SEVERITY } from "@/lib/risk";
import { useT, useLocale, intlLocale } from "@/lib/i18n";
import type { CalloutPackData, ForcesHint } from "@/lib/dispatch";
import {
  Card,
  PageHeader,
  MetricCard,
  SectionLabel,
  Banner,
  Button,
  LinkButton,
  Input,
  Select,
  Field,
  EmptyState,
} from "@/components/ui";
import { cn } from "@/lib/cn";

/* ── Types ── */
type Preset = { key: string; label: string; vl: number; jtr: number };
type Barrel = { key: string; label: string; q: number };
type Result = {
  time: { t_travel: number; t_deploy: number; t_free: number };
  fire: { radius_m: number; s_fire_m2: number; s_ext_m2: number };
  flow: {
    q_req_ext: number;
    q_req_def: number;
    q_req: number;
    q_act_ext: number;
    q_act_def: number;
    q_act: number;
  };
  result: {
    barrels_ext: number;
    barrels_def: number;
    trucks: number;
    personnel: number;
    personnel_breakdown: Record<string, number>;
    squads: number;
    rank: string;
    water_liters_10min: number;
    gdzs_links?: number;
    warnings?: string[];
  };
};

/** Пресет по умолчанию — им же подписан первый пункт выпадающего списка.
 *  Раньше список показывал «жилое», а в полях лежала интенсивность
 *  общественного (0,10) — форма противоречила сама себе. */
const DEFAULT_PRESET = "residential";

/* ── Defaults (identical keys to original) ── */
const defaults = {
  vl: 1.0,
  jtr: 0.06,
  form: "rectangular",
  directions: 2,
  width_m: 5,
  depth_m: 5,
  barrel: "rs50",
  detection_min: 3,
  report_min: 1,
  info_min: 0.5,
  gather_min: 1,
  distance_km: 1,
  travel_speed_kmh: 40,
  hose_lay_m: 100,
  supply_per_truck: 40,
  // Этаж пожара — уже был в API (ГДЗС, время развёртывания, напор), но форма
  // его не показывала: расчёт для 24-этажки считался как для первого этажа.
  floor: 1,
};

/* ── Local sub-components ── */

/** Section divider for the form groups */
function FormSection({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  );
}

/** Result group card */
function GroupCard({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-faint" aria-hidden />}
        <SectionLabel>{title}</SectionLabel>
      </div>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

/** Label / value row inside a GroupCard */
function Row({
  k,
  v,
  bold,
}: {
  k: string;
  v: number | string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">{k}</span>
      <span
        className={cn(
          "tabular",
          bold ? "font-semibold text-fg" : "text-fg/80",
        )}
      >
        {v}
      </span>
    </div>
  );
}

/* ── Page ── */

export default function ForcesPage() {
  // useSearchParams требует Suspense-границы — та же обёртка, что в /cards.
  return (
    <Suspense fallback={null}>
      <ForcesCalculator />
    </Suspense>
  );
}

function ForcesCalculator() {
  const t = useT();
  const { locale } = useLocale();
  const params = useSearchParams();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [barrels, setBarrels] = useState<Barrel[]>([]);
  const [presetKey, setPresetKey] = useState(params.get("preset") ?? DEFAULT_PRESET);
  const [p, setP] = useState({ ...defaults });
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Контекст из боевого пакета: по какому объекту считаем и откуда взялись
  // предзаполненные параметры (расчёт по ПТП или черновая прикидка по типу).
  const fromPack = params.get("object");
  const packSource = params.get("source");
  const packCardId = params.get("card");
  const packCalloutId = params.get("callout");
  const [ptp, setPtp] = useState<ForcesHint | null>(null);

  // Цифры расчёта по ПТП того же вызова — рядом с результатом калькулятора.
  // Калькулятор считает по общей методике и обобщённой геометрии, поэтому его
  // результат и документ по объекту расходятся; РТП должен видеть оба и знать,
  // что при расхождении верен документ, а не гадать между двумя экранами.
  useEffect(() => {
    if (!packCalloutId || packSource !== "card") return;
    apiFetch(`/dispatch/${packCalloutId}/pack`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CalloutPackData | null) => {
        if (d?.forces_hint?.source === "card") setPtp(d.forces_hint);
      })
      .catch(() => {});
  }, [packCalloutId, packSource]);

  useEffect(() => {
    apiFetch(`/forces/presets`)
      .then((r) => r.json())
      .then((d) => {
        setPresets(d.objects);
        setBarrels(d.barrels);
      })
      .catch(() => {});
  }, []);

  // Параметры объекта из ссылки пакета: тип (Vл/Jтр), этаж пожара и расстояние
  // до части — то, что система уже знает и что РТП иначе вбивал бы заново.
  useEffect(() => {
    if (presets.length === 0) return;
    const preset = presets.find((x) => x.key === presetKey) ?? presets[0];
    const floorRaw = Number(params.get("floor"));
    const distRaw = Number(params.get("distance_km"));
    setP((s) => ({
      ...s,
      vl: preset.vl,
      jtr: preset.jtr,
      floor: Number.isFinite(floorRaw) && floorRaw !== 0
        ? Math.min(50, Math.max(-3, Math.round(floorRaw)))
        : s.floor,
      distance_km: Number.isFinite(distRaw) && distRaw > 0 ? distRaw : s.distance_km,
    }));
    setPresetKey(preset.key);
    setPrefilled(true);
    // Пресеты приходят один раз; дальше значения правит сам пользователь.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets]);

  async function calc() {
    setLoading(true);
    try {
      const r = await apiFetch(`/forces/calc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (r.ok) setRes(await r.json());
    } finally {
      setLoading(false);
    }
  }

  // Автосчёт: на старте и повторно, когда подставлены параметры из пакета
  // (флаг переключается вместе с setP, поэтому считается уже по новым значениям).
  useEffect(() => {
    calc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled]);

  const set = (k: string, v: number | string) => setP((s) => ({ ...s, [k]: v }));

  /** Numeric field bound to a param key — same logic as original `num()` helper */
  function num(k: keyof typeof defaults, label: string, step = 1) {
    return (
      <Field label={t(label)}>
        <Input
          type="number"
          step={step}
          value={p[k] as number}
          onChange={(e) => set(k, Number(e.target.value))}
        />
      </Field>
    );
  }

  /* Rank → severity mapping. Сравнение шло со строкой «№ 3» с пробелом, а API
     отдаёт «№3» — ранг №3 и №4 подсвечивались как повышенный. */
  const rankNum = res ? Number(res.result.rank.replace(/\D+/g, "")) : 0;
  const rankSev =
    rankNum >= 3 ? SEVERITY.critical : rankNum === 2 ? SEVERITY.high : SEVERITY.elevated;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Расчёт сил и средств")}
          subtitle={t(
            "Методика ДЧС РК · «Есеп Евразия» — время развития, геометрия пожара, расход воды, стволы, машины, личный состав, ранг",
          )}
        />

        {/* Пришли из боевого пакета — видно, по какому объекту считаем и что
            именно подставлено; расчёт по ПТП объекта всегда главнее калькулятора. */}
        {fromPack && (
          <Banner
            tone={packSource === "card" ? "info" : "warning"}
            title={`${t("Расчёт для объекта:")} ${fromPack}`}
            className="mt-4"
          >
            <div className="space-y-1.5">
              <p>
                {t(
                  "Из пакета вызова подставлены тип объекта, этаж (верхний по объекту) и расстояние до части. Уточните их под фактическую обстановку.",
                )}
              </p>
              {packSource === "card" ? (
                <div>
                  <p>{t("По объекту есть расчёт по ПТП — при расхождении верен он.")}</p>
                  {ptp && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-fg">
                      {ptp.rank && (
                        <span>
                          {t("Ранг пожара")}{" "}
                          <span className="font-semibold tabular">{ptp.rank}</span>
                        </span>
                      )}
                      {ptp.barrels_ext != null && ptp.barrels_def != null && (
                        <span>
                          {t("Стволы (туш.+защ.)")}{" "}
                          <span className="font-semibold tabular">
                            {ptp.barrels_ext}+{ptp.barrels_def}
                          </span>
                        </span>
                      )}
                      {ptp.squads != null && (
                        <span>
                          {t("Отделений")}{" "}
                          <span className="font-semibold tabular">{ptp.squads}</span>
                        </span>
                      )}
                      {ptp.q_req_l_s != null && (
                        <span>
                          {t("Qобщ.тр, л/с")}{" "}
                          <span className="font-semibold tabular">{ptp.q_req_l_s.toFixed(2)}</span>
                        </span>
                      )}
                    </p>
                  )}
                  {packCardId && (
                    <LinkButton
                      href={`/cards?id=${packCardId}`}
                      variant="ghost"
                      size="sm"
                      className="mt-1"
                    >
                      <ScanLine className="h-3.5 w-3.5" />
                      {t("Расчёт в карточке ПТП")}
                    </LinkButton>
                  )}
                </div>
              ) : (
                <p>
                  {t(
                    "Расчёта по ПТП для объекта нет — пресет подобран по типу здания, это черновая прикидка.",
                  )}
                </p>
              )}
            </div>
          </Banner>
        )}

        <div className="mt-6 grid gap-5 lg:grid-cols-[360px_1fr]">
          {/* ── LEFT: Form ── */}
          <Card className="h-fit p-5 space-y-5">
            {/* Объект */}
            <FormSection label={t("Объект")}>
              <Field label={t("Тип объекта")}>
                <Select
                  value={presetKey}
                  onChange={(e) => {
                    const pr = presets.find((x) => x.key === e.target.value);
                    setPresetKey(e.target.value);
                    if (pr) setP((s) => ({ ...s, vl: pr.vl, jtr: pr.jtr }));
                  }}
                >
                  {presets.map((pr) => (
                    <option key={pr.key} value={pr.key}>
                      {pr.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                {num("vl", "Vл, м/мин", 0.1)}
                {num("jtr", "Jтр, л/с·м²", 0.01)}
              </div>
            </FormSection>

            <div className="border-t border-border" />

            {/* Геометрия */}
            <FormSection label={t("Геометрия пожара")}>
              <div className="grid grid-cols-2 gap-3">
                {num("directions", "Направлений n")}
                {num("width_m", "Ширина a, м")}
                {num("depth_m", "Глубина h, м")}
                <Field label={t("Ствол")}>
                  <Select
                    value={p.barrel}
                    onChange={(e) => set("barrel", e.target.value)}
                  >
                    {barrels.map((b) => (
                      <option key={b.key} value={b.key}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {num("floor", "Этаж пожара")}
              </div>
              <p className="text-xs text-faint">
                {t("Этаж влияет на время развёртывания, звенья ГДЗС и напор. Отрицательный — подвал.")}
              </p>
            </FormSection>

            <div className="border-t border-border" />

            {/* Логистика */}
            <FormSection label={t("Логистика")}>
              <div className="grid grid-cols-2 gap-3">
                {num("distance_km", "Расст. до ПЧ, км", 0.1)}
                {num("travel_speed_kmh", "Скорость, км/ч")}
                {num("hose_lay_m", "Рукав. линия, м")}
                {num("supply_per_truck", "Подача АЦ, л/с")}
              </div>
            </FormSection>

            <div className="border-t border-border" />

            {/* Время */}
            <FormSection label={t("Время (мин)")}>
              <div className="grid grid-cols-2 gap-3">
                {num("detection_min", "Тобн, мин", 0.5)}
                {num("gather_min", "Тсбора, мин", 0.5)}
              </div>
            </FormSection>

            <Button
              className="w-full mt-1"
              onClick={calc}
              disabled={loading}
              aria-label={t("Рассчитать")}
            >
              <Calculator className="h-4 w-4" aria-hidden />
              {loading ? t("Вычисляем…") : t("Рассчитать")}
            </Button>
          </Card>

          {/* ── RIGHT: Results ── */}
          <section aria-label={t("Результаты расчёта")} className="space-y-4">
            {res === null ? (
              <EmptyState
                icon={ChevronDown}
                title={t("Результаты появятся здесь")}
                description={t("Задайте параметры и нажмите «Рассчитать»")}
                className="h-full min-h-[320px]"
              />
            ) : (
              <div className="fw-fade-in space-y-4">
                {/* Тактические предупреждения методики (высота, подвал, ГДЗС,
                    напор) — считались и раньше, но на экран не выводились. */}
                {(res.result.warnings ?? []).map((w) => (
                  <Banner key={w} tone="warning">
                    {w}
                  </Banner>
                ))}

                {/* Headline metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricCard
                    label={t("Ранг пожара")}
                    value={res.result.rank}
                    icon={Flame}
                    severity={rankSev}
                    hint={t("по методике ДЧС РК")}
                  />
                  <MetricCard
                    label={t("Стволы (туш.+защ.)")}
                    value={`${res.result.barrels_ext}+${res.result.barrels_def}`}
                    icon={Crosshair}
                    hint={`${res.result.barrels_ext + res.result.barrels_def} ${t("ствола всего")}`}
                  />
                  <MetricCard
                    label={t("Пож. машины (АЦ)")}
                    value={res.result.trucks}
                    icon={Truck}
                    hint={`${res.result.squads} ${t("отд.")}`}
                  />
                  <MetricCard
                    label={t("Личный состав")}
                    value={res.result.personnel}
                    icon={Users}
                    hint={t("чел. на тушение")}
                  />
                </div>

                {/* Three detail groups */}
                <div className="grid gap-3 md:grid-cols-3">
                  <GroupCard title={t("Время развития (мин)")} icon={Clock}>
                    <Row k={t("Тследования")} v={res.time.t_travel} />
                    <Row k={t("Тразвёртывания")} v={res.time.t_deploy} />
                    <div className="my-1 border-t border-border" />
                    <Row k={t("Т1св (свободного)")} v={res.time.t_free} bold />
                  </GroupCard>

                  <GroupCard title={t("Геометрия пожара")} icon={Layers}>
                    <Row k={t("Путь огня R, м")} v={res.fire.radius_m} />
                    <Row k={t("Sпожара, м²")} v={res.fire.s_fire_m2} />
                    <div className="my-1 border-t border-border" />
                    <Row k={t("Sтушения, м²")} v={res.fire.s_ext_m2} bold />
                  </GroupCard>

                  <GroupCard title={t("Расход воды (л/с)")} icon={Droplets}>
                    <Row k={t("Qтр тушение")} v={res.flow.q_req_ext} />
                    <Row k={t("Qтр защита")} v={res.flow.q_req_def} />
                    <div className="my-1 border-t border-border" />
                    <Row k={t("Qфакт")} v={res.flow.q_act} bold />
                  </GroupCard>
                </div>

                {/* Bottom two groups */}
                <div className="grid gap-3 md:grid-cols-2">
                  <GroupCard title={t("Личный состав — расшифровка")} icon={Users}>
                    {Object.entries(res.result.personnel_breakdown).map(([k, v]) => (
                      <Row key={k} k={k} v={v} />
                    ))}
                  </GroupCard>

                  <GroupCard title={t("Итоги")} icon={BarChart3}>
                    <Row k={t("Отделений")} v={res.result.squads} bold />
                    <Row k={t("Ранг пожара")} v={res.result.rank} bold />
                    <div className="my-1 border-t border-border" />
                    <Row
                      k={t("Вода на 10 мин, л")}
                      v={res.result.water_liters_10min.toLocaleString(intlLocale(locale))}
                      bold
                    />
                  </GroupCard>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
