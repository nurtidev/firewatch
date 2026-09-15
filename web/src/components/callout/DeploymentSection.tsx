"use client";

/**
 * План развёртывания: расстановка сил на поэтажной схеме объекта или списком
 * по участкам. Очередь расстановки (`queue`) приходит сверху — она общая для
 * всех разделов выезда и переживает переход между ними (см. CalloutOps).
 */
import { useEffect, useMemo, useState } from "react";
import { CloudOff, LayoutGrid, List, Loader2, Map, Plus, X } from "lucide-react";
import { Badge, Button, Card, Field, Input, SectionLabel, Select, StatusChip } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n";
import { SEVERITY } from "@/lib/risk";
import { apiFetch } from "@/lib/auth";
import FloorPlan2D from "@/components/FloorPlan2D";
import DeploymentPlan from "@/components/DeploymentPlan";
import StaleDataBanner from "@/components/StaleDataBanner";
import { realPlanForFloor } from "@/lib/realgeom";
import {
  POSITION_KINDS,
  POSITION_KIND_META,
  POSITION_PHASES,
  POSITION_PHASE_LABEL,
  LATE_SYNC_ICON,
  addPosition,
  lateSyncStamp,
  type CalloutPackData,
  type PositionKind,
  type PositionPhase,
} from "@/lib/dispatch";
import {
  mergePositions,
  queueCreate,
  queueDelete,
  queueUpdate,
  type PlanPosition,
  type PositionFields,
  type PositionLabel,
} from "@/lib/deploymentQueue";
import type { DeploymentQueue } from "./useDeploymentQueue";
import type { RunAction } from "./types";

export default function DeploymentSection({
  pack,
  cachedAt,
  editable,
  busy,
  onRun,
  queue,
}: {
  pack: CalloutPackData;
  cachedAt: string | null;
  editable: boolean;
  busy: string | null;
  onRun: RunAction;
  queue: DeploymentQueue;
}) {
  const t = useT();
  const { locale } = useLocale();
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

  const calloutId = pack.callout.id;
  const { setSynced } = queue;
  const closedAt = pack.callout.closed_at;
  const LateIcon = LATE_SYNC_ICON;
  // Свежий боевой пакет главнее ответа синхронизации — он приходит позже и
  // видит в том числе то, что сделали с пульта.
  const serverPositions = pack.deployment ?? [];
  useEffect(() => {
    setSynced(null);
  }, [serverPositions, setSynced]);

  // Единственный источник для отрисовки: то, что на сервере, плюс то, что
  // ещё не уехало. Иначе РТП без связи видел бы «0 из 4 стволов», расставив
  // четыре, и пошёл бы расставлять их заново.
  const positions = useMemo(
    () => mergePositions(queue.synced ?? serverPositions, queue.pending),
    [queue.synced, serverPositions, queue.pending],
  );
  const hint = pack.forces_hint;

  // Сверка факта с методикой — то же сравнение, что у наряда техники.
  // Раздельно по тушению и защите: расчёт даёт для них разные величины.
  const placed = (k: PositionKind) => positions.filter((p) => p.kind === k).length;
  const compare: { k: PositionKind; need: number | null }[] = [
    { k: "barrel_ext", need: hint?.barrels_ext ?? null },
    { k: "barrel_def", need: hint?.barrels_def ?? null },
  ];

  // Позиция из формы — работа за столом: у неё есть участок, но нет места на
  // плане, и ставят её с пульта, где связь есть. Через очередь идёт то, что
  // ставят пальцем на схеме — то есть на пожаре.
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

  // Что это за позиция — запоминается в очереди, чтобы отказ сервера назвать
  // по-человечески («Перемещение: Ствол на тушение · 5-й этаж»), даже если
  // позиции к тому времени на схеме уже нет.
  const labelFor = (pos: PlanPosition | undefined): PositionLabel | undefined =>
    pos ? { kind: pos.kind, floor: pos.floor, sector: pos.sector } : undefined;

  const move = (key: string, fields: PositionFields) => {
    const pos = positions.find((p) => p.key === key);
    queue.apply(() =>
      queueUpdate(calloutId, key, pos?.serverId ?? null, fields, labelFor(pos)),
    );
  };

  const remove = (key: string) => {
    const pos = positions.find((p) => p.key === key);
    queue.apply(() => queueDelete(calloutId, key, pos?.serverId ?? null, labelFor(pos)));
  };

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

      {/* Серверная часть расстановки пришла из офлайн-кэша: то, что поставили
          или сняли с пульта после снимка, на схеме не видно. Своё
          неотправленное РТП видит всегда — оно лежит на устройстве. Пометка
          стоит рядом со схемой, а не только над разделами. */}
      <StaleDataBanner cachedAt={cachedAt} kind="deployment" className="mt-3" />

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
              closedAt={closedAt}
              onAdd={(k, x, y) =>
                queue.apply(() =>
                  queueCreate(calloutId, {
                    kind: k,
                    phase,
                    floor: activeFloor,
                    plan_x: x,
                    plan_y: y,
                  }),
                )
              }
              onMove={(key, x, y) => move(key, { plan_x: x, plan_y: y })}
              onRotate={(key, heading) => move(key, { heading })}
              onRemove={remove}
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
                    key={p.key}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Badge>{t(POSITION_KIND_META[p.kind].short)}</Badge>
                      <span className="truncate text-sm text-fg">
                        {p.sector || p.floor || t("участок не указан")}
                      </span>
                      {p.note && (
                        <span className="truncate text-xs text-faint">{p.note}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* То же различие, что и на схеме: позиция есть, но на
                          пульте её пока не видят. */}
                      {p.pending && (
                        <span className="flex items-center gap-1 text-2xs text-muted">
                          <CloudOff className="h-3 w-3" aria-hidden />
                          {t("ждёт отправки")}
                        </span>
                      )}
                      {/* Дошла с планшета уже после закрытия выезда. */}
                      {p.synced_after_close_at && (
                        <span className="flex items-center gap-1 text-2xs text-info">
                          <LateIcon className="h-3 w-3" aria-hidden />
                          {t("досинхронизировано после закрытия, {time}").replace(
                            "{time}",
                            lateSyncStamp(p.synced_after_close_at, closedAt, locale),
                          )}
                        </span>
                      )}
                      {p.lat != null && (
                        <span className="tabular text-2xs text-faint">
                          {p.lat.toFixed(4)}, {p.lng?.toFixed(4)}
                        </span>
                      )}
                      {editable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(p.key)}
                          aria-label={`${t("Снять позицию")}: ${t(POSITION_KIND_META[p.kind].label)}`}
                        >
                          <X className="h-4 w-4" aria-hidden />
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
