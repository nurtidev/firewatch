import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.access import has_full_access
from app.audit import audit, client_ip
from app.auth import create_token, decode_token, hash_password, verify_password
from app.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

# Роли, которые администратор заводит через продукт. Внутренние — сотрудники
# ДЧС; `owner` — внешний владелец объекта (портал ОСИ), у него нет района, он
# привязывается к зданиям через owner_buildings.
INTERNAL_ROLES = (
    "inspector",
    "supervisor",
    "leadership",
    "admin",
    "dispatcher",
    "responder",
)
ASSIGNABLE_ROLES = (*INTERNAL_ROLES, "owner")

# Роли, у которых район — граница доступа (app/access.py): без района такой
# пользователь не видит ничего, поэтому район при заведении обязателен.
DISTRICT_SCOPED_ROLES = ("inspector", "supervisor")

# Районы Астаны — тот же список, что в scripts/seed_ops.py (buildings.district).
DISTRICTS = (
    "Сарыаркинский",
    "Алматинский",
    "Есильский",
    "Байконырский",
    "Нуринский",
)


class LoginRequest(BaseModel):
    username: str
    password: str


class RevokeRequest(BaseModel):
    username: str


class PasswordReset(BaseModel):
    password: str = Field(..., min_length=8)


class UserCreate(BaseModel):
    """Учётная запись, заводимая администратором через продукт.

    Раньше эндпоинт умел только `owner`, а сотрудники ДЧС появлялись правкой
    scripts/seed_users.py и передеплоем — приём сотрудника был операцией
    разработчика, а не администратора, и не попадал в журнал аудита.

    Район: обязателен для скоупленных ролей (инспектор/руководитель управления)
    и принудительно пуст для общегородских — иначе скоупинг сузил бы им выдачу.
    """

    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-z0-9_.-]+$")
    password: str = Field(..., min_length=8)
    name: str = Field(..., min_length=1, max_length=200)
    role: str
    district: str | None = None
    building_ids: list[int] = Field(default_factory=list)

    @field_validator("role")
    @classmethod
    def _known_role(cls, v: str) -> str:
        if v not in ASSIGNABLE_ROLES:
            raise ValueError(
                "неизвестная роль; допустимы: " + ", ".join(ASSIGNABLE_ROLES)
            )
        return v

    @model_validator(mode="after")
    def _role_consistency(self) -> "UserCreate":
        if self.role == "owner":
            if not self.building_ids:
                raise ValueError("для владельца укажите хотя бы один объект (building_ids)")
            self.district = None
            return self

        if self.building_ids:
            raise ValueError("объекты (building_ids) допустимы только для роли 'owner'")
        if self.role in DISTRICT_SCOPED_ROLES:
            if not self.district:
                raise ValueError("для этой роли обязателен район")
            if self.district not in DISTRICTS:
                raise ValueError("неизвестный район; допустимы: " + ", ".join(DISTRICTS))
        else:
            # Общегородская роль: район не хранится (см. access.py — citywide).
            self.district = None
        return self


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

    Beyond signature/expiry, the user must still exist, must not be disabled,
    and the token must have been issued at or after the user's
    sessions_revoked_at — that timestamp is how an admin (or the user) forcibly
    terminates all active sessions.

    Отключённая учётная запись (`is_active = FALSE`) проверяется здесь на каждом
    запросе, а не только при входе: иначе токен, выданный до отключения, дожил
    бы до истечения срока.
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
        text("SELECT sessions_revoked_at, is_active FROM users WHERE username = :u"),
        {"u": payload["sub"]},
    ).mappings().first()
    if row is None:
        raise HTTPException(401, "Недействительный токен")
    if not row["is_active"]:
        raise HTTPException(401, "Учётная запись отключена")
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
            "SELECT username, password_hash, name, role, district, is_active "
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
    # Проверка после пароля: отдельное сообщение об отключении не должно
    # подсказывать постороннему, что такой логин существует.
    if not row["is_active"]:
        audit(
            action="login.disabled", username=row["username"], role=row["role"],
            method="POST", path="/auth/login", status_code=401, ip=ip,
        )
        raise HTTPException(401, "Учётная запись отключена — обратитесь к администратору")
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
            "station": _station_of(db, row["username"]),
        },
    }


