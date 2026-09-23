"""Кэш тяжёлых агрегатов чтения в памяти процесса.

Что кэшируется: /city/summary (и та же сводка внутри /city/districts.geojson),
контуры районов, ячейки /city/priorities, /infra/coverage, /infra/blind-zones.
Все они не зависят от роли и района читателя (у /city и этих /infra-ручек нет
скоупинга), поэтому ключ — только имя набора. Каждый ответ считается сотни
миллисекунд по всему городу, а экран карты запрашивает их все разом: без кэша
несколько открытых карт занимали весь пул соединений (см. app/db.py).

Свежесть:
  • TTL (`FW_READ_CACHE_TTL_SEC`, по умолчанию 60 с). В ответах остаётся
    `computed_at` — момент фактического расчёта, так что экран честно
    показывает возраст цифр.
  • Изменения, которые делает сам API и которые меняют картину покрытия,
    сбрасывают кэш сразу: пересчёт зон прибытия (`POST /infra/coverage/rebuild`)
    и отметка гидранта с выезда. Выезды и предписания в сводке города
    (callouts_90d, медианы, open_prescriptions) догоняют не позже TTL.
  • Изменения из других процессов (seed_districts в preDeploy, cron
    compute_risk, import_infra) видны не позже TTL: сбросить кэш чужого
    процесса нельзя. После деплоя процесс новый — кэш пуст.
  • Несколько воркеров uvicorn (сейчас один) — у каждого свой кэш: сброс
    доходит только до обработавшего запрос воркера, остальные догонят за TTL.

Нагрузка:
  • single-flight — при пустом кэше считает один запрос, остальные ждут его
    результат (не занимая соединение: current_user уже вернул своё в пул);
  • протухшее значение отдаётся остальным, пока один запрос его пересчитывает
    (не дольше ещё одного TTL), — истечение TTL не превращается в залп
    одинаковых тяжёлых запросов;
  • сброшенное (`invalidate`) значение не отдаётся никогда, и результат
    расчёта, начатого до сброса, в кэш не ложится.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from app.config import settings

T = TypeVar("T")


@dataclass
class _Entry:
    value: Any
    expires_at: float


class ReadCache:
    def __init__(self, ttl_seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.ttl = ttl_seconds
        self._clock = clock
        self._entries: dict[str, _Entry] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._generation: dict[str, int] = {}
        self._guard = threading.Lock()

    def _lock_for(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def get_or_compute(self, key: str, compute: Callable[[], T]) -> T:
        if self.ttl <= 0:
            return compute()

        now = self._clock()
        entry = self._entries.get(key)
        if entry is not None and now < entry.expires_at:
            return entry.value

        lock = self._lock_for(key)
        if entry is not None and now < entry.expires_at + self.ttl:
            # Протухло недавно: пересчитывает один, остальные берут прежнее.
            if not lock.acquire(blocking=False):
                return entry.value
        else:
            lock.acquire()
        try:
            entry = self._entries.get(key)
            if entry is not None and self._clock() < entry.expires_at:
                return entry.value  # посчитал тот, кого мы ждали
            with self._guard:
                generation = self._generation.get(key, 0)
            value = compute()
            with self._guard:
                if self._generation.get(key, 0) == generation:
                    self._entries[key] = _Entry(value, self._clock() + self.ttl)
            return value
        finally:
            lock.release()

    def invalidate(self, prefix: str = "") -> None:
        """Сбросить все ключи с префиксом (пустой — всё)."""
        with self._guard:
            for key in [k for k in self._entries if k.startswith(prefix)]:
                del self._entries[key]
            for key in set(self._locks) | set(self._generation):
                if key.startswith(prefix):
                    self._generation[key] = self._generation.get(key, 0) + 1


read_cache = ReadCache(settings.read_cache_ttl_sec)
