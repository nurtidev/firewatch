/**
 * Запись демо-видео FireWatch по сценарию docs/demo_video_script.md.
 *
 * Каждый сегмент сценария пишется отдельным файлом seg-NN.webm — так неудачный
 * кусок перезаписывается точечно (`node record.mjs 06`), а не весь ролик заново.
 * Склейка и озвучка — build.sh.
 *
 * Вход в систему делается подстановкой токена в localStorage ДО первой навигации:
 * иначе экран логина и редирект попадают в кадр, и каждый сегмент пришлось бы
 * обрезать вручную.
 *
 * Запуск:  node ops/demo/record.mjs [номер сегмента ...]
 */
import { chromium } from "playwright";
import { mkdir, rm, readdir, rename, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const WEB = process.env.FW_WEB ?? "http://localhost:3001";
const API = process.env.FW_API ?? "http://localhost:8001";
const OUT = path.resolve(process.env.FW_OUT ?? "ops/demo/out");
const SIZE = { width: 1920, height: 1080 };

/* Время, которое кадр держится после того, как страница отрисовалась.
   Совпадает с длительностью сегмента в сценарии; звук ляжет сверху. */
/* Объекты подобраны под демо-базу: Хайвилл (карточка 37) — единственный
   с оцифрованными поэтажными планами и схемами ДЧС, выезд 30 — единственный
   активный с зафиксированной расстановкой. Deep-link вместо клика по списку:
   порядок в списке зависит от дат и на другой машине может отличаться. */
const SEGMENTS = [
  { id: "01", role: "supervisor", path: "/map", hold: 14_000, steps: mapOverview },
  { id: "02", role: "supervisor", path: "/map", hold: 32_000, steps: mapDrilldown },
  { id: "03", role: "supervisor", path: "/model", hold: 27_000, steps: scrollThrough },
  { id: "04", role: "inspector", path: "/routes", hold: 24_000, steps: inspectorRoute },
  { id: "05", role: "inspector", path: "/cards?id=37", hold: 18_000, steps: openCard },
  { id: "06", role: "dispatcher", path: "/dispatch", hold: 28_000, steps: dispatchFlow },
  { id: "07", role: "responder", path: "/callout?id=30", hold: 18_000, steps: deploymentSheet },
  { id: "08", role: "supervisor", path: "/forces", hold: 18_000, steps: forcesCalc },
  { id: "09", role: "supervisor", path: "/infra", hold: 12_000, steps: infraMap },
  // Финал — под руководством ведомства: у supervisor сводка урезана его районом,
  // а закадровый текст говорит про город целиком.
  { id: "10", role: "leadership", path: "/dashboard", hold: 17_000, steps: scrollThrough },
];

const PASSWORD = (u) => `${u}123`;
const USER_BY_ROLE = {
  inspector: "inspector",
  supervisor: "supervisor",
  leadership: "minister",
  dispatcher: "dispatcher",
  responder: "responder",
  admin: "admin",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(role) {
  const username = USER_BY_ROLE[role];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD(username) }),
  });
  if (!res.ok) throw new Error(`login ${username}: ${res.status} ${await res.text()}`);
  return res.json();
}

/* Курсора у Playwright в кадре нет — без него клики выглядят как телепортация
   состояния. Рисуем свой и двигаем с transition, чтобы движение читалось. */
const CURSOR_JS = `
  (() => {
    if (window.__fwCursor) return;
    const c = document.createElement('div');
    c.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'left:0', 'top:0',
      'width:22px', 'height:22px', 'pointer-events:none',
      'transform:translate(50vw,50vh)',
      'transition:transform .55s cubic-bezier(.22,.61,.36,1)',
    ].join(';');
    c.innerHTML =
      '<svg viewBox="0 0 22 22" width="22" height="22">' +
      '<path d="M2 1 L2 16 L6.2 12.3 L9 18.6 L12 17.2 L9.2 11 L15 11 Z" ' +
      'fill="#fff" stroke="rgba(0,0,0,.65)" stroke-width="1.2"/></svg>';
    document.documentElement.appendChild(c);
    window.__fwCursor = c;
    window.__fwMove = (x, y) => { c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    window.__fwPulse = () => {
      const r = document.createElement('div');
      const m = c.style.transform.match(/translate\\(([-\\d.]+)px,([-\\d.]+)px\\)/);
      const x = m ? +m[1] : 0, y = m ? +m[2] : 0;
      r.style.cssText = [
        'position:fixed','z-index:2147483646','pointer-events:none',
        'left:' + (x - 14) + 'px','top:' + (y - 14) + 'px',
        'width:30px','height:30px','border-radius:50%',
        'border:2px solid rgba(255,255,255,.9)',
        'transition:transform .45s ease-out, opacity .45s ease-out',
      ].join(';');
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => {
        r.style.transform = 'scale(1.9)';
        r.style.opacity = '0';
      });
      setTimeout(() => r.remove(), 500);
    };
  })();
`;

