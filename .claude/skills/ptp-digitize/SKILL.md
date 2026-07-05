---
name: ptp-digitize
description: >
  Оцифровка нового ПТП (плана тушения пожара) в структурную карточку FireWatch —
  как сделано для Хайвилл/Аланда/Евразия: seed-JSON, привязка к зданию, схемы
  .vsd→PNG, 2D/3D, проверка. Use when the user wants to add a new object/building
  operational card, digitize a ПТП/оперплан document, add schemes or floor plans
  for an object. Triggers: "оцифруй ПТП", "добавь объект", "новая карточка",
  "новый оперплан", "digitize", "add operational card".
---

# Оцифровка ПТП в FireWatch

## Два пути — не путать

1. **Плоская карточка (AI)**: пользователь грузит PDF/скан через `POST /cards` →
   `api/app/extraction.py` (Claude, structured output `EXTRACT_TOOL`) → плоские поля +
   prescriptions. Быстро, но БЕЗ 3D, без «Схем ДЧС», без поэтажных планов.
2. **Структурная карточка (ручная оцифровка)**: seed-JSON → сид-скрипт → полный UI
   (`StructuredPlanView`: этажи, 3D-башня, схемы, расчёт сил). Хайвилл/Аланда/Евразия сделаны так.
   Гейт в UI: `isStructured()` в `web/src/app/cards/page.tsx` — карточка структурная, если
   в extracted есть `object` или `floor_plans`.

Этот скилл — про путь 2. Дальше — пошагово для нового объекта `<slug>`.

## Шаг 1. Исходники

Положить документы объекта в `docs/docs_tg/` (ПТП-текстовка .docx, схемы .vsd, поэтажные
планы .pdf). **Это реальные документы ДЧС с ПДн** — телефоны/ФИО не копировать в публичные
артефакты; в seed-JSON телефоны либо маскировать, либо помнить, что contacts маскируются
только на AI-пути (`_mask_contacts`), сид-путь кладёт как есть.
Справочник по структуре ПТП/КТП: `docs/docs_tg/PTP_KTP_reference.md`.

## Шаг 2. Seed-JSON → `api/scripts/seed_data/<slug>.json`

Образцы: `hayvill.json` (максимальный), `alanda.json`/`evraziya.json` (минимальный достаточный).
Ключи: `object` (название, адрес, категория, степень огнестойкости, blocks, structure),
`response` (ближайшая ПЧ, расстояние, маршрут, время прибытия, ранг), `contacts`,
`water_sources` ({type, note, distance_m} — из них сеятся гидранты), `floor_plans`
({floor, source_file, total_area_m2, rooms:[{name, area_m2, type}]}), `force_calc`
(расчёт из первоисточника, справочный — программно НЕ пересчитывается).

Правила:
- Типы комнат брать из `ROOM_TYPE_META` (`web/src/lib/floorplan.ts`): эвакуация/лифт/тех/
  санузел/жилое/коридор/паркинг/… — от них цвета treemap.
- Если атрибуция документа сомнительна (как «Есеп Евразия» ↔ корпус 2 vs 3) — писать
  честное поле `_provenance` с предупреждением. Не выдумывать данные.
- Числа (площади, расстояния) — только из документа; чего нет — `null`, не оценка.

## Шаг 3. Привязка к зданию → `api/scripts/seed_extra_objects.py`

Добавить запись в список `OBJECTS`: json-файл, `filename` карточки, `address_patterns`
(несколько ILIKE-вариантов написания адреса), свой `hydrant_base` — уникальный сентинел,
не пересекающийся с занятыми (-9000 Хайвилл, -9100/-9200 Аланда/Евразия → новый -9300).
Логика поиска: сначала по address_patterns, фолбэк — самое высокое residential-здание без
карточки. Скрипт идемпотентен (DELETE by filename + INSERT; гидранты ON CONFLICT DO UPDATE) —
безопасно гонять повторно; на проде он уже в `preDeployCommand` api.

## Шаг 4. Схемы .vsd → PNG (если есть .vsd)

Зависимости (разово): `brew install libvisio` (бинарь `vsd2xhtml`), `@resvg/resvg-js` уже в
devDeps web. **qlmanage не использовать** — виснет на тяжёлых страницах.

1. В `web/scripts/build-schemes.mjs` добавить объект в `OBJECTS` ({group: "файл.vsd"}).
2. `cd web && node scripts/build-schemes.mjs` → PNG @2200px в `web/public/schemes/<slug>/<group>/pNN.png` (PNG коммитятся в репо).
3. Зарегистрировать в манифесте `web/src/data/schemes.ts` (`OBJECT_SCHEMES`, хелпер `pages()`),
   и **добавить regex-ветку в `schemesForObject()`** — матчинг по названию объекта из карточки.
4. Не приписывать объекту смешанные файлы ПЧ: `схемы (1).vsd` — сборник разных объектов,
   такие исключать (прецедент Хайвилла).

## Шаг 5. 2D/3D

- Ничего делать не нужно: из `floor_plans[].rooms` автоматически строится schematic treemap
  (FloorPlan2D) и 3D-башня из плит (Building3D).
- Реальная полигональная геометрия — опциональный апгрейд, сейчас есть только у Хайвилла
  (`web/src/data/floorplans/hayvill.ts`); для нового объекта потребуется свой файл геометрии
  и расширение `web/src/lib/realgeom.ts` (он жёстко завязан на Хайвилл — `isRealGeomObject`).

## Шаг 6. Проверка (локально)

```bash
docker compose exec api python -m scripts.seed_extra_objects
docker compose exec api python -m scripts.compute_risk
```
Затем по скиллу `verify-firewatch`: под supervisor открыть /cards → у нового объекта видны
поэтажные планы, 3D, таб «Схемы ДЧС» (если делал шаг 4), расчёт сил; карточка привязана к
ПРАВИЛЬНОМУ зданию на карте (проверить адрес — фолбэк «самое высокое здание» может промахнуться).

## Шаг 7. Деплой

По скиллу `deploy-railway`. Заметки: сиды прогонятся сами через preDeployCommand api;
PNG схем уезжают с деплоем **web** — деплоить оба сервиса.

## Валидация методики forces (смежное)

`api/app/routers/forces.py` — самостоятельный калькулятор, программно с карточками НЕ связан.
Ground truth методики — документ «Есеп Евразия» (`docs/docs_tg/`): T1св=10.5, Тр.с.с=0.035·Lp,
Qз=Sо·Jтр/4 (def_intensity_ratio=0.25), qРС-50=3.7; воспроизводимый пример: Qф 11.1,
2+1 ствола, 1 АЦ, 16 л/с, ранг №2. Любую правку forces.py сверять с этим примером
(автотеста нет — прогнать POST /forces/calc руками).

## Definition of done

- [ ] seed-JSON собран только из документов, сомнения — в `_provenance`.
- [ ] Запись в `seed_extra_objects.py` с уникальным `hydrant_base`; сид прогнан дважды (идемпотентность).
- [ ] Карточка структурная (3D + планы видны), привязана к правильному зданию.
- [ ] Схемы: PNG в репо, манифест + regex в `schemesForObject()` обновлены.
- [ ] ПДн: телефоны не светятся в публичных местах, docs_tg не уходит наружу.
