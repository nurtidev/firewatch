#!/usr/bin/env node
'use strict';
/**
 * Строит web/src/data/floorplans/hayvill.ts (реальная геометрия комнат ЖК «Хайвилл-Астана»,
 * калиброванная в метры) из геометрической экстракции extract-floorplans.mjs.
 *
 * Пайплайн:  .vsd → extractRooms() из ./extract-floorplans.mjs (растр → полигоны в SVG-дюймах,
 *            см. хрупкие места в шапке того файла) → калибровка масштаба листа в метры →
 *            эмит TypeScript-файла с массивом RealFloorPlan[].
 *
 * Калибровка (SVG-дюймы → метры): для каждого листа подобран ЕДИНЫЙ множитель
 *   k = sqrt(целевая_площадь_м² / сумма_площадей_многоугольников_листа_в_SVG-дюймах²)
 * то есть суммарная площадь всех комнат листа после калибровки точно равна целевой площади из
 * ground truth (targetM2 ниже). Координаты каждого плана после калибровки сдвинуты так, что bbox
 * начинается в (0,0); area_m2 каждой комнаты — shoelace-площадь ПОСЛЕ калибровки и округления
 * (а не area_svg_in² × k²), поэтому суммы комнат и widthM/heightM внутренне согласованы.
 *
 * Целевые площади (targetM2, захардкожены в PAGES ниже) для калибровки:
 *  - паркинг/цоколь (p03–p05): api/scripts/seed_data/hayvill.json → floor_plans
 *    («Цокольный этаж — 1-й/2-й уровень», «Паркинг (цокольный этаж)»), сопоставление по порядку
 *    листов — см. предупреждение в scaleNote p04 о несовпадении масштабов между уровнями.
 *  - типовой жилой этаж (p06): среднее total_area_m2 этажей «1-й».."15-й» из того же JSON
 *    (≈1086.89 м²).
 *  - квартиры (p07/p08/p10): реальные поквартирные экспликации из docs/docs_tg/57.2.pdf
 *    (скан без текстового слоя — площади считаны вручную по фото страницы 1, кв. №201/202/204).
 *  - 3-комнатная (p09): прямого аналога в 57.2.pdf не нашлось — использовано правдоподобное
 *    приближение 120 м² (см. scaleNote p09 ниже), НЕ измеренное значение.
 * Это ad-hoc источники (скан-фото, ручное сопоставление по порядку листов) — если появится
 * официальная экспликация для p09 или уточнённое соответствие p03–p05, поправить targetM2/
 * scaleNote в PAGES и перезапустить скрипт.
 *
 * Требования: те же, что у extract-floorplans.mjs (brew install libvisio). Zero npm-зависимостей.
 *
 * Запуск:
 *   node web/scripts/build-floorplan-dataset.mjs
 *     — обрабатывает дефолтный .vsd ("docs/docs_tg/поэтажные планы.vsd"), пишет
 *       web/src/data/floorplans/hayvill.ts (перезаписывает файл!)
 *   node web/scripts/build-floorplan-dataset.mjs --dry-run
 *     — печатает только сводку калибровки (raw/k/sum/target/delta по каждому листу), ничего
 *       не пишет — безопасно для проверки после правки PAGES или пересчёта экстрактора
 *   node web/scripts/build-floorplan-dataset.mjs "docs/docs_tg/поэтажные планы.vsd" --out /tmp/hayvill.ts
 *     — явный путь к .vsd и/или альтернативный путь вывода (не трогает репозиторий)
 *
 * ВАЖНО: этот скрипт при запуске без --out/--dry-run перезаписывает закоммиченный файл
 * web/src/data/floorplans/hayvill.ts. Запускать осознанно (например, после правки PAGES ниже
 * или после пересчёта экстрактора), не как часть обычной сборки.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRooms, vsdToPages } from './extract-floorplans.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const DEFAULT_VSD = resolve(REPO, 'docs', 'docs_tg', 'поэтажные планы.vsd');
const DEFAULT_OUT = resolve(REPO, 'web', 'src', 'data', 'floorplans', 'hayvill.ts');

// ---------- per-page config (sourcePage = 1-indexed page in поэтажные планы.vsd) ----------
const PAGES = [
  {
    pg: 'p03', id: 'parking-l1', kind: 'parking', sourcePage: 3,
    title: 'План 1-го этажа авто стоянки',
    targetM2: 1077.2,
    scaleNote: 'Соответствие листа и записи в hayvill.json — по порядку следования ' +
      '(лист «план N-го этажа авто стоянки» → N-я запись цокольных уровней в экспликации): ' +
      'p03 → «Цокольный этаж — 1-й уровень» (1077.2 м²). Масштаб k=SCALE м/дюйм(SVG), единый ' +
      'для всех полигонов листа, площадь листа в исходных SVG-дюймах ≈ RAW in². ' +
      'ВНИМАНИЕ: точное поэтажное соответствие не подтверждено первоисточником — см. общее ' +
      'предупреждение у p04/p05.',
  },
  {
    pg: 'p04', id: 'parking-l2', kind: 'parking', sourcePage: 4,
    title: 'План 2-го этажа авто стоянки',
    targetM2: 1660.8,
    scaleNote: 'Соответствие листа и записи в hayvill.json — по порядку следования: ' +
      'p04 → «Цокольный этаж — 2-й уровень» (1660.8 м²). Масштаб k=SCALE м/дюйм(SVG). ' +
      'ВНИМАНИЕ: сырые площади в SVG-дюймах у p03/p04/p05 почти одинаковы (46.7/40.6/42.1 in²), ' +
      'а целевые м² различаются в разы (1077/1661/392) — значит, эти три листа НЕ являются ' +
      'простой перекладкой одного и того же этажа друг на друга, и после калибровки их bbox ' +
      'по метрам не совпадут (масштаб на p03/p04/p05 разный: k≈4.80/6.40/3.05 м/дюйм). Если ' +
      '3D-рендерер укладывает уровни паркинга друг на друга по футпринту — это допущение будет ' +
      'заметно нарушено, честно предупреждаем.',
  },
  {
    pg: 'p05', id: 'parking-l3', kind: 'parking', sourcePage: 5,
    title: 'План 3-го этажа авто стоянки',
    targetM2: 391.5,
    scaleNote: 'Соответствие листа и записи в hayvill.json — по порядку следования: ' +
      'p05 → «Паркинг (цокольный этаж)» (391.5 м², в экспликации всего 1 строкой, без разбивки ' +
      'по помещениям — вероятно, не полный этаж, а отдельная зона). Масштаб k=SCALE м/дюйм(SVG). ' +
      'См. предупреждение о несовпадении масштабов у p04.',
  },
  {
    pg: 'p06', id: 'typical', kind: 'typical', sourcePage: 6,
    title: 'План с 1-го по 22-го жилых этажей',
    targetM2: 1086.89,
    scaleNote: 'Масштаб подобран так, чтобы Σ(площадей 7 извлечённых контуров «Квартира») ≈ ' +
      'среднему total_area_m2 этажей «1-й этаж».."15-й этаж" из hayvill.json ' +
      '(1086.89 м², среднее по 15 этажам). План на этом листе Visio схематичный: квартиры — ' +
      'единые контуры-боксы без внутренней разбивки на комнаты, подписей лифтов/лестниц на ' +
      'листе нет вовсе (только 7×«Квартира»), поэтому эвакуационные узлы/лифты в датасете ' +
      'этого плана отсутствуют — это ограничение исходного чертежа, не извлечения.',
  },
  {
    pg: 'p07', id: 'apt-1k', kind: 'apartment', sourcePage: 7,
    title: 'Схема 1 комнатной квартиры',
    targetM2: 67.0,
    scaleNote: 'Калибровка по реальной поквартирной экспликации (docs/docs_tg/57.2.pdf, ' +
      'скан, кв. №201, ИТОГО 67.0 м²): состав и число помещений почти точно совпадают с ' +
      'извлечёнными — прихожая, гостиная, кухня, спальная(«комната»), 2×сан.узел(' +
      '«сан-узел»+«туалет»), постирочная, лоджия — 8/8. Масштаб k=SCALE м/дюйм(SVG).',
  },
  {
    pg: 'p08', id: 'apt-2k', kind: 'apartment', sourcePage: 8,
    title: 'Схема 2 комнатной квартиры',
    targetM2: 79.5,
    scaleNote: 'Калибровка по реальной поквартирной экспликации (57.2.pdf, кв. №202, ИТОГО ' +
      '79.5 м²): состав близок к извлечённому (прихожая, комната, гостиная, кухня, сан-узел, ' +
      'туалет, постирочная, шкаф/гардеробная, 2×лоджия ≈ извлечённые 9 помещений). Масштаб ' +
      'k=SCALE м/дюйм(SVG).',
  },
  {
    pg: 'p09', id: 'apt-3k', kind: 'apartment', sourcePage: 9,
    title: 'Схема 3 комнатной квартиры',
    targetM2: 120,
    scaleNote: 'Прямого поквартирного аналога 3-комнатной планировки в отсканированных листах ' +
      '57.2.pdf не найдено (там встретились только кв. на 67.0/79.5/193.0/219.9 м² — это ближе ' +
      'к 1-, 2- и 4-комнатным типам). Использовано приближение из ТЗ: 120 м² с учётом лоджии — ' +
      'правдоподобный ориентир между 2- и 4-комнатными типами, НЕ измеренное значение. Масштаб ' +
      'k=SCALE м/дюйм(SVG).',
  },
  {
    pg: 'p10', id: 'apt-4k', kind: 'apartment', sourcePage: 10,
    title: 'Схема 4 комнатной квартиры',
    targetM2: 193.0,
    scaleNote: 'Калибровка по реальной поквартирной экспликации (57.2.pdf, кв. №204, ИТОГО ' +
      '193.0 м²; на том же листе есть более крупная кв. №203 на 219.9 м² — она не выбрана, т.к. ' +
      'по числу строк (15 против 24) №204 ближе к извлечённым 17 помещениям). Состав — прихожая, ' +
      'сан.узел×2, комната×3/гостиная, гардеробная, кухня, кладовая, постирочная, туалет, ' +
      '2×лоджия — близок к извлечённому. Масштаб k=SCALE м/дюйм(SVG). ПРИМЕЧАНИЕ: у извлечённой ' +
      '«кладовая» аномально большая площадь (больше гостиной) — эта комната, похоже, ' +
      'захватила часть неподписанного общего коридора при водоразделе (Voronoi-партиции) между ' +
      'соседними подписями; геометрия визуально правдоподобна, но площадь этой конкретной ' +
      'комнаты может быть завышена.',
  },
];

// ---------- name cleanup (Visio line-wrap artifacts) ----------
const NAME_FIX = {
  'пости рочная': 'постирочная',
  'гардероб ная': 'гардеробная',
};

// ---------- room type heuristic ----------
function roomType(name) {
  const n = name.toLowerCase();
  if (/лестн/.test(n)) return 'эвакуация';
  if (/лифт/.test(n)) return 'лифт';
  if (/постирочн/.test(n)) return 'тех';
  if (/сан.?узел|туалет/.test(n)) return 'санузел';
  if (/оздоровит/.test(n)) return 'общественное';
  if (/торгов/.test(n)) return 'общественное';
  if (/кухня/.test(n)) return 'общепит';
  if (/спальн|гостин|лоджия|квартира/.test(n)) return 'жилое';
  if (/прихож|холл|коридор/.test(n)) return 'коридор';
  if (/кладов|гардероб|шкаф/.test(n)) return 'кладовая';
  if (/паркинг|стоянк/.test(n)) return 'паркинг';
  return 'помещение';
}

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function round2(x) { return Math.round(x * 100) / 100; }

function calibratePlan(cfg, data) {
  const rawTotal = data.rooms.reduce((s, r) => s + r.area_svg_in2, 0);
  const k = Math.sqrt(cfg.targetM2 / rawTotal); // meters per svg-inch

  // dedupe repeated generic names (Квартира x7, Торговые помещения x5...)
  const rooms = data.rooms.map((r) => ({ ...r, name: NAME_FIX[r.name] || r.name }));
  const counts = new Map();
  for (const r of rooms) counts.set(r.name, (counts.get(r.name) || 0) + 1);
  const seenIdx = new Map();

  // scale + shift to bbox (0,0)
  const scaled = rooms.map((r) => r.polygon.map(([x, y]) => [x * k, y * k]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of scaled) for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  const outRooms = rooms.map((r, i) => {
    const dupCount = counts.get(r.name);
    let label = r.name;
    if (dupCount > 1) {
      const n = (seenIdx.get(r.name) || 0) + 1;
      seenIdx.set(r.name, n);
      label = `${r.name} №${n}`;
    }
    const poly = scaled[i].map(([x, y]) => [round2(x - minX), round2(y - minY)]);
    const area = round2(shoelace(poly));
    return { name: label, type: roomType(r.name), polygon: poly, area_m2: area };
  });

  const widthM = round2(maxX - minX);
  const heightM = round2(maxY - minY);
  const scaleNote = cfg.scaleNote
    .replace('SCALE', k.toFixed(3))
    .replace('RAW', rawTotal.toFixed(1));

  return {
    id: cfg.id, title: cfg.title, kind: cfg.kind, sourcePage: cfg.sourcePage,
    scaleNote, widthM, heightM, rooms: outRooms,
    _debug: { rawTotal, k, sumAreaM2: round2(outRooms.reduce((s, r) => s + r.area_m2, 0)), targetM2: cfg.targetM2 },
  };
}

// ---------- emit TS ----------
function tsRoom(r) {
  const poly = '[' + r.polygon.map(([x, y]) => `[${x},${y}]`).join(',') + ']';
  return `    { name: ${JSON.stringify(r.name)}, type: ${JSON.stringify(r.type)}, polygon: ${poly}, area_m2: ${r.area_m2} }`;
}

function tsPlan(p) {
  const rooms = p.rooms.map(tsRoom).join(',\n');
  return `  {
    id: ${JSON.stringify(p.id)},
    title: ${JSON.stringify(p.title)},
    kind: ${JSON.stringify(p.kind)},
    sourcePage: ${p.sourcePage},
    scaleNote: ${JSON.stringify(p.scaleNote)},
    widthM: ${p.widthM},
    heightM: ${p.heightM},
    rooms: [
${rooms},
    ],
  }`;
}

const HEADER = `/**
 * Калиброванная геометрия планов этажей ЖК «Хайвилл-Астана» — реальные полигоны комнат
 * (не treemap-заглушка из lib/floorplan.ts), для 2D/3D-визуализации.
 *
 * Происхождение: docs/docs_tg/поэтажные планы.vsd (страницы p03–p10, экспорт в SVG через
 * vsd2xhtml/libvisio) → геометрия восстановлена web/scripts/extract-floorplans.mjs (растровая
 * заливка стен из чёрных path-элементов Visio, flood fill от текстовых подписей комнат,
 * трассировка контура (Мур), упрощение Дугласа–Пекера) → калибровка масштаба в метры
 * web/scripts/build-floorplan-dataset.mjs (этот скрипт сгенерировал файл, см. его шапку —
 * там же таргеты калибровки и источники ground truth).
 *
 * Калибровка (SVG-дюймы → метры): для каждого листа подобран ЕДИНЫЙ множитель
 * k = sqrt(целевая_площадь_м² / сумма_площадей_многоугольников_в_SVG-дюймах²), то есть
 * суммарная площадь всех комнат листа после калибровки точно равна целевой площади из
 * ground truth (или из приближения, когда прямого измерения не было — см. scaleNote конкретного
 * плана). Координаты каждого плана после калибровки сдвинуты так, что bbox начинается в (0,0),
 * округлены до 2 знаков; area_m2 у каждой комнаты — это shoelace-площадь ПОСЛЕ калибровки и
 * округления (а не area_svg_in² × k²), поэтому суммы комнат и widthM/heightM внутренне согласованы.
 *
 * Известные ограничения (честно, для автора 3D-рендерера):
 *  - p06 содержит только контуры квартир («Квартира» ×7) — на листе нет подписей
 *    лифтов/лестниц, поэтому эвакуационные узлы в типовом плане отсутствуют.
 *  - p10 («кладовая») — при водоразделе (nearest-label partition) эта комната, похоже, забрала
 *    часть неподписанного коридора, её area_m2 может быть завышена относительно реальной.
 *  - p03–p05 калиброваны с разным k (масштаб/дюйм отличается в разы) — при укладке уровней
 *    паркинга друг на друга по футпринту в 3D они НЕ совпадут, см. scaleNote p04.
 */