/** Плавно подвести курсор к элементу и кликнуть. Возвращает false, если
 *  элемента нет — сегмент тогда просто продолжается без этого шага, а не падает
 *  целиком: демо-данные на разных машинах отличаются. */
async function clickAt(page, locator, { pause = 900 } = {}) {
  try {
    const el = locator.first();
    await el.waitFor({ state: "visible", timeout: 5_000 });
    // Без скролла boundingBox может лежать ниже вьюпорта, и клик по координате
    // уходит в пустоту — Playwright при этом не падает, шаг просто теряется.
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(400);
    const box = await el.boundingBox();
    if (!box || box.y < 0 || box.y > 1080) return false;
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    await page.evaluate(([x, y]) => window.__fwMove?.(x, y), [x, y]);
    await sleep(650);
    await page.evaluate(() => window.__fwPulse?.());
    await page.mouse.click(x, y);
    await sleep(pause);
    return true;
  } catch {
    return false;
  }
}

/** Клик по произвольной точке карты (здания — canvas, локатора нет). */
async function clickPoint(page, x, y) {
  await page.evaluate(([x, y]) => window.__fwMove?.(x, y), [x, y]);
  await sleep(650);
  await page.evaluate(() => window.__fwPulse?.());
  await page.mouse.click(x, y);
  await sleep(1_200);
}

/* ── шаги сегментов ─────────────────────────────────────────────────────── */

async function mapOverview(page) {
  await sleep(3_000); // тайлы и слой риска
  await page.mouse.move(960, 540);
  for (const d of [-120, -120]) {
    await page.mouse.wheel(0, d);
    await sleep(1_400);
  }
}

async function mapDrilldown(page) {
  await sleep(3_000);
  // 3D включаем ДО поиска: карточка объекта раскрывается справа и накрывает
  // кнопку. Заодно перелёт камеры к зданию происходит уже в наклоне.
  // Имя кнопки берём из aria-label — он перекрывает текстовое «3D».
  await clickAt(page, page.getByRole("button", { name: /Перейти в 3D/i }), { pause: 3_000 });
  // Поиск вместо клика по canvas: попасть курсором в конкретное здание на
  // растре нельзя воспроизводимо, а промах даёт пустой кадр под озвучку.
  const search = page.getByPlaceholder(/Начните вводить адрес/i);
  if (await clickAt(page, search, { pause: 400 })) {
    await page.keyboard.type("Тәуелсіздік даңғылы 16", { delay: 110 });
    await sleep(1_800);
    // Результаты — обычные <button>; клавиатурной навигации по ним нет.
    await clickAt(page, page.locator("button").filter({ hasText: /Тәуелсіздік/i }), {
      pause: 4_500, // перелёт камеры + карточка риска с разбором факторов
    });
  }
  // В наклонённой камере высота — этажность, цвет — уровень риска: критический
  // объект читается объёмом, а не только точкой на плоскости.
  await page.mouse.wheel(0, -120); // приблизить квартал
  await sleep(3_500);
}

async function scrollThrough(page) {
  await sleep(2_500);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 420);
    await sleep(1_800);
  }
  await page.mouse.wheel(0, -1_260);
}

async function inspectorRoute(page) {
  await sleep(2_500);
  // Первый объект маршрута: конкретный адрес зависит от даты, поэтому цепляемся
  // за статус-чип, который есть у любого непроверенного объекта.
  await clickAt(page, page.getByText(/Не проверено/i), { pause: 2_500 });
  await page.mouse.wheel(0, 350);
  await sleep(2_000);
  await clickAt(page, page.getByRole("button", { name: /^Нарушение$/i }), { pause: 1_800 });
  await page.mouse.wheel(0, 300);
}

async function openCard(page) {
  await sleep(3_000);
  // «Схемы ДЧС» — самая наглядная вкладка карточки: сканы планов из ПТП.
  await clickAt(page, page.getByRole("button", { name: /Схемы ДЧС/i }), { pause: 3_500 });
  await page.mouse.wheel(0, 400);
  await sleep(2_000);
}

async function dispatchFlow(page) {
  await sleep(2_500);
  await page.mouse.wheel(0, 250);
  await sleep(1_500);
  // Клик по активному выезду раскрывает боевой пакет в правой колонке.
  await clickAt(page, page.getByText(/Тәуелсіздік даңғылы 26/i), { pause: 3_500 });
  await page.mouse.wheel(0, 350);
  await sleep(2_500);
  await page.mouse.wheel(0, 350);
}

