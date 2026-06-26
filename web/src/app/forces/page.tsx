"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

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

export default function ForcesPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [barrels, setBarrels] = useState<Barrel[]>([]);
  const [p, setP] = useState({ ...defaults });
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/forces/presets`)
      .then((r) => r.json())
      .then((d) => {
        setPresets(d.objects);
        setBarrels(d.barrels);
      })
      .catch(() => {});
  }, []);

  async function calc() {
    const r = await fetch(`${API_URL}/forces/calc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    if (r.ok) setRes(await r.json());
  }

  useEffect(() => {
    calc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string, v: number | string) => setP((s) => ({ ...s, [k]: v }));
  const num = (k: keyof typeof defaults, label: string, step = 1) => (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      {label}
      <input
        type="number"
        step={step}
        value={p[k] as number}
        onChange={(e) => set(k, Number(e.target.value))}
        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
      />
    </label>
  );

  return (
    <AppShell>
      <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Расчёт сил и средств</h1>
        <p className="text-sm text-neutral-400">
          Методика ДЧС РК · по «Есеп Евразия» — время развития, площадь, расход
          воды, стволы, машины, личный состав, ранг
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Form */}
        <section className="space-y-4 rounded-md border border-neutral-800 bg-neutral-950 p-4">
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Тип объекта
            <select
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
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
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            {num("vl", "Vл, м/мин", 0.1)}
            {num("jtr", "Jтр, л/с·м²", 0.01)}
            {num("directions", "Направлений n")}
            {num("width_m", "Ширина a, м")}
            {num("depth_m", "Глубина h, м")}
            <label className="flex flex-col gap-1 text-xs text-neutral-400">
              Ствол
              <select
                value={p.barrel}
                onChange={(e) => set("barrel", e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
              >
                {barrels.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            {num("distance_km", "Расст. до ПЧ, км", 0.1)}
            {num("travel_speed_kmh", "Скорость, км/ч")}
            {num("hose_lay_m", "Рукав. линия, м")}
            {num("supply_per_truck", "Подача АЦ, л/с")}
            {num("detection_min", "Тобн, мин", 0.5)}
            {num("gather_min", "Тсбора, мин", 0.5)}
          </div>

          <button
            onClick={calc}
            className="w-full rounded-md px-4 py-2 text-sm font-medium text-black"
            style={{ background: "var(--fw-accent)" }}
          >
            Рассчитать
          </button>
        </section>

        {/* Result */}
        {res && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Big value={res.result.rank} label="Ранг пожара" accent />
              <Big
                value={`${res.result.barrels_ext}+${res.result.barrels_def}`}
                label="Стволы (туш.+защ.)"
              />
              <Big value={res.result.trucks} label="Пож. машины (АЦ)" />
              <Big value={res.result.personnel} label="Личный состав" />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Group title="Время развития (мин)">
                <Row k="Тследования" v={res.time.t_travel} />
                <Row k="Тразвёртывания" v={res.time.t_deploy} />
                <Row k="Т1св (свободного)" v={res.time.t_free} bold />
              </Group>
              <Group title="Геометрия пожара">
                <Row k="Путь огня R, м" v={res.fire.radius_m} />
                <Row k="Sпожара, м²" v={res.fire.s_fire_m2} />
                <Row k="Sтушения, м²" v={res.fire.s_ext_m2} bold />
              </Group>
              <Group title="Расход воды (л/с)">
                <Row k="Qтр тушение" v={res.flow.q_req_ext} />
                <Row k="Qтр защита" v={res.flow.q_req_def} />
                <Row k="Qфакт" v={res.flow.q_act} bold />
              </Group>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Group title="Личный состав — расшифровка">
                {Object.entries(res.result.personnel_breakdown).map(([k, v]) => (
                  <Row key={k} k={k} v={v} />
                ))}
              </Group>
              <Group title="Итоги">
                <Row k="Отделений" v={res.result.squads} bold />
                <Row k="Ранг пожара" v={res.result.rank} bold />
                <Row
                  k="Вода на 10 мин, л"
                  v={res.result.water_liters_10min.toLocaleString("ru")}
                />
              </Group>
            </div>
          </section>
        )}
      </div>
      </div>
    </AppShell>
  );
}

function Big({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
      <div
        className="text-3xl font-bold"
        style={{ color: accent ? "#ff5a1f" : "#fff" }}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-neutral-500">
        {label}
      </div>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
      <p className="mb-2 text-xs tracking-widest text-neutral-500">{title}</p>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

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
    <div className="flex justify-between gap-3">
      <span className="text-neutral-400">{k}</span>
      <span className={bold ? "font-semibold text-neutral-100" : "text-neutral-200"}>
        {v}
      </span>
    </div>
  );
}
