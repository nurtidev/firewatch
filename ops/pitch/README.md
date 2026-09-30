# Моушн-ролик FireWatch для руководства ДЧС

~85 с, 1920×1080, русский, озвучка + субтитры. Сцены: вызов → проблема → реагирование →
расстановка → оцифровка ПТП → профилактика → покрытие → пилот → финал.

Это не запись экрана продукта (для неё — `ops/demo/`), а моушн-графика в стиле продукта:
токены и шрифты из `web/src/app/globals.css`, пороги severity — как в `web/src/lib/risk.ts`.
Город, планировка этажа, расчёт сил и телефон на кадрах — условные, не реальные данные.

## Сборка

```sh
pip install edge-tts imageio-ffmpeg
# озвучка: по клипу на сцену в out/voice/<id>.mp3 (голос ru-RU-DmitryNeural)
cd ops/pitch && python3 -c "import json,subprocess;[subprocess.run(['python3','tts.py','ru-RU-DmitryNeural',s.get('tts',s['text']),f'out/voice/{s[\"id\"]}.mp3','+12%'],check=True) for s in json.load(open('voiceover.json'))]"
cd ../.. && node ops/pitch/render.mjs          # → ops/pitch/out/firewatch-dchs.mp4
node ops/pitch/render.mjs --stills scenes      # только контрольные кадры
```

- Текст диктора и субтитров — `voiceover.json` (`text` — субтитры, `tts` — как читать числа).
  Длина сцены = длина её озвучки, тайминги пересчитываются сами.
- Студийный голос (так собран текущий ролик): `ELEVENLABS_API_KEY=... node ops/pitch/el_tts.mjs [id ...]` —
  голос Brian, как в `ops/demo`, модель `eleven_multilingual_v2`; затем `rm -rf ops/pitch/out/voice/trim` и `render.mjs`.
  Бесплатный тариф ElevenLabs не даёт коммерческих прав — для показа заказчику нужен платный.
- Превью в браузере: открыть `index.html?play` или `index.html?t=30`.
- Шрифты Inter и JetBrains Mono — SIL OFL 1.1.
