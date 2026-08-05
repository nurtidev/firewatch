"use client";

/**
 * Оперативный блок выезда: хронология боевых действий, наряд сил и расход
 * средств. Живёт под боевым пакетом на планшете РТП (/callout) и на пульте
 * ЦОУ (/dispatch).
 *
 * Принцип, определяющий весь этот экран: система *предлагает* расчёт по
 * методике, а отметки ставит человек. Ни одна отметка времени не выставляется
 * автоматически — даже там, где её можно было бы вывести. Автоматика придёт
 * тогда, когда появится доверенный источник (телематика системы мониторинга),
 * и заменит собой ручной ввод, а не решение РТП.
 *
 * Отметка ставится «сейчас» одним нажатием — в кабине и на месте пожара никто
 * не набирает время руками. Ошибочную отметку можно снять тем же нажатием.
 */
import { useState } from "react";
import {
  Clock,
  Truck,
  Package,
  Check,
  X,
  Plus,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  Card,
  SectionLabel,
  Button,
  Badge,
  StatusChip,
  Banner,
  EmptyState,
  Input,
} from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SEVERITY } from "@/lib/risk";
import {
  TIMELINE_STEPS,
  TIMELINE_STEP_LABEL,
  VEHICLE_TYPE_META,
  VEHICLE_STATUS_META,
  RESOURCE_ITEMS,
  RESOURCE_META,
  formatClock,
  formatDuration,
  patchTimeline,
  assignVehicles,
  releaseVehicle,
  putResources,
  useVehicles,
  type CalloutPackData,
  type TimelineStep,
  type ResourceItem,
  type Vehicle,
} from "@/lib/dispatch";

/** Норматив прибытия в городе — 10 минут (Закон «О гражданской защите»).
 *  Показывается как сравнение, а не как оценка работы караула: причина
 *  превышения (перекрытый проезд, пробка) видна не здесь, а в донесениях. */
const RESPONSE_NORM_SEC = 600;

