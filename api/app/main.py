from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import buildings, cards, forces, health, infra, routes

app = FastAPI(title="FireWatch API", version="0.1.0")

# Phase 0: permissive CORS for local dev. Lock down to the web origin before pilot.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(buildings.router)
app.include_router(cards.router)
app.include_router(routes.router)
app.include_router(infra.router)
app.include_router(forces.router)


@app.get("/")
def root() -> dict:
    return {"service": "firewatch-api", "docs": "/docs"}
