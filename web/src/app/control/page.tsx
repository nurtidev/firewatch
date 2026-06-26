"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

type Stop = {
  building_id: number;
  address: string;
  score: number;
  status: "pending" | "done" | "violation";
};
type Progress = {
  inspector: { id: number; name: string; district: string };
  total: number;
  done: number;
  violations: number;
  stops: Stop[];
};

const DOT: Record<string, string> = {
  pending: "#3f3f46",
  done: "#2ecc71",
  violation: "#e74c3c",
};

export default function ControlPage() {
  const [data, setData] = useState<Progress[]>([]);
  const [updated, setUpdated] = useState<string>("");

  const load = useCallback(() => {
    fetch(`${API_URL}/routes/progress`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        setData(d);
        setUpdated(new Date().toLocaleTimeString("ru"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live refresh
    return () => clearInterval(t);
  }, [load]);

  const totalDone = data.reduce((a, p) => a + p.done, 0);
  const totalAll = data.reduce((a, p) => a + p.total, 0);
  const totalViol = data.reduce((a, p) => a + p.violations, 0);

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Контроль выполнения</h1>
            <p className="text-sm text-neutral-400">
              Маршруты инспекторов в реальном времени
            </p>
          </div>
          <div className="text-right text-xs text-neutral-500">
            <div>
              <span className="font-bold text-white">{totalDone}</span> / {totalAll}{" "}
              выполнено · <span className="text-red-400">{totalViol}</span> нарушений
            </div>
            <div>обновлено {updated}</div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => {
            const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
            return (
              <div
                key={p.inspector.id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4"
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-sm font-semibold text-neutral-100">
                    {p.inspector.name}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {p.inspector.district} р-н
                  </div>
                </div>

                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold" style={{ color: "var(--fw-accent)" }}>
                    {p.done}
                  </span>
                  <span className="text-sm text-neutral-500">/ {p.total}</span>
                  {p.violations > 0 && (
                    <span className="ml-auto text-xs text-red-400">
                      {p.violations} наруш.
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1.5 w-full rounded bg-neutral-800">
                  <div
                    className="h-1.5 rounded"
                    style={{ width: `${pct}%`, background: "var(--fw-accent)" }}
                  />
                </div>

                <div className="mt-3 space-y-1">
                  {p.stops.map((s) => (
                    <div key={s.building_id} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: DOT[s.status] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-neutral-300">
                        {s.address}
                      </span>
                      <span className="text-neutral-600">{s.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
