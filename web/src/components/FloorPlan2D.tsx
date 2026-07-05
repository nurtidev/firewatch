"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  layoutFloor,
  roomTypeMeta,
  type PlanRoom,
  type PlacedRoom,
} from "@/lib/floorplan";
import type { RealFloorPlan, RealRoom } from "@/data/floorplans/hayvill";

const VB_W = 100;
const VB_H = 62;

/**
 * 2D floor plan. Two renderers behind one component:
 *  • real — when `plan` is given, draws the actual calibrated polygons (metres →
 *    viewBox), coloured by functional type; a survey-derived drawing (from the ПТП).
 *  • schematic — otherwise, an area-proportional treemap ("zoning") from the
 *    explication; honest about being schematic, not survey-accurate.
 * Colour always encodes type (single source: ROOM_TYPE_META), never the only
 * signal (label + click info + legend).
 */
export default function FloorPlan2D(props: {
  rooms?: PlanRoom[];
  /** When present, render real geometry instead of the schematic treemap. */
  plan?: RealFloorPlan | null;
  /** Compact: plan only, no side panel/legend (for small gallery tiles). */
  compact?: boolean;
  className?: string;
}) {
  if (props.plan) {
    return <RealPlanView plan={props.plan} compact={props.compact} className={props.className} />;
  }
  return <TreemapView rooms={props.rooms ?? []} className={props.className} />;
}

/* ── Shared bits ───────────────────────────────────────────────────────────── */

