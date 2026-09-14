/**
 * Озвучка сегментов сценария нейросетевым TTS (Piper, локально, без ключей и
 * без отправки текста наружу).
 *
 * Почему не системный `say`: он даёт разборчивый, но явно синтетический голос —
 * для показа заказчику это слышно сразу. Piper заметно ближе к диктору, при
 * этом работает офлайн, поэтому не требует ни ключа, ни оплаты, ни выгрузки
 * текста в чужой сервис.
 *
 * Результат кладётся в ops/demo/voice/seg-NN.wav — build.mjs подхватывает эти
 * файлы автоматически, вместо чернового `say`.
 *
 * Запуск:  node ops/demo/voiceover.mjs [--voice ruslan|dmitri] [--sample]
 *   --sample  озвучить только один абзац каждым голосом (для выбора голоса)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

/* Пути к движку и моделям задаются переменными окружения: голоса весят ~60 МБ
   каждый и в репозитории им не место. Установка — см. docs/demo_video_script.md. */
const PIPER = process.env.FW_PIPER ?? "piper";
const VOICES_DIR = process.env.FW_PIPER_VOICES ?? "";
const ESPEAK_DATA = process.env.FW_ESPEAK_DATA ?? "/opt/homebrew/share/espeak-ng-data";

const OUT = path.resolve("ops/demo/voice");
const SAMPLES = path.join(OUT, "samples");

const args = process.argv.slice(2);
const sampleMode = args.includes("--sample");
const voiceArg = args[args.indexOf("--voice") + 1];
const VOICE = args.includes("--voice") && voiceArg ? voiceArg : "ruslan";

/* Темп и паузы. length-scale > 1 растягивает фонемы: 1.08 даёт спокойную
   докладную подачу вместо новостной скороговорки. sentence-silence держит
   паузу между фразами, чтобы зритель успевал прочитать экран. */
const LENGTH_SCALE = process.env.FW_TTS_LENGTH ?? "1.08";
const SENTENCE_SILENCE = process.env.FW_TTS_SILENCE ?? "0.45";

const model = (v) => (VOICES_DIR ? path.join(VOICES_DIR, `${v}.onnx`) : `${v}.onnx`);

async function speak(text, outFile, voice) {
  // Текст подаём файлом через -i, а не в stdin: execFile не умеет опцию input,
  // и piper молча висит в ожидании ввода, пока не убьёшь процесс.
  const txt = `${outFile}.txt`;
  await writeFile(txt, text, "utf8");
  try {
    await run(
      PIPER,
      ["-m", model(voice), "-i", txt, "-f", outFile,
        "--length-scale", LENGTH_SCALE,
        "--sentence-silence", SENTENCE_SILENCE],
      { env: { ...process.env, ESPEAK_DATA_PATH: ESPEAK_DATA } },
    );
  } finally {
    await rm(txt, { force: true });
  }
}

async function duration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(stdout.trim());
}

const segments = JSON.parse(await readFile("ops/demo/voiceover.json", "utf8"));

if (sampleMode) {
  // Один и тот же абзац каждым голосом: выбирать голос имеет смысл только на слух.
  await mkdir(SAMPLES, { recursive: true });
  const demo = segments.find((s) => s.id === "06") ?? segments[0];
  for (const voice of ["ruslan", "dmitri"]) {
    const file = path.join(SAMPLES, `${voice}.wav`);
    await speak(demo.text, file, voice);
    console.log(`  ✓ ${voice}: ${(await duration(file)).toFixed(1)} c → voice/samples/${voice}.wav`);
  }
  console.log("\nПослушай оба и выбери:  node ops/demo/voiceover.mjs --voice <имя>");
} else {
  await mkdir(OUT, { recursive: true });
  // Номера сегментов в аргументах — озвучить только их: правка одной формулировки
  // не должна стоить полного прогона движка по всем десяти.
  const only = args.filter((a) => /^\d{2}$/.test(a));
  const todo = only.length ? segments.filter((s) => only.includes(s.id)) : segments;
  let total = 0;
  for (const seg of todo) {
    const file = path.join(OUT, `seg-${seg.id}.wav`);
    // `tts` — произносимый вариант: движок читает латиницу побуквенно и
    // по-английски («FireWatch» → «фире-ватч»), поэтому в него идёт кириллическая
    // транскрипция, а `text` остаётся каноничным для документа и живого диктора.
    await speak(seg.tts ?? seg.text, file, VOICE);
    const d = await duration(file);
    total += d;
    console.log(`  ✓ seg-${seg.id}: ${d.toFixed(1)} c`);
  }
  const words = todo.reduce((n, s) => n + (s.tts ?? s.text).split(/\s+/).length, 0);
  console.log(
    `\nГолос: ${VOICE}. Озвучено ${todo.length} сегментов, ` +
    `${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")} ` +
    `речи (${Math.round((words / total) * 60)} слов/мин).`,
  );
  console.log("Дальше:  node ops/demo/build.mjs");
}