def _station_of(db: Session, username: str) -> dict | None:
    """Пожарная часть пользователя (для боевых ролей).

    Резолвится из БД, а не из токена: привязку меняет администратор, и токен,
    выданный до перевода в другую часть, не должен продолжать указывать на
    прежнюю. По той же причине так устроен `_user_station` в dispatch.py.
    """
    row = db.execute(
        text(
            "SELECT s.id, s.name FROM users u "
            "JOIN fire_stations s ON s.id = u.station_id "
            "WHERE u.username = :u"
        ),
        {"u": username},
    ).mappings().first()
    return {"id": row["id"], "name": row["name"]} if row else None


@router.get("/me")
def me(user: dict = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    # Часть нужна фронту, чтобы показывать действия только там, где сервер их
    # разрешит: начальник караула ведёт технику своей части, а видит — всего
    # города (ему нужно знать, откуда идёт подкрепление).
    return {**user, "station": _station_of(db, user["username"])}


@router.get("/users")
def list_users(
    user: dict = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Реестр учётных записей для экрана администрирования (только admin).

    Вместе со списком отдаёт допустимые роли и районы — форма приёма сотрудника
    не должна знать их отдельно от бэкенда, иначе списки разъедутся.
    """
    rows = db.execute(
        text(
            """
            SELECT u.id, u.username, u.name, u.role, u.district, u.is_active,
                   u.created_at, u.disabled_at, u.disabled_by,
                   i.id AS inspector_id,
                   (SELECT count(*) FROM owner_buildings ob WHERE ob.user_id = u.id)
                       AS building_count
              FROM users u
              LEFT JOIN inspectors i ON i.user_id = u.id
             ORDER BY u.is_active DESC, u.role, u.username
            """
        )
    ).mappings().all()
    return {
        "users": [dict(r) for r in rows],
        "roles": list(ASSIGNABLE_ROLES),
        "districts": list(DISTRICTS),
    }


def _link_inspector_row(db: Session, user_id: int, name: str, district: str) -> int:
    """Связать учётную запись инспектора со строкой реестра `inspectors`.

    Без этой связи `resolve_inspector` (app/access.py) отдаёт 403 на собственный
    же маршрут: авторство акта проверки резолвится только через FK
    `inspectors.user_id`, сопоставление по ФИО как правило доступа неприемлемо.

    Если в реестре уже есть ровно одна непривязанная строка с тем же ФИО и
    районом — это тот же человек (реестр вели раньше учётных записей),
    привязываем её. Во всех остальных случаях (нет совпадений или их несколько)
    заводим новую строку: дубль в реестре безопаснее чужого авторства.
    """
    candidates = db.execute(
        text(
            "SELECT id FROM inspectors "
            "WHERE user_id IS NULL AND name = :n AND district IS NOT DISTINCT FROM :d"
        ),
        {"n": name, "d": district},
    ).scalars().all()
    if len(candidates) == 1:
        db.execute(
            text("UPDATE inspectors SET user_id = :uid WHERE id = :id"),
            {"uid": user_id, "id": candidates[0]},
        )
        return int(candidates[0])
    return int(
        db.execute(
            text(
                "INSERT INTO inspectors (name, district, user_id) "
                "VALUES (:n, :d, :u) RETURNING id"
            ),
            {"n": name, "d": district, "u": user_id},
        ).scalar()
    )


@router.post("/users")
def create_user(
    body: UserCreate,
    request: Request,
    user: dict = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Завести учётную запись (только admin).

    Внутренние роли получают район (там, где он обязателен), внешний владелец —
    привязку к объектам. Для роли `inspector` одновременно создаётся/связывается
    строка реестра инспекторов — иначе новый сотрудник получит 403 на своём же
    маршруте.
    """
    taken = db.execute(
        text("SELECT 1 FROM users WHERE username = :u"), {"u": body.username}
    ).scalar()
    if taken:
        raise HTTPException(409, "Пользователь с таким логином уже существует")

    # Every linked building must exist — fail closed on an unknown id.
    ids = list(dict.fromkeys(body.building_ids))  # de-dupe, keep order
    if ids:
        found = db.execute(
            text("SELECT count(*) FROM buildings WHERE id = ANY(:ids)"),
            {"ids": ids},
        ).scalar()
        if int(found or 0) != len(ids):
            raise HTTPException(404, "Одно или несколько зданий не найдены")

    new_id = db.execute(
        text(
            """
            INSERT INTO users (username, password_hash, name, role, district)
            VALUES (:u, :p, :n, :r, :d)
            RETURNING id
            """
        ),
        {
            "u": body.username,
            "p": hash_password(body.password),
            "n": body.name,
            "r": body.role,
            "d": body.district,
        },
    ).scalar()
    for bid in ids:
        db.execute(
            text(
                "INSERT INTO owner_buildings (user_id, building_id) "
                "VALUES (:uid, :bid) ON CONFLICT DO NOTHING"
            ),
            {"uid": new_id, "bid": bid},
        )
    inspector_id = None
    if body.role == "inspector":
        inspector_id = _link_inspector_row(db, new_id, body.name, body.district)
    db.commit()

    audit(
        action="user.created",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path="/auth/users",
        status_code=200,
        ip=client_ip(request),
        detail={
            "username": body.username,
            "name": body.name,
            "role": body.role,
            "district": body.district,
            "building_ids": ids,
            "inspector_id": inspector_id,
        },
    )
    return {
        "id": new_id,
        "username": body.username,
        "name": body.name,
        "role": body.role,
        "district": body.district,
        "building_ids": ids,
        "inspector_id": inspector_id,
    }


def _target_user(db: Session, username: str) -> dict:
    row = db.execute(
        text("SELECT id, username, name, role, is_active FROM users WHERE username = :u"),
        {"u": username},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Пользователь не найден")
    return dict(row)


@router.post("/users/{username}/disable")
def disable_user(
    username: str,
    request: Request,
    user: dict = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Отключить учётную запись — настоящее закрытие доступа (только admin).

    Снимает `is_active` И штампует `sessions_revoked_at`: уже выданные токены
    умирают сразу, вход по паролю больше не проходит. Запись пользователя не
    удаляется — иначе развалилось бы авторство актов и журнала аудита.
    """
    if username == user["username"]:
        raise HTTPException(400, "Нельзя отключить собственную учётную запись")

    target = _target_user(db, username)
    if target["role"] == "admin":
        # Иначе одним запросом можно оставить систему без администратора —
        # включить обратно будет некому.
        others = db.execute(
            text(
                "SELECT count(*) FROM users "
                "WHERE role = 'admin' AND is_active AND username <> :u"
            ),
            {"u": username},
        ).scalar()
        if not int(others or 0):
            raise HTTPException(
                409, "Это последний действующий администратор — отключить его нельзя"
            )

    db.execute(
        text(
            "UPDATE users SET is_active = FALSE, disabled_at = now(), "
            "disabled_by = :by, sessions_revoked_at = now() WHERE username = :u"
        ),
        {"by": user["username"], "u": username},
    )
    db.commit()

    audit(
        action="user.disabled",
        username=user["username"],
        role=user["role"],
        method="POST",
        path=f"/auth/users/{username}/disable",
        status_code=200,
        ip=client_ip(request),
        detail={"target": username, "target_name": target["name"], "target_role": target["role"]},
    )
    return {"ok": True, "username": username, "is_active": False}


@router.post("/users/{username}/enable")
def enable_user(
    username: str,
    request: Request,
    user: dict = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Включить ранее отключённую учётную запись (только admin).

    `sessions_revoked_at` намеренно не сбрасывается: токены, выданные до
    отключения, должны остаться мёртвыми — сотрудник входит заново.
    """
    target = _target_user(db, username)
    db.execute(
        text(
            "UPDATE users SET is_active = TRUE, disabled_at = NULL, "
            "disabled_by = NULL WHERE username = :u"
        ),
        {"u": username},
    )
    db.commit()

    audit(
        action="user.enabled",
        username=user["username"],
        role=user["role"],
        method="POST",
        path=f"/auth/users/{username}/enable",
        status_code=200,
        ip=client_ip(request),
        detail={"target": username, "target_name": target["name"], "target_role": target["role"]},
    )
    return {"ok": True, "username": username, "is_active": True}


@router.post("/users/{username}/password")
def reset_password(
    username: str,
    body: PasswordReset,
    request: Request,
    user: dict = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Сбросить пароль пользователя (только admin).

    Смена пароля завершает все активные сессии: старый токен не должен пережить
    сброс. Сам пароль в журнал аудита не попадает — только факт сброса.
    """
    target = _target_user(db, username)
    db.execute(
        text(
            "UPDATE users SET password_hash = :p, sessions_revoked_at = now() "
            "WHERE username = :u"
        ),
        {"p": hash_password(body.password), "u": username},
    )
    db.commit()

    audit(
        action="user.password_reset",
        username=user["username"],
        role=user["role"],
        method="POST",
        path=f"/auth/users/{username}/password",
        status_code=200,
        ip=client_ip(request),
        detail={"target": username, "target_role": target["role"]},
    )
    return {"ok": True, "username": username}


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

    Это НЕ закрытие доступа: пароль остаётся действующим и пользователь войдёт
    заново. Для увольнения — POST /auth/users/{username}/disable.
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
