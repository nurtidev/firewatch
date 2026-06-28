/**
 * Schematic 2D floor-plan layout from explication data.
 *
 * We don't have real architectural geometry (the drawings live in non-digitised
 * .vsd/.pdf scans), so we synthesise a *zoning* plan: each room becomes a box
 * whose AREA is proportional to its m², packed with a squarified treemap. It
 * reads like a floor-zoning diagram and is honest about being schematic — not a
 * survey-accurate plan. Colour encodes the functional room type (data, not
 * decoration), decoded by a legend; never the only signal (label + click info).
 */

export type RoomTypeMeta = { label: string; color: string };

/**
 * Functional room categories → label + a calm categorical hue. Kept distinct
 * from the severity scale (red/orange/green status) so the two never read as the
 * same thing. Эвакуация is highlighted — egress is the single most
 * operationally important class on a fire pre-plan.
 */
export const ROOM_TYPE_META: Record<string, RoomTypeMeta> = {
  эвакуация:     { label: "Эвакуация",      color: "#34d399" }, // stairs / exits — egress
  лифт:          { label: "Лифт",           color: "#60a5fa" },
  тех:           { label: "Технические",    color: "#f59e0b" }, // ИТП/насосная/электрощит — utility
  санузел:       { label: "Санузлы",        color: "#38bdf8" },
  медицина:      { label: "Медицина",       color: "#f472b6" },
  общепит:       { label: "Общепит",        color: "#fb7185" }, // kitchen — fire load
  жилое:         { label: "Жилые",          color: "#a78bfa" },
  общественное:  { label: "Обществ.",       color: "#c084fc" },
  коридор:       { label: "Коридоры/холлы", color: "#7c8aa0" },
  паркинг:       { label: "Паркинг",        color: "#64748b" },
  кладовая:      { label: "Кладовые",       color: "#9ca3af" },
  помещение:     { label: "Прочие",         color: "#5b6472" },
};

const FALLBACK: RoomTypeMeta = { label: "Прочие", color: "#5b6472" };

export function roomTypeMeta(type?: string): RoomTypeMeta {
  return (type && ROOM_TYPE_META[type]) || FALLBACK;
}

export type PlanRoom = { name?: string; area_m2?: number | string; type?: string };

export type PlacedRoom = {
  room: PlanRoom;
  area: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

function toArea(a: PlanRoom["area_m2"]): number {
  if (typeof a === "number") return a;
  if (typeof a === "string") {
    const n = parseFloat(a.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Worst (largest) aspect ratio in a row laid along `side`. Lower is squarer. */
function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum === 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Lays the rooms into `w×h`,
 * each box area ∝ its m², keeping boxes as square as possible. Deterministic.
 */
export function layoutFloor(rooms: PlanRoom[], w = 100, h = 62): PlacedRoom[] {
  const items = rooms
    .map((room) => ({ room, area: toArea(room.area_m2) }))
    .filter((r) => r.area > 0)
    .sort((a, b) => b.area - a.area);
  if (items.length === 0) return [];

  const total = items.reduce((s, r) => s + r.area, 0);
  const scale = (w * h) / total;
  const scaled = items.map((r) => ({ ...r, value: r.area * scale }));

  const out: PlacedRoom[] = [];
  const rect = { x: 0, y: 0, w, h };

  const layoutRow = (row: typeof scaled) => {
    const sum = row.reduce((s, r) => s + r.value, 0);
    const horizontal = rect.w >= rect.h;
    if (horizontal) {
      const colW = sum / rect.h;
      let cy = rect.y;
      for (const r of row) {
        const rh = (r.value / sum) * rect.h;
        out.push({ room: r.room, area: r.area, x: rect.x, y: cy, w: colW, h: rh });
        cy += rh;
      }
      rect.x += colW;
      rect.w -= colW;
    } else {
      const rowH = sum / rect.w;
      let cx = rect.x;
      for (const r of row) {
        const rw = (r.value / sum) * rect.w;
        out.push({ room: r.room, area: r.area, x: cx, y: rect.y, w: rw, h: rowH });
        cx += rw;
      }
      rect.y += rowH;
      rect.h -= rowH;
    }
  };

  let row: typeof scaled = [];
  for (const item of scaled) {
    const side = Math.min(rect.w, rect.h);
    const cur = row.map((r) => r.value);
    if (row.length === 0 || worst(cur, side) >= worst([...cur, item.value], side)) {
      row.push(item);
    } else {
      layoutRow(row);
      row = [item];
    }
  }
  if (row.length) layoutRow(row);
  return out;
}
