"use client";

import { useEffect, useRef, useState } from "react";
import {
  Upload,
  FileText,
  Image as ImageIcon,
  AlertOctagon,
  Calendar,
  Clock,
  MapPin,
  ServerCrash,
  ScanLine,
  ChevronRight,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, apiSrc } from "@/lib/auth";
import { SEVERITY, type Severity } from "@/lib/risk";
import {
  Card,
  PageHeader,
  SectionLabel,
  Button,
  Badge,
  StatusChip,
  Skeleton,
  EmptyState,
} from "@/components/ui";
import { cn } from "@/lib/cn";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Prescription = {
  issue: string | null;
  recommendation: string;
  deadline_days: number | null;
  severity: string | null;
};

type ProcessedCard = {
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

/* ─── Structured ПТП (operational plan) shape ────────────────────────────── */

type Room = { name?: string; area_m2?: number | string; type?: string };
type FloorPlan = { floor?: string; source_file?: string; rooms?: Room[] };
type StructuredPlan = {
  object?: {
    name?: string;
    address?: string;
    category?: string;
    fire_resistance_degree?: string;
    total_area_ha?: number;
    occupancy?: string;
    has_kindergarten?: boolean;
    blocks?: { id?: string; floors?: string; notes?: string }[];
  };
  response?: {
    nearest_station?: string;
    distance_km?: number;
    route?: string;
    arrival_min?: number;
    preassigned_rank?: string;
  };
  contacts?: { role?: string; name?: string; phone?: string }[];
  water_sources?: { type?: string; note?: string; distance_m?: number | null }[];
  floor_plans?: FloorPlan[];
  force_calc?: Record<string, unknown>;
};

function isStructured(ex: Record<string, unknown> | undefined): boolean {
  return !!ex && (!!ex["object"] || !!ex["floor_plans"]);
}

/* ─── Field manifest ─────────────────────────────────────────────────────── */

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

/* ─── Severity mapping from prescription severity string ─────────────────── */

function prescriptionSeverity(s: string | null): (typeof SEVERITY)[Severity] {
  if (s === "high") return SEVERITY.critical;
  if (s === "medium") return SEVERITY.high;
  return SEVERITY.elevated;
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function CardsPage() {
  const [card, setCard] = useState<ProcessedCard | null>(null);
  const [list, setList] = useState<CardListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshList = () =>
    apiFetch(`/cards`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setList(data);
        setListLoading(false);
      })
      .catch(() => setListLoading(false));

  useEffect(() => {
    refreshList();
  }, []);

  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setUploading(true);
    setError(null);
    setCard(null);
    const body = new FormData();
    body.append("file", f);
    try {
      const res = await apiFetch(`/cards`, { method: "POST", body });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error((msg as { detail?: string }).detail || `Ошибка ${res.status}`);
      }
      setCard(await res.json());
      refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обработать файл");
    } finally {
      setUploading(false);
    }
  }

  async function openCard(id: number) {
    const res = await apiFetch(`/cards/${id}`);
    if (res.ok) setCard(await res.json());
  }

  function handleFileChange() {
    const f = fileRef.current?.files?.[0];
    setSelectedFilename(f?.name ?? null);
    setError(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (fileRef.current && e.dataTransfer.files.length > 0) {
      const dt = new DataTransfer();
      dt.items.add(e.dataTransfer.files[0]);
      fileRef.current.files = dt.files;
      setSelectedFilename(e.dataTransfer.files[0].name);
      setError(null);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title="ИИ-обработка оперкарточек"
          subtitle="Скан/PDF → извлечение полей по форме МЧС РК → автопредписания"
          actions={
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1">
              <ScanLine className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs text-muted">Claude AI</span>
            </div>
          }
        />

        {/* ── Upload zone ── */}
        <Card className="mt-6 p-5">
          <SectionLabel className="mb-4">Загрузить карточку</SectionLabel>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "relative flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed py-10 transition-colors duration-[var(--dur-fast)]",
              dragOver
                ? "border-accent bg-accent-weak"
                : "border-border hover:border-border-strong",
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2">
              <Upload className="h-5 w-5 text-faint" />
            </div>
            <div className="text-center">
              <p className="text-sm text-fg">
                Перетащите файл сюда или{" "}
                <label className="cursor-pointer text-accent underline-offset-2 hover:underline">
                  выберите вручную
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </label>
              </p>
              <p className="mt-1 text-xs text-faint">PDF, PNG, JPEG — до 20 МБ</p>
            </div>

            {selectedFilename && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5">
                {selectedFilename.endsWith(".pdf") ? (
                  <FileText className="h-4 w-4 text-info" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-info" />
                )}
                <span className="max-w-[260px] truncate text-sm text-fg">{selectedFilename}</span>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={upload}
              disabled={uploading || !selectedFilename}
              className="gap-2"
            >
              {uploading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-fg/30 border-t-accent-fg" />
                  Обработка…
                </>
              ) : (
                <>
                  <ScanLine className="h-4 w-4" />
                  Извлечь данные
                </>
              )}
            </Button>

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-critical/40 bg-critical-bg px-3 py-1.5">
                <AlertOctagon className="h-4 w-4 shrink-0 text-critical" />
                <span className="text-sm text-critical">{error}</span>
              </div>
            )}
          </div>
        </Card>

        {/* ── Result: structured ПТП (digital operational plan) ── */}
        {card && isStructured(card.extracted) && (
          <StructuredPlanView
            ex={card.extracted as StructuredPlan}
            filename={card.filename}
          />
        )}

        {/* ── Result: AI-extracted flat card (two-column) ── */}
        {card && !isStructured(card.extracted) && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2 fw-fade-in">
            {/* Left — original */}
            <Card className="flex flex-col overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                {card.media_type === "application/pdf" ? (
                  <FileText className="h-4 w-4 text-info" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-info" />
                )}
                <SectionLabel>Оригинал</SectionLabel>
                <span className="ml-auto max-w-[200px] truncate text-xs text-faint">
                  {card.filename}
                </span>
              </div>
              <div className="flex-1 p-3">
                {card.media_type === "application/pdf" ? (
                  <iframe
                    src={apiSrc(`/cards/${card.id}/file`)}
                    className="h-[560px] w-full rounded-sm bg-white"
                    title="Оригинал карточки PDF"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={apiSrc(`/cards/${card.id}/file`)}
                    alt="Оригинал карточки"
                    className="max-h-[560px] w-full rounded-sm object-contain"
                  />
                )}
              </div>
            </Card>

            {/* Right — extracted + prescriptions */}
            <div className="flex flex-col gap-5">
              {/* Extracted fields */}
              <Card className="p-5">
                <SectionLabel className="mb-4">Извлечено ИИ</SectionLabel>
                <dl className="space-y-2">
                  {FIELDS.map(([key, label]) => {
                    const v = card.extracted?.[key];
                    if (v == null || v === "") return null;
                    return (
                      <div key={key} className="flex gap-3 text-sm">
                        <dt className="w-36 shrink-0 text-faint">{label}</dt>
                        <dd className="min-w-0 text-fg">{String(v)}</dd>
                      </div>
                    );
                  })}
                  {FIELDS.every(([key]) => !card.extracted?.[key]) && (
                    <p className="text-sm text-faint">Поля не извлечены</p>
                  )}
                </dl>
              </Card>

              {/* Prescriptions */}
              {card.prescriptions.length > 0 && (
                <Card className="p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <SectionLabel>Автопредписания</SectionLabel>
                    <Badge tone="accent">{card.prescriptions.length}</Badge>
                  </div>
                  <ol className="space-y-3">
                    {card.prescriptions.map((p, i) => {
                      const sev = prescriptionSeverity(p.severity);
                      return (
                        <li
                          key={i}
                          className="rounded-md border border-border bg-surface-2 p-3"
                        >
                          <div className="flex flex-wrap items-start gap-2">
                            <StatusChip severity={sev} />
                            {p.deadline_days != null && (
                              <span className="inline-flex items-center gap-1 text-xs text-faint">
                                <Clock className="h-3.5 w-3.5" />
                                <span className="tabular">{p.deadline_days} дн.</span>
                              </span>
                            )}
                          </div>
                          {p.issue && (
                            <p className="mt-2 text-xs text-muted">{p.issue}</p>
                          )}
                          <p className="mt-1 text-sm text-fg">{p.recommendation}</p>
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ── Processed cards list ── */}
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Обработанные карточки</SectionLabel>
            {!listLoading && list.length > 0 && (
              <Badge>{list.length}</Badge>
            )}
          </div>

          <Card>
            {listLoading ? (
              <div className="divide-y divide-border">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                icon={ScanLine}
                title="Карточек нет"
                description="Загрузите первый скан или PDF оперкарточки, чтобы ИИ извлёк поля и сформировал предписания."
                className="border-0"
              />
            ) : (
              <ul className="divide-y divide-border" role="list">
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => openCard(c.id)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2"
                      aria-label={`Открыть карточку: ${c.address || c.filename}`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-faint group-hover:text-muted">
                        {c.filename.endsWith(".pdf") ? (
                          <FileText className="h-4 w-4" />
                        ) : (
                          <ImageIcon className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {c.address && (
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-faint" />
                          )}
                          <span className="truncate text-sm text-fg">
                            {c.address || c.filename}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-faint">
                          <Calendar className="h-3 w-3" />
                          <span className="tabular">
                            {new Date(c.created_at).toLocaleDateString("ru", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.prescriptions > 0 && (
                          <Badge tone={c.prescriptions >= 3 ? "accent" : "neutral"}>
                            {c.prescriptions} предпис.
                          </Badge>
                        )}
                        <ChevronRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

/* ─── Structured ПТП view (digital operational plan / building plan) ──────── */

function StructuredPlanView({ ex, filename }: { ex: StructuredPlan; filename: string }) {
  const obj = ex.object ?? {};
  const resp = ex.response ?? {};
  const floors = (ex.floor_plans ?? []).filter((f) => (f.rooms?.length ?? 0) > 0);
  const [floorIdx, setFloorIdx] = useState(0);
  const floor = floors[floorIdx];

  return (
    <div className="mt-6 space-y-5 fw-fade-in">
      {/* Object summary */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>Оперативный план (ПТП)</SectionLabel>
            <h2 className="mt-1 text-lg font-semibold leading-snug text-fg">
              {obj.name ?? filename}
            </h2>
            {obj.address && <p className="mt-1 text-sm text-muted">{obj.address}</p>}
          </div>
          <FileText className="h-5 w-5 shrink-0 text-faint" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {obj.category && <Badge>{obj.category}</Badge>}
          {obj.fire_resistance_degree && <Badge>{obj.fire_resistance_degree}</Badge>}
          {obj.total_area_ha != null && <Badge>{obj.total_area_ha} га</Badge>}
          {obj.has_kindergarten && <Badge tone="accent">Детский сад в составе</Badge>}
          {obj.occupancy && <Badge>{obj.occupancy}</Badge>}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Response */}
        <Card className="p-5">
          <SectionLabel className="mb-3">Реагирование</SectionLabel>
          <dl className="space-y-2 text-sm">
            <Row label="Ближайшая ПЧ" value={resp.nearest_station} />
            <Row
              label="Расстояние / прибытие"
              value={[
                resp.distance_km != null ? `${resp.distance_km} км` : null,
                resp.arrival_min != null ? `${resp.arrival_min} мин` : null,
              ].filter(Boolean).join(" · ") || null}
            />
            <Row label="Маршрут" value={resp.route} />
            <Row label="Ранг пожара" value={resp.preassigned_rank} />
          </dl>
        </Card>

        {/* Blocks */}
        {(obj.blocks?.length ?? 0) > 0 && (
          <Card className="p-5">
            <SectionLabel className="mb-3">Блоки / этажность</SectionLabel>
            <ul className="space-y-1.5 text-sm">
              {obj.blocks!.map((b, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-10 shrink-0 font-medium text-fg">{b.id}</span>
                  <span className="text-muted">
                    {[b.floors, b.notes].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* Floor plan / экспликация — the building plan content */}
      {floors.length > 0 && (
        <Card className="p-5">
          <SectionLabel className="mb-3">План объекта · поэтажная экспликация</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {floors.map((f, i) => (
              <button
                key={i}
                onClick={() => setFloorIdx(i)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  i === floorIdx
                    ? "border-accent/40 bg-accent-weak text-accent"
                    : "border-border bg-surface-2 text-muted hover:text-fg",
                )}
              >
                {f.floor ?? `Этаж ${i + 1}`}
              </button>
            ))}
          </div>
          {floor && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-faint">
                    <th className="py-2 pr-3 font-medium">Помещение</th>
                    <th className="py-2 pr-3 font-medium">Тип</th>
                    <th className="py-2 text-right font-medium">Площадь, м²</th>
                  </tr>
                </thead>
                <tbody>
                  {floor.rooms!.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 pr-3 text-fg">{r.name ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-muted">{r.type ?? ""}</td>
                      <td className="py-1.5 text-right tabular text-muted">{r.area_m2 ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Water sources */}
      {(ex.water_sources?.length ?? 0) > 0 && (
        <Card className="p-5">
          <SectionLabel className="mb-3">Водоисточники</SectionLabel>
          <ul className="space-y-1.5 text-sm">
            {ex.water_sources!.map((w, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className="text-fg">
                  {w.type}
                  {w.note && <span className="text-faint"> · {w.note}</span>}
                </span>
                {w.distance_m != null && (
                  <span className="shrink-0 tabular text-muted">{w.distance_m} м</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Force calc */}
      {ex.force_calc && Object.keys(ex.force_calc).length > 0 && (
        <Card className="p-5">
          <SectionLabel className="mb-3">Расчёт сил и средств</SectionLabel>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {Object.entries(ex.force_calc).map(([k, v]) => (
              <div key={k} className="flex gap-3 text-sm">
                <dt className="min-w-0 flex-1 text-faint">{k}</dt>
                <dd className="shrink-0 text-fg">
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-40 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 text-fg">{value}</dd>
    </div>
  );
}
