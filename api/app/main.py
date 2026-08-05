import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.audit import audit, client_ip
from app.auth import decode_token
from app.config import settings
from app.routers import (
    audit_log,
    auth,
    buildings,
    cards,
    chat,
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


@app.middleware("http")
async def audit_mutations(request: Request, call_next):
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
    """
    response = await call_next(request)
    method = request.method
    path = request.url.path
    status = response.status_code

    denied = status in (401, 403) and path != "/auth/login"
    mutating_unaudited = method in _MUTATING and not _self_audited(method, path)

    if denied or mutating_unaudited:
        auth_header = request.headers.get("authorization", "")
        payload = (
            decode_token(auth_header.split(" ", 1)[1])
            if auth_header.lower().startswith("bearer ")
            else None
        )
        audit(
            action=f"{method} {path}",
            username=payload.get("sub") if payload else None,
            role=payload.get("role") if payload else None,
            method=method,
            path=path,
            status_code=status,
            ip=client_ip(request),
        )
    return response

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
app.include_router(model.router)
app.include_router(audit_log.router)


@app.get("/")
def root() -> dict:
    return {"service": "firewatch-api", "docs": "/docs"}
