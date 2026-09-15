"use client";

/**
 * Лист схемы расстановки для донесения о пожаре.
 *
 * То же, что рисует РТП пальцем на планшете (`DeploymentPlan`), но без единого
 * жеста: документ. Отсюда три отличия, каждое продиктовано бумагой, а не
 * вкусом.
 *
 *  • **У позиций есть номера.** На экране позицию опознают по цвету и иконке;
 *    донесение читают в чёрно-белой копии, подшитой в дело, где цвет исчезает
 *    первым. Номер связывает маркер на плане со строкой таблицы под ним.
 *  • **Легенда печатается на том же листе.** Отдельная страница с условными
 *    обозначениями теряется, а лист схемы должен читаться сам по себе — его
 *    прикладывают к делу и через год достают без остального пакета.
 *  • **Одна схема — один этаж и один этап.** Расстановка на локализации и на
 *    ликвидации различается, и наложенные друг на друга они превращаются в
 *    кашу, по которой разбор не сделать.
 *
 * Маркеры лежат абсолютным оверлеем в процентах поверх той же подложки, что и
 * на экране: координаты — доля от габарита плана, поэтому лист печатается в
 * любом масштабе без пересчёта.
 */

import FloorPlan2D from "@/components/FloorPlan2D";
import {
  LATE_SYNC_ICON,
  POSITION_KIND_META,
  formatClock,
  lateSyncStamp,
  type DeploymentPosition,
} from "@/lib/dispatch";
import type { RealFloorPlan } from "@/data/floorplans/hayvill";

/** Позиция с номером, под которым она стоит в таблице листа. */
export type NumberedPosition = DeploymentPosition & { no: number };

/** Пометка строки: позиция дошла с планшета РТП уже после закрытия выезда.
 *  Значок и текст, а не цвет: лист читают в чёрно-белой копии. */
export function LateSyncMark({
  position,
  closedAt,
}: {
  position: DeploymentPosition;
  closedAt: string | null;
}) {
  if (!position.synced_after_close_at) return null;
  const Icon = LATE_SYNC_ICON;
  return (
    <span className="mt-0.5 flex items-center gap-1 text-2xs text-muted">
      <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden />
      <span className="tabular">
        досинхронизировано после закрытия, {lateSyncStamp(position.synced_after_close_at, closedAt)}
      </span>
    </span>
  );
}

export default function DeploymentSheet({
  plan,
  positions,
  closedAt = null,
}: {
  plan: RealFloorPlan;
  /** Позиции одного этажа и одного этапа, уже пронумерованные. */
  positions: NumberedPosition[];
  /** Когда закрыт выезд — для даты у пометки досинхронизации. */
  closedAt?: string | null;
}) {
  // Легенда — только те типы, что есть на этом листе: перечислять шесть
  // условных обозначений там, где стоят два ствола, значит заставлять читателя
  // искать нужное среди лишнего.
  const kinds = [...new Set(positions.map((p) => p.kind))];
  const hasLate = positions.some((p) => p.synced_after_close_at);
  const LateIcon = LATE_SYNC_ICON;

  return (
    <div className="space-y-3">
      <div data-deployment-sheet className="relative rounded border border-border bg-surface">
        <FloorPlan2D plan={plan} compact />

        {positions.map((p) => {
          const meta = POSITION_KIND_META[p.kind];
          const Icon = meta.icon;
          return (
            <div
              key={p.id}
              data-sheet-pos={p.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(p.plan_x ?? 0) * 100}%`, top: `${(p.plan_y ?? 0) * 100}%` }}
            >
              {meta.directional && p.heading != null && (
                <span
                  className="absolute left-1/2 top-1/2 h-7 w-0.5 origin-top"
                  style={{
                    background: meta.cssVar,
                    transform: `translate(-50%, 0) rotate(${p.heading - 180}deg)`,
                  }}
                  aria-hidden
                />
              )}
              <span
                className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 bg-surface"
                style={{ borderColor: meta.cssVar }}
              >
                <Icon className="h-4 w-4" style={{ color: meta.cssVar }} aria-hidden />
                <span
                  className="tabular absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-2xs font-semibold text-fg"
                  aria-hidden
                >
                  {p.no}
                </span>
                {p.synced_after_close_at && (
                  <span
                    className="absolute -left-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-fg"
                    aria-hidden
                  >
                    <LateIcon className="h-2.5 w-2.5" />
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {kinds.map((kind) => {
          const meta = POSITION_KIND_META[kind];
          const Icon = meta.icon;
          return (
            <span key={kind} className="flex items-center gap-1.5 text-2xs text-muted">
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full border"
                style={{ borderColor: meta.cssVar }}
              >
                <Icon className="h-2.5 w-2.5" style={{ color: meta.cssVar }} aria-hidden />
              </span>
              {meta.label}
            </span>
          );
        })}
        {hasLate && (
          <span className="flex items-center gap-1.5 text-2xs text-muted">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border text-fg">
              <LateIcon className="h-2.5 w-2.5" aria-hidden />
            </span>
            досинхронизировано после закрытия выезда
          </span>
        )}
      </div>

      <table className="w-full border-collapse text-2xs">
        <thead>
          <tr className="border-b border-border text-left text-faint">
            <th className="w-8 py-1 font-medium">№</th>
            <th className="py-1 font-medium">Позиция</th>
            <th className="py-1 font-medium">Боевой участок</th>
            <th className="w-20 py-1 font-medium">Направление</th>
            <th className="w-16 py-1 font-medium">Время</th>
            <th className="w-28 py-1 font-medium">Поставил</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const meta = POSITION_KIND_META[p.kind];
            return (
              <tr key={p.id} className="border-b border-border/60">
                <td className="tabular py-1 font-semibold">{p.no}</td>
                <td className="py-1">
                  {meta.label}
                  <LateSyncMark position={p} closedAt={closedAt} />
                </td>
                <td className="py-1">{p.sector || "—"}</td>
                <td className="tabular py-1">
                  {meta.directional && p.heading != null ? `${p.heading}°` : "—"}
                </td>
                {/* Время постановки, а не записи: позиция, поставленная без
                    связи, доехала до сервера позже, чем её подали. */}
                <td className="tabular py-1">{formatClock(p.placed_at ?? p.created_at)}</td>
                <td className="py-1">{p.created_by}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
