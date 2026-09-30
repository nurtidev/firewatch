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

## Ролик «Выезд: сейчас и с FireWatch» (film.html, ~2,5 мин)

Один вызов (ул. Сабатаева, 82, пожар на 5 этаже) дважды: «как сейчас» — папка в части,
караул едет вслепую, разведка и поиск гидранта; «с FireWatch» — пульт ЦОУ, боевой пакет,
гидранты на углах квартала, расстановка: АЦ-40 №1 на ПГ-1 → магистраль 77 мм → РТ-70 →
звено ГДЗС со стволом на 5 этаж и на защиту 6-го; АЛ-30 напротив окон; АЦ-40 №2 на ПГ-2
→ ствол с АЛ; штаб; ход тушения и донесение. Затем картина города для руководства
(этажность, время доезда по OSRM — `drive_s` в buildings.geojson, без пробок).

Тактика, время на часах и размещение гидрантов — иллюстрация; схему расстановки
перед показом стоит проверить с РТП. Гидранты размещены по нормам: вдоль дороги,
≤2,5 м от края проезжей части, не ближе 5 м от стен, у перекрёстков.

```sh
ELEVENLABS_API_KEY=... EL_SCRIPT=ops/kokshetau/film.json EL_OUT=ops/kokshetau/out/film-voice node ops/kokshetau/el_tts.mjs
# обрезка тишины → out/film-voice/trim/*.wav и out/film-voice/durations.json (см. историю сессии / скрипт в README pitch)
node ops/kokshetau/render.mjs --page film.html        # → out/film.mp4
```
