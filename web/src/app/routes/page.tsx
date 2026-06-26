"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth";

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
  note: string | null;
  status: "pending" | "done" | "violation";
};
type Route = {
  inspector: Inspector;
  date: string;
  district: string;
  stops: Stop[];
  done: number;
  total: number;
};
type ChecklistItem = { key: string; label: string };

function scoreColor(s: number): string {
  if (s <= 35) return "#2ecc71";
  if (s <= 70) return "#f1c40f";
  return "#e74c3c";
}

const STATUS_LABEL = {
  pending: "Не проверено",
  done: "Выполнено",
  violation: "Нарушение",
};
const STATUS_COLOR = {
  pending: "#737373",
  done: "#2ecc71",
  violation: "#e74c3c",
};

export default function RoutesPage() {
  const { user } = useAuth();
  const isInspector = user?.role === "inspector";

  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [openStop, setOpenStop] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/routes/checklist`)
      .then((r) => r.json())
      .then(setChecklist)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/inspectors`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Inspector[]) => {
        setInspectors(list);
        // Inspector role → their own record (match by name); others → first.
        const mine = list.find((i) => i.name === user?.name);
        setSelected((isInspector && mine ? mine : list[0])?.id ?? null);
      })
      .catch(() => {});
  }, [user, isInspector]);

  const loadRoute = useCallback(() => {
    if (selected == null) return;
    fetch(`${API_URL}/routes/today?inspector_id=${selected}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRoute)
      .catch(() => setRoute(null));
  }, [selected]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">
            {isInspector ? "Мой маршрут на сегодня" : "Автоматический план инспекций"}
          </h1>
          <p className="text-sm text-neutral-400">
            Маршрут на день · приоритет по риску, сроку проверки и географии
          </p>
        </div>

        {!isInspector && (
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
        )}

        {route && (
          <div className="max-w-3xl rounded-md border border-neutral-800 bg-neutral-950 p-5">
            <div className="mb-4 flex items-baseline justify-between border-b border-neutral-800 pb-3">
              <div>
                <p className="text-sm font-semibold">
                  Маршрут на{" "}
                  {new Date(route.date).toLocaleDateString("ru", {
                    day: "numeric",
                    month: "long",
                  })}
                </p>
                <p className="text-xs text-neutral-500">
                  {route.district} р-н · {route.inspector.name}
                </p>
              </div>
              <span className="text-sm">
                <span style={{ color: "var(--fw-accent)" }} className="font-bold">
                  {route.done}
                </span>
                <span className="text-neutral-500"> / {route.total} выполнено</span>
              </span>
            </div>

            <ol className="space-y-2">
              {route.stops.map((s) => (
                <StopRow
                  key={s.building_id}
                  stop={s}
                  checklist={checklist}
                  inspectorId={route.inspector.id}
                  canMark={isInspector}
                  open={openStop === s.building_id}
                  onToggle={() =>
                    setOpenStop(openStop === s.building_id ? null : s.building_id)
                  }
                  onSaved={() => {
                    setOpenStop(null);
                    loadRoute();
                  }}
                />
              ))}
            </ol>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StopRow({
  stop,
  checklist,
  inspectorId,
  canMark,
  open,
  onToggle,
  onSaved,
}: {
  stop: Stop;
  checklist: ChecklistItem[];
  inspectorId: number;
  canMark: boolean;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(status: "done" | "violation") {
    setSaving(true);
    try {
      await fetch(`${API_URL}/routes/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspector_id: inspectorId,
          building_id: stop.building_id,
          status,
          checklist: marks,
          note: note || null,
        }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const hot = stop.score >= 85;
  const done = stop.status !== "pending";

  return (
    <li
      className={`rounded-md border ${
        done
          ? "border-neutral-800 bg-neutral-900/30"
          : hot
            ? "border-orange-700/70 bg-orange-950/20"
            : "border-neutral-800 bg-neutral-900/40"
      }`}
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{
            background: done ? STATUS_COLOR[stop.status] : hot ? "var(--fw-accent)" : "#262626",
            color: done || hot ? "#000" : "#a3a3a3",
          }}
        >
          {done ? (stop.status === "done" ? "✓" : "!") : stop.order}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-neutral-100">{stop.address}</p>
          <p className="truncate text-xs text-neutral-500">
            {[stop.type_label, stop.note, `риск ${stop.score}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className="hidden text-xs sm:inline"
          style={{ color: STATUS_COLOR[stop.status] }}
        >
          {STATUS_LABEL[stop.status]}
        </span>
        <span className="w-12 text-right text-xs text-neutral-500">{stop.time}</span>
        {canMark && (
          <button
            onClick={onToggle}
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {open ? "Свернуть" : "Отметить"}
          </button>
        )}
      </div>

      {canMark && open && (
        <div className="border-t border-neutral-800 px-4 py-3">
          <div className="space-y-1.5">
            {checklist.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 text-sm text-neutral-300"
              >
                <input
                  type="checkbox"
                  checked={!!marks[c.key]}
                  onChange={(e) =>
                    setMarks((m) => ({ ...m, [c.key]: e.target.checked }))
                  }
                  className="h-4 w-4 accent-orange-500"
                />
                {c.label}
              </label>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Примечание / описание нарушения"
            rows={2}
            className="mt-3 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => save("done")}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
              style={{ background: "#2ecc71" }}
            >
              Выполнено
            </button>
            <button
              onClick={() => save("violation")}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#e74c3c" }}
            >
              Зафиксировать нарушение
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
