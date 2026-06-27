from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.audit import audit
from app.auth import decode_token
from app.config import settings
from app.routers import (
    audit_log,
    auth,
    buildings,
    cards,
    chat,
    forces,
    health,
    infra,
    model,
    overview,
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


@app.middleware("http")
async def audit_mutations(request: Request, call_next):
    """Audit every state-changing request. Login is audited in its handler
    (it needs the request body), so it is skipped here to avoid duplicates."""
    response = await call_next(request)
    if request.method in _MUTATING and request.url.path != "/auth/login":
        auth_header = request.headers.get("authorization", "")
        payload = (
            decode_token(auth_header.split(" ", 1)[1])
            if auth_header.lower().startswith("bearer ")
            else None
        )
        audit(
            action=f"{request.method} {request.url.path}",
            username=payload.get("sub") if payload else None,
            role=payload.get("role") if payload else None,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            ip=request.client.host if request.client else None,
        )
    return response

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(buildings.router)
app.include_router(cards.router)
app.include_router(routes.router)
app.include_router(infra.router)
app.include_router(forces.router)
app.include_router(chat.router)
app.include_router(overview.router)
app.include_router(model.router)
app.include_router(audit_log.router)


@app.get("/")
def root() -> dict:
    return {"service": "firewatch-api", "docs": "/docs"}
