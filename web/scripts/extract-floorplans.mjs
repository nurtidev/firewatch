#!/usr/bin/env node
'use strict';
/**
 * Восстановление геометрии помещений (полигонов комнат) из поэтажных Visio-планов ДЧС.
 *
 * Пайплайн:  .vsd → vsd2xhtml (libvisio) → постранично (<svg:svg>), см. web/scripts/build-schemes.mjs
 *            → на каждой странице: растровая заливка стен/дверей из чёрных path-элементов Visio
 *            → flood fill от текстовых подписей комнат (каждая подпись — «семя»)
 *            → для открытых пространств с несколькими подписями в одной связной области —
 *              разбиение по ближайшему семени (multi-source BFS, водораздел/Voronoi-approx)
 *            → трассировка контура области (алгоритм Мура) → упрощение Дугласа–Пекера (RDP)
 *            → координаты контура переводятся из SVG user-unit (1/72 дюйма) в дюймы.
 *
 * Это ТОЛЬКО геометрическая экстракция (растр → полигоны в SVG-дюймах). Перевод в метры и
 * калибровка масштаба под реальные площади (экспликации/57.2.pdf) — отдельный шаг, см.
 * web/scripts/build-floorplan-dataset.mjs, который импортирует extractRooms() из этого файла.
 *
 * Требования (dev-машина, разово):
 *   brew install libvisio          # даёт vsd2xhtml
 * Zero npm-зависимостей — только node:fs/child_process/path/url.
 *
 * Запуск:
 *   node web/scripts/extract-floorplans.mjs
 *     — все страницы дефолтного .vsd ("docs/docs_tg/поэтажные планы.vsd"), JSON-массив в stdout
 *   node web/scripts/extract-floorplans.mjs 4 9
 *     — только страницы 4 и 9 дефолтного .vsd
 *   node web/scripts/extract-floorplans.mjs "docs/docs_tg/поэтажные планы.vsd" 4 9
 *     — явный путь к .vsd + фильтр по страницам (1-indexed, как sourcePage в hayvill.ts)
 *   node web/scripts/extract-floorplans.mjs 4 9 --out-dir /tmp/rooms --preview
 *     — вдобавок пишет pNN_rooms.json и preview_pNN.svg (превью-SVG с закрашенными
 *       полигонами поверх исходной геометрии) в указанную папку; без --out-dir файлы не
 *       пишутся, только stdout (скрипт не трогает файлы репозитория по умолчанию)
 *   DEBUG=1 node web/scripts/extract-floorplans.mjs 4 --out-dir /tmp/rooms
 *     — вдобавок пишет debug_pNN.ppm (растровая карта wall/region/seed, см. writeDebugPPM)
 *
 * Честно про хрупкие места (см. также предупреждения в web/src/data/floorplans/hayvill.ts):
 *  - Стенами/дверями считаются ТОЛЬКО path с заливкой или обводкой #000000 (isBarrier). Если в
 *    исходнике Visio стены нарисованы другим цветом слоя — экстрактор их не увидит и комната
 *    "утечёт" наружу (status: open-to-outside).
 *  - Открытые пространства с несколькими подписями в одной связной области (общий зал с кухней
 *    и гостиной без перегородки) разбиваются multi-source BFS от каждого семени — это ПРИБЛИЖЕНИЕ
 *    (водораздел/Voronoi по кратчайшему пути в растре, не по реальным зонам), граница между
 *    комнатами в таких случаях условна и площади соседних комнат могут быть искажены (см. кейс
 *    "кладовая" на листе с 4-комнатной квартирой в hayvill.ts).
 *  - Дверной проём запечатывается заливкой pie-сектора дуги притвора (см. flattenPath → arc),
 *    но ТОЛЬКО если радиус дуги ≤ DOOR_MAX_R=60 SVG-единиц — это эмпирический порог (все дверные
 *    дуги во всех виденных квартирах имеют r=25.5). Дуга большего радиуса (замечена одна, r≈280 —
 *    гнутая стена/эркер) НЕ запечатывается, иначе pie-заливка закрасила бы половину листа.
 *    Если в новом .vsd есть более крупные (но всё ещё дверные) дуги — DOOR_MAX_R придётся поднять.
 *  - Повёрнутые подписи (transform="rotate(a,cx,cy)" на <text>) — обрабатываются: якорь текста
 *    поворачивается и сдвигается к центру вращения, чтобы семя flood fill попадало в середину
 *    надписи, а не в край базовой линии. Подписи с transform="translate(...)" или matrix(...)
 *    (без rotate) — НЕ обрабатываются, x/y читаются как есть; если Visio когда-нибудь начнёт
 *    экспортировать подписи через translate/matrix вместо прямых x/y, семена сместятся.
 *  - Сплошная заливка больше FILL_BBOX_FRAC=0.35 площади листа считается декоративной (лого,
 *    роза компаса) и пропускается целиком — так и решётка настоящих стен, если её залить одним
 *    полигоном на весь этаж, будет ошибочно отброшена как "декор".
 *  - SC=3.0 px/SVG-unit, DILATE=2px, DP_EPS_PX=3.5 — подобраны на глаз по восьми листам
 *    ЖК «Хайвилл-Астана» (docs/docs_tg/поэтажные планы.vsd). Для чертежей с другой толщиной
 *    линий/масштабом эти константы, возможно, придётся перекалибровать (env DILATE=N меняет
 *    дилатацию без правки кода).
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const DEFAULT_VSD = resolve(REPO, 'docs', 'docs_tg', 'поэтажные планы.vsd');

// ---------- tunable constants (see "хрупкие места" above) ----------
const SC = 3.0;            // raster pixels per SVG user-unit (viewBox unit = 1/72 in)
const UU_PER_INCH = 72;    // SVG user units per inch (viewBox 841.89 / width 11.69in)
const DILATE = +(process.env.DILATE || 2); // px of wall dilation to close hairline gaps
const MIN_STROKE_PX = 1.4; // min render width for thin (door) strokes
const DP_EPS_PX = 3.5;     // Douglas-Peucker tolerance in px
const DOOR_MAX_R = 60;     // svg-unit radius ceiling for "this arc is a door swing" (observed door
                           // arcs are r=25.5 across every apartment page); big curved walls/bay
                           // windows (seen once, r~280 on p10) must NOT be sealed as a door pie-slice.
const LEAK_FRAC = 0.55;    // region larger than this fraction of page => leaked/failed

// ---------- .vsd -> per-page SVG (same normalize()/vsdToPages() approach as build-schemes.mjs) ----------
function normalize(block) {
  return block
    .replace(/<svg:/g, '<')
    .replace(/<\/svg:/g, '</')
    .replace(/xmlns:svg=/g, 'xmlns=');
}

export function vsdToPages(vsdPath) {
  const xhtml = execFileSync('vsd2xhtml', [vsdPath], { maxBuffer: 1 << 30 }).toString('utf8');
  return (xhtml.match(/<svg:svg [\s\S]*?<\/svg:svg>/g) || []).map(normalize);
}

// ---------- SVG parsing ----------
function parseStyle(s) {
  const o = {};
  (s || '').split(';').forEach(kv => {
    const i = kv.indexOf(':');
    if (i < 0) return;
    o[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return o;
}

function parseSVG(src) {
  const vb = src.match(/viewBox="([\d.\- ]+)"/)[1].trim().split(/\s+/).map(Number);
  const viewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };

  // paths
  const paths = [];
  const reP = /<path\s+d="([^"]*)"\s+style="([^"]*)"/g;
  let m;
  while ((m = reP.exec(src))) {
    paths.push({ d: m[1], style: parseStyle(m[2]), raw: m[1].replace(/\s+/g, ' ').trim() });
  }
  // texts — tolerate arbitrary attribute order and a transform="rotate(..)"
  // (Visio exports some labels, e.g. "Оздоровительный центр", rotated).
  const texts = [];
  const reT = /<text\s+([^>]*?)>(.*?)<\/text>/gs;
  while ((m = reT.exec(src))) {
    const attrs = m[1];
    const xm = attrs.match(/\bx="(-?[\d.]+)"/), ym = attrs.match(/\by="(-?[\d.]+)"/);
    if (!xm || !ym) continue;
    let x = +xm[1], y = +ym[1], rot = 0;
    const tm = attrs.match(/rotate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
    if (tm) {
      rot = +tm[1];
      const a = rot * Math.PI / 180, cx = +tm[2], cy = +tm[3];
      const dx = x - cx, dy = y - cy;
      // rotate the anchor, then nudge toward the label centre (rotate origin) so
      // the flood seed lands mid-label rather than at the left baseline tip.
      const rx = cx + dx * Math.cos(a) - dy * Math.sin(a);
      const ry = cy + dx * Math.sin(a) + dy * Math.cos(a);
      x = (rx + cx) / 2; y = (ry + cy) / 2;
    }
    const inner = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    texts.push({ x, y, text: inner, rot });
  }
  return { viewBox, paths, texts };
}

// ---------- path 'd' -> array of polylines (flattened) ----------
function flattenPath(d) {
  const toks = d.match(/[MLHVCSQTAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!toks) return { sub: [], sectors: [] };
  const sub = [];      // list of point arrays
  const sectors = [];  // door-swing sectors: {center,pts} to seal doorway gaps
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let i = 0, cmd = null;
  const num = () => parseFloat(toks[i++]);
  const moveTo = (nx, ny) => { cur = [[nx, ny]]; sub.push(cur); x = nx; y = ny; sx = nx; sy = ny; };
  const lineTo = (nx, ny) => { if (!cur) moveTo(x, y); cur.push([nx, ny]); x = nx; y = ny; };

  function arc(rx, ry, rot, laf, sweep, ex, ey) {
    // flatten elliptical arc into segments (endpoint param -> center param)
    const x1 = x, y1 = y;
    if (rx === 0 || ry === 0) { lineTo(ex, ey); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = rot * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x1 - ex) / 2, dy = (y1 - ey) / 2;
    const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    let rxs = rx * rx, rys = ry * ry;
    const lam = (x1p * x1p) / rxs + (y1p * y1p) / rys;
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; rxs = rx * rx; rys = ry * ry; }
    let sign = laf === sweep ? -1 : 1;
    let num = rxs * rys - rxs * y1p * y1p - rys * x1p * x1p;
    num = Math.max(0, num);
    const den = rxs * y1p * y1p + rys * x1p * x1p;
    const co = sign * Math.sqrt(num / den);
    const cxp = co * (rx * y1p) / ry, cyp = -co * (ry * x1p) / rx;
    const cx = cp * cxp - sp * cyp + (x1 + ex) / 2;
    const cy = sp * cxp + cp * cyp + (y1 + ey) / 2;
    const ang = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    let th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dth > 0) dth -= 2 * Math.PI;
    if (sweep && dth < 0) dth += 2 * Math.PI;
    const steps = Math.max(4, Math.ceil(Math.abs(dth) / (Math.PI / 16)));
    const arcPts = [[x1, y1]];
    for (let s = 1; s <= steps; s++) {
      const th = th1 + dth * s / steps;
      const px = cp * rx * Math.cos(th) - sp * ry * Math.sin(th) + cx;
      const py = sp * rx * Math.cos(th) + cp * ry * Math.sin(th) + cy;
      lineTo(px, py);
      arcPts.push([px, py]);
    }
    // Only queue this as a door-swing seal if it's door-sized. Large arcs are curved walls/bay
    // windows (e.g. p10 has one with r~280) — pie-filling those would black out most of the page.
    if (rx <= DOOR_MAX_R && ry <= DOOR_MAX_R) sectors.push({ center: [cx, cy], pts: arcPts });
  }
  function cubic(x1, y1, x2, y2, ex, ey) {
    const n = 16, x0 = x, y0 = y;
    for (let s = 1; s <= n; s++) {
      const t = s / n, u = 1 - t;
      const bx = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex;
      const by = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey;
      lineTo(bx, by);
    }
  }

  while (i < toks.length) {
    const t = toks[i];
    if (/[MLHVCSQTAZ]/i.test(t)) { cmd = t; i++; } // else implicit repeat
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') { let nx = num(), ny = num(); if (rel) { nx += x; ny += y; } moveTo(nx, ny); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { let nx = num(), ny = num(); if (rel) { nx += x; ny += y; } lineTo(nx, ny); }
    else if (C === 'H') { let nx = num(); if (rel) nx += x; lineTo(nx, y); }
    else if (C === 'V') { let ny = num(); if (rel) ny += y; lineTo(x, ny); }
    else if (C === 'C') { let a = num(), b = num(), c = num(), dd = num(), e = num(), f = num(); if (rel) { a += x; b += y; c += x; dd += y; e += x; f += y; } cubic(a, b, c, dd, e, f); }
    else if (C === 'A') { let rx = num(), ry = num(), rot = num(), laf = num(), sw = num(), e = num(), f = num(); if (rel) { e += x; f += y; } arc(rx, ry, rot, laf, sw, e, f); }
    else if (C === 'T' || C === 'S' || C === 'Q') { // rare here; approximate as line to end
      let n = C === 'Q' ? 4 : (C === 'S' ? 4 : 2); const vals = []; for (let k = 0; k < n; k++) vals.push(num());
      let ex = vals[n - 2], ey = vals[n - 1]; if (rel) { ex += x; ey += y; } lineTo(ex, ey);
    }
    else if (C === 'Z') { if (cur && (x !== sx || y !== sy)) cur.push([sx, sy]); x = sx; y = sy; }
    else { i++; }
  }
  return { sub: sub.filter(p => p.length > 1), sectors };
}

function isBarrier(style) {
  const fill = (style.fill || 'none').toLowerCase();
  const stroke = (style.stroke || 'none').toLowerCase();
  // solid black fill = wall body
  if (fill === '#000000') return { fill: true, strokeW: style.stroke && stroke === '#000000' ? +style['stroke-width'] || 0 : 0 };
  // any black stroke (walls thick, door leaf/arc thin) = barrier line
  if (stroke === '#000000') return { fill: false, strokeW: +style['stroke-width'] || 0 };
  return null;
}

// ---------- rasterization ----------
function makeGrid(doc) {
  const W = Math.round(doc.viewBox.w * SC), H = Math.round(doc.viewBox.h * SC);
  const wall = new Uint8Array(W * H);
  const toPx = (p) => [(p[0] - doc.viewBox.x) * SC, (p[1] - doc.viewBox.y) * SC];

  function fillPolys(polys) {
    // even-odd scanline fill over union of subpaths
    let minY = Infinity, maxY = -Infinity;
    for (const pl of polys) for (const p of pl) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (const pl of polys) {
        for (let k = 0; k + 1 < pl.length; k++) {
          const a = pl[k], b = pl[k + 1];
          const ay = a[1], by = b[1];
          if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
            xs.push(a[0] + (yc - ay) / (by - ay) * (b[0] - a[0]));
          }
        }
        // implicit close for fill
        const a = pl[pl.length - 1], b = pl[0];
        if (a[0] !== b[0] || a[1] !== b[1]) {
          if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc))
            xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) wall[y * W + x] = 1;
      }
    }
  }

  function strokePolys(polys, wpx) {
    const r = Math.max(MIN_STROKE_PX, wpx) / 2;
    for (const pl of polys) {
      for (let k = 0; k + 1 < pl.length; k++) {
        const a = pl[k], b = pl[k + 1];
        const minx = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r));
        const maxx = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + r));
        const miny = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r));
        const maxy = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + r));
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
        for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
          let t = ((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = a[0] + t * dx, py = a[1] + t * dy;
          if ((x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 <= r * r) wall[y * W + x] = 1;
        }
      }
    }
  }

  const pageAreaPx = W * H;
  const FILL_BBOX_FRAC = 0.35; // a *solid fill* this big relative to the page is decorative art
  // (e.g. a giant logo/compass ring), never real wall fill — real wall fills are thin bands.
  let filled = 0, stroked = 0, sealed = 0, decorSkipped = 0;
  for (const p of doc.paths) {
    const b = isBarrier(p.style);
    if (!b) continue;
    const flat = flattenPath(p.d);
    const polys = flat.sub.map(pl => pl.map(toPx));
    if (b.fill) {
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const pl of polys) for (const pt of pl) { if (pt[0] < minx) minx = pt[0]; if (pt[0] > maxx) maxx = pt[0]; if (pt[1] < miny) miny = pt[1]; if (pt[1] > maxy) maxy = pt[1]; }
      const bboxArea = Math.max(0, maxx - minx) * Math.max(0, maxy - miny);
      if (bboxArea > FILL_BBOX_FRAC * pageAreaPx) { decorSkipped++; continue; } // skip decorative blob entirely (fill + its stroke)
      fillPolys(polys); filled++; if (b.strokeW) strokePolys(polys, b.strokeW * SC);
    }
    else { strokePolys(polys, (b.strokeW || 0) * SC); stroked++; }
    // seal doorway gaps: fill the door-swing sector (pie slice at hinge)
    for (const sec of flat.sectors) {
      const poly = [sec.center].concat(sec.pts).map(toPx);
      fillPolys([poly]);
      sealed++;
    }
  }
  // dilate to close hairline gaps
  if (DILATE > 0) dilate(wall, W, H, DILATE);
  return { W, H, wall };
}

function dilate(wall, W, H, r) {
  // separable-ish square dilation via two passes (approx round with r small)
  for (let pass = 0; pass < r; pass++) {
    const src = wall.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (src[i]) continue;
      if (src[i - 1] || src[i + 1] || src[i - W] || src[i + W]) wall[i] = 1;
    }
  }
}

// ---------- flood fill regions ----------
// Two stages:
//  (1) connected-component label all enclosed free space (comp>=1); outside=0; wall=-2.
//  (2) for each component, gather the room labels inside it. If exactly one -> that comp is
//      the room. If several (open-plan: living/kitchen/hall share one space) -> partition the
//      comp by nearest-label via multi-source BFS (approx. Voronoi / watershed).
// Output `owner` grid: owner[i] = roomId (>=1) | -1 (wall/outside/unassigned).
function floodRegions(grid, seeds) {
  const { W, H, wall } = grid;
  const N = W * H;
  const comp = new Int32Array(N);           // 0 unset-free, -2 wall
  for (let i = 0; i < N; i++) if (wall[i]) comp[i] = -2;

  // border flood => outside = -3
  const OUT = -3;
  let stack = [];
  const pushOut = (x, y) => { const i = y * W + x; if (comp[i] === 0) { comp[i] = OUT; stack.push(i); } };
  for (let x = 0; x < W; x++) { pushOut(x, 0); pushOut(x, H - 1); }
  for (let y = 0; y < H; y++) { pushOut(0, y); pushOut(W - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    if (x > 0 && comp[i - 1] === 0) { comp[i - 1] = OUT; stack.push(i - 1); }
    if (x < W - 1 && comp[i + 1] === 0) { comp[i + 1] = OUT; stack.push(i + 1); }
    if (y > 0 && comp[i - W] === 0) { comp[i - W] = OUT; stack.push(i - W); }
    if (y < H - 1 && comp[i + W] === 0) { comp[i + W] = OUT; stack.push(i + W); }
  }

  // label enclosed free components 1..K
  let K = 0;
  const compArea = [0];
  for (let s = 0; s < N; s++) {
    if (comp[s] !== 0) continue;
    K++; compArea[K] = 0;
    comp[s] = K; stack = [s];
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W; compArea[K]++;
      if (x > 0 && comp[i - 1] === 0) { comp[i - 1] = K; stack.push(i - 1); }
      if (x < W - 1 && comp[i + 1] === 0) { comp[i + 1] = K; stack.push(i + 1); }
      if (y > 0 && comp[i - W] === 0) { comp[i - W] = K; stack.push(i - W); }
      if (y < H - 1 && comp[i + W] === 0) { comp[i + W] = K; stack.push(i + W); }
    }
  }

  // assign each seed to a component
  const compSeeds = new Map(); // compId -> [seedRec]
  const results = [];
  seeds.forEach((seed, si) => {
    const sx0 = Math.round(seed.x * SC), sy0 = Math.round(seed.y * SC);
    let start = -1, outNear = 0, wallNear = 0;
    outer:
    for (let rad = 0; rad < 60 * SC; rad += 2) {
      for (let dy = -rad; dy <= rad; dy += 2) for (let dx = -rad; dx <= rad; dx += 2) {
        const x = sx0 + dx, y = sy0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const v = comp[y * W + x];
        if (v >= 1) { start = y * W + x; break outer; }
        if (v === OUT) outNear++; else if (v === -2) wallNear++;
      }
    }
    const rec = { seed, si, id: si + 1, startpx: start, sx0, sy0 };
    if (start < 0) {
      rec.status = 'unresolved';
      rec.why = outNear > wallNear ? 'open-to-outside (unclosed room, flood escaped)' : 'seed buried in wall';
      results.push(rec); return;
    }
    const cid = comp[start];
    rec.comp = cid;
    if (!compSeeds.has(cid)) compSeeds.set(cid, []);
    compSeeds.get(cid).push(rec);
    results.push(rec);
  });

  // owner grid + per-room stats
  const owner = new Int32Array(N).fill(-1);
  const stats = new Map(); // id -> {count,minx,miny,maxx,maxy}
  const touch = (id, x, y) => {
    let s = stats.get(id);
    if (!s) { s = { count: 0, minx: W, miny: H, maxx: 0, maxy: 0 }; stats.set(id, s); }
    s.count++; if (x < s.minx) s.minx = x; if (x > s.maxx) s.maxx = x; if (y < s.miny) s.miny = y; if (y > s.maxy) s.maxy = y;
  };

  for (const [cid, recs] of compSeeds) {
    // multi-source BFS from all seeds in this comp -> nearest-label partition
    let q = [];
    for (const r of recs) { owner[r.startpx] = r.id; q.push(r.startpx); }
    // BFS (FIFO) so growth is roughly isotropic (distance-ordered)
    let head = 0;
    while (head < q.length) {
      const i = q[head++]; const x = i % W, y = (i - x) / W; const o = owner[i];
      const nb = [];
      if (x > 0) nb.push(i - 1); if (x < W - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - W); if (y < H - 1) nb.push(i + W);
      for (const j of nb) { if (comp[j] === cid && owner[j] === -1) { owner[j] = o; q.push(j); } }
    }
    for (const r of recs) {
      const single = recs.length === 1;
      const frac = compArea[cid] / N; // whole comp size
      r.status = (single && frac > LEAK_FRAC) ? 'leaked' : 'ok';
      r.shared = recs.length > 1 ? recs.map(z => z.seed.text) : null;
    }
  }
  // compute bbox/count from owner grid
  for (let i = 0; i < N; i++) { const o = owner[i]; if (o >= 1) { const x = i % W; touch(o, x, (i - x) / W); } }
  for (const r of results) {
    if (r.status === 'ok' || r.status === 'leaked') {
      const s = stats.get(r.id) || { count: 0, minx: 0, miny: 0, maxx: 0, maxy: 0 };
      r.count = s.count; r.bbox = [s.minx, s.miny, s.maxx, s.maxy];
      if (r.count === 0) r.status = 'unresolved', r.why = 'no pixels won in partition';
    }
  }
  return { region: owner, results };
}

// ---------- boundary trace (Moore) + Douglas-Peucker ----------
function traceContour(region, W, H, id, bbox) {
  // find topmost-leftmost pixel of region
  let sx = -1, sy = -1;
  for (let y = bbox[1]; y <= bbox[3] && sy < 0; y++)
    for (let x = bbox[0]; x <= bbox[2]; x++)
      if (region[y * W + x] === id) { sx = x; sy = y; break; }
  if (sx < 0) return null;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === id;
  // Moore-neighbor tracing
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour = [];
  let cx = sx, cy = sy, bdir = 6; // came-from (from left/up)
  let guard = 0, first = true;
  let startDir = -1;
  do {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (bdir + 1 + k) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (inside(nx, ny)) {
        if (first) { startDir = d; first = false; }
        contour.push([cx, cy]);
        bdir = (d + 4 + 2) % 8; // set backtrack: came from opposite, then start search from d-? standard: bdir = (d+5)%8
        bdir = (d + 5) % 8;
        cx = nx; cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (++guard > 4 * (W + H) * 4) break;
  } while (!(cx === sx && cy === sy) || contour.length < 3);
  return contour;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [pts[0], pts[pts.length - 1]];
}

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// ---------- main per-page ----------
function processPage(svgText) {
  const doc = parseSVG(svgText);
  const titleY = 60; // labels above this are page titles
  const seeds = doc.texts.filter(t => t.y > titleY && !/^(Схема|План)/.test(t.text));
  const grid = makeGrid(doc);
  const { region, results } = floodRegions(grid, seeds);

  const rooms = [];
  const notes = [];
  const px2in = 1 / (SC * UU_PER_INCH);
  for (const r of results) {
    if (r.status !== 'ok') { notes.push(`${r.seed.text} @(${r.seed.x.toFixed(0)},${r.seed.y.toFixed(0)}): ${r.status}${r.mergedWith ? ' with ' + r.mergedWith : ''}${r.why ? ' — ' + r.why : ''}`); continue; }
    let contour = traceContour(region, grid.W, grid.H, r.id, r.bbox);
    if (!contour || contour.length < 4) { notes.push(`${r.seed.text}: contour-failed`); continue; }
    let poly = rdp(contour, DP_EPS_PX);
    // dedupe consecutive + drop closing dup
    poly = poly.filter((p, i) => i === 0 || p[0] !== poly[i - 1][0] || p[1] !== poly[i - 1][1]);
    if (poly.length > 2 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
    const areaPx = shoelace(poly);
    const polyIn = poly.map(p => [+(p[0] * px2in).toFixed(4), +(p[1] * px2in).toFixed(4)]);
    rooms.push({
      name: r.seed.text,
      label_xy: [+(r.seed.x / UU_PER_INCH).toFixed(4), +(r.seed.y / UU_PER_INCH).toFixed(4)],
      polygon: polyIn,
      vertices: polyIn.length,
      area_svg_in2: +(areaPx * px2in * px2in).toFixed(4),
      area_px: Math.round(r.count),
    });
  }
  return { doc, grid, region, results, rooms, notes, seeds };
}

// ---------- preview SVG ----------
function writePreview(doc, rooms, results, outFile) {
  const vb = doc.viewBox;
  const palette = ['#e6194B', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9A6324', '#800000', '#808000'];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${vb.w}" height="${vb.h}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">\n`;
  s += `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#ffffff"/>\n`;
  // original wall/door geometry (black)
  s += `<g stroke="#000" fill="none" stroke-width="0.6">\n`;
  for (const p of doc.paths) {
    const b = isBarrier(p.style);
    if (!b) continue;
    const fill = b.fill ? '#000' : 'none';
    s += `<path d="${p.raw}" fill="${fill}" fill-opacity="0.85" stroke="#000"/>\n`;
  }
  s += `</g>\n`;
  // extracted polygons
  rooms.forEach((r, i) => {
    const col = palette[i % palette.length];
    const inToUu = p => [(p[0] * UU_PER_INCH).toFixed(2), (p[1] * UU_PER_INCH).toFixed(2)].join(',');
    const pts = r.polygon.map(inToUu).join(' ');
    s += `<polygon points="${pts}" fill="${col}" fill-opacity="0.32" stroke="${col}" stroke-width="1.2"/>\n`;
  });
  // labels
  rooms.forEach((r, i) => {
    const col = palette[i % palette.length];
    s += `<text x="${r.label_xy[0] * UU_PER_INCH}" y="${r.label_xy[1] * UU_PER_INCH}" font-family="sans-serif" font-size="9" fill="#000">${r.name} [${r.vertices}v ${r.area_svg_in2}in²]</text>\n`;
  });
  // failed seeds in red
  results.filter(r => r.status !== 'ok').forEach(r => {
    s += `<circle cx="${r.seed.x}" cy="${r.seed.y}" r="4" fill="red"/>\n`;
    s += `<text x="${r.seed.x + 5}" y="${r.seed.y}" font-family="sans-serif" font-size="8" fill="red">${r.seed.text}: ${r.status}</text>\n`;
  });
  s += `</svg>\n`;
  writeFileSync(outFile, s);
}

function writeDebugPPM(R, outFile) {
  const { W, H } = R.grid; const region = R.region; const wall = R.grid.wall;
  const cols = [[230, 25, 75], [60, 180, 75], [67, 99, 216], [245, 130, 49], [145, 30, 180], [66, 212, 244], [240, 50, 230], [191, 239, 69], [250, 190, 212], [70, 153, 144], [220, 190, 255], [154, 99, 36], [128, 0, 0], [128, 128, 0]];
  const scaleDown = +(process.env.DS || 2); const w2 = Math.floor(W / scaleDown), h2 = Math.floor(H / scaleDown);
  const buf = Buffer.alloc(w2 * h2 * 3);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const i = (y * scaleDown) * W + (x * scaleDown);
    let r = 255, g = 255, b = 255;
    const rg = region[i];
    if (wall[i]) { r = g = b = 0; }
    else if (rg === 0) { r = 235; g = 235; b = 245; }
    else if (rg > 0) { const c = cols[(rg - 1) % cols.length]; r = c[0]; g = c[1]; b = c[2]; }
    const o = (y * w2 + x) * 3; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
  }
  // mark seeds as black crosses
  for (const s of R.seeds) {
    const cx = Math.round(s.x * SC / scaleDown), cy = Math.round(s.y * SC / scaleDown);
    for (let d = -3; d <= 3; d++) { for (const [px, py] of [[cx + d, cy], [cx, cy + d]]) { if (px >= 0 && py >= 0 && px < w2 && py < h2) { const o = (py * w2 + px) * 3; buf[o] = buf[o + 1] = buf[o + 2] = 0; } } }
  }
  writeFileSync(outFile, Buffer.concat([Buffer.from(`P6\n${w2} ${h2}\n255\n`), buf]));
}

// ---------- public API: one page SVG (string) -> rooms JSON ----------
export function extractRooms(svgText, pageLabel) {
  const R = processPage(svgText);
  const areas = R.rooms.map(r => r.area_svg_in2);
  const maxA = Math.max(...areas, 1);
  const out = {
    page: pageLabel,
    units: 'inches (SVG user-units / 72). area_svg_in2 = square inches in SVG space',
    raster: { grid_px: [R.grid.W, R.grid.H], scale_px_per_uu: SC, dilate_px: DILATE, min_stroke_px: MIN_STROKE_PX, dp_eps_px: DP_EPS_PX },
    rooms: R.rooms.map(r => ({ ...r, area_ratio_to_largest: +(r.area_svg_in2 / maxA).toFixed(3) })),
    unlabeled_regions_note: R.notes.join(' | ') || 'none',
    stats: {
      labeled_rooms: R.seeds.length,
      polygonized: R.rooms.length,
      failed: R.seeds.length - R.rooms.length,
    },
  };
  return { out, R };
}

// ---------- CLI ----------
function parseArgs(argv) {
  const opts = { vsd: null, pages: [], outDir: null, preview: false };
  let wantOutDir = false;
  for (const a of argv) {
    if (wantOutDir) { opts.outDir = a; wantOutDir = false; continue; }
    if (a === '--preview') { opts.preview = true; continue; }
    if (a === '--out-dir') { wantOutDir = true; continue; }
    if (a.startsWith('--out-dir=')) { opts.outDir = a.slice('--out-dir='.length); continue; }
    if (/^\d+$/.test(a)) { opts.pages.push(+a); continue; }
    if (!opts.vsd) { opts.vsd = a; continue; }
    throw new Error(`unrecognised argument: ${a}`);
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const vsdPath = args.vsd ? resolve(args.vsd) : DEFAULT_VSD;
  const pages = vsdToPages(vsdPath);
  const wanted = args.pages.length ? args.pages : pages.map((_, i) => i + 1);

  if (args.outDir) mkdirSync(args.outDir, { recursive: true });

  const results = [];
  for (const n of wanted) {
    const svg = pages[n - 1];
    if (!svg) { console.error(`skip: page ${n} not found (vsd has ${pages.length} pages)`); continue; }
    const pg = 'p' + String(n).padStart(2, '0');
    const { out, R } = extractRooms(svg, pg);
    console.error(`=== ${pg} === labeled=${R.seeds.length} polygonized=${R.rooms.length}`);
    R.rooms.forEach(r => console.error(`  OK  ${r.name.padEnd(24)} v=${String(r.vertices).padStart(3)} area=${r.area_svg_in2.toFixed(2)}in²`));
    R.results.filter(r => r.status !== 'ok').forEach(r => console.error(`  FAIL ${r.seed.text.padEnd(24)} ${r.status}${r.why ? ' — ' + r.why : ''}`));
    if (args.outDir) {
      writeFileSync(resolve(args.outDir, pg + '_rooms.json'), JSON.stringify(out, null, 2));
      if (args.preview) writePreview(R.doc, R.rooms, R.results, resolve(args.outDir, 'preview_' + pg + '.svg'));
      if (process.env.DEBUG) writeDebugPPM(R, resolve(args.outDir, 'debug_' + pg + '.ppm'));
    }
    results.push(out);
  }
  process.stdout.write(JSON.stringify(results.length === 1 ? results[0] : results, null, 2) + '\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
