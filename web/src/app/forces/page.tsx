"use client";

import { useEffect, useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { SEVERITY } from "@/lib/risk";
import {
  Card,
  PageHeader,
  MetricCard,
  SectionLabel,
  Button,
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
  };
};

/* ── Defaults (identical keys to original) ── */
const defaults = {
  vl: 1.0,
  jtr: 0.1,
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
  const [presets, setPresets] = useState<Preset[]>([]);
  const [barrels, setBarrels] = useState<Barrel[]>([]);
  const [p, setP] = useState({ ...defaults });
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch(`/forces/presets`)
      .then((r) => r.json())
      .then((d) => {
        setPresets(d.objects);
        setBarrels(d.barrels);
      })
      .catch(() => {});
  }, []);

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

  // Auto-calc on mount (matches original behaviour)
  useEffect(() => {
    calc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string, v: number | string) => setP((s) => ({ ...s, [k]: v }));

  /** Numeric field bound to a param key — same logic as original `num()` helper */
  function num(k: keyof typeof defaults, label: string, step = 1) {
    return (
      <Field label={label}>
        <Input
          type="number"
          step={step}
          value={p[k] as number}
          onChange={(e) => set(k, Number(e.target.value))}
        />
      </Field>
    );
  }

  /* Rank → severity mapping */
  const rankSev =
    res?.result.rank === "№ 3" || res?.result.rank === "№ 4" || res?.result.rank === "№ 5"
      ? SEVERITY.critical
      : res?.result.rank === "№ 2"
        ? SEVERITY.high
        : SEVERITY.elevated;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title="Расчёт сил и средств"
          subtitle="Методика ДЧС РК · «Есеп Евразия» — время развития, геометрия пожара, расход воды, стволы, машины, личный состав, ранг"
        />

        <div className="mt-6 grid gap-5 lg:grid-cols-[360px_1fr]">
          {/* ── LEFT: Form ── */}
          <Card className="h-fit p-5 space-y-5">
            {/* Объект */}
            <FormSection label="Объект">
              <Field label="Тип объекта">
                <Select
                  onChange={(e) => {
                    const pr = presets.find((x) => x.key === e.target.value);
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
            <FormSection label="Геометрия пожара">
              <div className="grid grid-cols-2 gap-3">
                {num("directions", "Направлений n")}
                {num("width_m", "Ширина a, м")}
                {num("depth_m", "Глубина h, м")}
                <Field label="Ствол">
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
              </div>
            </FormSection>

            <div className="border-t border-border" />

            {/* Логистика */}
            <FormSection label="Логистика">
              <div className="grid grid-cols-2 gap-3">
                {num("distance_km", "Расст. до ПЧ, км", 0.1)}
                {num("travel_speed_kmh", "Скорость, км/ч")}
                {num("hose_lay_m", "Рукав. линия, м")}
                {num("supply_per_truck", "Подача АЦ, л/с")}
              </div>
            </FormSection>

            <div className="border-t border-border" />

            {/* Время */}
            <FormSection label="Время (мин)">
              <div className="grid grid-cols-2 gap-3">
                {num("detection_min", "Тобн, мин", 0.5)}
                {num("gather_min", "Тсбора, мин", 0.5)}
              </div>
            </FormSection>

            <Button
              className="w-full mt-1"
              onClick={calc}
              disabled={loading}
              aria-label="Рассчитать"
            >
              <Calculator className="h-4 w-4" aria-hidden />
              {loading ? "Вычисляем…" : "Рассчитать"}
            </Button>
          </Card>

          {/* ── RIGHT: Results ── */}
          <section aria-label="Результаты расчёта" className="space-y-4">
            {res === null ? (
              <EmptyState
                icon={ChevronDown}
                title="Результаты появятся здесь"
                description="Задайте параметры и нажмите «Рассчитать»"
                className="h-full min-h-[320px]"
              />
            ) : (
              <div className="fw-fade-in space-y-4">
                {/* Headline metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricCard
                    label="Ранг пожара"
                    value={res.result.rank}
                    icon={Flame}
                    severity={rankSev}
                    hint="по методике ДЧС РК"
                  />
                  <MetricCard
                    label="Стволы (туш.+защ.)"
                    value={`${res.result.barrels_ext}+${res.result.barrels_def}`}
                    icon={Crosshair}
                    hint={`${res.result.barrels_ext + res.result.barrels_def} ствола всего`}
                  />
                  <MetricCard
                    label="Пож. машины (АЦ)"
                    value={res.result.trucks}
                    icon={Truck}
                    hint={`${res.result.squads} отд.`}
                  />
                  <MetricCard
                    label="Личный состав"
                    value={res.result.personnel}
                    icon={Users}
                    hint="чел. на тушение"
                  />
                </div>

                {/* Three detail groups */}
                <div className="grid gap-3 md:grid-cols-3">
                  <GroupCard title="Время развития (мин)" icon={Clock}>
                    <Row k="Тследования" v={res.time.t_travel} />
                    <Row k="Тразвёртывания" v={res.time.t_deploy} />
                    <div className="my-1 border-t border-border" />
                    <Row k="Т1св (свободного)" v={res.time.t_free} bold />
                  </GroupCard>

                  <GroupCard title="Геометрия пожара" icon={Layers}>
                    <Row k="Путь огня R, м" v={res.fire.radius_m} />
                    <Row k="Sпожара, м²" v={res.fire.s_fire_m2} />
                    <div className="my-1 border-t border-border" />
                    <Row k="Sтушения, м²" v={res.fire.s_ext_m2} bold />
                  </GroupCard>

                  <GroupCard title="Расход воды (л/с)" icon={Droplets}>
                    <Row k="Qтр тушение" v={res.flow.q_req_ext} />
                    <Row k="Qтр защита" v={res.flow.q_req_def} />
                    <div className="my-1 border-t border-border" />
                    <Row k="Qфакт" v={res.flow.q_act} bold />
                  </GroupCard>
                </div>

                {/* Bottom two groups */}
                <div className="grid gap-3 md:grid-cols-2">
                  <GroupCard title="Личный состав — расшифровка" icon={Users}>
                    {Object.entries(res.result.personnel_breakdown).map(([k, v]) => (
                      <Row key={k} k={k} v={v} />
                    ))}
                  </GroupCard>

                  <GroupCard title="Итоги" icon={BarChart3}>
                    <Row k="Отделений" v={res.result.squads} bold />
                    <Row k="Ранг пожара" v={res.result.rank} bold />
                    <div className="my-1 border-t border-border" />
                    <Row
                      k="Вода на 10 мин, л"
                      v={res.result.water_liters_10min.toLocaleString("ru")}
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
