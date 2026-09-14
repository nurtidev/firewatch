/**
 * Озвучка сегментов через ElevenLabs — альтернатива локальному Piper
 * (ops/demo/voiceover.mjs), когда нужна живая интонация.
 *
 * Кладёт seg-NN.mp3 в ops/demo/voice/, откуда их забирает build.mjs. Файлы Piper
 * (.wav) при этом не удаляются: build.mjs предпочитает .mp3, так что вернуться
 * к прежней дорожке можно, просто убрав mp3.
 *
 * ВАЖНО про бесплатный план: он не даёт коммерческих прав и требует атрибуции
 * ElevenLabs в публикуемом контенте. Годится, чтобы оценить качество на слух;
 * для показа заказчику и конкурсных заявок нужен платный тариф.
 *
 * Ключ: https://elevenlabs.io → Profile → API Keys
 *   export ELEVENLABS_API_KEY=...
 *
 * Запуск:
 *   node ops/demo/voiceover-11labs.mjs --list           список голосов аккаунта
 *   node ops/demo/voiceover-11labs.mjs --sample         один сегмент (проба голоса)
 *   node ops/demo/voiceover-11labs.mjs --voice George   озвучить всё выбранным голосом
 *   node ops/demo/voiceover-11labs.mjs 03 07            только эти сегменты
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API = "https://api.elevenlabs.io/v1";
const KEY = process.env.ELEVENLABS_API_KEY ?? "";
const OUT = path.resolve("ops/demo/voice");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, dflt) => (has(f) ? args[args.indexOf(f) + 1] : dflt);

/* multilingual_v2 — модель с поддержкой русского. Голоса из англоязычной
   пресет-библиотеки читают по-русски с акцентом, поэтому голос лучше выбрать
   из Voice Library (там есть носители) и добавить в аккаунт: он появится в --list. */
const MODEL = opt("--model", "eleven_multilingual_v2");
const VOICE = opt("--voice", "");
const FORMAT = opt("--format", "mp3_44100_128");

/* Настройки подачи: чуть выше стабильность, чем дефолт, — для докладного тона
   без актёрских перепадов; style=0 не добавляет отсебятины в интонацию. */
const VOICE_SETTINGS = {
  stability: Number(opt("--stability", 0.55)),
  similarity_boost: Number(opt("--similarity", 0.8)),
  style: 0,
  use_speaker_boost: true,
  speed: Number(opt("--speed", 1)),
};

if (!KEY) {
  console.error(
    "Нет ключа. Заведи бесплатный аккаунт на elevenlabs.io, скопируй ключ\n" +
    "(Profile → API Keys) и выполни:\n\n  export ELEVENLABS_API_KEY=...\n",
  );
  process.exit(1);
}

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { "xi-api-key": KEY, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    let hint = "";
    if (res.status === 401) hint = " — ключ неверный или отозван";
    if (res.status === 429) hint = " — исчерпан месячный лимит символов";
    throw new Error(`${res.status} ${pathname}${hint}\n${body.slice(0, 300)}`);
  }
  return res;
}

async function voices() {
  const { voices: list } = await (await api("/voices")).json();
  return list;
}

/** Голос по имени или id; без параметра — первый мужской в аккаунте.
 *
 *  Ключ может быть выпущен без права `voices_read` (права выбираются при
 *  создании) — тогда каталог недоступен, но синтез работает. В этом случае
 *  --voice принимается как готовый voice_id и запрос к /voices пропускается. */
async function resolveVoice() {
  let list;
  try {
    list = await voices();
  } catch (e) {
    if (VOICE && /missing_permissions|401/.test(e.message)) {
      console.warn("  ⚠ каталог голосов недоступен (ключ без voices_read) — беру --voice как id\n");
      return { name: VOICE, voice_id: VOICE };
    }
    throw e;
  }
  if (VOICE) {
    const found = list.find(
      (v) => v.voice_id === VOICE || v.name.toLowerCase() === VOICE.toLowerCase(),
    );
    if (!found) throw new Error(`Голос "${VOICE}" не найден. Список: --list`);
    return found;
  }
  const male = list.find((v) => (v.labels?.gender ?? "").toLowerCase() === "male");
  if (!male) throw new Error("В аккаунте нет мужских голосов — укажи --voice");
  return male;
}

async function speak(text, voiceId, outFile) {
  const res = await api(
    `/text-to-speech/${voiceId}?output_format=${FORMAT}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: VOICE_SETTINGS }),
    },
  );
  await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
}

const segments = JSON.parse(await readFile("ops/demo/voiceover.json", "utf8"));
// Озвучиваем произносимый вариант — тот же, что и в Piper-скрипте.
const say = (s) => s.tts ?? s.text;

if (has("--list")) {
  const list = await voices();
  console.log(`Голосов в аккаунте: ${list.length}\n`);
  for (const v of list) {
    const l = v.labels ?? {};
    const tags = [l.gender, l.accent, l.age, l.use_case].filter(Boolean).join(" · ");
    console.log(`  ${v.name.padEnd(18)} ${v.voice_id}  ${tags}`);
  }
  console.log(
    "\nРусскоязычные носители — в Voice Library на сайте: добавь голос в аккаунт,\n" +
    "и он появится здесь. Пресет-голоса читают по-русски с акцентом.",
  );
  process.exit(0);
}

const voice = await resolveVoice();
const only = args.filter((a) => /^\d{2}$/.test(a));
const todo = has("--sample")
  ? [segments.find((s) => s.id === "06") ?? segments[0]]
  : only.length
    ? segments.filter((s) => only.includes(s.id))
    : segments;

const chars = todo.reduce((n, s) => n + say(s).length, 0);
console.log(`Голос: ${voice.name} (${voice.voice_id}), модель ${MODEL}`);
console.log(`Сегментов: ${todo.length}, символов: ${chars} (бесплатный лимит — 10 000/мес)\n`);

await mkdir(OUT, { recursive: true });
for (const seg of todo) {
  const file = path.join(OUT, has("--sample") ? "samples/11labs.mp3" : `seg-${seg.id}.mp3`);
  await mkdir(path.dirname(file), { recursive: true });
  await speak(say(seg), voice.voice_id, file);
  console.log(`  ✓ ${path.basename(file)} (${say(seg).length} симв.)`);
}

console.log(
  has("--sample")
    ? "\nПроба: voice/samples/11labs.mp3 — сравни с voice/samples/dmitri.wav"
    : "\nДальше:  node ops/demo/build.mjs",
);
