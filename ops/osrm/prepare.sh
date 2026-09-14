#!/usr/bin/env bash
#
# Подготовка дорожного графа для зон прибытия (OSRM).
#
# Запускается один раз на установку и повторяется, когда обновляют карту —
# то есть примерно раз в месяц, а не при каждом деплое. Всё, что делает
# скрипт: качает выгрузку OSM по Казахстану, строит из неё граф и оставляет
# его в ops/osrm/data, откуда его читает контейнер osrm.
#
# Дальше:
#   docker compose --profile routing up -d osrm
#   FW_ROUTING_URL=http://osrm:5000 в .env  → docker compose up -d api
#   POST /infra/coverage/rebuild (admin)    → зоны считаются по дорогам
#
# Требуется: docker, ~1,5 ГБ свободного места, 10–15 минут в первый раз.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p data

PBF_URL="${PBF_URL:-https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf}"
PBF="data/kazakhstan-latest.osm.pbf"
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"
# Профиль car: пожарная машина едет по тем же дорогам, что и автомобиль.
# Приоритетный проезд (выделенные полосы, встречка) — отдельная работа, она
# требует и собственного профиля, и разметки полос в OSM, которой в Астане
# пока 45 сегментов.
PROFILE="${PROFILE:-/opt/car.lua}"

if [ ! -f "$PBF" ]; then
  echo "→ Качаю выгрузку OSM (~210 МБ): $PBF_URL"
  curl -fL --progress-bar -o "$PBF" "$PBF_URL"
else
  echo "→ Выгрузка уже на месте: $PBF (удалите файл, чтобы обновить карту)"
fi

run() {
  docker run --rm -v "$PWD/data:/data" "$OSRM_IMAGE" "$@"
}

echo "→ osrm-extract (разбор карты в граф, самый долгий шаг)"
run osrm-extract -p "$PROFILE" /data/kazakhstan-latest.osm.pbf

echo "→ osrm-partition"
run osrm-partition /data/kazakhstan-latest.osrm

echo "→ osrm-customize"
run osrm-customize /data/kazakhstan-latest.osrm

echo
echo "Граф готов. Дальше:"
echo "  docker compose --profile routing up -d osrm"
echo "  echo 'FW_ROUTING_URL=http://osrm:5000' >> .env && docker compose up -d api"
echo "  curl -X POST localhost:8001/infra/coverage/rebuild -H 'Authorization: Bearer <admin>'"
