/**
 * Сборка демо-ролика: озвучка сегментов + подгонка видео под звук + склейка.
 *
 * Ведущая дорожка — звук: диктор не должен обрываться на середине фразы, если
 * экранная запись сегмента вышла короче. Поэтому каждый сегмент подтягивается
 * до длины своей озвучки стоп-кадром (tpad), а не наоборот.
 *
 * Озвучка по умолчанию — системный TTS macOS (`say`, голос Milena): это
 * черновик для проверки таймингов. Готовые файлы из ElevenLabs кладутся в
 * ops/demo/voice/seg-NN.mp3 — скрипт берёт их вместо `say` автоматически.
 *
 * Запуск:  node ops/demo/build.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const OUT = path.resolve(process.env.FW_OUT ?? "ops/demo/out");
const VOICE_DIR = path.resolve("ops/demo/voice");
const WORK = path.join(OUT, "work");
const VOICE = "Milena";
/* Темп черновика намеренно совпадает с целевой начиткой диктора (~135 слов/мин):
   при более быстром `say` черновик занижает хронометраж, и ролик, собранный
   на студийной озвучке, внезапно оказывается на минуту длиннее. */
const RATE = 135;
const GAP = 0.5; // пауза между сегментами, сек

const exists = (p) => access(p).then(() => true, () => false);

async function duration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(stdout.trim());
}

/** Озвучка сегмента: готовый файл из ops/demo/voice/ или системный TTS. */
async function makeVoice(seg) {
  const wav = path.join(WORK, `voice-${seg.id}.wav`);
  for (const ext of ["mp3", "wav", "m4a", "aiff"]) {
    const ready = path.join(VOICE_DIR, `seg-${seg.id}.${ext}`);
    if (await exists(ready)) {
      await run("ffmpeg", ["-y", "-i", ready, "-ar", "48000", "-ac", "2", wav]);
      return { wav, source: "studio" };
    }
  }
  const aiff = path.join(WORK, `voice-${seg.id}.aiff`);
  await run("say", ["-v", VOICE, "-r", String(RATE), "-o", aiff, seg.text]);
  await run("ffmpeg", ["-y", "-i", aiff, "-ar", "48000", "-ac", "2", wav]);
  return { wav, source: "say" };
}

/** Видео сегмента, обрезанное от загрузки страницы и подтянутое под длину звука. */
async function fitVideo(meta, target) {
  const src = path.join(OUT, meta.file);
  const dst = path.join(WORK, `fit-${meta.id}.mp4`);
  await run("ffmpeg", [
    "-y",
    "-ss", String(meta.trimStart ?? 0),
    "-i", src,
    // tpad клонирует последний кадр, если запись короче озвучки; trim режет хвост.
    "-vf", `tpad=stop_mode=clone:stop_duration=${Math.max(target, 1)},fps=30,scale=1920:1080`,
    "-t", String(target),
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", dst,
  ]);
  return dst;
}

const segments = JSON.parse(await readFile("ops/demo/voiceover.json", "utf8"));
const recorded = JSON.parse(await readFile(path.join(OUT, "segments.json"), "utf8"));
const byId = Object.fromEntries(recorded.map((m) => [m.id, m]));

await mkdir(WORK, { recursive: true });

const parts = [];
let total = 0;
let usedSay = false;

for (const seg of segments) {
  const meta = byId[seg.id];
  if (!meta) {
    console.warn(`  ⚠ сегмент ${seg.id} не записан — пропускаю`);
    continue;
  }
  const { wav, source } = await makeVoice(seg);
  if (source === "say") usedSay = true;
  const voiceLen = await duration(wav);
  // Сегмент длится столько, сколько нужно ДЛИННЕЙШЕМУ из двух: обрезав видео
  // под озвучку, мы срезали бы хвост, где происходит само действие (расстановка
  // стволов, отметка нарушения). Лишнее время добирается тишиной, а не спешкой.
  const videoLen = (await duration(path.join(OUT, meta.file))) - (meta.trimStart ?? 0);
  const target = +Math.max(voiceLen + GAP, videoLen).toFixed(2);
  const video = await fitVideo(meta, target);

  const merged = path.join(WORK, `seg-${seg.id}.mp4`);
  await run("ffmpeg", [
    "-y", "-i", video, "-i", wav,
    // Тишина до конца кадра: -shortest иначе обрубит видео по концу речи.
    "-filter_complex", `[1:a]apad=whole_dur=${target}[a]`,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", merged,
  ]);
  parts.push(merged);
  total += target;
  console.log(`  ✓ seg-${seg.id}: ${target.toFixed(1)} c (${source === "say" ? "TTS-черновик" : "дорожка из voice/"})`);
}

const list = path.join(WORK, "concat.txt");
await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
const final = path.join(OUT, "firewatch-demo.mp4");
await run("ffmpeg", [
  "-y", "-f", "concat", "-safe", "0", "-i", list,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  // Приводим громкость к вещательному ориентиру: без этого дорожка тихая
  // в среднем при пиках у нуля, и на проекторе речь приходится выкручивать.
  "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
  "-c:a", "aac", "-b:a", "192k", final,
]);

const mm = Math.floor(total / 60);
const ss = Math.round(total % 60);
console.log(`\nГотово: ${final}`);
console.log(`Хронометраж: ${mm}:${String(ss).padStart(2, "0")}`);
if (usedSay) {
  console.log(
    "Озвучка черновая (macOS say). Для финала положи файлы ElevenLabs\n" +
    "в ops/demo/voice/seg-01.mp3 … seg-10.mp3 и перезапусти build.mjs.",
  );
}
