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

        {/* ── Result: two-column ── */}
        {card && (
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
