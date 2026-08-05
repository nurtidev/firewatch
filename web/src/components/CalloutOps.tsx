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
import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  Truck,
  Package,
  Map,
  List,
  LayoutGrid,
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
  Select,
  Field,
} from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SEVERITY } from "@/lib/risk";
import { apiFetch } from "@/lib/auth";
import FloorPlan2D from "@/components/FloorPlan2D";
import DeploymentPlan from "@/components/DeploymentPlan";
import { realPlanForFloor } from "@/lib/realgeom";
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
  POSITION_KINDS,
  POSITION_KIND_META,
  POSITION_PHASES,
  POSITION_PHASE_LABEL,
  addPosition,
  deletePosition,
  patchPosition,
  type CalloutPackData,
  type TimelineStep,
  type ResourceItem,
  type Vehicle,
  type PositionKind,
  type PositionPhase,
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
  // Граница проходит не по «закрыт / не закрыт», а по смыслу действия.
  // Оперативные (наряд, расстановка) на закрытом выезде запрещает сервер —
  // силами закрытого выезда уже не распоряжаются. Документальные (хронология,
  // расход) он разрешает: их уточняют позже, когда РТП садится составлять
  // донесение о пожаре. Интерфейс обязан повторять ровно это различие.
  const editable = canEdit && !closed;
  const documentEditable = canEdit;

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
                  {documentEditable && (
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

      {/* ─────────────── План развёртывания ─────────────── */}
      <DeploymentSection pack={pack} editable={editable} busy={busy} onRun={run} />

      {/* ─────────────── Расход средств ─────────────── */}
      <ResourcesSection pack={pack} editable={documentEditable} busy={busy} onRun={run} />
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
  // Справочник по всему городу тянется только когда РТП открыл выбор техники.
  const { data, reload } = useVehicles(null, picking ? 15000 : undefined, picking);

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

/* ─────────────────────── План развёртывания ─────────────────────── */

function DeploymentSection({
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
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<PositionKind>("barrel_ext");
  const [phase, setPhase] = useState<PositionPhase>("localization");
  const [sector, setSector] = useState("");
  // Схема против списка: на объекте с оцифрованным планом расстановку ведут
  // на схеме, без плана остаётся список по участкам — он работает всегда.
  const [mode, setMode] = useState<"list" | "plan">("list");
  const [card, setCard] = useState<{ extracted?: Record<string, unknown> } | null>(null);
  const [floor, setFloor] = useState("");

  const cardId = pack.building?.card_id ?? null;
  useEffect(() => {
    // Карточку тянем только когда открыли схему: боевой пакет отдаёт её id,
    // но не геометрию, а на планшете лишний запрос стоит дорого.
    if (mode !== "plan" || card || cardId == null) return;
    apiFetch(`/cards/${cardId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCard(d))
      .catch(() => {});
  }, [mode, card, cardId]);

  const floors = useMemo(() => {
    const ex = card?.extracted as { floor_plans?: { floor?: string }[] } | undefined;
    return (ex?.floor_plans ?? []).map((f) => f.floor).filter(Boolean) as string[];
  }, [card]);

  const objectName = (
    (card?.extracted as { object?: { name?: string } } | undefined)?.object?.name
  );
  const activeFloor = floor || floors[0] || "";
  const plan = useMemo(
    () => realPlanForFloor(objectName, activeFloor),
    [objectName, activeFloor],
  );

  const positions = pack.deployment ?? [];
  const hint = pack.forces_hint;

  // Сверка факта с методикой — то же сравнение, что у наряда техники.
  // Раздельно по тушению и защите: расчёт даёт для них разные величины.
  const placed = (k: PositionKind) => positions.filter((p) => p.kind === k).length;
  const compare: { k: PositionKind; need: number | null }[] = [
    { k: "barrel_ext", need: hint?.barrels_ext ?? null },
    { k: "barrel_def", need: hint?.barrels_def ?? null },
  ];

  const submit = () =>
    onRun("add-position", () =>
      addPosition(pack.callout.id, {
        kind,
        phase,
        sector: sector.trim() || null,
      }),
    ).then(() => {
      setSector("");
      setAdding(false);
    });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>
          <Map className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          {t("План развёртывания")}
        </SectionLabel>
        <div className="flex flex-wrap items-center gap-2">
          {compare.map(({ k, need }) =>
            need != null ? (
              <StatusChip
                key={k}
                severity={placed(k) < need ? SEVERITY.high : SEVERITY.normal}
                label={`${t(POSITION_KIND_META[k].short)} ${placed(k)} / ${need}`}
              />
            ) : null,
          )}
          {cardId != null && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode(mode === "plan" ? "list" : "plan")}
            >
              {mode === "plan" ? (
                <List className="h-4 w-4" aria-hidden />
              ) : (
                <LayoutGrid className="h-4 w-4" aria-hidden />
              )}
              {t(mode === "plan" ? "Списком" : "На схеме")}
            </Button>
          )}
          {editable && mode === "list" && (
            <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("Позиция")}
            </Button>
          )}
        </div>
      </div>

      {adding && editable && (
        <div className="mt-3 grid gap-3 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-4">
          <Field label={t("Тип позиции")}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as PositionKind)}>
              {POSITION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(POSITION_KIND_META[k].label)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Этап")}>
            <Select value={phase} onChange={(e) => setPhase(e.target.value as PositionPhase)}>
              {POSITION_PHASES.map((p) => (
                <option key={p} value={p}>
                  {t(POSITION_PHASE_LABEL[p])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Боевой участок")}>
            <Input
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder={t("БУ-1, 5 этаж")}
              maxLength={120}
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={submit} disabled={busy === "add-position"} className="w-full">
              {busy === "add-position" && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              {t("Поставить")}
            </Button>
          </div>
        </div>
      )}

      {mode === "plan" ? (
        plan ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel className="mr-1">{t("Этаж")}</SectionLabel>
              {floors.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={activeFloor === f ? "primary" : "secondary"}
                  onClick={() => setFloor(f)}
                >
                  {f}
                </Button>
              ))}
              <span className="ml-auto flex gap-2">
                {POSITION_PHASES.map((ph) => (
                  <Button
                    key={ph}
                    size="sm"
                    variant={phase === ph ? "primary" : "secondary"}
                    onClick={() => setPhase(ph)}
                  >
                    {t(POSITION_PHASE_LABEL[ph])}
                  </Button>
                ))}
              </span>
            </div>

            <DeploymentPlan
              positions={positions}
              floor={activeFloor}
              phase={phase}
              editable={editable}
              onAdd={(k, x, y) =>
                onRun("add-position", () =>
                  addPosition(pack.callout.id, {
                    kind: k,
                    phase,
                    floor: activeFloor,
                    plan_x: x,
                    plan_y: y,
                  }),
                )
              }
              onMove={(id, x, y) =>
                onRun(`move-${id}`, () =>
                  patchPosition(pack.callout.id, id, { plan_x: x, plan_y: y }),
                )
              }
              onRotate={(id, heading) =>
                onRun(`rot-${id}`, () => patchPosition(pack.callout.id, id, { heading }))
              }
              onRemove={(id) =>
                onRun(`del-pos-${id}`, () => deletePosition(pack.callout.id, id))
              }
            >
              <FloorPlan2D plan={plan} />
            </DeploymentPlan>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            {t("У объекта нет оцифрованного поэтажного плана — расстановка ведётся списком по участкам.")}
          </p>
        )
      ) : positions.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {t("Расстановка сил не зафиксирована.")}
        </p>
      ) : (
        POSITION_PHASES.map((ph) => {
          const inPhase = positions.filter((p) => p.phase === ph);
          if (inPhase.length === 0) return null;
          return (
            <div key={ph} className="mt-3">
              <div className="text-xs font-medium text-faint">
                {t(POSITION_PHASE_LABEL[ph])}
              </div>
              <ul className="mt-1.5 space-y-2">
                {inPhase.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Badge>{t(POSITION_KIND_META[p.kind].short)}</Badge>
                      <span className="truncate text-sm text-fg">
                        {p.sector || t("участок не указан")}
                      </span>
                      {p.note && (
                        <span className="truncate text-xs text-faint">{p.note}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.lat != null && (
                        <span className="tabular text-2xs text-faint">
                          {p.lat.toFixed(4)}, {p.lng?.toFixed(4)}
                        </span>
                      )}
                      {editable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            onRun(`del-pos-${p.id}`, () =>
                              deletePosition(pack.callout.id, p.id),
                            )
                          }
                          disabled={busy === `del-pos-${p.id}`}
                          aria-label={`${t("Снять позицию")}: ${t(POSITION_KIND_META[p.kind].label)}`}
                        >
                          {busy === `del-pos-${p.id}` ? (
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
            </div>
          );
        })
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
