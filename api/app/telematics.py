"""Телематика: позиции пожарной техники из системы мониторинга ДЧС.

**Что здесь делается и чего здесь намеренно не делается.**

На технике ДЧС уже стоят трекеры и работает система мониторинга. Поэтому мы
НЕ заводим свой трекинг и НЕ подключаемся к трекерам напрямую: параллельный
приёмник конфликтует с работающей системой и рискует сломать то, что уже
эксплуатируется. Мы читаем позиции у существующей платформы — как потребитель.

Пока доступ к API системы мониторинга не выдан, провайдер = `none`, и все
экраны честно показывают «интеграция не настроена». Выдуманных или
экстраполированных позиций здесь нет и быть не должно: на боевом экране
ложная позиция машины хуже отсутствующей.

Подключение сводится к трём переменным окружения (см. app/config.py):
    FW_TELEMATICS_PROVIDER=wialon
    FW_TELEMATICS_URL=https://hst-api.wialon.com
    FW_TELEMATICS_TOKEN=<токен, выдаёт владелец системы>

Сопоставление «машина в системе мониторинга ↔ машина у нас» идёт по позывному
(`station_vehicles.callsign` ↔ имя объекта в платформе). Это единственный
идентификатор, который в обеих системах ведёт человек, и его же называют по
радио. Несопоставленные объекты не отбрасываются молча, а возвращаются в
`unmatched` — иначе расхождение справочников осталось бы невидимым.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from app.config import settings

log = logging.getLogger(__name__)

# Таймаут короткий: боевой экран обновляется по опросу, и лучше отдать
# «данных нет», чем задержать отрисовку пакета на медленном внешнем API.
REQUEST_TIMEOUT_SEC = 5.0


@dataclass
class VehiclePosition:
    """Позиция единицы техники, приведённая к нашей модели."""

    callsign: str
    lat: float
    lng: float
    speed_kmh: float | None = None
    course_deg: float | None = None
    at: datetime | None = None

    @property
    def age_sec(self) -> float | None:
        if self.at is None:
            return None
        return max(0.0, (datetime.now(timezone.utc) - self.at).total_seconds())

    @property
    def stale(self) -> bool:
        age = self.age_sec
        return age is None or age > settings.telematics_stale_sec

    def as_dict(self) -> dict:
        return {
            "callsign": self.callsign,
            "lat": self.lat,
            "lng": self.lng,
            "speed_kmh": self.speed_kmh,
            "course_deg": self.course_deg,
            "at": self.at.isoformat() if self.at else None,
            "age_sec": round(self.age_sec) if self.age_sec is not None else None,
            "stale": self.stale,
        }


@dataclass
class TelematicsSnapshot:
    """Ответ провайдера целиком, включая причину пустоты.

    `configured` отличает «интеграция не настроена» от «настроена, но сейчас
    ничего не отдала»: на экране это принципиально разные сообщения, и
    сваливать их в один пустой список значит скрывать от диспетчера, что
    источник данных недоступен.
    """

    configured: bool
    provider: str
    positions: list[VehiclePosition] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)
    error: str | None = None

    def as_dict(self) -> dict:
        return {
            "configured": self.configured,
            "provider": self.provider,
            "positions": [p.as_dict() for p in self.positions],
            "unmatched": self.unmatched,
            "error": self.error,
            "stale_after_sec": settings.telematics_stale_sec,
        }


class TelematicsProvider:
    """Интерфейс провайдера. Реализация читает чужую систему, не пишет в неё."""

    name = "base"

    def fetch(self) -> TelematicsSnapshot:  # pragma: no cover - интерфейс
        raise NotImplementedError


class NullProvider(TelematicsProvider):
    """Интеграция не настроена — доступ к системе мониторинга ещё не выдан."""

    name = "none"

    def fetch(self) -> TelematicsSnapshot:
        return TelematicsSnapshot(configured=False, provider=self.name)


class WialonProvider(TelematicsProvider):
    """Wialon Remote API — самая распространённая платформа мониторинга в РК.

    Схема простая: `token/login` меняет токен на sid, `core/search_items`
    отдаёт объекты (флаг 0x00000401 = базовые поля + последнее сообщение с
    координатами). Реализация намеренно короткая и без кеша сессии: опрос
    идёт раз в несколько секунд с одного бэкенда, а лишний слой состояния
    здесь дороже одного дополнительного запроса.

    До получения доступа этот класс не выполнялся ни разу против боевого
    стенда — сверить формат полей нужно на первом же подключении.
    """

    name = "wialon"

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/") + "/wialon/ajax.html"
        self.token = token

    def _call(self, client: httpx.Client, svc: str, params: str, sid: str | None = None) -> dict:
        query = {"svc": svc, "params": params}
        if sid:
            query["sid"] = sid
        r = client.get(self.base_url, params=query, timeout=REQUEST_TIMEOUT_SEC)
        r.raise_for_status()
        data = r.json()
        # Wialon отвечает HTTP 200 и на ошибку — код лежит в теле.
        if isinstance(data, dict) and "error" in data and data.get("error") != 0:
            raise RuntimeError(f"Wialon error {data['error']} ({svc})")
        return data

    def fetch(self) -> TelematicsSnapshot:
        try:
            with httpx.Client() as client:
                login = self._call(
                    client, "token/login", f'{{"token":"{self.token}"}}'
                )
                sid = login.get("eid")
                if not sid:
                    raise RuntimeError("Wialon не вернул идентификатор сессии")

                items = self._call(
                    client,
                    "core/search_items",
                    '{"spec":{"itemsType":"avl_unit","propName":"sys_name",'
                    '"propValueMask":"*","sortType":"sys_name"},'
                    '"force":1,"flags":1025,"from":0,"to":0}',
                    sid=sid,
                )
        except Exception as exc:  # внешняя система: сеть, токен, формат
            log.warning("Телематика недоступна: %s", exc)
            return TelematicsSnapshot(
                configured=True,
                provider=self.name,
                error="Система мониторинга недоступна",
            )

        positions: list[VehiclePosition] = []
        for item in items.get("items") or []:
            pos = item.get("pos") or {}
            lat, lng = pos.get("y"), pos.get("x")
            if lat is None or lng is None:
                continue
            at = pos.get("t")
            positions.append(
                VehiclePosition(
                    callsign=str(item.get("nm") or "").strip(),
                    lat=float(lat),
                    lng=float(lng),
                    speed_kmh=pos.get("s"),
                    course_deg=pos.get("c"),
                    at=datetime.fromtimestamp(at, tz=timezone.utc) if at else None,
                )
            )
        return TelematicsSnapshot(
            configured=True, provider=self.name, positions=positions
        )


def get_provider() -> TelematicsProvider:
    """Провайдер по конфигурации. Неполная настройка = не настроено вовсе:
    частично сконфигурированная интеграция молча отдавала бы пустоту, и это
    было бы неотличимо от «все машины в гараже»."""
    kind = (settings.telematics_provider or "none").strip().lower()
    if kind == "wialon" and settings.telematics_url and settings.telematics_token:
        return WialonProvider(settings.telematics_url, settings.telematics_token)
    if kind not in ("none", "", "wialon"):
        log.warning("Неизвестный провайдер телематики: %s", kind)
    return NullProvider()


def match_positions(
    snapshot: TelematicsSnapshot, callsigns: dict[str, int]
) -> tuple[list[dict], list[str]]:
    """Сопоставить позиции с нашим реестром техники по позывному.

    `callsigns` — отображение «позывной в нижнем регистре → id машины».
    Возвращает пары (позиция + vehicle_id) и список позывных из системы
    мониторинга, которым в реестре ничего не соответствует: расхождение
    справочников должно быть видимым, а не тихо отброшенным.
    """
    matched: list[dict] = []
    unmatched: list[str] = []
    for p in snapshot.positions:
        vid = callsigns.get(p.callsign.lower())
        if vid is None:
            unmatched.append(p.callsign)
            continue
        matched.append({**p.as_dict(), "vehicle_id": vid})
    return matched, unmatched
