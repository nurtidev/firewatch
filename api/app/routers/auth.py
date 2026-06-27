from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import audit
from app.auth import create_token, decode_token, verify_password
from app.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


def current_user(authorization: str | None = Header(default=None)) -> dict:
    """Decode the Bearer token; raise 401 if missing/invalid."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Требуется авторизация")
    payload = decode_token(authorization.split(" ", 1)[1])
    if payload is None:
        raise HTTPException(401, "Недействительный токен")
    return {
        "username": payload["sub"],
        "role": payload["role"],
        "name": payload["name"],
        "district": payload.get("district"),
    }


@router.post("/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    ip = request.client.host if request.client else None
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
