# FireWatch — правила проекта

Предиктивная платформа пожарной безопасности для ДЧС РК (govtech, mission-critical).
Пилот: Астана. Прод: https://www.firewatch.kz (Railway). Архитектура и роадмап: `docs/ARCHITECTURE.md`.

## Структура монорепо

- `web/` — Next.js 15 + React 19 + Tailwind v4 (CSS-first, без tailwind.config и shadcn) + MapLibre GL + three.js
- `api/` — FastAPI: auth (JWT), buildings, cards (ПТП), chat, forces, infra, routes, audit; Alembic-миграции
- `ml/` — FastAPI + XGBoost + SHAP (риск-модель; обучается на этапе Docker build, quality gate ROC-AUC ≥ 0.78)
- `db/init/` — init-скрипты PostGIS
- `docs/` — архитектура, `docs/commercial/` (КП, pricing, LOI), `docs/docs_tg/` (реальные ПТП ДЧС — исходники для Module 03)

## Запуск и проверка

- Локально: `cp .env.example .env` → `docker compose up --build`. Порты: web :3001, api :8001, ml :8002, db PostGIS.
- `NEXT_PUBLIC_*` инлайнится в build-time (Docker build ARG) — пустое значение ломает fetch в браузере.
- После правки `.env` — `docker compose up -d <svc>` (restart не перечитывает env); после правки кода api/ml — рестарт сервиса (uvicorn без --reload).
- Тесты: `api/tests/` и `ml/tests/` через pytest; db/e2e-тесты api идут только с `FW_RUN_DB_TESTS=1` + `DATABASE_URL` на PostGIS. У web тестов нет — `npm run build` как проверка типов. CI-эталон: `.github/workflows/ci.yml`.
- Сиды пользователей: `docker compose exec api python -m scripts.seed_users`.
- **Перед merge в main обязательно: `/verify` (скилл verify-firewatch) + `/code-review`.**

## Дизайн-система (жёсткие правила)

Основа: `web/src/app/globals.css` (`@theme`-токены), примитивы `web/src/components/ui/index.tsx`,
`web/src/lib/risk.ts`, `web/src/lib/cn.ts`. Тёмная тема — дефолт (`:root`), светлая — класс `.light`.

1. **Только токен-классы.** Никаких raw hex и палитр `neutral-*/red-*/orange-*` в JSX.
   Исключение: paint-слои карт и свотчи легенд — через `severity.cssVar`.
2. **Severity — единственный источник: `web/src/lib/risk.ts`** (`SEVERITY`, `scoreSeverity`, `scoreBand`).
   Бейдж, маркер карты и строка таблицы одного объекта обязаны резолвиться через него.
   Пороги (≥60 critical, ≥40 high, ≥20 elevated) продублированы в api RISK_BANDS, chat SCHEMA_DOC,
   легенде карты — при изменении синхронизировать все четыре места.
3. **Переиспользуй примитивы** из `components/ui/index.tsx` (Card, PageHeader, MetricCard, StatusChip,
   ScoreBadge, Button, Field, Tabs, EmptyState, …) — не пиши свои кнопки/карточки.
4. Цвет — никогда не единственный сигнал (пара: иконка/лейбл, иконки — lucide-react).
5. Класс `tabular` на всех числах. Всегда проектируй loading/empty/error/dense-состояния.
6. Обёртка страницы: `<div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">`. Responsive: desktop + tablet (AppShell sidebar → drawer < lg).
7. Новые цвета/размеры — сначала токен в `@theme`, потом использование.

## Роли и доступ

Роли (`web/src/lib/auth.tsx`): `inspector | supervisor | leadership | admin`.
Ролевой nav — `web/src/lib/nav.ts` (`navForRole`, `DEFAULT_ROUTE`) — при добавлении страницы прописать доступ там.
Скоупинг: inspector/supervisor видят только свой район, leadership/admin — весь город.
Тестовые пользователи (из seed_users): `inspector/inspector123`, `supervisor/supervisor123`,
`minister/minister123` (leadership), `admin/admin123`.
JWT в localStorage (`fw_token`); для `<img>/<iframe>` токен передаётся как `?token=` через `apiSrc()` — не забывать при новых файловых эндпоинтах.

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
- api самомигрирующийся (preDeploy: alembic + идемпотентные сиды); uploads живут на volume `api-volume` (эфемерный FS стирается при деплое).

## Конвенции

- Коммиты: Conventional Commits на русском — `feat(web): …`, `fix(api): …`, `docs(commercial): …`.
- Ветки: `feat/<slug>`; после merge в main ветки удаляются (local + remote).
- Данные в `docs/docs_tg/` — реальные документы ДЧС с ПДн (телефоны, ФИО): не публиковать наружу, не вставлять в публичные артефакты.
