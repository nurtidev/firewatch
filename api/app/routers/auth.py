import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import has_full_access
from app.audit import audit, client_ip
from app.auth import create_token, decode_token, verify_password
from app.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class RevokeRequest(BaseModel):
    username: str


def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Decode the Bearer token; raise 401 if missing/invalid/revoked.

    The token is taken from the Authorization header, or — as a fallback — from
    a `?token=` query param. The latter exists for <img>/<iframe> sources (e.g.
    GET /cards/{id}/file) that cannot set request headers; enumeration is still
    blocked because a valid signed token is required either way.

    Beyond signature/expiry, the user must still exist and the token must have
    been issued at or after the user's sessions_revoked_at — that timestamp is
    how an admin (or the user) forcibly terminates all active sessions.
    """
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    else:
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(401, "Требуется авторизация")
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(401, "Недействительный токен")

    row = db.execute(
        text("SELECT sessions_revoked_at FROM users WHERE username = :u"),
        {"u": payload["sub"]},
    ).mappings().first()
    if row is None:
        raise HTTPException(401, "Недействительный токен")
    revoked_at = row["sessions_revoked_at"]
    if revoked_at is not None:
        iat = datetime.datetime.fromtimestamp(
            payload["iat"], tz=datetime.timezone.utc
        )
        if iat < revoked_at:
            raise HTTPException(401, "Сессия завершена, требуется повторный вход")

    return {
        "username": payload["sub"],
        "role": payload["role"],
        "name": payload["name"],
        "district": payload.get("district"),
    }


def require_roles(*roles: str):
    """FastAPI dependency: 403 unless the current user's role is in `roles`.

    Layered on top of current_user (which already enforces a valid, non-revoked
    token), so a caller with the wrong role gets 403, an unauthenticated one 401.
    """
    allowed = frozenset(roles)

    async def _guard(user: dict = Depends(current_user)) -> dict:
        if user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="Недостаточно прав для этой операции")
        return user

    return _guard


@router.post("/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    ip = client_ip(request)
    row = db.execute(
        text(
            "SELECT username, password_hash, name, role, district "
            "FROM users WHERE username = :u"
        ),
        {"u": body.username},
    ).mappings().first()
    if row is None or not verify_password(body.password, row["password_hash"]):
        audit(
            action="login.failed", username=body.username, role=None,
            method="POST", path="/auth/login", status_code=401, ip=ip,
        )
        raise HTTPException(401, "Неверный логин или пароль")
    token = create_token(row["username"], row["role"], row["name"], row["district"])
    audit(
        action="login.success", username=row["username"], role=row["role"],
        method="POST", path="/auth/login", status_code=200, ip=ip,
    )
    return {
        "token": token,
        "user": {
            "username": row["username"],
            "name": row["name"],
            "role": row["role"],
            "district": row["district"],
        },
    }


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    return user


def _revoke_sessions(db: Session, username: str) -> bool:
    """Stamp sessions_revoked_at = now() for a user. Returns False if no such user."""
    res = db.execute(
        text("UPDATE users SET sessions_revoked_at = now() WHERE username = :u"),
        {"u": username},
    )
    db.commit()
    return res.rowcount > 0


@router.post("/revoke")
def revoke_sessions(
    body: RevokeRequest,
    request: Request,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Принудительно завершить все сессии пользователя.

    Администратор/руководство может завершить сессии любого пользователя; любой
    пользователь может завершить только свои собственные сессии.
    """
    target = body.username
    if target != user["username"] and not has_full_access(user):
        raise HTTPException(403, "Недостаточно прав для завершения чужих сессий")

    if not _revoke_sessions(db, target):
        raise HTTPException(404, "Пользователь не найден")

    audit(
        action="auth.revoke", username=user["username"], role=user["role"],
        method="POST", path="/auth/revoke", status_code=200,
        ip=client_ip(request), detail={"target": target},
    )
    return {"ok": True, "revoked": target}


@router.post("/logout")
def logout(
    request: Request,
    user: dict = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Завершить все собственные сессии вызывающего (logout на всех устройствах)."""
    _revoke_sessions(db, user["username"])
    audit(
        action="auth.revoke", username=user["username"], role=user["role"],
        method="POST", path="/auth/logout", status_code=200,
        ip=client_ip(request), detail={"target": user["username"]},
    )
    return {"ok": True, "revoked": user["username"]}
