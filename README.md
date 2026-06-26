# FireWatch

Предиктивная аналитика пожарной безопасности для ДЧС РК.
Пилот — Астана (~250 000 зданий). Инфраструктура: **Railway + Cloudflare + Claude**.

Архитектура и дорожная карта: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Структура монорепо

```
web/        Next.js + MapLibre GL — UI (6 модулей)
api/        FastAPI — auth, бизнес-логика, чат, extraction
ml/         FastAPI + XGBoost + SHAP — риск-оценки и объяснения
db/         init-скрипты PostGIS
docs/       презентация, архитектура
```

## Локальный запуск

```bash
cp .env.example .env          # заполнить ANTHROPIC_API_KEY
docker compose up --build
```

| Сервис | URL |
|--------|-----|
| web    | http://localhost:3000 |
| api    | http://localhost:8001  (docs: /docs) |
| ml     | http://localhost:8002  (docs: /docs) |
| db     | localhost:5432 (PostGIS) |

Проверка здоровья:

```bash
curl localhost:8001/health
curl localhost:8002/health
```

## Деплой на Railway

Каждый каталог (`web`, `api`, `ml`) — отдельный Railway service. PostGIS — сервис
из образа `postgis/postgis:16-3.4`. Подробности — раздел 5 в
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
