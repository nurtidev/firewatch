"use client";

/* Stylised «карта риска» for the gov hero — product-true to Module 01 (Карта
   риска). A deterministic grid of building footprints coloured by the SAME
   severity scale as the real map (single source: lib/risk.ts SEVERITY +
   scoreSeverity), plus a stylised arrival isochrone around a station to hint at
   Module 05. Deterministic (seeded) so SSR and client render identically — no
   hydration mismatch, no Math.random at render. Honest: it is a stylisation, the
   real map runs on the region's data inside the system. */

import { cn } from "@/lib/cn";
import { SEVERITY, scoreSeverity, type Severity } from "@/lib/risk";

const W = 104;
const H = 88;

/* Deterministic PRNG (mulberry32) so the map is identical on every render. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Footprint = { x: number; y: number; w: number; h: number; score: number };

/* Station the isochrone radiates from (plan units). */
const STATION = { x: W * 0.66, y: H * 0.4 };

function buildCity(): Footprint[] {
  const rng = mulberry32(20260703);
  const cols = 10;
  const rows = 9;
  const cellW = W / cols;
  const cellH = H / rows;
  const out: Footprint[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() < 0.13) continue; // street / empty lot
      const padX = cellW * 0.2;
      const padY = cellH * 0.2;
      const jx = (rng() - 0.5) * cellW * 0.14;
      const jy = (rng() - 0.5) * cellH * 0.14;
      const w = cellW - padX * 2 - rng() * cellW * 0.14;
      const h = cellH - padY * 2 - rng() * cellH * 0.14;
      const x = c * cellW + padX + jx;
      const y = r * cellH + padY + jy;
      /* Right-skewed scores (most buildings low-risk), like the calibrated
         distribution: median ~9, few criticals. */
      let score = Math.pow(rng(), 2.3) * 100;
      /* Nudge a cluster near the map centre up, so the "hot" area reads. */
      const cx = c * cellW + cellW / 2;
      const cy = r * cellH + cellH / 2;
      const d = Math.hypot(cx - W * 0.4, cy - H * 0.62) / W;
      if (d < 0.22) score = Math.min(100, score + 34);
      out.push({ x, y, w: Math.max(2, w), h: Math.max(2, h), score });
    }
  }
  return out;
}

const CITY = buildCity();

const FILL_OPACITY: Record<Severity, number> = {
  critical: 0.92,
  high: 0.82,
  elevated: 0.62,
  normal: 0.42,
  info: 0.42,
};

const LEGEND: Severity[] = ["critical", "high", "elevated", "normal"];

export default function RiskCityMap({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Стилизованная карта риска города: здания окрашены по оценке риска"
      >
        {/* base */}
        <rect x={0} y={0} width={W} height={H} fill="var(--color-surface-2)" />
        {/* faint street grid */}
        <g stroke="var(--color-faint)" strokeOpacity={0.14} strokeWidth={0.25}>
          {Array.from({ length: 11 }, (_, i) => (
            <line key={`v${i}`} x1={(i * W) / 10} y1={0} x2={(i * W) / 10} y2={H} />
          ))}
          {Array.from({ length: 10 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={(i * H) / 9} x2={W} y2={(i * H) / 9} />
          ))}
        </g>

        {/* arrival isochrone (stylised) around the station */}
        <g fill="none" stroke="var(--color-accent)" strokeOpacity={0.5}>
          <circle cx={STATION.x} cy={STATION.y} r={16} strokeWidth={0.35} strokeDasharray="1.6 1.6" />
          <circle cx={STATION.x} cy={STATION.y} r={27} strokeWidth={0.3} strokeDasharray="1.6 1.6" strokeOpacity={0.3} />
        </g>

        {/* building footprints, coloured by severity (single source of truth) */}
        {CITY.map((b, i) => {
          const sev = scoreSeverity(b.score);
          return (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={0.9}
              fill={sev.cssVar}
              fillOpacity={FILL_OPACITY[sev.key]}
              stroke="var(--color-surface-2)"
              strokeWidth={0.5}
            />
          );
        })}

        {/* fire station marker */}
        <g>
          <circle cx={STATION.x} cy={STATION.y} r={2.4} fill="var(--color-accent)" />
          <circle cx={STATION.x} cy={STATION.y} r={2.4} fill="none" stroke="var(--color-surface)" strokeWidth={0.7} />
        </g>
      </svg>

      {/* badge */}
      <span className="pointer-events-none absolute right-3 top-3 rounded-[10px] border border-accent/30 bg-accent-weak px-2.5 py-1 text-[11px] font-semibold text-accent">
        Карта риска · стилизация
      </span>

      {/* legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border border-border bg-surface/85 px-3 py-2 backdrop-blur">
        {LEGEND.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SEVERITY[k].cssVar }} aria-hidden />
            {SEVERITY[k].label}
          </span>
        ))}
      </div>
    </div>
  );
}
