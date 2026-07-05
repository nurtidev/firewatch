---
name: deploy-railway
description: >
  Деплой FireWatch в прод на Railway (проект firewatch-app) — пошаговый процесс,
  ID сервисов, проверки после деплоя и известные грабли. Use when the user asks to
  deploy, release, ship to prod, задеплоить, выкатить, обновить прод, or when a
  change is merged to main and needs to go live. Triggers: "деплой", "задеплой",
  "выкати", "обнови прод", "deploy", "release".
---

# Деплой FireWatch на Railway

## Карта прода

Проект **firewatch-app** `6b9d2d3f-c985-425e-b687-2d611fee7a81`, env production `38249f55-08a2-4914-abc5-e5da5de300ad`.
(Старый проект firewatch.kz `44f5ece2…` — легаси, не трогать.)

| Сервис | ID | URL / доступ | root |
|---|---|---|---|
| web | `c7006fee-525b-4810-9884-eeab1205dbac` | https://www.firewatch.kz (+ web-production-08977.up.railway.app) | /web |
| api | `46f5c691-1ae7-44ac-9a57-3c4fe6eb1d0e` | https://api-production-2df09.up.railway.app | /api |
| ml | `71705889-9c3e-4bc3-924f-4803160a11ed` | только private network, PORT=8000 | /ml |
| postgis | `309efd4a-2ec2-466b-b766-4b2b12c19733` | internal postgis.railway.internal:5432; TCP proxy reseau.proxy.rlwy.net:36451 | image postgis:16-3.4 |

Volume **api-volume** `4157b3d5-2267-4dd1-9cea-7fffba7fc58a` смонтирован в `/app/uploads` на api — там живут загруженные ПТП-файлы.

## Процесс деплоя

1. **Push в main НЕ запускает билд** — auto-deploy выключен. Деплой всегда ручной, per-service.
2. Убедись, что коммит запушен в GitHub, затем один из способов:
   - CLI из корня репо: `railway up -s api --detach` (аналогично `-s web`, `-s ml`);
   - MCP: `mcp__railway__deployment_trigger(commitSha, serviceId, ...)` — деплоит указанный коммит.
3. Порядок при изменениях и api, и web: сначала **api** (миграции применятся), потом **web**.
4. ml деплоить только при изменениях в /ml: модель обучается на Docker build, quality gate валит билд при ROC-AUC < 0.78.

## Что происходит при деплое api

- `preDeployCommand` = `sh -c 'alembic upgrade head && (seed_hayvill||true) && (seed_extra_objects||true)'` —
  миграции + идемпотентные сиды структурных ПТП-карточек прогоняются при каждом деплое.
- После деплоя ml существующие `risk_scores` в БД НЕ пересчитываются сами — нужно вручную запустить
  `compute_risk` с доступом к прод-БД (изнутри api-контейнера или локально через TCP proxy).
- Прод-БД можно наполнять локальными скриптами, переопределив `DATABASE_URL` на TCP proxy.

## Проверка после деплоя (обязательно)

1. `deployment_status` / Railway dashboard — статус SUCCESS, healthcheck прошёл.
2. https://api-production-2df09.up.railway.app/health — 200.
3. https://www.firewatch.kz — логин работает (supervisor), карта рисков рендерится, /cards открывает карточку с 3D/«Схемы ДЧС».
4. Если менялись файловые эндпоинты — проверить, что PDF в карточке открывается (iframe с `?token=`).

## Грабли (все уже случались — не наступать повторно)

- **`startCommand` без `sh -c` = прод лежит.** Railway запускает команду без шелла: `${PORT}` остаётся
  литералом → crash-loop «'${PORT}' is not a valid integer». Всегда:
  `"startCommand": "sh -c 'uvicorn app.main:app --host 0.0.0.0 --port ${PORT}'"`. Эта регрессия уже
  возвращалась при рефакторинге railway.json — проверяй при любом его изменении.
- **Эфемерный FS.** Всё, что пишется вне volume (`/app/uploads`), стирается при редеплое. Новые
  директории для записи — только на volume.
- Public-сервисы биндятся на `0.0.0.0` (IPv4 healthcheck); ml биндится на `::` (IPv6 private) и без healthcheck.
- Next standalone требует `ENV HOSTNAME=0.0.0.0` в Dockerfile — иначе биндится на container id → 502.
- `NEXT_PUBLIC_API_URL` бейкается в билд web через Railway service variable — смена значения требует ребилда web.
- PostGIS volume требует `PGDATA=/var/lib/postgresql/data/pgdata` (lost+found блокирует initdb).
- Railway блокирует деплой при CVE в зависимостях — обновить пакет (так был bump next ^15.1.11).
- Секреты ставить через `railway variables --set-from-stdin` (не светить в чате/логах).
- JWT обязателен на всех api-эндпоинтах; файловые эндпоинты принимают токен и как `?token=` (для iframe/img).

## DNS / домены

- DNS хостится на **PS.kz** (не Cloudflare). www.firewatch.kz — CNAME на Railway, SSL авто (Let's Encrypt).
- Apex (firewatch.kz без www) — PS.kz не умеет apex-CNAME; ждёт редиректа apex→www или переезда DNS на Cloudflare.
- MCP `domain_create` отвергает apex («Invalid domain») — apex-домены добавлять через CLI: `railway domain <name> -s web`.
- CLI показывает TXT как `railway-verify=railway-verify=…` — это display bug, в DNS кладётся один префикс.
- CNAME-target регенерируется при delete+recreate домена; verify-hash стабилен per domain.
