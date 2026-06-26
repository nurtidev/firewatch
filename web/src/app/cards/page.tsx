"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch, apiSrc } from "@/lib/auth";

type Prescription = {
  issue: string | null;
  recommendation: string;
  deadline_days: number | null;
  severity: string | null;
};
type Card = {
  id: number;
  filename: string;
  media_type: string;
  created_at: string;
  extracted: Record<string, unknown>;
  prescriptions: Prescription[];
};
type CardListItem = {
  id: number;
  filename: string;
  address: string | null;
  prescriptions: number;
  created_at: string;
};

const FIELDS: [string, string][] = [
  ["object_name", "Объект"],
  ["address", "Адрес"],
  ["object_type", "Тип объекта"],
  ["category", "Категория"],
  ["fire_resistance", "Огнестойкость"],
  ["floors", "Этажность / блоки"],
  ["year_built", "Год постройки"],
  ["construction", "Конструктив"],
  ["fire_systems", "АПС / АУПТ"],
  ["water_source", "Водоснабжение"],
  ["nearest_station", "Ближайшая ПЧ"],
  ["distance_to_station", "Расстояние до ПЧ"],
  ["arrival_time", "Время прибытия"],
  ["fire_rank", "Ранг пожара"],
  ["contacts", "Контакты"],
  ["staff_day", "Персонал днём"],
  ["staff_night", "Персонал ночью"],
  ["evacuation", "Эвакуация"],
  ["notes", "Примечания"],
];

const SEV_COLOR: Record<string, string> = {
  high: "#e74c3c",
  medium: "#e67e22",
  low: "#f1c40f",
};

export default function CardsPage() {
  const [card, setCard] = useState<Card | null>(null);
  const [list, setList] = useState<CardListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshList = () =>
    apiFetch(`/cards`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setList)
      .catch(() => {});

  useEffect(() => {
    refreshList();
  }, []);

  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setLoading(true);
    setError(null);
    setCard(null);
    const body = new FormData();
    body.append("file", f);
    try {
      const res = await apiFetch(`/cards`, { method: "POST", body });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.detail || `Ошибка ${res.status}`);
      }
      setCard(await res.json());
      refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обработать файл");
    } finally {
      setLoading(false);
    }
  }

  async function openCard(id: number) {
    const res = await apiFetch(`/cards/${id}`);
    if (res.ok) setCard(await res.json());
  }

  return (
    <AppShell>
      <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            ИИ-обработка оперкарточек
          </h1>
          <p className="text-sm text-neutral-400">
            Скан/PDF → извлечение полей по форме МЧС РК → автопредписания · Claude
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 p-4">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="text-sm text-neutral-300 file:mr-3 file:rounded file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-200"
        />
        <button
          onClick={upload}
          disabled={loading}
          className="rounded-md px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          style={{ background: "var(--fw-accent)" }}
        >
          {loading ? "Обработка…" : "Извлечь данные"}
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {card && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
            <p className="mb-2 text-xs tracking-widest text-neutral-500">
              ОРИГИНАЛ · {card.filename}
            </p>
            {card.media_type === "application/pdf" ? (
              <iframe
                src={apiSrc(`/cards/${card.id}/file`)}
                className="h-[560px] w-full rounded bg-white"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={apiSrc(`/cards/${card.id}/file`)}
                alt="Оригинал карточки"
                className="max-h-[560px] w-full rounded object-contain"
              />
            )}
          </section>

          <section>
            <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4">
              <p className="mb-3 text-xs tracking-widest text-green-500">
                ИЗВЛЕЧЕНО ИИ
              </p>
              <dl className="space-y-1.5 text-sm">
                {FIELDS.map(([key, label]) => {
                  const v = card.extracted?.[key];
                  if (v == null || v === "") return null;
                  return (
                    <div key={key} className="flex gap-3">
                      <dt className="w-32 shrink-0 text-neutral-500">{label}</dt>
                      <dd className="text-neutral-200">{String(v)}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>

            {card.prescriptions.length > 0 && (
              <div className="mt-4 rounded-md border border-orange-900/60 bg-orange-950/20 p-4">
                <p className="mb-3 text-xs tracking-widest text-orange-400">
                  ПРЕДПИСАНИЯ СФОРМИРОВАНЫ АВТОМАТИЧЕСКИ
                </p>
                <ol className="space-y-3">
                  {card.prescriptions.map((p, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: SEV_COLOR[p.severity ?? "low"] }}
                        />
                        <div>
                          {p.issue && (
                            <p className="text-neutral-400">{p.issue}</p>
                          )}
                          <p className="text-neutral-100">
                            {p.recommendation}
                            {p.deadline_days != null && (
                              <span className="text-neutral-500">
                                {" "}
                                · срок {p.deadline_days} дн.
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        </div>
      )}

      {list.length > 0 && (
        <div className="mt-10">
          <p className="mb-3 text-xs tracking-widest text-neutral-500">
            ОБРАБОТАННЫЕ КАРТОЧКИ
          </p>
          <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => openCard(c.id)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-neutral-900"
                >
                  <span className="text-neutral-200">
                    {c.address || c.filename}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {c.prescriptions} предпис. ·{" "}
                    {new Date(c.created_at).toLocaleDateString("ru")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </AppShell>
  );
}
