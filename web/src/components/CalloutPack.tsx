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
import { useLocale, useT } from "@/lib/i18n";
import { scoreSeverity, SEVERITY } from "@/lib/risk";
import { CATEGORY_META } from "@/lib/reports";
import {
  CALLOUT_TYPE_META,
  HYDRANT_STATUS_META,
  BLOCKING_REPORT_CATEGORIES,
  relativeTimeRu,
  type CalloutPackData,
  type ForcesHint,
  type PackHydrant,
  type PackReport,
  type HydrantStatus,
} from "@/lib/dispatch";
import {
  Card,
  SectionLabel,
  StatusChip,
  ScoreBadge,
  Badge,
  Button,
  LinkButton,
  EmptyState,
} from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Ссылка на калькулятор с параметрами объекта. Раньше вела на голый `/forces`,
 * и РТП собирал заново то, что система уже знает: тип объекта, этажность,
 * расстояние до части. Этаж пожара подставляется верхний — на 24-этажке это
 * худший по времени развёртывания случай, и он же правится одним полем.
 */
function forcesHref(pack: CalloutPackData): string {
  const p = new URLSearchParams();
  const hint = pack.forces_hint;
  if (hint) {
    p.set("preset", hint.preset_key);
    p.set("source", hint.source);
    if (hint.card_id != null) p.set("card", String(hint.card_id));
  }
  if (pack.building?.floors != null) p.set("floor", String(pack.building.floors));
  if (pack.station?.distance_m != null) {
    p.set("distance_km", (pack.station.distance_m / 1000).toFixed(1));
  }
  const object = pack.building?.address ?? pack.callout.address;
  if (object) p.set("object", object);
  // По id вызова калькулятор дотягивает цифры расчёта по ПТП и показывает их
  // рядом со своим результатом — чтобы «уточнение» не выглядело опровержением.
  p.set("callout", String(pack.callout.id));
  return `/forces?${p.toString()}`;
}

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
  const t = useT();
  const { locale } = useLocale();
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
                {t(typeMeta.label)}
              </span>
              {callout.status === "closed" && (
                <StatusChip severity={SEVERITY.info} label={t("Закрыт")} />
              )}
            </div>
            <p
              className={cn(
                "mt-2 font-semibold leading-snug text-fg",
                large ? "text-2xl sm:text-3xl" : "text-lg sm:text-xl",
                !callout.address && "tabular",
              )}
            >
              {callout.address || `${callout.lat.toFixed(5)}, ${callout.lng.toFixed(5)}`}
            </p>
            {callout.district && (
              <p className="mt-0.5 text-xs text-muted">
                {callout.district} {t("р-н")}
              </p>
            )}
          </div>
          <div className="shrink-0 space-y-1 text-right text-xs text-faint">
            {/* `flex` (block-level), not `inline-flex` — as inline-level boxes
                these two <p> ran together on one line with no separator
                ("только чтоСпециализированная пожарная часть №2") because JSX
                doesn't emit whitespace between adjacent elements. */}
            <p className="flex items-center justify-end gap-1 tabular">
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
              {relativeTimeRu(callout.created_at, locale, t)}
            </p>
            {station && (
              <p className="flex items-center justify-end gap-1">
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
        <SectionLabel className="mb-2">{t("Объект")}</SectionLabel>
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
                  {building.floors != null && (
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={
                        building.floors_source === "card" && building.floors_registry != null
                          ? `${t("В реестре зданий:")} ${building.floors_registry} ${t("эт.")}`
                          : undefined
                      }
                    >
                      {/* Этажность решает выбор автолестницы — крупнее и
                          контрастнее, чем остальной служебный текст блока. */}
                      <span className="text-base font-semibold text-fg">
                        {building.floors} {t("эт.")}
                      </span>
                      {/* Документ ПТП главнее реестра OSM — по этой цифре
                          выбирают автолестницу, и видно, откуда она взята. */}
                      {building.floors_source === "card" && <Badge>{t("по ПТП")}</Badge>}
                    </span>
                  )}
                  {building.year_built != null && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      {building.year_built} {t("г.")}
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
                {t("Открыть ПТП")}
              </LinkButton>
            )}
          </Card>
        ) : (
          <EmptyState
            icon={Building2}
            title={t("Здание не привязано")}
            description={t("Выезд зарегистрирован по координатам, без привязки к объекту.")}
          />
        )}
      </section>

      {/* Водоисточники */}
      <section>
        <SectionLabel className="mb-2">{t("Водоисточники")}</SectionLabel>
        {hydrants.length === 0 ? (
          <EmptyState
            icon={Droplets}
            title={t("Гидрантов рядом нет")}
            description={t("Уточните водоисточники на месте — ближайшие гидранты не найдены в радиусе поиска.")}
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
        <SectionLabel className="mb-2">{t("Препятствия")}</SectionLabel>
        {blocking.length === 0 && other.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("Препятствий не обнаружено")}
            description={t("Заблокированных проездов и водоисточников рядом не зарегистрировано.")}
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
        <SectionLabel className="mb-2">{t("Силы и средства")}</SectionLabel>
        {forces_hint ? (
          <ForcesBlock hint={forces_hint} href={forcesHref(pack)} />
        ) : (
          <EmptyState
            icon={Calculator}
            title={t("Рекомендации нет")}
            description={t("Выезд без привязки к объекту — параметры пожара подберите вручную.")}
            action={
              <LinkButton href={forcesHref(pack)} variant="secondary" size="sm">
                <Calculator className="h-3.5 w-3.5" />
                {t("Открыть расчёт")}
              </LinkButton>
            }
          />
        )}
      </section>
    </div>
  );
}

