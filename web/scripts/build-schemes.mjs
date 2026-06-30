/**
 * Оцифровка схем ДЧС из исходных Visio (.vsd) ПТП в PNG-листы для фронта.
 *
 * Пайплайн: .vsd → vsd2xhtml (libvisio) → постранично (<svg:svg>) → resvg → PNG.
 *
 * Требования (dev-машина, разово):
 *   brew install libvisio          # даёт vsd2xhtml
 *   npm i -D @resvg/resvg-js       # из каталога web/
 *
 * Запуск:   node scripts/build-schemes.mjs
 * Результат: web/public/schemes/<obj>/<group>/pNN.png (коммитятся в репозиторий).
 *
 * Конфиг ниже должен соответствовать манифесту web/src/data/schemes.ts.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..", "..");
const DOCS = resolve(REPO, "docs", "docs_tg");
const OUT = resolve(REPO, "web", "public", "schemes");
const WIDTH = 2200; // px по ширине листа — достаточно для читаемости тактических знаков

/** Объект → группы схем (vsd-источники). Держать в синхроне со schemes.ts. */
const OBJECTS = {
  hayvill: {
    deployment: "Расстановка сил  и средств.vsd",
    floors: "поэтажные планы.vsd",
    // «схемы (1).vsd» намеренно исключён: сборный файл с несколькими объектами
    // (этажные схемы + СО «Евразия-2» + 6-МКР), не атрибутируется как Хайвилл.
  },
};

/** Нормализуем namespaced (svg:) разметку vsd2xhtml → стандартный SVG. */
function normalize(block) {
  return block
    .replace(/<svg:/g, "<")
    .replace(/<\/svg:/g, "</")
    .replace(/xmlns:svg=/g, "xmlns=");
}

function vsdToPages(vsdPath) {
  const xhtml = execFileSync("vsd2xhtml", [vsdPath], { maxBuffer: 1 << 30 }).toString("utf8");
  return (xhtml.match(/<svg:svg [\s\S]*?<\/svg:svg>/g) || []).map(normalize);
}

for (const [obj, groups] of Object.entries(OBJECTS)) {
  for (const [group, file] of Object.entries(groups)) {
    const dir = resolve(OUT, obj, group);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const pages = vsdToPages(resolve(DOCS, file));
    pages.forEach((svg, i) => {
      const png = new Resvg(svg, {
        fitTo: { mode: "width", value: WIDTH },
        font: { loadSystemFonts: true },
        background: "white",
      })
        .render()
        .asPng();
      const n = String(i + 1).padStart(2, "0");
      writeFileSync(resolve(dir, `p${n}.png`), png);
    });
    console.log(`${obj}/${group}: ${pages.length} листов ← ${file}`);
  }
}
