"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

type Inspector = { id: number; name: string; district: string };
type Stop = {
  order: number;
  time: string;
  building_id: number;
  address: string;
  type_label: string;
  year_built: number | null;
  score: number;
  last_inspected: string | null;
  days_since: number;
  note: string | null;
};
type Route = {
  inspector: Inspector;
  date: string;
  district: string;
  stops: Stop[];
};

function scoreColor(s: number): string {
  if (s <= 35) return "#2ecc71";
  if (s <= 70) return "#f1c40f";
  return "#e74c3c";
}

export default function RoutesPage() {
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/inspectors`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Inspector[]) => {
        setInspectors(list);
        if (list.length) setSelected(list[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selected == null) return;
    fetch(`${API_URL}/routes/today?inspector_id=${selected}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRoute)
      .catch(() => setRoute(null));
  }, [selected]);

  return (
    <AppShell>
      <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Автоматический план инспекций</h1>
        <p className="text-sm text-neutral-400">
          Маршрут на день · приоритет по риску, сроку проверки и географии
        </p>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <label className="text-xs tracking-widest text-neutral-500">
          ИНСПЕКТОР
        </label>
        <select
          value={selected ?? ""}
          onChange={(e) => setSelected(Number(e.target.value))}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        >
          {inspectors.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · {i.district} р-н
            </option>
          ))}
        </select>
      </div>

      {route && (
        <div className="rounded-md border border-neutral-800 bg-neutral-950 p-5">
          <div className="mb-4 flex items-baseline justify-between border-b border-neutral-800 pb-3">
            <div>
              <p className="text-sm font-semibold">
                Маршрут на{" "}
                {new Date(route.date).toLocaleDateString("ru", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <p className="text-xs text-neutral-500">
                {route.district} р-н · {route.stops.length} объектов
              </p>
            </div>
            <span className="text-xs tracking-widest text-neutral-500">
              ИНСПЕКТОР · {route.inspector.name}
            </span>
          </div>

          <ol className="space-y-2">
            {route.stops.map((s) => {
              const hot = s.score >= 85;
              return (
                <li
                  key={s.building_id}
                  className={`flex items-center gap-4 rounded-md border px-4 py-3 ${
                    hot
                      ? "border-orange-700/70 bg-orange-950/20"
                      : "border-neutral-800 bg-neutral-900/40"
                  }`}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: hot ? "var(--fw-accent)" : "#262626",
                      color: hot ? "#000" : "#a3a3a3",
                    }}
                  >
                    {s.order}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-100">
                      {s.address}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {[
                        s.type_label,
                        s.note,
                        `посл. пров. ${
                          s.last_inspected
                            ? new Date(s.last_inspected).toLocaleDateString("ru")
                            : "—"
                        }`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  <span
                    className="text-lg font-bold"
                    style={{ color: scoreColor(s.score) }}
                  >
                    {s.score}
                  </span>
                  <span className="w-12 text-right text-xs text-neutral-500">
                    {s.time}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      </div>
    </AppShell>
  );
}