/* ───────────────────────────── Силы и средства ─────────────────── */

/** Одна цифра расчёта: подпись сверху, значение крупно и моноширинно. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] leading-tight text-faint">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular leading-none text-fg">{value}</dd>
    </div>
  );
}

/**
 * Расчёт по ПТП объекта против черновой прикидки по типу здания. Пока эти два
 * источника выглядели одинаково, РТП получал из пакета ранг №2 и 2+1 ствола
 * там, где в карточке того же вызова лежал ранг №3 и 4+2 — то есть на один АЦ
 * и три ствола меньше фактической потребности. Теперь пакет показывает цифры
 * из ПТП, а эвристика прямо называется черновой.
 */
function ForcesBlock({ hint, href }: { hint: ForcesHint; href: string }) {
  const t = useT();
  const fromCard = hint.source === "card";
  const barrels =
    hint.barrels_ext != null && hint.barrels_def != null
      ? `${hint.barrels_ext}+${hint.barrels_def}`
      : hint.barrels_ext != null
        ? String(hint.barrels_ext)
        : "—";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChip
          severity={fromCard ? SEVERITY.normal : SEVERITY.elevated}
          label={fromCard ? t("Расчёт по ПТП объекта") : t("Черновая прикидка")}
        />
        {fromCard && hint.rank && (
          <span className="text-sm text-muted">
            {t("Ранг пожара")}{" "}
            <span className="text-base font-semibold tabular text-fg">{hint.rank}</span>
          </span>
        )}
      </div>

      {fromCard ? (
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <Figure label={t("Стволы (туш.+защ.)")} value={barrels} />
          <Figure label={t("Отделений")} value={hint.squads != null ? String(hint.squads) : "—"} />
          <Figure
            label={t("Qобщ.тр, л/с")}
            value={hint.q_req_l_s != null ? hint.q_req_l_s.toFixed(2) : "—"}
          />
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {t("Расчёта по ПТП для этого объекта нет. Прикидка по типу здания:")}{" "}
          <span className="font-semibold text-fg">{hint.label}</span> —{" "}
          {t("проверьте параметры в калькуляторе перед выездом сил.")}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        <LinkButton href={href} variant="secondary" size="sm">
          <Calculator className="h-3.5 w-3.5" />
          {fromCard ? t("Уточнить расчёт") : t("Открыть расчёт")}
        </LinkButton>
        {fromCard && hint.card_id != null && (
          <LinkButton
            href={`/cards?id=${hint.card_id}`}
            variant="ghost"
            size="sm"
          >
            <ScanLine className="h-3.5 w-3.5" />
            {t("Расчёт в карточке ПТП")}
          </LinkButton>
        )}
      </div>
    </Card>
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
  const t = useT();
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
      if (!r.ok) throw new Error(t("Не удалось обновить статус гидранта"));
      const d = await r.json();
      onChanged({ ...hydrant, status: (d.status as HydrantStatus) ?? nextStatus });
    } catch (e) {
      // fetch() throws a bare TypeError when the network itself is
      // unreachable (offline, DNS, CORS) — that IS an Error, so `e.message`
      // used to leak the untranslated browser string ("Failed to fetch")
      // right in the offline scenario this fallback exists for. Our own
      // throws above are plain Error with an already-translated message —
      // TypeError is reserved for the network layer, so this reliably tells
      // the two apart instead of trusting e.message blindly.
      setError(
        e instanceof TypeError
          ? t("Нет связи с сервером — попробуйте ещё раз")
          : e instanceof Error
            ? e.message
            : t("Не удалось обновить статус"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip severity={meta.severity} label={t(meta.label)} />
          {hydrant.hydrant_type && <span className="text-xs text-muted">{hydrant.hydrant_type}</span>}
        </div>
        {/* Расстояние/диаметр/давление — цифры, по которым РТП решает, куда
            качать воду и каким стволом; несут больше тактического веса, чем
            служебный текст рядом, поэтому крупнее и контрастнее его. */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-fg tabular">
          {hydrant.pressure_bar != null && <span>{hydrant.pressure_bar} {t("бар")}</span>}
          {hydrant.diameter_mm != null && <span>⌀ {hydrant.diameter_mm} {t("мм")}</span>}
          <span>{hydrant.distance_m} {t("м")}</span>
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
          {hydrant.status === "ok" ? t("Отметить неисправным") : t("Отметить исправным")}
        </Button>
      )}
    </Card>
  );
}

/* ───────────────────────────── Obstacle report ─────────────────── */

function ObstacleReport({ report, muted = false }: { report: PackReport; muted?: boolean }) {
  const t = useT();
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
          <p className={cn("text-sm font-semibold", meta.severity.text)}>{t(meta.label)}</p>
          {report.description && <p className="mt-0.5 text-sm text-muted">{report.description}</p>}
          <p className="mt-1 text-xs text-faint tabular">{report.distance_m} {t("м")}</p>
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
                    alt={t("Фото препятствия")}
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
