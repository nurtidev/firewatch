# FireWatch — правила проекта

Платформа пожарной безопасности для ДЧС РК и акиматов (govtech, mission-critical).
Пилот: Астана. Прод: https://www.firewatch.kz (Railway). Архитектура и роадмап: `docs/ARCHITECTURE.md`.

## Структура монорепо

- `web/` — Next.js 15 + React 19 + Tailwind v4 (CSS-first, без tailwind.config и shadcn) + MapLibre GL + three.js
- `api/` — FastAPI: auth (JWT), buildings, cards (ПТП), chat, city, dispatch, forces, infra, routes, audit; Alembic-миграции
- `ml/` — FastAPI + XGBoost + SHAP (риск-модель; обучается на этапе Docker build, quality gate ROC-AUC ≥ 0.78)
- `db/init/` — init-скрипты PostGIS
- `docs/` — архитектура, `docs/commercial/` (КП, pricing, LOI), `docs/docs_tg/` (реальные ПТП ДЧС — исходники для Module 03)

## Запуск и проверка

- Локально: `cp .env.example .env` → `docker compose up --build`. Порты: web :3001, api :8001, ml :8002, db PostGIS.
- `NEXT_PUBLIC_*` инлайнится в build-time (Docker build ARG) — пустое значение ломает fetch в браузере.
- После правки `.env` — `docker compose up -d <svc>` (restart не перечитывает env); после правки кода api/ml — рестарт сервиса (uvicorn без --reload).
- Тесты: `api/tests/` и `ml/tests/` через pytest; db/e2e-тесты api идут только с `FW_RUN_DB_TESTS=1` + `DATABASE_URL` на PostGIS. У web тестов нет — `npm run build` как проверка типов. CI-эталон: `.github/workflows/ci.yml`.
- DB-тесты при `FW_RUN_DB_TESTS=1` отказываются работать с базой без «test» в имени (общий guard в `api/tests/conftest.py`, после инцидента со сносом демо-данных). В CI база — `firewatch_test`. Локально — только выделенная тестовая база, никогда dev.
- Сиды пользователей (локально): `docker compose exec api python -m scripts.seed_users`. Существующие пароли не перезаписываются без `--reset-demo-passwords`; **на проде `seed_users` не запускать никогда**.
- **Перед merge в main обязательно: `/verify` (скилл verify-firewatch) + `/code-review`.**

## Дизайн-система (жёсткие правила)

Основа: `web/src/app/globals.css` (`@theme`-токены), примитивы `web/src/components/ui/index.tsx`,
`web/src/lib/risk.ts`, `web/src/lib/cn.ts`. Тёмная тема — дефолт (`:root`), светлая — класс `.light`.

1. **Только токен-классы.** Никаких raw hex и палитр `neutral-*/red-*/orange-*` в JSX.
   Исключение: paint-слои карт и свотчи легенд — через `severity.cssVar` / `lib/mapStyle.ts`.
2. **Severity — единственный источник: `web/src/lib/risk.ts`** (`SEVERITY`, `scoreSeverity`, `scoreBand`).
   Бейдж, маркер карты и строка таблицы одного объекта обязаны резолвиться через него (цвет зданий на картах —
   ступенчатое выражение по порогам, не градиент).
   Пороги (≥60 critical, ≥40 high, ≥20 elevated) во фронте берутся только из `lib/risk.ts` (карты, фильтры `/city`);
   на бэкенде — `RISK_BANDS` (city.py выводит из него), плюс chat SCHEMA_DOC — при изменении синхронизировать фронт,
   `RISK_BANDS` и SCHEMA_DOC. Hex-цвета severity в `risk.ts` (для maplibre) сверяются с токенами `globals.css`
   скриптом в CI.
3. **Переиспользуй примитивы** из `components/ui/index.tsx` (Card, PageHeader, MetricCard, StatusChip,
   ScoreBadge, Button, Field, Tabs, EmptyState, …) — не пиши свои кнопки/карточки.
4. Цвет — никогда не единственный сигнал (пара: иконка/лейбл, иконки — lucide-react).
5. Класс `tabular` на всех числах. Всегда проектируй loading/empty/error/dense-состояния.
6. Обёртка страницы: `<div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">`. Responsive: desktop + tablet (AppShell sidebar → drawer < lg).
7. Новые цвета/размеры — сначала токен в `@theme`, потом использование.

## Роли, треки и доступ

Роли (`web/src/lib/auth.tsx`): `inspector | supervisor | leadership | admin | owner | dispatcher | responder | akimat`.

Продукт разложен на два ведущих трека (`track`/`section` в `web/src/lib/nav.ts`):
- **«Пожарные»** (ДЧС): *Реагирование* — `/dispatch`, `/callout`, `/cards`, `/forces`, `/vehicles`; *Профилактика* — `/dashboard` («Сводка ДЧС»), `/routes`, `/control`, `/reports`, `/map`, `/infra`.
- **«Город»** (акимат и руководство): `/city`, `/city/map`, `/city/priorities`, `/city/report`, `/chat`.
- **«Система»**: `/model`, `/audit`, `/users`. `/portal` — вне треков (owner).

Переключатель трека — только у ролей с ≥2 пунктами в обоих треках (leadership, admin). Новая страница: сразу прописать
`track`/`section`, `roles` (и `extraAccessRoles` для доступа без пункта меню) в `nav.ts`. Активный пункт, `trackOfPath`
и guard AppShell берут **самый длинный** совпавший href. Печатные страницы без AppShell guard'ом AppShell не защищены: `/city/report` проверяет роль через
`lib/useRoleGuard.ts`, `/callout/report` — пока только бэкендом (подключить тот же хук — follow-up).

