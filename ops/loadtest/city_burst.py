"""Нагрузочный прогон городского трека: всплески запросов, как их шлёт браузер.

Что моделируется (на один «браузер» = один логин):
  • открытие /city        — GET /city/summary;
  • переход на /city/map  — параллельно /infra/coverage, /infra/blind-zones,
    /infra/hydrants, /infra/stations, /city/districts.geojson,
    /city/priorities?limit=20 и /buildings?bbox=… (весь город);
  • панорамирование карты — серия `moveend`: каждый следующий /buildings?bbox
    отменяет предыдущий, ещё не ответивший (как AbortController в CityMap);
  • уход со страницы      — часть тяжёлых запросов отменяется посреди ответа.

Параллельно:
  • зонд входа — POST /auth/login раз в `--probe-interval` секунд, латентность
    показывает, «висит» ли вход во время всплеска;
  • сэмплер pg_stat_activity — число соединений API (всего / active /
    idle in transaction) и возраст самой старой транзакции; после нагрузки он
    ещё `--settle` секунд смотрит, не остались ли соединения в транзакции
    (признак утечки, а не насыщения).

Необязательно `--denied N`: N запросов с недействительным токеном за раунд
(ответ 401 проходит через audit-middleware — путь, где раньше блокировался
event loop). ВНИМАНИЕ: каждый такой запрос пишет строку audit_log — на общей
dev-базе не использовать.

Секретов в скрипте нет: учётки передаются аргументами (`--user login:pass`).

Пример (зависимости — из api/requirements.txt: httpx, psycopg):
  python ops/loadtest/city_burst.py --api http://localhost:8001 \\
      --dsn postgresql://firewatch:firewatch@localhost:5433/firewatch \\
      --pg-filter 172.18.0.4 --user akimat:akimat123 --user minister:minister123 \\
      --probe-user minister:minister123 --sessions 4 --rounds 6
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import time
from collections import defaultdict
from dataclasses import dataclass, field

import httpx
import psycopg

# Астана при zoom 10.5 — примерно весь город (как первый кадр CityMap).
CITY_BBOX = (71.25, 51.03, 71.65, 51.28)
MAP_ENDPOINTS = (
    "/infra/coverage",
    "/infra/blind-zones",
    "/infra/hydrants",
    "/infra/stations",
    "/city/districts.geojson",
    "/city/priorities?limit=20",
)
HEAVY_ABORTABLE = {"/city/summary", "/city/districts.geojson", "/city/priorities?limit=20",
                   "/infra/blind-zones", "/infra/coverage"}


def bbox_path(b: tuple[float, float, float, float]) -> str:
    return "/buildings?bbox=" + ",".join(f"{v:.5f}" for v in b)


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[idx]


@dataclass
class Stats:
    lat: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))
    status: dict[str, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int))
    )

    def record(self, key: str, outcome: str, seconds: float | None = None) -> None:
        self.status[key][outcome] += 1
        if seconds is not None and outcome.isdigit():
            self.lat[key].append(seconds)


def endpoint_key(path: str) -> str:
    return "/buildings?bbox" if path.startswith("/buildings?bbox") else path


async def timed_get(client: httpx.AsyncClient, path: str, stats: Stats,
                    abort_after: float | None = None) -> None:
    key = endpoint_key(path)
    started = time.perf_counter()

    async def run() -> None:
        # Тело читается целиком — как fetch().json(): соединение занято до
        # последнего байта, а не до заголовков.
        r = await client.get(path)
        await r.aread()
        stats.record(key, str(r.status_code), time.perf_counter() - started)

    task = asyncio.create_task(run())
    try:
        if abort_after is None:
            await task
        else:
            done, _ = await asyncio.wait({task}, timeout=abort_after)
            if not done:
                task.cancel()
                stats.record(key, "aborted")
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            else:
                task.result()
    except asyncio.CancelledError:
        stats.record(key, "aborted")
        raise
    except httpx.TimeoutException:
        stats.record(key, "client_timeout")
    except httpx.HTTPError as err:
        stats.record(key, f"error:{type(err).__name__}")


async def login(api: str, cred: str, timeout: float) -> tuple[str, float]:
    username, password = cred.split(":", 1)
    started = time.perf_counter()
    async with httpx.AsyncClient(base_url=api, timeout=timeout) as c:
        r = await c.post("/auth/login", json={"username": username, "password": password})
        r.raise_for_status()
        return r.json()["token"], time.perf_counter() - started


async def browser_session(api: str, token: str, args: argparse.Namespace, stats: Stats,
                          rng: random.Random) -> None:
    limits = httpx.Limits(
        max_connections=args.browser_conns or None,
        max_keepalive_connections=args.browser_conns or 20,
    )
    async with httpx.AsyncClient(
        base_url=api,
        headers={"Authorization": f"Bearer {token}"},
        timeout=args.timeout,
        limits=limits,
    ) as client:
        for _ in range(args.rounds):
            maybe_abort = (lambda p: rng.uniform(0.05, 0.4)
                           if p in HEAVY_ABORTABLE and rng.random() < args.abort_ratio else None)
            # /city
            await timed_get(client, "/city/summary", stats, maybe_abort("/city/summary"))
            # /city/map: всё сразу, как Promise.all в CityMap
            first = [timed_get(client, p, stats, maybe_abort(p)) for p in MAP_ENDPOINTS]
            first.append(timed_get(client, bbox_path(CITY_BBOX), stats))
            map_load = asyncio.gather(*first)
            # moveend-серия поверх ещё грузящейся карты
            pending: asyncio.Task | None = None
            w, s, e, n = CITY_BBOX
            for step in range(args.moves):
                await asyncio.sleep(args.move_interval)
                dx = (step + 1) * 0.01
                b = (w + dx, s + dx / 2, e - 0.1 + dx, n - 0.06 + dx / 2)
                if pending and not pending.done():
                    pending.cancel()
                pending = asyncio.create_task(timed_get(client, bbox_path(b), stats))
            if pending:
                try:
                    await pending
                except asyncio.CancelledError:
                    pass
            await map_load
            await asyncio.sleep(rng.uniform(0.0, 0.3))


async def denied_burst(api: str, n: int, stats: Stats, timeout: float) -> None:
    async with httpx.AsyncClient(
        base_url=api, headers={"Authorization": "Bearer invalid.token.value"}, timeout=timeout
    ) as client:
        await asyncio.gather(*(timed_get(client, "/city/summary#denied", stats) for _ in range(n)))


async def login_probe(api: str, cred: str, interval: float, stop: asyncio.Event,
                      out: list[float], failures: list[str], timeout: float) -> None:
    while not stop.is_set():
        try:
            _, seconds = await login(api, cred, timeout)
            out.append(seconds)
        except Exception as err:  # noqa: BLE001 — зонд фиксирует любой отказ
            failures.append(type(err).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass


SAMPLE_SQL = """
SELECT COALESCE(NULLIF(application_name, ''), host(client_addr), 'local') AS who,
       state,
       EXTRACT(EPOCH FROM now() - xact_start) AS xact_age
  FROM pg_stat_activity
 WHERE datname = current_database()
   AND backend_type = 'client backend'
   AND pid <> pg_backend_pid()
