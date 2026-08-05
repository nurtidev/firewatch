"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  MapPin,
  Layers,
  ClipboardList,
  Clock3,
  CalendarDays,
  AlertOctagon,
  Camera,
  Check,
  X,
  RefreshCw,
  Send,
  Info,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, apiSrc } from "@/lib/auth";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { apiErrorText } from "@/lib/api-error";
import { scoreSeverity, SCORE_HINT } from "@/lib/risk";
import {
  PageHeader,
  Card,
  SectionLabel,
  MetricCard,
  ScoreBadge,
  StatusChip,
  Button,
  Field,
  Textarea,
  Skeleton,
  EmptyState,
  Banner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { MAX_PHOTO_BYTES } from "@/lib/offline";
import {
  prescriptionSeverity,
  REMEDIATION_STATUS,
  type PortalSummary,
  type PortalBuilding,
  type PortalPrescription,
  type RemediationStatus,
} from "@/lib/portal";

const MAX_PHOTOS = 5;

export default function PortalPage() {
  const t = useT();
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [prescriptions, setPrescriptions] = useState<PortalPrescription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      apiFetch(`/portal/summary`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("summary")),
      ),
      apiFetch(`/portal/prescriptions`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("prescriptions")),
      ),
    ])
      .then(([s, p]: [PortalSummary, PortalPrescription[]]) => {
        setSummary(s);
        setPrescriptions(p);
      })
      .catch(() =>
        setError(t("Не удалось загрузить данные по вашему объекту. Проверьте связь и обновите страницу.")),
      );
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const loading = summary === null || prescriptions === null;

  const byBuilding = useMemo(() => {
    const m = new Map<number, PortalPrescription[]>();
    for (const p of prescriptions ?? []) {
      const arr = m.get(p.building_id) ?? [];
      arr.push(p);
      m.set(p.building_id, arr);
    }
    return m;
  }, [prescriptions]);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Мой объект")}
          subtitle={t("Предписания по вашим зданиям и статус их устранения")}
        />

        {error && (
          <Banner tone="critical" className="mt-4">
            {error}
          </Banner>
        )}

        {loading && !error && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {!loading && !error && summary && (
          summary.buildings.length === 0 ? (
            <EmptyState
              className="mt-8"
              icon={Building2}
              title={t("Объекты не привязаны")}
              description={t(
                "К вашему аккаунту пока не привязано ни одного объекта — обратитесь в ДЧС, чтобы это исправить.",
              )}
            />
          ) : (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <MetricCard
                  label={t("Активных предписаний")}
                  value={summary.counts.prescriptions_active}
                  icon={ClipboardList}
                />
                <MetricCard
                  label={t("Заявок на проверке")}
                  value={summary.counts.remediations_pending}
                  icon={Clock3}
                />
              </div>

              {summary.buildings.map((b) => (
                <BuildingSection
                  key={b.id}
                  building={b}
                  prescriptions={byBuilding.get(b.id) ?? []}
                  onChanged={load}
                />
              ))}
            </div>
          )
        )}
      </div>
    </AppShell>
  );
}

/* ───────────────────────────── Building section ────────────────────────── */

