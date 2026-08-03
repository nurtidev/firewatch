---
name: verify-firewatch
description: >
  Поднять FireWatch локально и прогнать смоук-проверку end-to-end: docker compose,
  сиды, ключевые страницы под нужными ролями, pytest. Use before merging any branch
  to main, after nontrivial changes to web/api/ml, or when the user asks to verify,
  check, test the app, проверить что работает. Triggers: "проверь", "verify",
  "смоук", "прогони проверку", "работает ли", "перед мержем".
---

# Верификация FireWatch

Цель: убедиться, что изменение работает в реальном приложении, а не только компилируется.
Прогоняй затронутые изменением пункты; перед merge в main — полный смоук (раздел 3).

## 1. Поднять стек

```bash
cd /Users/nurtilek/Desktop/firewatch
docker compose up --build -d
```

Порты: **web http://localhost:3001** (README пишет 3000 — неверно, compose мапит 3001:3000),
api http://localhost:8001, ml http://localhost:8002, db :5432 (PostGIS).
`.env` в корне уже заполнен (включая ANTHROPIC_API_KEY) — ничего копировать не нужно.

Грабли запуска:
- Правка кода api/ml → рестарт сервиса (`docker compose restart api`) — uvicorn без --reload.
- Правка `.env` → `docker compose up -d <svc>` (restart не перечитывает env).
- Правка `NEXT_PUBLIC_*` → **ребилд web** (`docker compose up --build -d web`) — инлайнится в билд.
- `npm run dev` вне докера: корневой `.env` не подхватывается; дефолт API-URL в коде — :8001, обычно хватает.
- Не выставлять `FW_ENV=production` локально — включит fail-fast на dev-секретах.

## 2. База: миграции и сиды (для свежей/пустой БД)

Порядок важен: последние ищут здания, засеянные первыми, а `seed_ops` связывает
реестр инспекторов с учётными записями (`inspectors.user_id`) — поэтому
`seed_users` идёт до него. Если порядок нарушен, `seed_ops` досвяжет связь при
повторном прогоне.

```bash
docker compose exec api python -m scripts.init_db          # alembic upgrade head
docker compose exec api python -m scripts.import_osm       # здания (Overpass, нужен интернет)
docker compose exec api python -m scripts.import_infra     # ПЧ + гидранты (НЕ идемпотентен, см. ниже)
docker compose exec api python -m scripts.seed_users       # демо-пользователи
docker compose exec api python -m scripts.seed_ops         # районы, инспекции, связь с учётками
docker compose exec api python -m scripts.compute_risk     # риск-скоры (дергает ml)
docker compose exec api python -m scripts.seed_hayvill     # ПТП Хайвилл + предписания и заявка owner
docker compose exec api python -m scripts.seed_extra_objects  # Аланда, Евразия
docker compose exec api python -m scripts.seed_field_reports  # донесения по районам
```

> **Никогда не запускай `FW_RUN_DB_TESTS=1 pytest` на общей dev-базе.** Фикстура
> `test_db_integration` чистит `buildings` и всё, что на неё ссылается. Однажды
> такой прогон снёс демо-данные целиком. Сейчас стоит защита: тесты
> пропускаются, если в имени базы нет «test». Правильный способ:
> ```bash
> docker compose exec -T db psql -U firewatch -d postgres -c "create database fw_test;"
> docker compose exec -T db psql -U firewatch -d fw_test -c "create extension postgis;"
> docker compose exec -T -e FW_RUN_DB_TESTS=1 \
>   -e DATABASE_URL=postgresql+psycopg://firewatch:firewatch@db:5432/fw_test \
>   api python -m pytest -q
> ```

> `import_infra` синтезирует гидранты с `osm_id = NULL`, а защита от дублей —
> `ON CONFLICT (osm_id)`, которая для NULL не срабатывает: каждый повторный
> прогон добавляет ещё ~1128 гидрантов и портит метрики инфраструктуры. Перед
> повторным запуском чистить таблицу (`DELETE FROM hydrants`) и после — заново
> прогонять `seed_hayvill`/`seed_extra_objects`, которые создают объектные
> гидранты.

Демо-учётки: `inspector/inspector123` (район Сарыаркинский), `supervisor/supervisor123` (Есильский),
`minister/minister123` (leadership, весь город), `admin/admin123`.

## 3. Смоук-чек-лист (браузер)

Health first: `curl -s localhost:8001/health` и `curl -s localhost:8002/health` — оба 200.

| Страница | Под кем | Что считается «работает» |
|---|---|---|
| `/` , `/gov`, `/business` | без логина | лендинги рендерятся: hero c 3D-планом, мини-карта риска на /gov, FloorPlan2D на /business |
| `/login` | — | логин supervisor → редирект на /dashboard; inspector → на /routes |
| `/dashboard` | supervisor | метрики из /overview не пустые; цифры отличаются от admin (district-скоуп работает) |
| `/map` | любая роль | карта MapLibre рендерится, маркеры окрашены по severity, фильтры и легенда работают; демо-баннер НЕ показан (значит данные из API, не фолбэк) |
| `/cards` | supervisor | список карточек; у Хайвилл/Аланда/Евразия есть 3D-башня и таб «Схемы ДЧС»; PDF в карточке открывается (iframe с ?token=) |
| `/routes` | inspector | план на день, чек-лист визита отмечается |
| `/control` | supervisor | прогресс маршрутов виден. Под inspector — 403 + EmptyState «Доступ ограничен» (это НОРМА, не баг) |
| `/forces` | supervisor | пресет считает: для Евразии сходится с эталоном (Qф 11.1, 2+1 ствола, ранг №2) |
| `/chat`, `/model`, `/audit` | по ролям nav.ts | отвечает/рендерится; chat требует ANTHROPIC_API_KEY |

Ролевой инвариант: бейдж риска, маркер карты и строка таблицы одного объекта показывают
одинаковый severity (единый источник `web/src/lib/risk.ts`).

## 4. Тесты

```bash
# api: unit всегда; db/e2e — под гейтом
cd api && FW_RUN_DB_TESTS=1 \
  DATABASE_URL=postgresql+psycopg://firewatch:firewatch@localhost:5432/firewatch pytest -q
cd ml && pytest -q
cd web && npm run build     # у web нет тестов — build ловит типы
```

CI-эталон: `.github/workflows/ci.yml` (там же roundtrip-проверка миграций
`alembic upgrade head && downgrade base && upgrade head` — гоняй при изменении миграций).

## 5. Definition of done

- [ ] Затронутые страницы проверены в браузере под правильной ролью (не только admin).
- [ ] /health api и ml — 200.
- [ ] pytest api (с FW_RUN_DB_TESTS=1 если трогал БД) и `npm run build` — зелёные.
- [ ] Ролевой гейтинг: под inspector закрытые страницы дают аккуратный 403-UI, не белый экран.
- [ ] В отчёте пользователю — что реально прогнал и что увидел, без «должно работать».
