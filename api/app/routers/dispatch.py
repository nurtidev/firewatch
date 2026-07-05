"""Боевой модуль — dispatch of callouts and the боевой пакет.

Two roles drive this module:
  • dispatcher (ЦОУ/112) — registers a callout (выезд), assigns a station and
    hands the караул a боевой пакет.
  • responder (начальник караула / РТП) — reads the pack and works the scene.

Geo work is done in PostGIS (geography casts → metres). Callouts are stored in
their own table, never in `incidents` (which feeds the ML risk model). All
data reads here are citywide — dispatcher/responder are not district-scoped.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import audit, client_ip
from app.db import get_db
from app.routers.auth import current_user, require_roles
from app.routers.forces import PRESETS

# Registering / closing a callout is a dispatcher action (admin may operate too).
DISPATCH_ROLES = require_roles("dispatcher", "admin")
# Reading callouts / the pack: the боевой roles plus oversight.
VIEW_ROLES = require_roles(
    "dispatcher", "responder", "supervisor", "leadership", "admin"
)

router = APIRouter(prefix="/dispatch", tags=["dispatch"], dependencies=[Depends(current_user)])

CALLOUT_TYPES = {"fire", "smoke", "alarm", "other"}

# Nearest hydrants / access reports around the callout point (metres).
HYDRANT_RADIUS_M = 800
REPORTS_RADIUS_M = 400
HYDRANT_LIMIT = 5

_PRESET_LABEL = {p["key"]: p["label"] for p in PRESETS}
# Minimal building_type → forces preset mapping. building_type is a coarse OSM
# class (residential/public/industrial/other); the named school/hospital/mall
# keys are here for when a finer type is available on the object.
_TYPE_TO_PRESET = {
    "residential": "residential",
    "school": "education",
    "hospital": "medical",
    "mall": "public_mass",
    "public": "public",
    "industrial": "industrial",
}
# Catches preset-key drift (forces.py renaming/removing a preset) at import
# time — in tests and on boot — instead of a 500 on a live callout.
assert set(_TYPE_TO_PRESET.values()) <= set(_PRESET_LABEL), (
    "_TYPE_TO_PRESET ссылается на пресет, которого нет в forces.PRESETS"
)


class CalloutCreate(BaseModel):
    building_id: int | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    address: str | None = Field(None, max_length=500)
    callout_type: str
    note: str | None = Field(None, max_length=2000)
    station_id: int | None = None

    @field_validator("callout_type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in CALLOUT_TYPES:
            raise ValueError(f"неизвестный тип вызова: {v}")
        return v

    @model_validator(mode="after")
    def _require_location(self) -> "CalloutCreate":
        # Need a point: either an object (centroid) or an explicit lat+lng.
        if self.building_id is None and (self.lat is None or self.lng is None):
            raise ValueError("укажите building_id либо пару координат lat+lng")
        return self


class CalloutClose(BaseModel):
    close_note: str | None = Field(None, max_length=2000)


# --- callout shaping ---------------------------------------------------------

# One row shape for both the list and the pack's `callout`. district/station name
# come from joins (callouts stores neither).
_CALLOUT_SELECT = """
    SELECT c.id, c.building_id, b.district, c.address, c.callout_type, c.note,
           c.status, ST_Y(c.geom) AS lat, ST_X(c.geom) AS lng,
           c.station_id, s.name AS station_name,
           c.created_by, c.created_at, c.closed_by, c.closed_at, c.close_note
    FROM callouts c
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN fire_stations s ON s.id = c.station_id
"""


def _callout_dict(r: dict) -> dict:
    return {
        "id": r["id"],
        "address": r["address"],
        "district": r["district"],
        "callout_type": r["callout_type"],
        "note": r["note"],
        "status": r["status"],
        "lat": r["lat"],
        "lng": r["lng"],
        "station": {"id": r["station_id"], "name": r["station_name"]}
        if r["station_id"] is not None
        else None,
        "building_id": r["building_id"],
        "created_by": r["created_by"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "closed_by": r["closed_by"],
        "closed_at": r["closed_at"].isoformat() if r["closed_at"] else None,
        "close_note": r["close_note"],
    }


def _fetch_callout(db: Session, callout_id: int) -> dict:
    row = db.execute(
        text(_CALLOUT_SELECT + " WHERE c.id = :id"), {"id": callout_id}
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Выезд не найден")
    return dict(row)


# --- боевой пакет ------------------------------------------------------------


def _build_pack(db: Session, callout_id: int) -> dict:
    row = _fetch_callout(db, callout_id)
    lng, lat = row["lng"], row["lat"]
    pt_params = {"lng": lng, "lat": lat}
    pt = "ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography"

    # Building block (only for object-linked callouts).
    building = None
    if row["building_id"] is not None:
        b = db.execute(
            text(
                """
                SELECT b.id, b.address, b.district, b.building_type, b.floors,
                       b.year_built, r.score AS risk_score,
                       (SELECT oc.id FROM operational_cards oc
                        WHERE oc.building_id = b.id
                        ORDER BY oc.id DESC LIMIT 1) AS card_id
                FROM buildings b
                LEFT JOIN risk_scores r ON r.building_id = b.id
                WHERE b.id = :id
                """
            ),
            {"id": row["building_id"]},
        ).mappings().first()
        if b is not None:
            building = {
                "id": b["id"],
                "address": b["address"],
                "district": b["district"],
                "building_type": b["building_type"],
                "floors": b["floors"],
                "year_built": b["year_built"],
                "risk_score": b["risk_score"],
                "card_id": b["card_id"],
            }

    # Nearest hydrants within HYDRANT_RADIUS_M.
    hydrants = db.execute(
        text(
            f"""
            SELECT id, status, hydrant_type, pressure_bar, diameter_mm,
                   ST_Y(geom) AS lat, ST_X(geom) AS lng,
                   ST_Distance(geom::geography, {pt}) AS dist
            FROM hydrants
            WHERE ST_DWithin(geom::geography, {pt}, :radius)
            ORDER BY dist
            LIMIT :lim
            """
        ),
        {**pt_params, "radius": HYDRANT_RADIUS_M, "lim": HYDRANT_LIMIT},
    ).mappings().all()

    # Assigned station with its distance from the callout.
    station = None
    if row["station_id"] is not None:
        s = db.execute(
            text(
                f"""
                SELECT id, name, vehicles,
                       ST_Distance(geom::geography, {pt}) AS dist
                FROM fire_stations WHERE id = :id
                """
            ),
            {**pt_params, "id": row["station_id"]},
        ).mappings().first()
        if s is not None:
            station = {
                "id": s["id"],
                "name": s["name"],
                "vehicles": s["vehicles"],
                "distance_m": round(s["dist"]),
            }

    # Active access reports the crew should know about before arrival.
    reports = db.execute(
        text(
            f"""
            SELECT id, category, status, description, photos,
                   ST_Distance(geom::geography, {pt}) AS dist
            FROM field_reports
            WHERE status IN ('open', 'in_progress')
              AND ST_DWithin(geom::geography, {pt}, :radius)
            ORDER BY dist
            """
        ),
        {**pt_params, "radius": REPORTS_RADIUS_M},
    ).mappings().all()

    # Forces preset hint from the object's type.
    forces_hint = None
    if building is not None:
        preset_key = _TYPE_TO_PRESET.get(building["building_type"])
        label = _PRESET_LABEL.get(preset_key) if preset_key is not None else None
        if label is not None:
            forces_hint = {"preset_key": preset_key, "label": label}

    return {
        "callout": _callout_dict(row),
        "building": building,
        "hydrants": [
            {
                "id": h["id"],
                "status": h["status"],
                "hydrant_type": h["hydrant_type"],
                "pressure_bar": h["pressure_bar"],
                "diameter_mm": h["diameter_mm"],
                "distance_m": round(h["dist"]),
                "lat": h["lat"],
                "lng": h["lng"],
            }
            for h in hydrants
        ],
        "station": station,
        "reports": [
            {
                "id": r["id"],
                "category": r["category"],
                "status": r["status"],
                "description": r["description"],
                "distance_m": round(r["dist"]),
                "photos": r["photos"],
            }
            for r in reports
        ],
        "forces_hint": forces_hint,
    }


# --- endpoints ---------------------------------------------------------------


@router.get("/search")
def search_buildings(
    q: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(DISPATCH_ROLES),
) -> list[dict]:
    """Token search over building addresses (for picking a callout object).

    Each whitespace-separated token must match somewhere in the address, so a
    dispatcher can type «Сарайшық 7» the way a caller says it — the street
    word and the house number don't have to be adjacent («… көшесі 7/1»).
    """
    tokens = [t for t in q.split() if t][:5]
    if not tokens:
        return []
    clauses = " AND ".join(f"b.address ILIKE :q{i}" for i in range(len(tokens)))
    params: dict = {f"q{i}": f"%{t}%" for i, t in enumerate(tokens)}
    params["raw"] = tokens[0]
    rows = db.execute(
        text(
            f"""
            SELECT b.id, b.address, b.district, b.building_type, b.floors,
                   r.score AS risk_score
            FROM buildings b
            LEFT JOIN risk_scores r ON r.building_id = b.id
            WHERE {clauses}
            -- Natural ordering: earlier first-token position, then the house
            -- number numerically (7/1 before 11 — plain ORDER BY address hides
            -- low house numbers behind lexicographic 1x/1xx neighbours).
            ORDER BY POSITION(lower(:raw) IN lower(b.address)),
                     COALESCE(substring(b.address FROM '[0-9]+')::int, 999999),
                     b.address
            LIMIT 10
            """
        ),
        params,
    ).mappings().all()
    return [
        {
            "id": r["id"],
            "address": r["address"],
            "district": r["district"],
            "building_type": r["building_type"],
            "floors": r["floors"],
            "risk_score": r["risk_score"],
        }
        for r in rows
    ]


@router.post("")
def create_callout(
    body: CalloutCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(DISPATCH_ROLES),
) -> dict:
    """Register a callout and return it together with its боевой пакет."""
    address = body.address
    # Resolve the callout point: object centroid or explicit coordinates.
    if body.building_id is not None:
        b = db.execute(
            text(
                """
                SELECT id, address,
                       ST_X(ST_Centroid(geom)) AS lng,
                       ST_Y(ST_Centroid(geom)) AS lat
                FROM buildings WHERE id = :id
                """
            ),
            {"id": body.building_id},
        ).mappings().first()
        if b is None:
            raise HTTPException(404, "Здание не найдено")
        lng, lat = b["lng"], b["lat"]
        if address is None:
            address = b["address"]
    else:
        lng, lat = body.lng, body.lat

    # Station: explicit (must exist) or the nearest one, recorded automatically.
    station_id = body.station_id
    if station_id is not None:
        exists = db.execute(
            text("SELECT 1 FROM fire_stations WHERE id = :id"), {"id": station_id}
        ).scalar()
        if not exists:
            raise HTTPException(404, "Пожарная часть не найдена")
    else:
        station_id = db.execute(
            text(
                """
                SELECT id FROM fire_stations
                ORDER BY geom::geography <->
                         ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                LIMIT 1
                """
            ),
            {"lng": lng, "lat": lat},
        ).scalar()

    new_id = db.execute(
        text(
            """
            INSERT INTO callouts
                (building_id, address, geom, callout_type, note, station_id, created_by)
            VALUES
                (:building_id, :address,
                 ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                 :callout_type, :note, :station_id, :created_by)
            RETURNING id
            """
        ),
        {
            "building_id": body.building_id,
            "address": address,
            "lng": lng,
            "lat": lat,
            "callout_type": body.callout_type,
            "note": body.note,
            "station_id": station_id,
            "created_by": user.get("username"),
        },
    ).scalar()
    db.commit()

    audit(
        action="callout.created",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path="/dispatch",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": new_id, "callout_type": body.callout_type,
                "building_id": body.building_id, "station_id": station_id},
    )

    return _build_pack(db, new_id)


@router.get("")
def list_callouts(
    status: str = "active",
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> list[dict]:
    """Callouts, newest first. `status`: active (default) | closed | all."""
    if status not in ("active", "closed", "all"):
        raise HTTPException(422, "status должен быть active, closed или all")
    clause = "" if status == "all" else "WHERE c.status = :status"
    params = {} if status == "all" else {"status": status}
    rows = db.execute(
        text(_CALLOUT_SELECT + f" {clause} ORDER BY c.created_at DESC LIMIT 100"),
        params,
    ).mappings().all()
    return [_callout_dict(dict(r)) for r in rows]


@router.get("/{callout_id}/pack")
def callout_pack(
    callout_id: int,
    db: Session = Depends(get_db),
    _user: dict = Depends(VIEW_ROLES),
) -> dict:
    """Боевой пакет for a callout — everything the караул needs on arrival."""
    return _build_pack(db, callout_id)


@router.post("/{callout_id}/close")
def close_callout(
    callout_id: int,
    body: CalloutClose,
    request: Request,
    db: Session = Depends(get_db),
    user: dict = Depends(DISPATCH_ROLES),
) -> dict:
    """Close an active callout (404 if unknown, 409 if already closed)."""
    updated = db.execute(
        text(
            """
            UPDATE callouts
               SET status = 'closed', closed_by = :by, closed_at = now(),
                   close_note = :note
             WHERE id = :id AND status = 'active'
            RETURNING id
            """
        ),
        {"by": user.get("username"), "note": body.close_note, "id": callout_id},
    ).scalar()
    if updated is None:
        exists = db.execute(
            text("SELECT 1 FROM callouts WHERE id = :id"), {"id": callout_id}
        ).scalar()
        if not exists:
            raise HTTPException(404, "Выезд не найден")
        raise HTTPException(409, "Выезд уже закрыт")
    db.commit()

    audit(
        action="callout.closed",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path=f"/dispatch/{callout_id}/close",
        status_code=200,
        ip=client_ip(request),
        detail={"callout_id": callout_id},
    )

    return _callout_dict(_fetch_callout(db, callout_id))
