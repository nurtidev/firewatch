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
 *   • перетащить маркер                 → сдвинуть (PATCH координат);
 *   • тап по маркеру                    → выбрать, снизу появляется поворот.
 *
 * Координаты — доля от габарита плана (0..1), поэтому слой лежит абсолютным
 * оверлеем в процентах и не зависит ни от viewBox плана, ни от размера
 * экрана: одна и та же расстановка одинаково верна на планшете, на десктопе
 * и в экспорте в донесение.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Flame,
  ShieldHalf,
  Users,
  Minus,
  Truck,
  Radio,
  RotateCw,
  Trash2,
  MousePointer2,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, SectionLabel, StatusChip, Banner } from "@/components/ui";
import { isOnline } from "@/lib/offline";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SEVERITY } from "@/lib/risk";
import {
  POSITION_KIND_META,
  type DeploymentPosition,
  type PositionKind,
  type PositionPhase,
} from "@/lib/dispatch";

/** Инструменты палитры. Набор намеренно короткий — это боевой экран.
 *  `directional` отмечает то, что имеет направление работы: у ствола оно
 *  есть, у штаба и рубежа — нет, и предлагать поворот там значило бы
 *  спрашивать о том, чего не существует. */
const TOOLS: {
  kind: PositionKind;
  icon: LucideIcon;
  directional: boolean;
  color: string;
}[] = [
  { kind: "barrel_ext", icon: Flame, directional: true, color: "var(--color-critical)" },
  { kind: "barrel_def", icon: ShieldHalf, directional: true, color: "var(--color-elevated)" },
  { kind: "checkpoint", icon: Minus, directional: false, color: "var(--color-high)" },
  { kind: "vehicle", icon: Truck, directional: false, color: "var(--color-info)" },
  { kind: "ladder", icon: Users, directional: true, color: "var(--color-info)" },
  { kind: "hq", icon: Radio, directional: false, color: "var(--color-normal)" },
];

const TOOL_BY_KIND = Object.fromEntries(TOOLS.map((tool) => [tool.kind, tool]));

export default function DeploymentPlan({
  positions,
  floor,
  phase,
  editable,
  onAdd,
  onMove,
  onRotate,
  onRemove,
  children,
}: {
  positions: DeploymentPosition[];
  /** Этаж, схема которого сейчас открыта: ставим и показываем только его. */
  floor: string;
  phase: PositionPhase;
  editable: boolean;
  onAdd: (kind: PositionKind, x: number, y: number) => void;
  onMove: (id: number, x: number, y: number) => void;
  onRotate: (id: number, heading: number) => void;
  onRemove: (id: number) => void;
  /** Подложка — поэтажный план (FloorPlan2D) или скан «Схем ДЧС». */
  children: React.ReactNode;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<PositionKind | null>(null);
  // Связь на пожаре пропадает, а каждое действие здесь уходит на сервер.
  // Без явного признака РТП видел бы только «не удалось сохранить» на каждый
  // жест и мог решить, что промахнулся мимо маркера, — и продолжал бы
  // расставлять то, что никуда не записывается.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(isOnline());
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const dragRef = useRef<{ id: number; moved: boolean } | null>(null);

  const onFloor = positions.filter(
    (p) => p.plan_x != null && p.plan_y != null && (p.floor ?? "") === floor && p.phase === phase,
  );

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

  const handleMarkerDown = (e: React.PointerEvent, id: number) => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, moved: false };
    setSelected(id);
  };

  const handleMarkerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pos = toFraction(e.clientX, e.clientY);
    if (!pos) return;
    drag.moved = true;
    // Оптимистично двигаем маркер прямо в DOM: ждать ответа сервера на каждый
    // кадр перетаскивания нельзя — в поле связь медленная, и маркер бы «залипал».
    const el = boxRef.current?.querySelector<HTMLElement>(`[data-pos="${drag.id}"]`);
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
    if (pos) onMove(drag.id, pos.x, pos.y);
  };

  const current = onFloor.find((p) => p.id === selected) ?? null;
  const currentTool = current ? TOOL_BY_KIND[current.kind] : null;

  return (
    <div className="space-y-3">
      {editable && !online && (
        <Banner tone="critical" icon={WifiOff}>
          {t(
            "Связи нет — расстановка не сохраняется. Запомните позиции и повторите, когда связь появится.",
          )}
        </Banner>
      )}
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
          {TOOLS.map(({ kind, icon: Icon }) => (
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
          ))}
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
          const meta = TOOL_BY_KIND[p.kind] ?? TOOLS[0];
          const Icon = meta.icon;
          const isSelected = p.id === selected;
          return (
            <div
              key={p.id}
              data-pos={p.id}
              onPointerDown={(e) => handleMarkerDown(e, p.id)}
              style={{ left: `${(p.plan_x ?? 0) * 100}%`, top: `${(p.plan_y ?? 0) * 100}%` }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2",
                editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
              )}
              title={`${t(POSITION_KIND_META[p.kind].label)}${p.sector ? ` · ${p.sector}` : ""}`}
            >
              {/* Направление работы: стрелка от маркера. Рисуется только там,
                  где направление осмысленно и задано. */}
              {meta.directional && p.heading != null && (
                <span
                  className="absolute left-1/2 top-1/2 h-9 w-0.5 origin-top"
                  style={{
                    background: meta.color,
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
                  isSelected && "scale-110 ring-2 ring-accent ring-offset-2 ring-offset-surface",
                )}
                style={{ borderColor: meta.color, background: "var(--color-surface)" }}
              >
                <Icon className="h-5 w-5" style={{ color: meta.color }} aria-hidden />
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
            {currentTool?.directional && (
              <span className="tabular text-xs text-faint">
                {current.heading != null ? `${current.heading}°` : t("направление не задано")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentTool?.directional && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRotate(current.id, ((current.heading ?? 0) + 45) % 360)}
              >
                <RotateCw className="h-4 w-4" aria-hidden />
                {t("Повернуть")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onRemove(current.id);
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
