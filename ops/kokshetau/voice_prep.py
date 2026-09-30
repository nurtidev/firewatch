"""Обрезка тишины в репликах ролика и таблица длительностей (ведущая дорожка — звук).

    python3 ops/kokshetau/voice_prep.py [film.json] [out/film-voice]
Вход: <dir>/<id>.mp3 (el_tts.mjs). Выход: <dir>/trim/<id>.wav, <dir>/durations.json.
"""
import json, re, subprocess, sys
from pathlib import Path

import imageio_ffmpeg

DIR = Path(__file__).parent
script = json.loads((DIR / (sys.argv[1] if len(sys.argv) > 1 else "film.json")).read_text())
vdir = DIR / (sys.argv[2] if len(sys.argv) > 2 else "out/film-voice")
(vdir / "trim").mkdir(parents=True, exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse")
dur = {}
for s in script:
    dst = vdir / "trim" / f"{s['id']}.wav"
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", str(vdir / f"{s['id']}.mp3"), "-af", TRIM,
                    "-ar", "48000", "-ac", "2", str(dst)], check=True)
    err = subprocess.run([FF, "-i", str(dst)], capture_output=True, text=True).stderr
    m, sec = re.search(r"Duration: \d+:(\d+):([\d.]+)", err).groups()
    dur[s["id"]] = round(float(m) * 60 + float(sec), 3)
(vdir / "durations.json").write_text(json.dumps(dur, indent=1))
print(dur, "итого речи:", round(sum(dur.values()), 1), "с")
