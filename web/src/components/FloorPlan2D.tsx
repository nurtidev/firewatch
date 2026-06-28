"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  layoutFloor,
  roomTypeMeta,
  type PlanRoom,
  type PlacedRoom,
} from "@/lib/floorplan";

const VB_W = 100;
const VB_H = 62;

/**
 * Schematic 2D floor zoning plan: rooms as area-proportional blocks, coloured by
 * function, click to inspect. Generated from the explication — a pre-incident
 * orientation aid, not a survey-accurate drawing (labelled as such by the host).
 */
export default function FloorPlan2D({
  rooms,
  className,
}: {
  rooms: PlanRoom[];
  className?: string;
}) {
  const placed = useMemo(() => layoutFloor(rooms, VB_W, VB_H), [rooms]);
  const [sel, setSel] = useState<number | null>(null);

  // Legend: the room types actually present on this floor.
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

      <div className="space-y-3">
        {/* Selected-room readout */}
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

        {/* Legend */}
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="mb-2 text-2xs uppercase tracking-wider text-faint">Назначение</div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 lg:grid-cols-1">
            {legend.map((l) => (
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
  // Only label boxes with room to breathe; the rest rely on click + <title>.
  const showName = p.w > 11 && p.h > 6;
  const showArea = p.w > 11 && p.h > 11;
  const maxChars = Math.max(3, Math.floor(p.w / 1.5));
  const shortName = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;

  return (
    <g
      onClick={onClick}
      className="cursor-pointer"
      style={{ outline: "none" }}
    >
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
