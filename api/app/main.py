import logging
import re
from functools import partial

import anyio
import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import exc as sa_exc
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.audit import audit, client_ip
from app.auth import decode_token
from app.config import settings
from app.db import engine
from app.routers import (
    audit_log,
    auth,
    buildings,
    cards,
    chat,
    city,
    dispatch,
    forces,
    health,
    infra,
    model,
    overview,
    portal,
    reports,
    routes,
)

log = logging.getLogger("firewatch.db")

app = FastAPI(title="FireWatch API", version="1.0.0")

# CORS: configurable allow-list. Defaults to "*" for local dev; set
# FW_CORS_ORIGINS (comma-separated) to the web origin(s) for the pilot.
_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


# Handlers that write their own richer audit entry (with body/SQL detail) once
# they run — the generic middleware below skips their *successful* responses to
# avoid a duplicate, less-informative row. Matched as (method, path) against
# these compiled patterns rather than a literal set, because several of these
# routes carry an id in the path (e.g. "/cards/{card_id}") that varies per
# request; each pattern mirrors the corresponding route's own declaration.
# NOTE: keep this in sync with the self-audited mutating routes in the
# routers below. If a new one is added without a pattern here, it isn't
# broken — the request is simply double-logged (generic + rich rows) until
# this list catches up.
_AUDIT_SELF_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("POST", re.compile(r"^/auth/login$")),
    ("POST", re.compile(r"^/auth/users$")),
    ("POST", re.compile(r"^/auth/users/[^/]+/disable$")),
    ("POST", re.compile(r"^/auth/users/[^/]+/enable$")),
    ("POST", re.compile(r"^/auth/users/[^/]+/password$")),
    ("POST", re.compile(r"^/auth/revoke$")),
    ("POST", re.compile(r"^/auth/logout$")),
    ("POST", re.compile(r"^/chat$")),
    ("DELETE", re.compile(r"^/cards/\d+$")),
    ("POST", re.compile(r"^/cards/\d+/prescriptions/\d+/review$")),
    ("POST", re.compile(r"^/cards/\d+/prescriptions/\d+/remediations/\d+/review$")),
    ("POST", re.compile(r"^/infra/hydrants/\d+/status$")),
    ("POST", re.compile(r"^/dispatch$")),
    ("PATCH", re.compile(r"^/dispatch/\d+$")),
    ("POST", re.compile(r"^/dispatch/\d+/close$")),
    ("POST", re.compile(r"^/reports$")),
    ("POST", re.compile(r"^/reports/\d+/status$")),
    ("POST", re.compile(r"^/portal/prescriptions/\d+/remediation$")),
    ("POST", re.compile(r"^/routes/visit$")),
]


def _self_audited(method: str, path: str) -> bool:
    return any(m == method and p.match(path) for m, p in _AUDIT_SELF_PATTERNS)


# Потоков под запись аудита из middleware — не больше, чем соединений в пуле
# аудита. Свой лимитер, а не общий пул потоков запросов (40): вал отказов
# (вкладки с протухшим токеном) иначе занимал потоки, ожидающие соединение
# аудита, и вход с картой ждали свободный поток. Очередь сверх лимита — это
# корутины в event loop, они ничего не держат.
_AUDIT_LIMITER = anyio.CapacityLimiter(max(1, settings.db_audit_pool_max))


