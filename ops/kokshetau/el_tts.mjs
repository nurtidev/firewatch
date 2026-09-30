/**
 * Озвучка ролика через ElevenLabs: out/voice/<id>.mp3 по voiceover.json.
 * Голос по умолчанию — Brian (тот же, что в ops/demo), модель eleven_multilingual_v2.
 * Ключ только из окружения:  ELEVENLABS_API_KEY=... node ops/pitch/el_tts.mjs [id ...]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error("нужен ELEVENLABS_API_KEY"); process.exit(1); }
const VOICE = process.env.EL_VOICE ?? "nPczCjzI2devNBz1zQrb";
const OUT = process.env.EL_OUT ?? path.join(DIR, "out", "voice");
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2);
const script = JSON.parse(readFileSync(path.join(process.env.EL_SCRIPT_DIR ?? DIR, "voiceover.json"), "utf8"));
for (const s of script.filter((x) => !only.length || only.includes(x.id))) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({
      text: s.tts ?? s.text,
      model_id: "eleven_multilingual_v2",
      // докладной тон: выше стабильность, без «актёрской» стилизации
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 1.05 },
    }),
  });
  if (!res.ok) { console.error(s.id, res.status, (await res.text()).slice(0, 300)); process.exit(1); }
  writeFileSync(path.join(OUT, `${s.id}.mp3`), Buffer.from(await res.arrayBuffer()));
  console.log("ok", s.id);
}