async function deploymentSheet(page) {
  await sleep(2_500);
  // Блок расстановки — в самом низу пакета, под водоисточниками и препятствиями.
  await page.mouse.wheel(0, 900);
  await sleep(1_500);
  await clickAt(page, page.getByRole("button", { name: /^На схеме$/i }), { pause: 3_000 });
  await page.mouse.wheel(0, 260);
  await sleep(1_500);

  // Позиции демо-выезда заведены списком, без координат, — на плане их не видно.
  // Поэтому расставляем прямо в кадре: это и есть то, о чём говорит закадровый
  // текст, и выглядит убедительнее готовой картинки.
  const canvas = page.locator("[data-deployment-canvas]").first();
  const box = await canvas.boundingBox().catch(() => null);
  if (!box) return;

  const put = async (tool, rx, ry) => {
    await clickAt(page, page.getByRole("button", { name: tool }), { pause: 500 });
    await clickPoint(page, Math.round(box.x + box.width * rx), Math.round(box.y + box.height * ry));
  };
  await put(/^Ств\. туш\.$/i, 0.34, 0.3);
  await put(/^Ств\. туш\.$/i, 0.58, 0.42);
  await put(/^Ств\. защ\.$/i, 0.46, 0.62);
  await put(/^Штаб$/i, 0.2, 0.72);
  await sleep(2_000);
}

async function forcesCalc(page) {
  await sleep(2_000);
  await clickAt(page, page.getByRole("button", { name: /^Рассчитать$/i }), { pause: 2_500 });
  await sleep(2_000);
  await page.mouse.wheel(0, 400);
}

async function infraMap(page) {
  await sleep(3_000);
  await page.mouse.wheel(0, 200);
}

/* ── запуск ─────────────────────────────────────────────────────────────── */

async function recordSegment(browser, seg) {
  const { token, user } = await login(seg.role);
  const dir = path.join(OUT, `raw-${seg.id}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const ctx = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir, size: SIZE },
    deviceScaleFactor: 1,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
  });
  // Токен до первой навигации — иначе в кадр попадёт логин и редирект.
  await ctx.addInitScript(
    ([t, u]) => {
      localStorage.setItem("fw_token", t);
      localStorage.setItem("fw_user", u);
    },
    [token, JSON.stringify(user)],
  );
  await ctx.addInitScript(CURSOR_JS);

  const page = await ctx.newPage();
  const started = Date.now();
  await page.goto(`${WEB}${seg.path}`, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  const loadedAt = Date.now() - started;

  try {
    await seg.steps?.(page);
  } catch (e) {
    console.warn(`  ⚠ шаги сегмента ${seg.id}: ${e.message}`);
  }
  // Добираем сегмент до плановой длительности, если шаги отработали быстрее.
  const elapsed = Date.now() - started - loadedAt;
  if (elapsed < seg.hold) await sleep(seg.hold - elapsed);

  await ctx.close(); // видео дописывается только при закрытии контекста
  const files = (await readdir(dir)).filter((f) => f.endsWith(".webm"));
  const out = path.join(OUT, `seg-${seg.id}.webm`);
  await rename(path.join(dir, files[0]), out);
  await rm(dir, { recursive: true, force: true });

  console.log(`  ✓ seg-${seg.id} (${seg.role} ${seg.path}) → ${path.basename(out)}`);
  return { id: seg.id, file: `seg-${seg.id}.webm`, trimStart: +(loadedAt / 1000).toFixed(2), role: seg.role, path: seg.path };
}

const only = process.argv.slice(2);
const todo = only.length ? SEGMENTS.filter((s) => only.includes(s.id)) : SEGMENTS;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });

// Метаданные ранее записанных сегментов сохраняем: перезапись одного сегмента
// не должна стирать trimStart остальных — иначе build.mjs соберёт ролик
// с обрезкой от нуля и в кадр попадёт незагруженная страница.
const metaPath = path.join(OUT, "segments.json");
const prev = JSON.parse(await readFile(metaPath, "utf8").catch(() => "[]"));
const meta = new Map(prev.map((m) => [m.id, m]));

for (const seg of todo) {
  console.log(`▶ сегмент ${seg.id} — ${seg.role} ${seg.path}`);
  const m = await recordSegment(browser, seg);
  meta.set(m.id, m);
}
await browser.close();
const merged = [...meta.values()].sort((a, b) => a.id.localeCompare(b.id));
await writeFile(metaPath, JSON.stringify(merged, null, 2));
console.log(`\nГотово: записано ${todo.length}, всего в ролике ${merged.length} сегментов (${OUT})`);
