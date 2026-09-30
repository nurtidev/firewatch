# 3D-проезд по Кокшетау (для презентации ДЧС Акмолинской области)

~42 с, 1080p, озвучка ElevenLabs + субтитры. Реальные здания OpenStreetMap с адресами и
этажностью (центр города, 2 636 зданий, 2 166 с адресом, 1 574 с этажностью в OSM),
реальная ПЧ-3 из OSM, маршрут по улицам — OSRM (3,4 км, ~5 мин), объект — ЖК «Капитал»,
ул. Сабатаева, 82 (9 этажей по OSM). Подложка — векторные тайлы OpenFreeMap.

**Гидранты — условные.** В OSM по Кокшетау гидранты не нанесены; в ролике это подписано.
На пилоте — реестр водоканала / ДЧС.

```sh
python3 ops/kokshetau/prepare.py                      # OSM API + OSRM + maplibre → данные
ELEVENLABS_API_KEY=... EL_OUT=ops/kokshetau/out/voice EL_SCRIPT_DIR=ops/kokshetau node ops/kokshetau/el_tts.mjs
# сведение реплик в out/voice.wav — см. тайминги CAPTIONS в index.html
node ops/kokshetau/render.mjs [--stills 8,16,38]      # → out/kokshetau-3d.mp4
```

Рендер покадровый (камера — функция времени `renderAt(t)`), тайлы OpenFreeMap кэшируются в
`out/tiles`. В песочнице WebGL идёт через swiftshader: обязательно `--disable-gpu-compositing`,
иначе скриншот кадра стоит ~2,5 с вместо ~0,1 с.