Скоупинг:
- inspector/supervisor — свой район. Район здания — **реальные границы OSM** (таблица `districts`, миграция 0023, сид
  `seed_districts` в preDeploy; вне полигонов — ближайший район по geography). Район нового объекта (донесение, здание)
  считается по геометрии в момент записи (`api/app/districts.py::district_of`), не по району автора.
  `field_reports.district` и `operational_cards.district` — денормализованные копии, пересчитываются сидом.
- Район пользователя резолвится из БД на каждый запрос (как `station` у responder), а не из JWT.
- leadership/admin/dispatcher/responder — весь город (`CITYWIDE_ROLES` в `api/app/access.py`).
- **akimat** — только чтение городских агрегатов и зданий: `CITY_READ_ROLES` + флаг `allow_city_read` в
  `enforce_building_scope` (передаёт только `buildings.py`). Без ПДн, донесений, карточек ПТП, чата, аудита, записи.
  **Не добавлять akimat в `CITYWIDE_ROLES`** — вместе с ним откроются донесения с фото. `api/tests/test_guards.py`
  обходит все маршруты OpenAPI: новый эндпоинт, открытый акимату, валит тест.

Тестовые пользователи (из seed_users): `inspector/inspector123` и `supervisor/supervisor123` (оба Есильский),
`minister/minister123` (leadership), `admin/admin123`, `owner/owner123`, `dispatcher/dispatcher123`,
`responder/responder123`, `akimat/akimat123`. На проде учётки — через «Пользователи» с не-демо паролем,
перенос района — точечным SQL + `/auth/revoke`. Часть responder (`users.station_id`) назначается и
переносится там же, на «Пользователи» (`PATCH /auth/users/{username}/station`) — SQL для этого не нужен.
JWT в localStorage (`fw_token`); для `<img>/<iframe>` токен передаётся как `?token=` через `apiSrc()` — не забывать при новых файловых эндпоинтах.

## Покрытие, городской трек, формулировки

- Слепые зоны и `coverage_source` (`osrm | buffer | mixed` + `approximate`) — единственный источник `api/app/coverage.py`,
  общий для `/infra/*` и `/city/*`. При сбое пересчёта изохрону части **не удалять** (круг завышает покрытие — ошибка в
  опасную сторону): она остаётся «устаревшей»; при недоступном OSRM пересчёт не трогает данные.
- `/city/*` — только агрегаты; `demo_data`, `method` и оговорки данных (мало частей в сидах) показываются, не прячутся.
  Время прибытия: `median_response_min` (регистрация → прибытие, сравнимо с нормативом) и `median_travel_min` (выезд → прибытие) — не путать.
- Терминология: слой риска — **«объяснимая оценка уязвимости»**, не «прогноз» и не «предиктивная модель» (до получения
  реальной истории пожаров от ДЧС). Касается лендинга, метаданных `layout.tsx`, питчей.
- Атрибуция «© OpenStreetMap contributors» (ODbL) обязательна на картах с районами и в городском отчёте.

## Module 03 (оцифровка ПТП) и forces

- Извлечение: `api/app/extraction.py` (Claude structured output, схема `EXTRACT_TOOL`), роутер `api/app/routers/cards.py`.
- PDF > 20 МБ пересжимается PyMuPDF (`_shrink_pdf_if_needed`, DPI 150→72) — лимит Anthropic API 32 МБ с учётом base64.
- Телефоны маскируются (`_mask_contacts`) промптом И бэкендом — не ослаблять (ПДн).
- Структурные карточки (3D + «Схемы ДЧС») создаются сидами `seed_hayvill`/`seed_extra_objects`; загруженный PDF даёт «плоскую» карточку без 3D.
- `api/app/routers/forces.py` — расчёт сил и средств по методике ДЧС; эталон — «Есеп Евразия» (`docs/docs_tg/`): Qз=Sо·Jтр/4, qРС-50=3.7. Изменения forces.py сверять с этим документом.
- Справочник по ПТП/КТП: `docs/docs_tg/PTP_KTP_reference.md`.

## Деплой (Railway)

Полный процесс и грабли — скилл `deploy-railway` (`.claude/skills/deploy-railway/SKILL.md`). Главное:
- **Push в main НЕ деплоит.** Деплой вручную: `railway up -s <api|ml|web> --detach` или MCP `deployment_trigger(commitSha)` per service.
- `startCommand` в railway.json всегда через `sh -c '... ${PORT}'` — без shell `${PORT}` остаётся литералом и сервис крашится.
- api самомигрирующийся (preDeploy: alembic → `seed_districts` → идемпотентные сиды); uploads живут на volume `api-volume` (эфемерный FS стирается при деплое).
- Изменения офлайн-синхронизации расстановки (`/dispatch/{id}/deployment/sync`, `deploymentQueue.ts`, `sw.js`): **сначала api, потом web** — старый API отвечает 422 на новые батчи, а 422 в очереди окончательный.
- Service Worker: кэш данных `fw-api` без версии (обновление SW не стирает офлайн-пакеты), версионируются precache, статика и страницы (оболочки ссылаются на чанки своей сборки).

## Конвенции

- Коммиты: Conventional Commits на русском — `feat(web): …`, `fix(api): …`, `docs(commercial): …`.
- Ветки: `feat/<slug>`; после merge в main ветки удаляются (local + remote).
- Данные в `docs/docs_tg/` — реальные документы ДЧС с ПДн (телефоны, ФИО): не публиковать наружу, не вставлять в публичные артефакты.
