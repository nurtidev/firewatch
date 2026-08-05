"""Module 09 · Audit log viewer — read access for full-access roles only.

The audit trail is written by app.audit / the mutation middleware; this exposes
a paginated, filterable read for admin and leadership accounts.
"""

from datetime import date, timedelta

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
    offset: int = Query(0, ge=0),
    action: str | None = None,
    username: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    if not has_full_access(user):
        raise HTTPException(403, "Недостаточно прав для просмотра журнала аудита")

    clauses: list[str] = []
    params: dict = {"limit": limit, "offset": offset}
    if action:
        clauses.append("action = :action")
        params["action"] = action
    if username:
        clauses.append("username ILIKE :username")
        params["username"] = f"%{username}%"
    if date_from:
        clauses.append("ts >= :date_from")
        params["date_from"] = date_from
    if date_to:
        # Верхняя граница исключительная (< следующий день) — так date_to
        # включает весь указанный день, а не только полночь.
        clauses.append("ts < :date_to_excl")
        params["date_to_excl"] = date_to + timedelta(days=1)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    rows = db.execute(
        text(
            f"""
            SELECT id, ts, username, role, action, method, path, status_code, ip, detail
            FROM audit_log
            {where}
            ORDER BY ts DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    total = db.execute(text("SELECT count(*) FROM audit_log")).scalar()
    # Сколько строк подходит под текущие фильтры (без limit/offset) — нужно для
    # пагинации: total может быть намного больше «видимого» набора за период.
    matched = (
        db.execute(text(f"SELECT count(*) FROM audit_log {where}"), params).scalar()
        if where
        else total
    )
    failed = db.execute(
        text("SELECT count(*) FROM audit_log WHERE action = 'login.failed'")
    ).scalar()

    return {
        "total": total,
        "matched": matched,
        "offset": offset,
        "limit": limit,
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
                # Заполняется частью роутеров (user.created, delete.card,
                # visit.recorded, callout.created, …) — «что именно» произошло,
                # не только факт запроса. Отдаётся всем ролям, видящим этот
                # журнал (leadership/admin — единственные, у кого вообще есть
                # доступ к /audit; более узкой ступени тут нет).
                "detail": r["detail"],
            }
            for r in rows
        ],
    }
