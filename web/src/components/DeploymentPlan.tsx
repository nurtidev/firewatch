"use client";

/**
 * Расстановка сил на поэтажном плане: палитра, перетаскивание, направление.
 *
 * Это не редактор схем. РТП работает в перчатках, под давлением, часто одной
 * рукой — поэтому здесь шесть инструментов и три жеста, а не свобода
 * рисования. Произвольные фигуры, текст и слои уместны в разборе после
 * пожара, а на пожаре мешают.
 *
 * Жесты:
 *   • инструмент выбран + тап по плану  → поставить позицию;
 *   • перетащить маркер                 → сдвинуть;
 *   • тап по маркеру                    → выбрать, снизу появляется поворот.
 *
 * Координаты — доля от габарита плана (0..1), поэтому слой лежит абсолютным
 * оверлеем в процентах и не зависит ни от viewBox плана, ни от размера
 * экрана: одна и та же расстановка одинаково верна на планшете, на десктопе
 * и в экспорте в донесение.
 *
 * Позиции адресуются строковым ключом (`client_uid` либо `srv:<id>`), а не
 * серверным id: без связи id ещё не существует, а расставлять надо уже
 * сейчас. Ключ не меняется в момент синхронизации — выделенный маркер не
 * слетает под рукой РТП. Подробнее — `lib/deploymentQueue.ts`.
 */
import { useCallback, useRef, useState } from "react";
import { RotateCw, Trash2, MousePointer2, CloudUpload } from "lucide-react";
import { Button, SectionLabel, StatusChip } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SEVERITY } from "@/lib/risk";
import {
  LATE_SYNC_ICON,
  POSITION_KIND_META,
  POSITION_TOOL_KINDS,
  lateSyncStamp,
  type PositionKind,
  type PositionPhase,
} from "@/lib/dispatch";
import type { PlanPosition } from "@/lib/deploymentQueue";

