/**
 * Сборка моушн-ролика FireWatch (ops/pitch/index.html) в MP4 1920×1080.
 *
 * 1. Озвучка: out/voice/<id>.mp3 (tts.py, edge-tts) → обрезка тишины по краям →
 *    длительность каждого клипа задаёт длину своей сцены (ведущая дорожка — звук).
 * 2. Кадры: страница рисует кадр чистой функцией window.renderAt(t) — снимаем
 *    покадрово через Playwright и подаём JPEG в ffmpeg по трубе. Реального времени
 *    нет, поэтому дёрганий и выпавших кадров тоже нет.
 * 3. Звук: клипы раскладываются по voiceStart своих сцен (adelay) и сводятся.
 *
 * Запуск:  node ops/pitch/render.mjs [--fps 30] [--from 0 --to 10]   (из корня репо)
 * Превью кадров:  node ops/pitch/render.mjs --stills 3,12,25
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "out");
const VOICE = path.join(OUT, "voice");
const FF = process.env.FFMPEG ?? execFileSync("python3", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim();

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const FPS = Number(arg("fps", 30));

const script = JSON.parse(readFileSync(path.join(DIR, "voiceover.json"), "utf8"));

function durationOf(file) {
  const err = spawnSyncStderr([FF, "-i", file]);
  const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function spawnSyncStderr(cmd) {
  try { execFileSync(cmd[0], cmd.slice(1), { stdio: ["ignore", "ignore", "pipe"] }); return ""; }
  catch (e) { return e.stderr.toString(); }
}

/* 1. озвучка без тишины по краям */
mkdirSync(path.join(VOICE, "trim"), { recursive: true });
const voice = {}, captions = {};
for (const s of script) {
  const src = path.join(VOICE, `${s.id}.mp3`);
  if (!existsSync(src)) throw new Error(`нет озвучки ${src} — сначала tts.py (см. README)`);
  const dst = path.join(VOICE, "trim", `${s.id}.wav`);
  execFileSync(FF, ["-y", "-loglevel", "error", "-i", src, "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
    "-ar", "48000", "-ac", "2", dst]);
  voice[s.id] = +durationOf(dst).toFixed(3);
  captions[s.id] = s.text;
}
console.log("озвучка:", voice);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(DIR, "index.html"));
await page.evaluate(() => document.fonts.ready);
const tl = await page.evaluate(([v, c]) => { window.CAPTIONS = c; return window.setTimeline(v, c); }, [voice, captions]);
console.log(`хронометраж: ${tl.total.toFixed(1)} с`);
console.log(tl.scenes.map((s) => `${s.id}@${s.start.toFixed(1)}+${s.dur.toFixed(1)}`).join("  "));

/* превью отдельных кадров */
const stills = arg("stills");
if (stills) {
  const ts = stills === "scenes" ? tl.scenes.flatMap((s) => [s.start + s.dur * .45, s.start + s.dur * .92]) : stills.split(",").map(Number);
  for (const t of ts.map((x) => +x.toFixed(2))) {
    await page.evaluate((x) => window.renderAt(x), t);
    const f = path.join(OUT, `still-${String(t).padStart(5, "0")}.png`);
    await page.screenshot({ path: f });
    console.log(f);
  }
  await browser.close();
  process.exit(0);
}

/* 2. кадры → видео без звука */
const from = Number(arg("from", 0)), to = Number(arg("to", tl.total));
const frames = Math.round((to - from) * FPS);
const silent = path.join(OUT, "video-silent.mp4");
const ff = spawn(FF, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent], { stdio: ["pipe", "inherit", "inherit"] });
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate((x) => window.renderAt(x), from + i / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % (FPS * 5) === 0) process.stdout.write(`\r${i}/${frames} кадров · ${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log("\nвидео:", silent);

/* 3. звук по таймлайну + сведение */
const inputs = [], filters = [];
tl.scenes.forEach((s, i) => {
  inputs.push("-i", path.join(VOICE, "trim", `${s.id}.wav`));
  const ms = Math.max(0, Math.round((s.voiceStart - from) * 1000));
  filters.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`);
});
const mix = `${filters.join(";")};${tl.scenes.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tl.scenes.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
const final = path.join(OUT, "firewatch-dchs.mp4");
execFileSync(FF, ["-y", "-loglevel", "error", "-i", silent, ...inputs, "-filter_complex", mix,
  "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", final]);
console.log("готово:", final);
writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(tl, null, 1));
