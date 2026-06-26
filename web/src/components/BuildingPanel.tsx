"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

type Factor = { feature: string; value: number };
type Detail = {
  id: number;
  address: string;
  type_label: string;
  year_built: number | null;
  floors: number | null;
  score: number | null;
  model_version: string | null;
  explanation: Factor[];
};

function scoreColor(score: number): string {
  if (score <= 35) return "#2ecc71";
  if (score <= 70) return "#f1c40f";
  return "#e74c3c";
}

export default function BuildingPanel({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (id == null) return;
    setLoading(true);
    setData(null);
    fetch(`${API_URL}/buildings/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (id == null) return null;

  const maxAbs =
    data?.explanation.reduce((m, f) => Math.max(m, Math.abs(f.value)), 0) || 1;

  return (
    <aside className="absolute right-0 top-0 z-20 h-full w-[380px] overflow-y-auto border-l border-neutral-800 bg-neutral-950/95 p-5 backdrop-blur">
      <div className="flex items-start justify-between">
        <span className="text-xs tracking-widest text-neutral-500">
          ОБЪЕКТ · {String(id).padStart(3, "0")}
        </span>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-200"
          aria-label="Закрыть"
        >
          ✕
        </button>
      </div>

      {loading && <p className="mt-6 text-sm text-neutral-500">Загрузка…</p>}

      {data && (
        <>
          <h2 className="mt-2 text-lg font-semibold leading-tight">
            {data.address}
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            {[
              data.type_label,
              data.floors ? `${data.floors} эт.` : null,
              data.year_built ?? null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {data.score != null && (
            <div className="mt-5">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-5xl font-bold"
                  style={{ color: scoreColor(data.score) }}
                >
                  {data.score}
                </span>
                <span className="text-sm text-neutral-500">/ 100 риск</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded bg-neutral-800">
                <div
                  className="h-1.5 rounded"
                  style={{
                    width: `${data.score}%`,
                    background: scoreColor(data.score),
                  }}
                />
              </div>
            </div>
          )}

          {data.explanation.length > 0 && (
            <div className="mt-6">
              <p className="text-xs tracking-widest text-neutral-500">
                SHAP · ВКЛАД ФАКТОРОВ
              </p>
              <ul className="mt-3 space-y-2">
                {data.explanation.map((f) => {
                  const positive = f.value >= 0;
                  return (
                    <li key={f.feature} className="text-xs">
                      <div className="flex justify-between text-neutral-300">
                        <span>{f.feature}</span>
                        <span style={{ color: positive ? "#e74c3c" : "#2ecc71" }}>
                          {positive ? "+" : ""}
                          {f.value.toFixed(1)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded bg-neutral-800">
                        <div
                          className="h-1.5 rounded"
                          style={{
                            width: `${(Math.abs(f.value) / maxAbs) * 100}%`,
                            background: positive ? "#e74c3c" : "#2ecc71",
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="mt-6 text-[10px] tracking-widest text-neutral-600">
            МОДЕЛЬ · {data.model_version ?? "—"}
          </p>
        </>
      )}
    </aside>
  );
}
