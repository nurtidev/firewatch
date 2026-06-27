"""Password hashing (pbkdf2, stdlib) and JWT issuing/verification."""

import base64
import datetime
import hashlib
import hmac
import os

import jwt

from app.config import settings

_ITER = 200_000
_ALG = "HS256"
TOKEN_TTL_DAYS = 7


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITER)
    return base64.b64encode(salt + dk).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        raw = base64.b64decode(stored)
    except Exception:  # noqa: BLE001
        return False
    salt, dk = raw[:16], raw[16:]
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITER)
    return hmac.compare_digest(dk, candidate)


def create_token(username: str, role: str, name: str, district: str | None = None) -> str:
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    payload = {
        "sub": username,
        "role": role,
        "name": name,
        "district": district,
        "exp": now + datetime.timedelta(days=TOKEN_TTL_DAYS),
        "iat": now,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALG)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_ALG])
    except jwt.PyJWTError:
        return None
