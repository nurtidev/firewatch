/**
 * Покадровая запись 3D-проезда по Кокшетау (index.html) → MP4 1920×1080.
 * Страница отдаётся локальным http-сервером (fetch не работает с file://),
 * каждый кадр: renderAt(t) → ждём загрузки тайлов → скриншот → ffmpeg.
 * Запуск (из корня репо):  node ops/kokshetau/render.mjs [--stills 3,15,35] [--fps 30]
 * Звук: out/voice.wav (если есть) кладётся дорожкой.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..");
const OUT = path.join(DIR, "out"); mkdirSync(OUT, { recursive: true });
const FF = process.env.FFMPEG ?? execFileSync("python3", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const FPS = Number(arg("fps", 25));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".woff2": "font/woff2" };

/* Тайлы, стиль, шрифты и спрайты OpenFreeMap идут через этот же сервер (/ofm/…):
   сервер качает их curl'ом с кэшем на диске (out/tiles). Так браузеру не нужен
   прямой выход в сеть, а повторный рендер не нагружает OpenFreeMap. */
const OFM = "https://tiles.openfreemap.org";
const CACHE = path.join(OUT, "tiles");
async function ofm(rel, host) {
  const safe = rel.replace(/[^\w./-]/g, "_");
  // «/planet» — и tilejson, и папка тайлов: у файлов без расширения свой суффикс
  const file = path.join(CACHE, path.extname(safe) ? safe : safe + ".meta");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    await new Promise((ok, fail) => execFile("curl", ["-sf", "-m", "30", "--retry", "3", "-o", file, OFM + rel], (e) => (e ? fail(e) : ok())));
  }
  let body = await readFile(file);
  if (/\.json$|^\/styles|^\/planet$/.test(rel)) body = Buffer.from(body.toString().replaceAll(OFM, `http://${host}/ofm`));
  return body;
}