export default function CalloutOps({
  pack,
  onChanged,
  canEdit,
  large,
}: {
  pack: CalloutPackData;
  onChanged: () => void;
  /** Диспетчер и РТП ставят отметки; надзорные роли смотрят только чтение. */
  canEdit: boolean;
  large?: boolean;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const callout = pack.callout;
  const timeline = callout.timeline;
  const closed = callout.status === "closed";
  const editable = canEdit && !closed;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Не удалось сохранить изменение"));
    } finally {
      setBusy(null);
    }
  };

  const toggleMark = (step: TimelineStep) =>
    run(step, () =>
      patchTimeline(callout.id, {
        [step]: timeline[step] ? null : new Date().toISOString(),
      }),
    );

  const overNorm =
    timeline.response_sec != null && timeline.response_sec > RESPONSE_NORM_SEC;

  return (
    <div className={cn("space-y-4", large && "space-y-5")}>
      {error && <Banner tone="critical">{error}</Banner>}

      {/* ─────────────── Хронология ─────────────── */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>
            <Clock className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
            {t("Хронология выезда")}
          </SectionLabel>
          {timeline.response_sec != null && (
            <StatusChip
              severity={overNorm ? SEVERITY.critical : SEVERITY.normal}
              label={`${t("Прибытие")}: ${formatDuration(timeline.response_sec)}`}
            />
          )}
        </div>

        <p className="mt-1 text-xs text-faint">
          {t("Сообщение о пожаре")} — {formatClock(timeline.reported_at)}
          {overNorm && (
            <span className="ml-2 text-critical">
              <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
              {t("сверх норматива 10 мин")}
            </span>
          )}
        </p>

        <ol className="mt-3 space-y-2">
          {TIMELINE_STEPS.map((step, i) => {
            const at = timeline[step];
            const done = Boolean(at);
            // Следующий шаг подсвечивается как ожидаемый — в кабине нужно
            // видеть, что нажимать дальше, без чтения всех строк.
            const isNext = !done && TIMELINE_STEPS.slice(0, i).every((s) => timeline[s]);
            return (
              <li
                key={step}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                  done
                    ? "border-border bg-surface-2"
                    : isNext
                      ? "border-accent/40 bg-accent/5"
                      : "border-border/60",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular",
                      done
                        ? "bg-normal/15 text-normal"
                        : "bg-surface-3 text-faint",
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className={cn("truncate text-sm", done ? "text-fg" : "text-muted")}>
                    {t(TIMELINE_STEP_LABEL[step])}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-sm text-muted">{formatClock(at)}</span>
                  {editable && (
                    <Button
                      size={large ? "lg" : "sm"}
                      variant={done ? "ghost" : "secondary"}
                      onClick={() => toggleMark(step)}
                      disabled={busy === step}
                      aria-label={
                        done
                          ? `${t("Снять отметку")}: ${t(TIMELINE_STEP_LABEL[step])}`
                          : `${t("Отметить")}: ${t(TIMELINE_STEP_LABEL[step])}`
                      }
                    >
                      {busy === step ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : done ? (
                        <X className="h-4 w-4" aria-hidden />
                      ) : (
                        t("Отметить")
                      )}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {(timeline.turnout_sec != null || timeline.total_sec != null) && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-muted">
            {timeline.turnout_sec != null && (
              <span>
                {t("Сбор караула")}:{" "}
                <span className="tabular text-fg">{formatDuration(timeline.turnout_sec)}</span>
              </span>
            )}
            {timeline.travel_sec != null && (
              <span>
                {t("В пути")}:{" "}
                <span className="tabular text-fg">{formatDuration(timeline.travel_sec)}</span>
              </span>
            )}
            {timeline.total_sec != null && (
              <span>
                {t("Всего до ликвидации")}:{" "}
                <span className="tabular text-fg">{formatDuration(timeline.total_sec)}</span>
              </span>
            )}
          </div>
        )}
      </Card>

      {/* ─────────────── Наряд сил ─────────────── */}
      <VehiclesSection
        pack={pack}
        editable={editable}
        large={large}
        busy={busy}
        onRun={run}
      />

      {/* ─────────────── Расход средств ─────────────── */}
      <ResourcesSection pack={pack} editable={canEdit} busy={busy} onRun={run} />
    </div>
  );
}

/* ───────────────────────── Наряд сил ───────────────────────── */

function VehiclesSection({
  pack,
  editable,
  large,
  busy,
  onRun,
}: {
  pack: CalloutPackData;
  editable: boolean;
  large?: boolean;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const { data, reload } = useVehicles(null, picking ? 15000 : undefined);

  const assigned = pack.vehicles;
  const assignedIds = new Set(assigned.map((v) => v.id));
  // В строю и не в этом наряде — то, что реально можно отправить сейчас.
  const available = (data?.vehicles ?? []).filter(
    (v) => v.status === "in_service" && !assignedIds.has(v.id),
  );

  const hint = pack.forces_hint;
  // Расчёт предлагает N машин — сравнение с фактом здесь и есть смысл наряда.
  const needed = hint?.trucks ?? null;
  const short = needed != null && assigned.length < needed;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          <Truck className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          {t("Наряд сил")}
        </SectionLabel>
        <div className="flex items-center gap-2">
          {needed != null && (
            <StatusChip
              severity={short ? SEVERITY.high : SEVERITY.normal}
              label={`${assigned.length} / ${needed} ${t("по расчёту")}`}
            />
          )}
          {editable && (
            <Button
              size={large ? "lg" : "sm"}
              variant="secondary"
              onClick={() => {
                setPicking((v) => !v);
                reload();
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("Назначить")}
            </Button>
          )}
        </div>
      </div>

      {assigned.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("Техника на выезд не назначена.")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {assigned.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Badge>{t(VEHICLE_TYPE_META[v.vehicle_type].short)}</Badge>
                <span className="truncate text-sm font-medium text-fg">{v.callsign}</span>
                <span className="truncate text-xs text-faint">{v.station_name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {v.water_l != null && (
                  <span className="tabular text-xs text-muted">{v.water_l} {t("л")}</span>
                )}
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRun(`rel-${v.id}`, () => releaseVehicle(pack.callout.id, v.id))}
                    disabled={busy === `rel-${v.id}`}
                    aria-label={`${t("Снять с выезда")}: ${v.callsign}`}
                  >
                    {busy === `rel-${v.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <X className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {picking && editable && (
        <div className="mt-3 border-t border-border pt-3">
          <SectionLabel>{t("Свободная техника")}</SectionLabel>
          {available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {t("Свободной техники в строю нет — проверьте состояние машин в частях.")}
            </p>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {available.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onRun(`asg-${v.id}`, () => assignVehicles(pack.callout.id, [v.id])).then(reload)
                    }
                    disabled={busy === `asg-${v.id}`}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left transition-[background-color] duration-[var(--dur-fast)] hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge>{t(VEHICLE_TYPE_META[v.vehicle_type].short)}</Badge>
                      <span className="truncate text-sm text-fg">{v.callsign}</span>
                    </span>
                    <span className="truncate text-xs text-faint">{v.station_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────── Расход средств ───────────────────────── */

function ResourcesSection({
  pack,
  editable,
  busy,
  onRun,
}: {
  pack: CalloutPackData;
  editable: boolean;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(pack.resources.map((r) => [r.item_key, String(r.qty)])),
  );

  const recorded = pack.resources.filter((r) => r.qty > 0);

  const save = () =>
    onRun("resources", () =>
      putResources(
        pack.callout.id,
        RESOURCE_ITEMS.map((key) => ({ item_key: key, qty: Number(draft[key] ?? 0) }))
          .filter((l) => Number.isFinite(l.qty) && l.qty > 0),
      ),
    ).then(() => setOpen(false));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          <Package className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          {t("Расход средств")}
        </SectionLabel>
        {editable && (
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? t("Отмена") : recorded.length ? t("Изменить") : t("Внести")}
          </Button>
        )}
      </div>

      {!open &&
        (recorded.length === 0 ? (
          <EmptyState
            className="mt-2 py-4"
            icon={Package}
            title={t("Расход не внесён")}
            description={t("Заполняется после ликвидации — что израсходовано на тушении.")}
          />
        ) : (
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {recorded.map((r) => (
              <li key={r.item_key} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-muted">{t(RESOURCE_META[r.item_key].label)}</span>
                <span className="tabular font-medium text-fg">
                  {r.qty} <span className="text-xs text-faint">{t(RESOURCE_META[r.item_key].unit)}</span>
                </span>
              </li>
            ))}
          </ul>
        ))}

      {open && editable && (
        <div className="mt-3 space-y-2">
          {RESOURCE_ITEMS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <label htmlFor={`res-${key}`} className="truncate text-sm text-muted">
                {t(RESOURCE_META[key].label)}
              </label>
              <div className="flex shrink-0 items-center gap-2">
                <Input
                  id={`res-${key}`}
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  className="w-24 text-right tabular"
                  value={draft[key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
                <span className="w-8 text-xs text-faint">{t(RESOURCE_META[key].unit)}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("Отмена")}
            </Button>
            <Button size="sm" onClick={save} disabled={busy === "resources"}>
              {busy === "resources" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("Сохранить")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
