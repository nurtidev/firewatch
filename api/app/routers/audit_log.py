"""Module 09 · Audit log viewer — read access for full-access roles only.

The audit trail is written by app.audit / the mutation middleware; this exposes
a paginated, filterable read for admin and leadership accounts.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import has_full_access
from app.db import get_db
from app.routers.auth import current_user

router = APIRouter(prefix="/audit", tags=["audit"], dependencies=[Depends(current_user)])


@router.get("")
def list_events(
    db: Session = Depends(get_db),
    user: dict = Depends(current_user),
    limit: int = Query(100, ge=1, le=500),
    action: str | None = None,
    username: str | None = None,
) -> dict:
    if not has_full_access(user):
        raise HTTPException(403, "Недостаточно прав для просмотра журнала аудита")

    clauses: list[str] = []
    params: dict = {"limit": limit}
    if action:
        clauses.append("action = :action")
        params["action"] = action
    if username:
        clauses.append("username ILIKE :username")
        params["username"] = f"%{username}%"
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    rows = db.execute(
        text(
            f"""
            SELECT id, ts, username, role, action, method, path, status_code, ip
            FROM audit_log
            {where}
            ORDER BY ts DESC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()

    total = db.execute(text("SELECT count(*) FROM audit_log")).scalar()
    failed = db.execute(
        text("SELECT count(*) FROM audit_log WHERE action = 'login.failed'")
    ).scalar()

    return {
        "total": total,
        "failed_logins": failed,
        "events": [
            {
                "id": r["id"],
                "ts": r["ts"].isoformat(),
                "username": r["username"],
                "role": r["role"],
                "action": r["action"],
                "method": r["method"],
                "path": r["path"],
                "status_code": r["status_code"],
                "ip": r["ip"],
            }
            for r in rows
        ],
    }