function BuildingSection({
  building,
  prescriptions,
  onChanged,
}: {
  building: PortalBuilding;
  prescriptions: PortalPrescription[];
  onChanged: () => void;
}) {
  const t = useT();
  const sev = building.risk_score != null ? scoreSeverity(building.risk_score) : null;

  return (
    <section>
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Building2 className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              {building.address}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {building.district && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {building.district} {t("р-н")}
                </span>
              )}
              {building.building_type && (
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" aria-hidden />
                  {t(building.building_type_label ?? building.building_type)}
                </span>
              )}
              {building.floors != null && (
                <span className="tabular">{building.floors} {t("эт.")}</span>
              )}
            </p>
          </div>
          {sev && building.risk_score != null && (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <ScoreBadge score={building.risk_score} severity={sev} />
                <span className={cn("text-sm font-medium", sev.text)}>{t(sev.label)}</span>
              </div>
              <span className="text-2xs text-faint">{t("Риск-балл · шкала 0–100")}</span>
            </div>
          )}
        </div>

        {/* Explain the score in plain language — this is what a chair answers
            to the general meeting with, not a bare number. */}
        {sev && building.risk_score != null && (
          <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
              {t(SCORE_HINT[sev.key])}
            </p>
            {building.top_factors.length > 0 && (
              <ul className="mt-2 space-y-1 pl-5">
                {building.top_factors.map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs">
                    {f.value >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-critical" aria-hidden />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 shrink-0 text-normal" aria-hidden />
                    )}
                    <span className="text-fg">{f.feature}</span>
                    <span className="text-faint">
                      · {f.value >= 0 ? t("повышает риск") : t("снижает риск")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <div className="mt-3">
        {prescriptions.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t("Предписаний нет")}
            description={t("По этому объекту сейчас нет действующих предписаний.")}
          />
        ) : (
          <ol className="space-y-3">
            {prescriptions.map((p) => (
              <PrescriptionRow key={p.id} prescription={p} onChanged={onChanged} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────── Prescription row ─────────────────────────── */

function PrescriptionRow({
  prescription: p,
  onChanged,
}: {
  prescription: PortalPrescription;
  onChanged: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const sev = prescriptionSeverity(p.severity);
  const [claiming, setClaiming] = useState(false);

  const dueLabel = p.due_date
    ? new Date(p.due_date).toLocaleDateString(intlLocale(locale), {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  const remStatus = p.remediation?.status;
  const showButton = !p.remediation || remStatus === "declined";

  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip severity={sev} label={t(sev.label)} />
          {dueLabel && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                p.overdue ? "font-medium text-critical" : "text-faint",
              )}
            >
              {p.overdue ? (
                <AlertOctagon className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              )}
              <span className="tabular">{dueLabel}</span>
              {p.overdue && <span>· {t("Просрочено")}</span>}
            </span>
          )}
          {p.remediation && (
            <RemediationChip status={p.remediation.status} className="ml-auto" />
          )}
        </div>

        {p.issue && <p className="mt-2 text-xs text-muted">{p.issue}</p>}
        <p className="mt-1 text-sm text-fg">{p.recommendation}</p>

        {p.remediation && p.remediation.status === "declined" && p.remediation.review_note && (
          <p className="mt-2 rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-xs text-fg">
            {t("Комментарий ДЧС:")} {p.remediation.review_note}
          </p>
        )}

        {p.remediation && p.remediation.status === "accepted" && (
          <p className="mt-2 text-2xs text-faint">
            {t("Подтвердил")}
            {p.remediation.reviewed_by_name ? `: ${p.remediation.reviewed_by_name}` : ""}
            {p.remediation.reviewed_at &&
              ` · ${new Date(p.remediation.reviewed_at).toLocaleDateString(intlLocale(locale))}`}
          </p>
        )}

        {showButton && !claiming && (
          <Button size="sm" variant="primary" className="mt-3" onClick={() => setClaiming(true)}>
            <Send className="h-3.5 w-3.5" />
            {p.remediation?.status === "declined" ? t("Подать повторно") : t("Заявить об устранении")}
          </Button>
        )}

        {claiming && (
          <RemediationForm
            prescriptionId={p.id}
            onCancel={() => setClaiming(false)}
            onSubmitted={() => {
              setClaiming(false);
              onChanged();
            }}
          />
        )}
      </Card>
    </li>
  );
}

function RemediationChip({ status, className }: { status: RemediationStatus; className?: string }) {
  const t = useT();
  const meta = REMEDIATION_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium",
        meta.cls,
        className,
      )}
    >
      <meta.icon className="h-3 w-3" aria-hidden />
      {t(meta.label)}
    </span>
  );
}

/* ───────────────────────────── Remediation form ─────────────────────────── */

function RemediationForm({
  prescriptionId,
  onCancel,
  onSubmitted,
}: {
  prescriptionId: number;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setError(`${t("Не более")} ${MAX_PHOTOS} ${t("фото.")}`);
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, remaining)) {
        if (file.size > MAX_PHOTO_BYTES) {
          setError(t("Фото больше 2 МБ — уменьшите размер перед добавлением."));
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const r = await apiFetch(`/portal/photo`, { method: "POST", body: fd });
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

  async function submit() {
    if (!note.trim()) {
      setError(t("Опишите, что было устранено."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch(`/portal/prescriptions/${prescriptionId}/remediation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim(), photos }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(
          apiErrorText(d.detail, t("Не удалось отправить заявку")) ?? t("Не удалось отправить заявку"),
        );
      }
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Не удалось отправить заявку"));
    } finally {
      setSubmitting(false);
    }
  }

  const busy = uploading || submitting;

  return (
    <div className="mt-3 rounded-md border border-border-strong bg-surface-2 p-3">
      <Field label={t("Что устранено")}>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={t("Опишите, какие меры были приняты по предписанию")}
        />
      </Field>

      <div className="mt-3">
        <SectionLabel className="mb-2">
          {t("Фото")} {photos.length > 0 && `· ${photos.length}/${MAX_PHOTOS}`}
        </SectionLabel>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
          {photos.map((id) => (
            <div key={id} className="relative aspect-square overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={apiSrc(`/portal/photo/${id}`)}
                alt={t("Фото устранения")}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => setPhotos((p) => p.filter((x) => x !== id))}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-bg/80 text-fg backdrop-blur hover:bg-critical hover:text-white"
                aria-label={t("Удалить фото")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label
              className={cn(
                "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong bg-surface text-faint hover:border-faint hover:text-muted",
                uploading && "pointer-events-none opacity-60",
              )}
            >
              {uploading ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Camera className="h-4 w-4" aria-hidden />
              )}
              <span className="text-2xs">{uploading ? t("Загрузка") : t("Добавить")}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void uploadPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>

      {error && <p className="mt-2.5 text-xs text-critical">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
          {submitting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("Отправить заявку")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("Отмена")}
        </Button>
      </div>
    </div>
  );
}
