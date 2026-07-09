"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  ArrowLeft,
  Camera,
  Check,
  X,
  Play,
  LocateFixed,
  RefreshCw,
  MapPin,
  User,
  CalendarDays,
  Siren,
  AlertOctagon,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, apiSrc, useAuth } from "@/lib/auth";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import {
  PageHeader,
  Card,
  Button,
  Field,
  Input,
  Textarea,
  StatusChip,
  Skeleton,
  EmptyState,
  Banner,
  Tabs,
  SectionLabel,
  useDismiss,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  CATEGORY_META,
  STATUS_META,
  type Report,
  type ReportCategory,
  type ReportStatus,
} from "@/lib/reports";
import { MAX_PHOTO_BYTES } from "@/lib/offline";
import { apiErrorText } from "@/lib/api-error";

/** Astana city-centre default — a sane starting point when geolocation is
 *  unavailable (desktop, denied permission) and the field must still be filled. */
const DEFAULT_LAT = 51.128;
const DEFAULT_LNG = 71.43;

type Filter = "all" | ReportStatus;

/* ───────────────────────────── Page ────────────────────────────── */

export default function ReportsPage() {
  const t = useT();
  const { user } = useAuth();
  const canCreate =
    user?.role === "inspector" ||
    user?.role === "supervisor" ||
    user?.role === "admin" ||
    user?.role === "dispatcher" ||
    user?.role === "responder";
  const canModerate = user?.role === "supervisor" || user?.role === "admin";

  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiFetch(`/reports`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("reports"))))
      .then((data: Report[]) => setReports(data))
      .catch(() => setError(t("Не удалось загрузить донесения. Проверьте связь и обновите страницу.")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const loading = reports === null;
  const safeReports = reports ?? [];

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: safeReports.length, open: 0, in_progress: 0, resolved: 0, dismissed: 0 };
    for (const r of safeReports) c[r.status]++;
    return c;
  }, [safeReports]);

  const visible = useMemo(
    () => (filter === "all" ? safeReports : safeReports.filter((r) => r.status === filter)),
    [safeReports, filter],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Донесения")}
          subtitle={t("Полевые донесения: препятствия пожаротушению вне плановых проверок")}
          actions={
            canCreate ? (
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                {t("Новое донесение")}
              </Button>
            ) : undefined
          }
        />

        {error && (
          <Banner tone="critical" className="mt-4">
            {error}
          </Banner>
        )}

        {/* Loading */}
        {loading && !error && (
          <div className="mt-6 space-y-2.5">
            <Skeleton className="h-10 w-full max-w-md" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        )}

        {/* Loaded */}
        {!loading && (
          <div className="mt-5">
            <Tabs
              className="mb-4"
              active={filter}
              onChange={(id) => setFilter(id as Filter)}
              tabs={[
                { id: "all", label: t("Все"), count: counts.all },
                ...REPORT_STATUSES.map((s) => ({
                  id: s,
                  label: t(STATUS_META[s].label),
                  count: counts[s],
                })),
              ]}
            />

            {visible.length === 0 ? (
              <EmptyState
                icon={Siren}
                title={filter === "all" ? t("Донесений пока нет") : t("Нет донесений с этим статусом")}
                description={
                  filter === "all"
                    ? t("Полевые донесения о препятствиях пожаротушению появятся здесь.")
                    : t("Переключите фильтр, чтобы увидеть остальные донесения.")
                }
              />
            ) : (
              <div className="space-y-3">
                {visible.map((r) => (
                  <ReportCard key={r.id} report={r} canModerate={canModerate} onChanged={load} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateReportSheet
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

/* ───────────────────────────── ReportCard ──────────────────────── */

function ReportCard({
  report,
  canModerate,
  onChanged,
}: {
  report: Report;
  canModerate: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const cat = CATEGORY_META[report.category];
  const CatIcon = cat.icon;
  const status = STATUS_META[report.status];
  const actionable = canModerate && (report.status === "open" || report.status === "in_progress");

  const created = new Date(report.created_at).toLocaleString(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const resolved = report.resolved_at
    ? new Date(report.resolved_at).toLocaleString(intlLocale(locale), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const location = [report.address, report.district && `${report.district} ${t("р-н")}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", cat.severity.bg)}
            aria-hidden
          >
            <CatIcon className={cn("h-[18px] w-[18px]", cat.severity.text)} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">{t(cat.label)}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className={cn("truncate", !location && "tabular")}>
                {location || `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`}
              </span>
            </p>
          </div>
        </div>
        <StatusChip severity={status.severity} label={t(status.label)} className="shrink-0" />
      </div>

      {report.description && (
        <p className="mt-3 text-sm leading-relaxed text-muted">{report.description}</p>
      )}

      {report.photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {report.photos.map((id) => (
            <a
              key={id}
              href={apiSrc(`/routes/visit/photo/${id}`)}
              target="_blank"
              rel="noreferrer"
              className="block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={apiSrc(`/routes/visit/photo/${id}`)}
                alt={t("Фото донесения")}
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-faint">
        <span className="inline-flex items-center gap-1">
          <User className="h-3 w-3" aria-hidden />
          {report.created_by}
        </span>
        <span className="inline-flex items-center gap-1 tabular">
          <CalendarDays className="h-3 w-3" aria-hidden />
          {created}
        </span>
      </div>

      {(report.status === "resolved" || report.status === "dismissed") && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
          <p className="text-muted">
            {report.resolved_by && (
              <>
                {report.status === "resolved" ? t("Решено") : t("Отклонено")} · {report.resolved_by}
                {resolved && <span className="tabular"> · {resolved}</span>}
              </>
            )}
          </p>
          {report.resolution_note && <p className="mt-1 text-fg">{report.resolution_note}</p>}
        </div>
      )}

      {actionable && <ReportActions report={report} onChanged={onChanged} />}
    </Card>
  );
}

/* ───────────────────────────── ReportActions ───────────────────── */

function ReportActions({ report, onChanged }: { report: Report; onChanged: () => void }) {
  const t = useT();
  const [pending, setPending] = useState<"in_progress" | "resolved" | "dismissed" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(status: "in_progress" | "resolved" | "dismissed", resolutionNote?: string) {
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch(`/reports/${report.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          resolution_note: resolutionNote?.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(
          apiErrorText(d.detail, t("Не удалось обновить статус")) ?? t("Не удалось обновить статус"),
        );
      }
      setPending(null);
      setNote("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Не удалось обновить статус"));
    } finally {
      setSubmitting(false);
    }
  }

  if (pending === "resolved" || pending === "dismissed") {
    return (
      <div className="mt-3 rounded-md border border-border-strong bg-surface-2 p-3">
        <Field label={pending === "resolved" ? t("Комментарий к решению") : t("Причина отклонения")}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={
              pending === "resolved" ? t("Что сделано для устранения") : t("Почему донесение отклонено")
            }
          />
        </Field>
        {error && <p className="mt-2 text-xs text-critical">{error}</p>}
        <div className="mt-2.5 flex items-center gap-2">
          <Button
            size="sm"
            variant={pending === "resolved" ? "success" : "danger"}
            disabled={submitting}
            onClick={() => void submit(pending, note)}
          >
            {submitting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t("Подтвердить")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={submitting}
            onClick={() => {
              setPending(null);
              setNote("");
              setError(null);
            }}
          >
            {t("Отмена")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {report.status === "open" && (
        <Button size="sm" variant="secondary" disabled={submitting} onClick={() => void submit("in_progress")}>
          <Play className="h-3.5 w-3.5" />
          {t("В работу")}
        </Button>
      )}
      <Button size="sm" variant="success" disabled={submitting} onClick={() => setPending("resolved")}>
        <Check className="h-3.5 w-3.5" />
        {t("Решено")}
      </Button>
      <Button size="sm" variant="danger" disabled={submitting} onClick={() => setPending("dismissed")}>
        <X className="h-3.5 w-3.5" />
        {t("Отклонено")}
      </Button>
      {error && <p className="text-xs text-critical">{error}</p>}
    </div>
  );
}

/* ───────────────────────────── CreateReportSheet ───────────────── */

function CreateReportSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT();
  // Fade + scale-in on open (~200ms), faster scale-out on close (~140ms).
  const { visible, requestClose } = useDismiss(onClose, 140);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState(String(DEFAULT_LAT));
  const [lng, setLng] = useState(String(DEFAULT_LNG));
  const [geoBusy, setGeoBusy] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function locate() {
    if (!("geolocation" in navigator)) {
      setError(t("Геолокация не поддерживается на этом устройстве — введите координаты вручную."));
      return;
    }
    setGeoBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setGeoBusy(false);
      },
      () => {
        setError(t("Не удалось получить местоположение — введите координаты вручную."));
        setGeoBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_PHOTO_BYTES) {
          setError(t("Фото больше 2 МБ — уменьшите размер перед добавлением."));
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const r = await apiFetch(`/routes/visit/photo`, { method: "POST", body: fd });
        if (!r.ok) throw new Error(t("Не удалось загрузить фото — проверьте связь."));
        const d = await r.json();
        setPhotos((p) => [...p, d.id as string]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Ошибка загрузки фото"));
    } finally {
      setUploading(false);
    }
  }

  function validate(): string | null {
    if (!category) return t("Выберите категорию донесения.");
    if (photos.length === 0) return t("Приложите хотя бы одно фото.");
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return t("Координаты должны быть числами.");
    }
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return t("Координаты вне допустимого диапазона.");
    }
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await apiFetch(`/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          description: description.trim() || undefined,
          lat: Number(lat),
          lng: Number(lng),
          photos,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(
          apiErrorText(d.detail, t("Не удалось отправить донесение")) ?? t("Не удалось отправить донесение"),
        );
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Не удалось отправить донесение"));
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || uploading || geoBusy;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label={t("Новое донесение")}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.97)",
        transition: `opacity ${visible ? 200 : 140}ms var(--ease), transform ${
          visible ? 200 : 140
        }ms var(--ease)`,
      }}
    >
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="flex items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={requestClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-[color,background-color,scale] duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
            aria-label={t("Закрыть")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <p className="text-[15px] font-semibold text-fg">{t("Новое донесение")}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-5">
          {/* Category */}
          <section>
            <SectionLabel className="mb-2">{t("Категория")}</SectionLabel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {REPORT_CATEGORIES.map((c) => {
                const meta = CATEGORY_META[c];
                const Icon = meta.icon;
                const active = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={active}
                    className={cn(
                      "relative flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-center transition-colors duration-[var(--dur-fast)]",
                      active
                        ? cn(meta.severity.border, meta.severity.bg, meta.severity.text)
                        : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {active && (
                      <Check
                        className={cn("absolute right-1.5 top-1.5 h-3.5 w-3.5", meta.severity.text)}
                        aria-hidden
                      />
                    )}
                    <Icon className="h-5 w-5" aria-hidden />
                    <span className="text-xs font-medium leading-tight">{t(meta.label)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Description */}
          <section>
            <Field label={t("Описание (необязательно)")}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder={t("Детали: что именно мешает пожаротушению")}
              />
            </Field>
          </section>

          {/* Location */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>{t("Геоточка")}</SectionLabel>
              <Button size="sm" variant="secondary" onClick={locate} disabled={busy}>
                {geoBusy ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LocateFixed className="h-3.5 w-3.5" />
                )}
                {t("Моё местоположение")}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={t("Широта (lat)")}>
                <Input
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  inputMode="decimal"
                  className="tabular"
                />
              </Field>
              <Field label={t("Долгота (lng)")}>
                <Input
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  inputMode="decimal"
                  className="tabular"
                />
              </Field>
            </div>
          </section>

          {/* Photos */}
          <section>
            <SectionLabel className="mb-2">{t("Фото")} {photos.length > 0 && `· ${photos.length}`}</SectionLabel>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2.5">
              {photos.map((id, i) => (
                <div key={id} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-normal-bg text-normal">
                    <Check className="h-5 w-5" />
                    <span className="text-2xs">{t("загружено")}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-bg/80 text-fg backdrop-blur hover:bg-critical hover:text-white"
                    aria-label={t("Удалить фото")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <label
                className={cn(
                  "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong bg-surface-2 text-faint hover:border-faint hover:text-muted",
                  uploading && "pointer-events-none opacity-60",
                )}
              >
                {uploading ? (
                  <RefreshCw className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Camera className="h-5 w-5" aria-hidden />
                )}
                <span className="text-2xs">{uploading ? t("Загрузка") : t("Добавить")}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    void uploadPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-2xs text-faint">{t("Не менее одного фото — доказательство препятствия.")}</p>
          </section>
        </div>
      </div>

      <footer
        className="shrink-0 border-t border-border bg-surface px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto max-w-2xl">
          {error && (
            <p className="mb-2.5 flex items-start gap-1.5 text-xs text-critical" role="alert">
              <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          <Button
            variant="primary"
            size="xl"
            onClick={() => void submit()}
            disabled={busy}
            className="w-full"
          >
            {saving ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Siren className="h-5 w-5" />}
            {t("Отправить донесение")}
          </Button>
        </div>
      </footer>
    </div>
  );
}