export default function DeploymentPlan({
  positions,
  floor,
  phase,
  editable,
  closedAt = null,
  onAdd,
  onMove,
  onRotate,
  onRemove,
  children,
}: {
  positions: PlanPosition[];
  /** Этаж, схема которого сейчас открыта: ставим и показываем только его. */
  floor: string;
  phase: PositionPhase;
  editable: boolean;
  /** Когда закрыт выезд: время досинхронизации на другие сутки — с датой. */
  closedAt?: string | null;
  onAdd: (kind: PositionKind, x: number, y: number) => void;
  onMove: (key: string, x: number, y: number) => void;
  onRotate: (key: string, heading: number) => void;
  onRemove: (key: string) => void;
  /** Подложка — поэтажный план (FloorPlan2D) или скан «Схем ДЧС». */
  children: React.ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const boxRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<PositionKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const dragRef = useRef<{ key: string; moved: boolean } | null>(null);

  const onFloor = positions.filter(
    (p) => p.plan_x != null && p.plan_y != null && (p.floor ?? "") === floor && p.phase === phase,
  );
  const pendingHere = onFloor.filter((p) => p.pending).length;
  // Позиции, дошедшие с планшета уже после закрытия выезда: на схеме они те
  // же самые, но разбор обязан видеть, что строка пришла позже закрытия.
  const lateHere = onFloor.filter((p) => p.synced_after_close_at).length;
  const lateText = (p: PlanPosition) =>
    t("досинхронизировано после закрытия, {time}").replace(
      "{time}",
      lateSyncStamp(p.synced_after_close_at, closedAt, locale),
    );
  const LateIcon = LATE_SYNC_ICON;

  /** Точка события → доля от габарита плана, с зажимом в границы: маркер,
   *  утащенный за край, иначе сохранился бы с координатой вне 0..1 и был бы
   *  отвергнут сервером уже после того, как пользователь его отпустил. */
  const toFraction = useCallback((clientX: number, clientY: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return null;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x: Number(clamp((clientX - box.left) / box.width).toFixed(4)),
      y: Number(clamp((clientY - box.top) / box.height).toFixed(4)),
    };
  }, []);

  const handlePlanClick = (e: React.PointerEvent) => {
    if (!editable || !tool || dragRef.current) return;
    const pos = toFraction(e.clientX, e.clientY);
    if (pos) onAdd(tool, pos.x, pos.y);
  };

  const handleMarkerDown = (e: React.PointerEvent, key: string) => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { key, moved: false };
    setSelected(key);
  };

  const handleMarkerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = toFraction(e.clientX, e.clientY);
    if (!pos) return;
    drag.moved = true;
    // Оптимистично двигаем маркер прямо в DOM: ждать перерисовки на каждый
    // кадр перетаскивания нельзя — маркер бы «залипал» под пальцем.
    const el = boxRef.current?.querySelector<HTMLElement>(
      `[data-pos="${CSS.escape(drag.key)}"]`,
    );
    if (el) {
      el.style.left = `${pos.x * 100}%`;
      el.style.top = `${pos.y * 100}%`;
    }
  };

  const handleMarkerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return;
    const pos = toFraction(e.clientX, e.clientY);
    if (pos) onMove(drag.key, pos.x, pos.y);
  };

  const current = onFloor.find((p) => p.key === selected) ?? null;
  const currentMeta = current ? POSITION_KIND_META[current.kind] : null;

  return (
    <div className="space-y-3">
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel className="mr-1">{t("Поставить")}</SectionLabel>
          <Button
            size="sm"
            variant={tool === null ? "primary" : "secondary"}
            onClick={() => setTool(null)}
            aria-pressed={tool === null}
          >
            <MousePointer2 className="h-4 w-4" aria-hidden />
            {t("Выбор")}
          </Button>
          {POSITION_TOOL_KINDS.map((kind) => {
            const Icon = POSITION_KIND_META[kind].icon;
            return (
              <Button
                key={kind}
                size="sm"
                variant={tool === kind ? "primary" : "secondary"}
                onClick={() => setTool(tool === kind ? null : kind)}
                aria-pressed={tool === kind}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t(POSITION_KIND_META[kind].short)}
              </Button>
            );
          })}
        </div>
      )}

      <div
        ref={boxRef}
        data-deployment-canvas
        onPointerDown={handlePlanClick}
        onPointerMove={handleMarkerMove}
        onPointerUp={handleMarkerUp}
        className={cn(
          "relative touch-none select-none overflow-hidden rounded-lg border border-border bg-surface",
          editable && tool && "cursor-crosshair",
        )}
      >
        {children}

        {onFloor.map((p) => {
          const meta = POSITION_KIND_META[p.kind];
          const Icon = meta.icon;
          const isSelected = p.key === selected;
          return (
            <div
              key={p.key}
              data-pos={p.key}
              data-pending={p.pending ? "1" : undefined}
              onPointerDown={(e) => handleMarkerDown(e, p.key)}
              style={{ left: `${(p.plan_x ?? 0) * 100}%`, top: `${(p.plan_y ?? 0) * 100}%` }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2",
                editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
              )}
              title={`${t(POSITION_KIND_META[p.kind].label)}${p.sector ? ` · ${p.sector}` : ""}${
                p.pending ? ` · ${t("ждёт отправки")}` : ""
              }${p.synced_after_close_at ? ` · ${lateText(p)}` : ""}`}
            >
              {/* Направление работы: стрелка от маркера. Рисуется только там,
                  где направление осмысленно и задано. */}
              {meta.directional && p.heading != null && (
                <span
                  className="absolute left-1/2 top-1/2 h-9 w-0.5 origin-top"
                  style={{
                    background: meta.cssVar,
                    transform: `translate(-50%, 0) rotate(${p.heading - 180}deg)`,
                  }}
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  // Крупная цель: экран смотрят в перчатках, промах дороже
                  // лишних пикселей (WCAG 2.5.5 — минимум 44px).
                  "relative flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-lg transition-transform",
                  // Пунктир — «на пульте этого ещё не видят». Один пунктир не
                  // сигнал: рядом значок отправки, а тип позиции остаётся тем
                  // же самым, чтобы схема читалась одинаково в обоих случаях.
                  p.pending && "border-dashed",
                  isSelected && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-surface",
                )}
                style={{ borderColor: meta.cssVar, background: "var(--color-surface)" }}
              >
                <Icon className="h-5 w-5" style={{ color: meta.cssVar }} aria-hidden />
                {p.pending && (
                  <span
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface-2"
                    aria-label={t("ждёт отправки")}
                  >
                    <CloudUpload className="h-2.5 w-2.5 text-muted" aria-hidden />
                  </span>
                )}
                {p.synced_after_close_at && (
                  <span
                    className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-info/40 bg-surface-2"
                    role="img"
                    aria-label={lateText(p)}
                  >
                    <LateIcon className="h-2.5 w-2.5 text-info" aria-hidden />
                  </span>
                )}
              </span>
            </div>
          );
        })}

        {onFloor.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center">
            <span className="rounded-md bg-surface-2/90 px-3 py-1.5 text-xs text-muted">
              {editable
                ? t("Выберите инструмент и коснитесь плана, чтобы поставить позицию")
                : t("Расстановка на этом этаже не зафиксирована")}
            </span>
          </div>
        )}

        {lateHere > 0 && (
          <div className="pointer-events-none absolute left-2 top-2">
            <span className="flex items-center gap-1.5 rounded-md bg-surface-2/90 px-2 py-1 text-2xs text-info">
              <LateIcon className="h-3 w-3" aria-hidden />
              <span className="tabular">
                {t("Досинхронизировано после закрытия: {n}").replace("{n}", String(lateHere))}
              </span>
            </span>
          </div>
        )}

        {pendingHere > 0 && (
          <div className="pointer-events-none absolute right-2 top-2">
            <span className="flex items-center gap-1.5 rounded-md bg-surface-2/90 px-2 py-1 text-2xs text-muted">
              <CloudUpload className="h-3 w-3" aria-hidden />
              <span className="tabular">{pendingHere}</span>
              {t("ждёт отправки")}
            </span>
          </div>
        )}
      </div>

      {/* Панель выбранной позиции: поворот и снятие. Отдельной строкой, а не
          попапом у маркера — попап на планшете перекрывается пальцем. */}
      {editable && current && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-2.5">
            <StatusChip
              severity={SEVERITY.elevated}
              label={t(POSITION_KIND_META[current.kind].label)}
            />
            {current.sector && <span className="text-sm text-fg">{current.sector}</span>}
            {currentMeta?.directional && (
              <span className="tabular text-xs text-faint">
                {current.heading != null ? `${current.heading}°` : t("направление не задано")}
              </span>
            )}
            {current.pending && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <CloudUpload className="h-3.5 w-3.5" aria-hidden />
                {t("ждёт отправки")}
              </span>
            )}
            {current.synced_after_close_at && (
              <span className="flex items-center gap-1 text-xs text-info">
                <LateIcon className="h-3.5 w-3.5" aria-hidden />
                {lateText(current)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentMeta?.directional && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRotate(current.key, ((current.heading ?? 0) + 45) % 360)}
              >
                <RotateCw className="h-4 w-4" aria-hidden />
                {t("Повернуть")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onRemove(current.key);
                setSelected(null);
              }}
              aria-label={`${t("Снять позицию")}: ${t(POSITION_KIND_META[current.kind].label)}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