export type RealRoom = {
  name: string;
  type: string; // ключ ROOM_TYPE_META (web/src/lib/floorplan.ts)
  /** Полигон в метрах, план-координаты (x вправо, y вниз от верхнего левого угла листа). */
  polygon: [number, number][];
  area_m2: number; // из полигона после калибровки
};

export type RealFloorPlan = {
  id: string;            // "parking-l1" | "parking-l2" | "parking-l3" | "typical" | "apt-1k".."apt-4k"
  title: string;         // заголовок листа из Visio
  kind: "parking" | "typical" | "apartment";
  sourcePage: number;    // номер листа в поэтажные планы.vsd
  scaleNote: string;     // как калибровали (RU, честно, включая допущения)
  widthM: number;        // bbox всех полигонов
  heightM: number;
  rooms: RealRoom[];
};

export const HAYVILL_FLOORPLANS: RealFloorPlan[] = [
`;

// ---------- CLI ----------
function parseArgs(argv) {
  const opts = { vsd: null, out: DEFAULT_OUT, dryRun: false };
  let wantOut = false;
  for (const a of argv) {
    if (wantOut) { opts.out = resolve(a); wantOut = false; continue; }
    if (a === '--dry-run') { opts.dryRun = true; continue; }
    if (a === '--out') { wantOut = true; continue; }
    if (a.startsWith('--out=')) { opts.out = resolve(a.slice('--out='.length)); continue; }
    if (!opts.vsd) { opts.vsd = a; continue; }
    throw new Error(`unrecognised argument: ${a}`);
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const vsdPath = args.vsd ? resolve(args.vsd) : DEFAULT_VSD;
  const svgPages = vsdToPages(vsdPath);

  const plans = PAGES.map((cfg) => {
    const svg = svgPages[cfg.sourcePage - 1];
    if (!svg) throw new Error(`page ${cfg.sourcePage} (${cfg.pg}) not found in ${vsdPath}`);
    const { out } = extractRooms(svg, cfg.pg);
    return calibratePlan(cfg, out);
  });

  console.log('\n=== Calibration summary ===');
  for (const p of plans) {
    const d = p._debug;
    console.log(`${p.id.padEnd(12)} raw=${d.rawTotal.toFixed(2)}in² k=${d.k.toFixed(3)} sum=${d.sumAreaM2}m² target=${d.targetM2}m² delta=${(d.sumAreaM2 - d.targetM2).toFixed(1)}m² (${((d.sumAreaM2 / d.targetM2 - 1) * 100).toFixed(1)}%)`);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: nothing written.');
    return;
  }

  const out = HEADER + plans.map(tsPlan).join(',\n') + ',\n];\n';
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, out);
  console.log('\nWrote', args.out, (out.length / 1024).toFixed(1) + 'KB');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