class AuditMiddleware:
    """Audit trail for every state-changing request and every access denial.

    Two independent triggers write a generic row here:
      - a mutating request (POST/PUT/PATCH/DELETE) whose handler has no richer
        audit() call of its own — self-audited ones (_AUDIT_SELF_PATTERNS)
        write their own on success, so they're skipped here to avoid a
        duplicate, less-informative row;
      - any 401/403 response, on *any* method. A guard (current_user /
        require_roles) rejects before the handler ever runs, so even a
        self-audited handler never gets a chance to write its own entry for a
        denial — a GET that gets refused (e.g. /audit, /cards) previously left
        no trace at all. The one exception is /auth/login: it has no auth
        dependency to be rejected by (only the DB session) and always audits
        its own outcome (login.success/login.failed), including its 401.

    Чистый ASGI и запись в пуле потоков — не `@app.middleware("http")`.
    Прежний вариант (BaseHTTPMiddleware) вызывал синхронный audit() прямо в
    event loop. Когда пул соединений был занят, audit() ждал соединение до
    pool_timeout (30 с), и всё это время стоял весь процесс — в том числе
    отправка ответов, после которой другие запросы только и возвращали свои
    соединения в пул. Итог: взаимная блокировка на 30 с, «зависший» вход и
    `QueuePool limit … timed out` на каждом запросе в очереди (смоук-тест
    /city). Кроме того, BaseHTTPMiddleware прогоняет тело ответа через свой
    поток в памяти, и обработчик ждёт, пока middleware его вычитает.

    Запись идёт после отправки ответа: клиент не ждёт аудит, а сам аудит
    пишется через отдельный пул (app/db.py::audit_engine).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        status: int | None = None

        async def send_with_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        await self.app(scope, receive, send_with_status)
        if status is None:
            return

        request = Request(scope)
        method = request.method
        path = request.url.path
        denied = status in (401, 403) and path != "/auth/login"
        mutating_unaudited = method in _MUTATING and not _self_audited(method, path)
        if not (denied or mutating_unaudited):
            return

        auth_header = request.headers.get("authorization", "")
        payload = (
            decode_token(auth_header.split(" ", 1)[1])
            if auth_header.lower().startswith("bearer ")
            else None
        )
        await anyio.to_thread.run_sync(
            partial(
                audit,
                action=f"{method} {path}",
                username=payload.get("sub") if payload else None,
                role=payload.get("role") if payload else None,
                method=method,
                path=path,
                status_code=status,
                ip=client_ip(request),
            ),
            limiter=_AUDIT_LIMITER,
        )


app.add_middleware(AuditMiddleware)


_RETRY_AFTER_SEC = "5"


@app.exception_handler(sa_exc.TimeoutError)
async def db_pool_exhausted(request: Request, err: sa_exc.TimeoutError) -> JSONResponse:
    """Пул соединений занят дольше FW_DB_POOL_TIMEOUT_SEC — 503, а не 500 без CORS.

    Необработанное исключение отдаёт ServerErrorMiddleware снаружи CORS:
    браузер видел «CORS error» вместо ответа, и экран не мог показать
    «повторите». Состояние пула — в лог, чтобы перегрузку было видно.
    """
    log.warning(
        "db pool exhausted: %s %s — %s", request.method, request.url.path, engine.pool.status()
    )
    return JSONResponse(
        status_code=503,
        content={"detail": "База данных перегружена — повторите через несколько секунд"},
        headers={"Retry-After": _RETRY_AFTER_SEC},
    )


@app.exception_handler(sa_exc.DBAPIError)
async def db_overloaded(request: Request, err: sa_exc.DBAPIError) -> JSONResponse:
    """Запрос отменён (statement_timeout) или база не приняла новое соединение — 503.

    `psycopg.OperationalError` — общий предок и `QueryCanceled` (app/db.py::heavy_read
    отменил зависший запрос), и `ConnectionTimeout`/«server closed the connection»/
    «too many connections» (новое соединение overflow не открылось за
    connect_timeout=5с, потому что сама база перегружена и не успевает принять
    TCP+auth за 5с — под нагрузочным прогоном это воспроизводится наравне с
    QueuePool timeout, и раньше здесь падал необработанный 500 без Retry-After).
    `err.orig` — psycopg-исключение; НЕ путать с `sqlalchemy.exc.OperationalError`
    (обёртка SQLAlchemy, которая покрывает и настоящие ошибки запроса — те
    остаются 500, см. tests/test_db_pool.py::test_other_db_errors_stay_500).
    """
    if not isinstance(err.orig, psycopg.OperationalError):
        raise err
    log.warning("db overloaded: %s %s — %s", request.method, request.url.path, type(err.orig).__name__)
    return JSONResponse(
        status_code=503,
        content={"detail": "Запрос к базе выполнялся слишком долго — повторите позже"},
        headers={"Retry-After": _RETRY_AFTER_SEC},
    )


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(buildings.router)
app.include_router(cards.router)
app.include_router(routes.router)
app.include_router(reports.router)
app.include_router(portal.router)
app.include_router(infra.router)
app.include_router(forces.router)
app.include_router(dispatch.router)
app.include_router(chat.router)
app.include_router(overview.router)
app.include_router(city.router)
app.include_router(model.router)
app.include_router(audit_log.router)


@app.get("/")
def root() -> dict:
    return {"service": "firewatch-api", "docs": "/docs"}