"""


async def pg_sampler(dsn: str, who_filter: str | None, stop: asyncio.Event,
                     samples: list[dict], period: float) -> None:
    async with await psycopg.AsyncConnection.connect(
        dsn, autocommit=True, application_name="fw-loadtest-sampler"
    ) as conn:
        while not stop.is_set():
            rows = await (await conn.execute(SAMPLE_SQL)).fetchall()
            mine = [r for r in rows if who_filter is None or who_filter in (r[0] or "")]
            samples.append({
                "t": time.perf_counter(),
                "total": len(mine),
                "active": sum(1 for r in mine if r[1] == "active"),
                "idle_in_tx": sum(1 for r in mine if r[1] and r[1].startswith("idle in transaction")),
                "oldest_xact_s": max((float(r[2]) for r in mine if r[2] is not None), default=0.0),
            })
            try:
                await asyncio.wait_for(stop.wait(), timeout=period)
            except asyncio.TimeoutError:
                pass


def summarize_pg(samples: list[dict], since: float | None = None) -> dict:
    sel = [s for s in samples if since is None or s["t"] >= since]
    if not sel:
        return {}
    return {
        "samples": len(sel),
        "max_total": max(s["total"] for s in sel),
        "max_active": max(s["active"] for s in sel),
        "max_idle_in_tx": max(s["idle_in_tx"] for s in sel),
        "max_oldest_xact_s": round(max(s["oldest_xact_s"] for s in sel), 2),
        "last": {k: sel[-1][k] for k in ("total", "active", "idle_in_tx")},
    }


async def main_async(args: argparse.Namespace) -> dict:
    rng = random.Random(args.seed)
    stats = Stats()
    tokens = [await login(args.api, cred, args.timeout) for cred in args.user]

    stop_pg = asyncio.Event()
    stop_probe = asyncio.Event()
    samples: list[dict] = []
    probe_lat: list[float] = []
    probe_fail: list[str] = []
    sampler = (asyncio.create_task(pg_sampler(args.dsn, args.pg_filter, stop_pg, samples, 0.1))
               if args.dsn else None)
    probe = (asyncio.create_task(login_probe(args.api, args.probe_user, args.probe_interval,
                                             stop_probe, probe_lat, probe_fail, args.timeout))
             if args.probe_user else None)

    await asyncio.sleep(0.5)
    started = time.perf_counter()
    jobs = []
    for token, _ in tokens:
        for _ in range(args.sessions):
            jobs.append(browser_session(args.api, token, args, stats, rng))
    if args.denied:
        async def denied_rounds() -> None:
            for _ in range(args.rounds):
                await denied_burst(args.api, args.denied, stats, args.timeout)
                await asyncio.sleep(1.0)
        jobs.append(denied_rounds())
    await asyncio.gather(*jobs)
    load_s = time.perf_counter() - started
    if probe:
        stop_probe.set()
        await probe

    settle_from = time.perf_counter()
    await asyncio.sleep(args.settle)
    if sampler:
        stop_pg.set()
        await sampler

    endpoints = {}
    for key in sorted(stats.status):
        lat = stats.lat.get(key, [])
        endpoints[key] = {
            "outcomes": dict(stats.status[key]),
            "p50_s": round(statistics.median(lat), 3) if lat else None,
            "p95_s": round(pct(lat, 0.95), 3) if lat else None,
            "max_s": round(max(lat), 3) if lat else None,
        }
    server_errors = sum(v for s in stats.status.values() for k, v in s.items()
                        if k.startswith("5"))
    return {
        "api": args.api,
        "load_seconds": round(load_s, 1),
        "browsers": len(tokens) * args.sessions,
        "rounds": args.rounds,
        "server_5xx": server_errors,
        "client_timeouts": sum(s.get("client_timeout", 0) for s in stats.status.values()),
        "endpoints": endpoints,
        "login_probe": {
            "n": len(probe_lat),
            "failures": probe_fail,
            "p50_s": round(statistics.median(probe_lat), 3) if probe_lat else None,
            "p95_s": round(pct(probe_lat, 0.95), 3) if probe_lat else None,
            "max_s": round(max(probe_lat), 3) if probe_lat else None,
        },
        "pg_during_load": summarize_pg([s for s in samples if s["t"] < settle_from]),
        "pg_after_settle": summarize_pg(samples, since=settle_from + args.settle * 0.5),
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--api", required=True)
    p.add_argument("--dsn", help="libpq DSN для сэмплера pg_stat_activity (только SELECT)")
    p.add_argument("--pg-filter", help="подстрока application_name/IP соединений API")
    p.add_argument("--user", action="append", required=True, help="login:password (повторяемый)")
    p.add_argument("--probe-user", help="login:password для зонда входа")
    p.add_argument("--probe-interval", type=float, default=0.5)
    p.add_argument("--sessions", type=int, default=3, help="браузеров на каждую учётку")
    p.add_argument("--rounds", type=int, default=5)
    p.add_argument("--moves", type=int, default=6, help="moveend-событий на раунд")
    p.add_argument("--move-interval", type=float, default=0.12)
    p.add_argument("--abort-ratio", type=float, default=0.25)
    p.add_argument("--browser-conns", type=int, default=0,
                   help="лимит соединений на браузер (0 = без лимита, как HTTP/2 через CDN)")
    p.add_argument("--denied", type=int, default=0, help="запросов с плохим токеном на раунд")
    p.add_argument("--timeout", type=float, default=90.0)
    p.add_argument("--settle", type=float, default=8.0)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--json", action="store_true", help="только JSON")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    result = asyncio.run(main_async(args))
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
        return
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
