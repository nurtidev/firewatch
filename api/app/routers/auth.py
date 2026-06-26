from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

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
    return {"username": payload["sub"], "role": payload["role"], "name": payload["name"]}


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)) -> dict:
    row = db.execute(
        text("SELECT username, password_hash, name, role FROM users WHERE username = :u"),
        {"u": body.username},
    ).mappings().first()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "Неверный логин или пароль")
    token = create_token(row["username"], row["role"], row["name"])
    return {
        "token": token,
        "user": {"username": row["username"], "name": row["name"], "role": row["role"]},
    }


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    return user