const server = createServer(async (req, res) => {
  if (req.url.startsWith("/ofm/")) {
    try {
      const rel = decodeURIComponent(req.url.slice(4));
      const body = await ofm(rel, req.headers.host);
      const ct = rel.endsWith(".pbf") ? "application/x-protobuf" : rel.endsWith(".png") ? "image/png" : "application/json";
      res.writeHead(200, { "content-type": ct }); res.end(body);
    } catch (e) { if (process.env.DEBUG) console.error("ofm fail", req.url, e.message); res.writeHead(204); res.end(); }
    return;
  }
  try {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (!p.startsWith(ROOT)) throw new Error();
    const body = await readFile(p);
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(" ") : ["--disable-gpu-compositing", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
/* WebGL в песочнице идёт через swiftshader (CPU). Главный тормоз был не WebGL, а
   GPU-композитинг страницы при скриншоте (~2,5 с) — он выключен флагом
   --disable-gpu-compositing (скриншот ~0,1 с). --dpr 0.667 — ещё быстрее, с апскейлом до 1080p. */
const DPR = Number(arg("dpr", 1));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DPR });
page.on("pageerror", (e) => console.error("page:", e.message));
const PAGE = arg("page", "index.html");
await page.goto(`http://127.0.0.1:${port}/kokshetau/${PAGE}`);
await page.evaluate(() => window.initDone);
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => window.TOTAL_T);
/* Прямой CDP-захват: page.screenshot() ждёт «стабильный» кадр и на WebGL тратит ~2,4 с. */
const cdp = await page.context().newCDPSession(page);

const PROF = { render: 0, ready: 0, shot: 0 };
async function frame(t) {
  let t1 = Date.now();
  await page.evaluate((x) => window.renderAt(x), t);
  PROF.render += Date.now() - t1; t1 = Date.now();
  await page.evaluate(() => window.frameReady());
  PROF.ready += Date.now() - t1;
}

/* --mux a,b,c: склеить куски chunk-a.mp4, chunk-b.mp4… и наложить озвучку (без повторного рендера) */
if (arg("mux")) {
  const list = path.join(OUT, "chunks.txt");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(list, arg("mux").split(",").map((c) => `file '${path.join(OUT, `chunk-${c}.mp4`)}'`).join("\n"));
  const silentAll = path.join(OUT, "video-silent.mp4");
  execFileSync(FF, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silentAll]);
  const track = await page.evaluate(() => window.VOICE_TRACK);
  const voice = path.join(OUT, "film-voice.wav"), ins = [], fl = [];
  track.forEach((c, j) => { ins.push("-i", path.join(OUT, "film-voice", "trim", `${c.id}.wav`)); const ms = Math.round(c.start * 1000); fl.push(`[${j}:a]adelay=${ms}|${ms}[a${j}]`); });
  execFileSync(FF, ["-y", "-loglevel", "error", ...ins, "-filter_complex", `${fl.join(";")};${track.map((_, j) => `[a${j}]`).join("")}amix=inputs=${track.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad[o]`, "-map", "[o]", "-ac", "2", "-t", String(total), voice]);
  const final = path.join(OUT, PAGE.replace(".html", ".mp4"));
  execFileSync(FF, ["-y", "-loglevel", "error", "-i", silentAll, "-i", voice, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", final]);
  console.log("готово:", final); await browser.close(); server.close(); process.exit(0);
}

const stills = arg("stills");
if (stills) {
  for (const t of stills.split(",").map(Number)) {
    await frame(t);
    const f = path.join(OUT, `still-${t}.png`);
    await page.screenshot({ path: f }); console.log(f);
  }
} else {
  const silent = path.join(OUT, arg("chunk") ? `chunk-${arg("chunk")}.mp4` : "video-silent.mp4");
  const ff = spawn(FF, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent], { stdio: ["pipe", "inherit", "inherit"] });
  const from = Number(arg("from", 0)), to = Number(arg("to", total));
  const n = Math.round((to - from) * FPS), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await frame(from + i / FPS);
    const t2 = Date.now();
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
    const buf = Buffer.from(data, "base64");
    PROF.shot += Date.now() - t2;
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % FPS === 0) process.stdout.write(`\r${i}/${n} кадров · ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on("close", r));
  if (arg("chunk")) { console.log("\nкусок:", silent); await browser.close(); server.close(); process.exit(0); }
  if (process.env.PROFILE) { const c0 = Date.now(); for (let i = 0; i < 5; i++) await page.evaluate(() => map.getCanvas().toDataURL("image/jpeg", .92).length); console.log("\ncanvas toDataURL, мс:", (Date.now() - c0) / 5); }
  if (process.env.PROFILE) console.log("\nмс на кадр:", Object.fromEntries(Object.entries(PROF).map(([k, v]) => [k, Math.round(v / n)])));
  /* Озвучка по таймлайну страницы (film.html): клипы out/film-voice/trim/<id>.wav по своим стартам. */
  const track = await page.evaluate(() => window.VOICE_TRACK ?? null);
  let voice = path.join(OUT, "voice.wav");
  if (track) {
    voice = path.join(OUT, "film-voice.wav");
    const ins = [], fl = [];
    track.forEach((c, j) => { ins.push("-i", path.join(OUT, "film-voice", "trim", `${c.id}.wav`)); const ms = Math.round(Math.max(0, c.start - from) * 1000); fl.push(`[${j}:a]adelay=${ms}|${ms}[a${j}]`); });
    execFileSync(FF, ["-y", "-loglevel", "error", ...ins, "-filter_complex", `${fl.join(";")};${track.map((_, j) => `[a${j}]`).join("")}amix=inputs=${track.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[o]`, "-map", "[o]", "-ac", "2", voice]);
  }
  const final = path.join(OUT, PAGE === "index.html" ? "kokshetau-3d.mp4" : PAGE.replace(".html", ".mp4"));
  if (existsSync(voice)) execFileSync(FF, ["-y", "-loglevel", "error", "-i", silent, "-i", voice, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", final]);
  console.log("\nготово:", existsSync(voice) ? final : silent);
}
await browser.close(); server.close();