function ModeBadge({ real }: { real: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-2xs font-medium",
        real
          ? "border-accent/30 bg-accent-weak text-accent"
          : "border-border bg-surface-2 text-muted",
      )}
    >
      <span
        className="inline-block h-2 w-2 rounded-sm"
        style={{ background: real ? "currentColor" : "var(--faint)" }}
        aria-hidden
      />
      {real ? "Реальная геометрия (из ПТП)" : "Схематическая раскладка (по площадям)"}
    </span>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-2 text-2xs uppercase tracking-wider text-faint">Назначение</div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 lg:grid-cols-1">
        {items.map((l) => (
          <li key={l.label} className="flex items-center gap-2 text-xs text-muted">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: l.color }}
              aria-hidden
            />
            <span className="truncate">{l.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Real geometry (calibrated polygons) ───────────────────────────────────── */

function RealPlanView({
  plan,
  compact,
  className,
}: {
  plan: RealFloorPlan;
  compact?: boolean;
  className?: string;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const pad = Math.max(plan.widthM, plan.heightM) * 0.02;
  const vbW = plan.widthM + pad * 2;
  const vbH = plan.heightM + pad * 2;
  const maxDim = Math.max(plan.widthM, plan.heightM, 1);
  const fs = Math.max(0.55, maxDim * 0.02);

  const legend = useMemo(() => {
    const seen = new Map<string, { label: string; color: string }>();
    for (const r of plan.rooms) {
      if (!seen.has(r.type)) seen.set(r.type, roomTypeMeta(r.type));
    }
    return [...seen.values()];
  }, [plan]);

  const svg = (
    <svg
      viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Реальная планировка: ${plan.title}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {plan.rooms.map((room, i) => (
        <RealRoomCell
          key={i}
          room={room}
          fs={fs}
          selected={i === sel}
          showLabels={!compact}
          onClick={() => setSel(i === sel ? null : i)}
        />
      ))}
    </svg>
  );

  if (compact) {
    return (
      <div className={cn("rounded-lg border border-border bg-surface-2/40 p-2", className)}>
        {svg}
      </div>
    );
  }

  const selected = sel != null ? plan.rooms[sel] : null;

  return (
    <div className={cn("grid gap-4 lg:grid-cols-[1fr_220px] lg:items-start", className)}>
      <div className="space-y-2">
        <ModeBadge real />
        <div className="rounded-lg border border-border bg-surface-2/40 p-2">{svg}</div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="text-2xs uppercase tracking-wider text-faint">Помещение</div>
          {selected ? (
            <>
              <div className="mt-0.5 text-sm font-medium text-fg">{selected.name}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: roomTypeMeta(selected.type).color }}
                  aria-hidden
                />
                {roomTypeMeta(selected.type).label}
                <span className="tabular">· {selected.area_m2} м²</span>
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm text-faint">Кликните по помещению на плане</div>
          )}
        </div>
        <Legend items={legend} />
      </div>
    </div>
  );
}

/** Bbox centre + span of a polygon, in plan metres. */
function polyBounds(poly: [number, number][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

function RealRoomCell({
  room,
  fs,
  selected,
  showLabels,
  onClick,
}: {
  room: RealRoom;
  fs: number;
  selected: boolean;
  showLabels: boolean;
  onClick: () => void;
}) {
  const { color, label } = roomTypeMeta(room.type);
  const points = room.polygon.map((p) => p.join(",")).join(" ");
  const b = polyBounds(room.polygon);
  const showName = showLabels && b.w > fs * 3.5 && b.h > fs * 2.2;
  const maxChars = Math.max(3, Math.floor(b.w / (fs * 0.62)));
  const shortName =
    room.name.length > maxChars ? room.name.slice(0, maxChars - 1) + "…" : room.name;

  return (
    <g onClick={onClick} className="cursor-pointer" style={{ outline: "none" }}>
      <title>{`${room.name} · ${label} · ${room.area_m2} м²`}</title>
      <polygon
        points={points}
        fill={color}
        fillOpacity={selected ? 0.95 : 0.66}
        stroke={selected ? "#ffffff" : "#0a0a0b"}
        strokeOpacity={selected ? 0.9 : 0.4}
        strokeWidth={selected ? fs * 0.28 : fs * 0.14}
        strokeLinejoin="round"
      />
      {showName && (
        <text
          x={b.cx}
          y={b.cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#0a0a0b"
          fillOpacity={0.85}
          style={{ fontSize: fs, fontWeight: 600, pointerEvents: "none" }}
        >
          {shortName}
        </text>
      )}
    </g>
  );
}

/* ── Schematic treemap (unchanged behaviour, extracted) ────────────────────── */

function TreemapView({ rooms, className }: { rooms: PlanRoom[]; className?: string }) {
  const placed = useMemo(() => layoutFloor(rooms, VB_W, VB_H), [rooms]);
  const [sel, setSel] = useState<number | null>(null);

  const legend = useMemo(() => {
    const seen = new Map<string, { label: string; color: string }>();
    for (const p of placed) {
      const t = p.room.type ?? "помещение";
      if (!seen.has(t)) seen.set(t, roomTypeMeta(t));
    }
    return [...seen.values()];
  }, [placed]);

  if (placed.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-sm text-faint", className)}>
        Нет помещений с площадью для построения плана
      </div>
    );
  }

  const selected = sel != null ? placed[sel] : null;

  return (
    <div className={cn("grid gap-4 lg:grid-cols-[1fr_220px] lg:items-start", className)}>
      <div className="space-y-2">
        <ModeBadge real={false} />
        <div className="rounded-lg border border-border bg-surface-2/40 p-2">
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="h-auto w-full"
            role="img"
            aria-label="Схематическая планировка этажа по экспликации"
            preserveAspectRatio="xMidYMid meet"
          >
            {placed.map((p, i) => (
              <RoomCell
                key={i}
                p={p}
                selected={i === sel}
                onClick={() => setSel(i === sel ? null : i)}
              />
            ))}
          </svg>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="text-2xs uppercase tracking-wider text-faint">Помещение</div>
          {selected ? (
            <>
              <div className="mt-0.5 text-sm font-medium text-fg">
                {selected.room.name ?? "—"}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: roomTypeMeta(selected.room.type).color }}
                  aria-hidden
                />
                {roomTypeMeta(selected.room.type).label}
                <span className="tabular">· {selected.area} м²</span>
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm text-faint">Кликните по помещению на плане</div>
          )}
        </div>
        <Legend items={legend} />
      </div>
    </div>
  );
}

function RoomCell({
  p,
  selected,
  onClick,
}: {
  p: PlacedRoom;
  selected: boolean;
  onClick: () => void;
}) {
  const { color, label } = roomTypeMeta(p.room.type);
  const name = p.room.name ?? "";
  const showName = p.w > 11 && p.h > 6;
  const showArea = p.w > 11 && p.h > 11;
  const maxChars = Math.max(3, Math.floor(p.w / 1.5));
  const shortName = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;

  return (
    <g onClick={onClick} className="cursor-pointer" style={{ outline: "none" }}>
      <title>{`${name} · ${label} · ${p.area} м²`}</title>
      <rect
        x={p.x + 0.25}
        y={p.y + 0.25}
        width={Math.max(0, p.w - 0.5)}
        height={Math.max(0, p.h - 0.5)}
        rx={0.6}
        fill={color}
        fillOpacity={selected ? 0.95 : 0.62}
        stroke={selected ? "#ffffff" : "#0a0a0b"}
        strokeOpacity={selected ? 0.9 : 0.35}
        strokeWidth={selected ? 0.6 : 0.3}
      />
      {showName && (
        <text
          x={cx}
          y={showArea ? cy - 0.6 : cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#0a0a0b"
          fillOpacity={0.85}
          style={{ fontSize: 2.1, fontWeight: 600, pointerEvents: "none" }}
        >
          {shortName}
        </text>
      )}
      {showArea && (
        <text
          x={cx}
          y={cy + 2.2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#0a0a0b"
          fillOpacity={0.6}
          style={{ fontSize: 1.7, pointerEvents: "none" }}
        >
          {p.area} м²
        </text>
      )}
    </g>
  );
}
