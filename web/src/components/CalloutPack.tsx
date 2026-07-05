"use client";

/**
 * Боевой пакет — shared by the ЦОУ console (/dispatch) and the responder
 * tablet (/callout): same data, same read of it, so a dispatcher and a
 * начальник караула looking at the same callout never see different framing.
 */
import { useEffect, useState } from "react";
import {
  Clock3,
  Truck,
  Building2,
  Layers,
  CalendarDays,
  Droplets,
  AlertTriangle,
  ScanLine,
  Calculator,
  Check,
  X,
  RefreshCw,
} from "lucide-react";
import { apiFetch, apiSrc } from "@/lib/auth";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
import { CATEGORY_META } from "@/lib/reports";
import {
  CALLOUT_TYPE_META,
  HYDRANT_STATUS_META,
  BLOCKING_REPORT_CATEGORIES,
  relativeTimeRu,
  type CalloutPackData,
  type PackHydrant,
  type PackReport,
  type HydrantStatus,
} from "@/lib/dispatch";
import { Card, SectionLabel, StatusChip, ScoreBadge, Button, LinkButton, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";

export default function CalloutPack({
  pack,
  canMarkHydrant,
  large = false,
  className,
}: {
  pack: CalloutPackData;
  canMarkHydrant: boolean;
  /** Tablet mode for the responder screen (/callout): bigger touch targets
   *  on the one action that matters roadside (marking a hydrant), bigger
   *  address so it reads from arm's length. */
  large?: boolean;
  className?: string;
}) {
  const { callout, building, station, reports, forces_hint } = pack;
  const typeMeta = CALLOUT_TYPE_META[callout.callout_type];
  const TypeIcon = typeMeta.icon;

  // Hydrant statuses are mutated in place by canMarkHydrant actions below; the
  // effect re-syncs from the parent whenever it hands us a fresh pack (poll /
  // manual reload / switching to a different callout).
  const [hydrants, setHydrants] = useState<PackHydrant[]>(pack.hydrants);
  useEffect(() => setHydrants(pack.hydrants), [pack]);

  const blocking = reports.filter((r) => BLOCKING_REPORT_CATEGORIES.includes(r.category));
  const other = reports.filter((r) => !BLOCKING_REPORT_CATEGORIES.includes(r.category));

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <Card className="relative overflow-hidden p-4 sm:p-5">
        <span
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: typeMeta.severity.cssVar }}
          aria-hidden
        />
        <div className="flex flex-wrap items-start justify-between gap-3 pl-1.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  typeMeta.severity.bg,
                )}
                aria-hidden
              >
                <TypeIcon className={cn("h-[18px] w-[18px]", typeMeta.severity.text)} />
              </span>
              <span className={cn("text-sm font-semibold", typeMeta.severity.text)}>
                {typeMeta.label}
              </span>
              {callout.status === "closed" && (
                <StatusChip severity={SEVERITY.info} label="Закрыт" />
              )}
            </div>
            <p
              className={cn(
                "mt-2 font-semibold leading-snug text-fg",
                large ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl",
              )}
            >
              {callout.address || `${callout.lat.toFixed(5)}, ${callout.lng.toFixed(5)}`}
            </p>
            {callout.district && <p className="mt-0.5 text-xs text-muted">{callout.district} р-н</p>}
          </div>
          <div className="shrink-0 space-y-1 text-right text-xs text-faint">
            <p className="inline-flex items-center gap-1 tabular">
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
              {relativeTimeRu(callout.created_at)}
            </p>
            {station && (
              <p className="inline-flex items-center gap-1">
                <Truck className="h-3.5 w-3.5" aria-hidden />
                {station.name}
              </p>
            )}
          </div>
        </div>
        {callout.note && <p className="mt-3 pl-1.5 text-sm text-fg">{callout.note}</p>}
      </Card>

      {/* Объект */}
      <section>
        <SectionLabel className="mb-2">Объект</SectionLabel>
        {building ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5 text-sm text-muted">
                {building.building_type && (
                  <p className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {building.building_type}
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular">
                  {building.floors != null && <span>{building.floors} эт.</span>}
                  {building.year_built != null && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      {building.year_built} г.
                    </span>
                  )}
                </p>
              </div>
              {building.risk_score != null && (
                <ScoreBadge score={building.risk_score} severity={scoreSeverity(building.risk_score)} />
              )}
            </div>
            {building.card_id != null && (
              <LinkButton href={`/cards?id=${building.card_id}`} size="lg" className="mt-3.5 w-full sm:w-auto">
                <ScanLine className="h-4 w-4" />
                Открыть ПТП
              </LinkButton>
            )}
          </Card>
        ) : (
          <EmptyState
            icon={Building2}
            title="Здание не привязано"
            description="Выезд зарегистрирован по координатам, без привязки к объекту."
          />
        )}
      </section>

      {/* Водоисточники */}
      <section>
        <SectionLabel className="mb-2">Водоисточники</SectionLabel>
        {hydrants.length === 0 ? (
          <EmptyState
            icon={Droplets}
            title="Гидрантов рядом нет"
            description="Уточните водоисточники на месте — ближайшие гидранты не найдены в радиусе поиска."
          />
        ) : (
          <div className="space-y-2">
            {hydrants.map((h) => (
              <HydrantRow
                key={h.id}
                hydrant={h}
                canMark={canMarkHydrant}
                large={large}
                onChanged={(next) =>
                  setHydrants((hs) => hs.map((x) => (x.id === h.id ? next : x)))
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Препятствия */}
      <section>
        <SectionLabel className="mb-2">Препятствия</SectionLabel>
        {blocking.length === 0 && other.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="Препятствий не обнаружено"
            description="Заблокированных проездов и водоисточников рядом не зарегистрировано."
          />
        ) : (
          <div className="space-y-2">
            {blocking.map((r) => (
              <ObstacleReport key={r.id} report={r} />
            ))}
            {other.map((r) => (
              <ObstacleReport key={r.id} report={r} muted />
            ))}
          </div>
        )}
      </section>

      {/* Силы и средства */}
      <section>
        <SectionLabel className="mb-2">Силы и средства</SectionLabel>
        {forces_hint ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="min-w-0 text-sm text-fg">
              Рекомендованный пресет: <span className="font-semibold">{forces_hint.label}</span>
            </p>
            <LinkButton href="/forces" variant="secondary" size="sm" className="shrink-0">
              <Calculator className="h-3.5 w-3.5" />
              Открыть расчёт
            </LinkButton>
          </Card>
        ) : (
          <EmptyState
            icon={Calculator}
            title="Рекомендации нет"
            description="Параметры пожара для этого выезда не определены — подберите их вручную."
            action={
              <LinkButton href="/forces" variant="secondary" size="sm">
                <Calculator className="h-3.5 w-3.5" />
                Открыть расчёт
              </LinkButton>
            }
          />
        )}
      </section>
    </div>
  );
}

/* ───────────────────────────── Hydrant row ─────────────────────── */

function HydrantRow({
  hydrant,
  canMark,
  large = false,
  onChanged,
}: {
  hydrant: PackHydrant;
  canMark: boolean;
  large?: boolean;
  onChanged: (next: PackHydrant) => void;
}) {
  const meta = HYDRANT_STATUS_META[hydrant.status];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const nextStatus: HydrantStatus = hydrant.status === "ok" ? "broken" : "ok";
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`/infra/hydrants/${hydrant.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!r.ok) throw new Error("Не удалось обновить статус гидранта");
      const d = await r.json();
      onChanged({ ...hydrant, status: (d.status as HydrantStatus) ?? nextStatus });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить статус");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip severity={meta.severity} label={meta.label} />
          {hydrant.hydrant_type && <span className="text-xs text-muted">{hydrant.hydrant_type}</span>}
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint tabular">
          {hydrant.pressure_bar != null && <span>{hydrant.pressure_bar} бар</span>}
          {hydrant.diameter_mm != null && <span>⌀ {hydrant.diameter_mm} мм</span>}
          <span>{hydrant.distance_m} м</span>
        </p>
        {error && <p className="mt-1 text-xs text-critical">{error}</p>}
      </div>
      {canMark && (
        <Button
          size={large ? "lg" : "sm"}
          variant={hydrant.status === "ok" ? "danger" : "success"}
          disabled={busy}
          onClick={() => void toggle()}
        >
          {busy ? (
            <RefreshCw className={cn(large ? "h-4 w-4" : "h-3.5 w-3.5", "animate-spin")} />
          ) : hydrant.status === "ok" ? (
            <X className={large ? "h-4 w-4" : "h-3.5 w-3.5"} />
          ) : (
            <Check className={large ? "h-4 w-4" : "h-3.5 w-3.5"} />
          )}
          {hydrant.status === "ok" ? "Отметить неисправным" : "Отметить исправным"}
        </Button>
      )}
    </Card>
  );
}

/* ───────────────────────────── Obstacle report ─────────────────── */

function ObstacleReport({ report, muted = false }: { report: PackReport; muted?: boolean }) {
  const meta = CATEGORY_META[report.category];
  const Icon = meta.icon;
  const contrast = !muted;
  return (
    <Card
      className={cn(
        "p-3.5",
        contrast && "border-2",
        contrast && meta.severity.border,
        contrast && meta.severity.bg,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.severity.bg)}
          aria-hidden
        >
          <Icon className={cn("h-4 w-4", meta.severity.text)} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", meta.severity.text)}>{meta.label}</p>
          {report.description && <p className="mt-0.5 text-sm text-muted">{report.description}</p>}
          <p className="mt-1 text-xs text-faint tabular">{report.distance_m} м</p>
          {report.photos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {report.photos.map((id) => (
                <a
                  key={id}
                  href={apiSrc(`/routes/visit/photo/${id}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={apiSrc(`/routes/visit/photo/${id}`)}
                    alt="Фото препятствия"
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
