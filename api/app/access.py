"""Role-based district scoping.

Leadership and admin see the whole city; inspectors and supervisors are confined
to their assigned district (defence in depth — enforced server-side regardless of
any client-supplied `district` filter). A scoped user without an assigned district
sees nothing, which is the safe default.
"""

from __future__ import annotations

from collections.abc import Mapping

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

# Privilege roles — admin functions that must stay narrow: reading the audit
# trail, revoking other users' sessions, the free-SQL ИИ-аналитик. NEVER widen
# this for the боевой roles; they get data, not privileges.
FULL_ACCESS_ROLES = frozenset({"leadership", "admin"})

# Roles that see the whole city in DATA (but hold no admin privileges). Command
# staff plus the боевой-модуль roles: a dispatcher (ЦОУ/112) registers callouts
# anywhere in the city and the начальник караула/РТП reads the боевой пакет for
# any object — neither is bound to a district. Distinct from FULL_ACCESS_ROLES
# so that data scoping opens up without also opening privileged endpoints.
CITYWIDE_ROLES = frozenset({"leadership", "admin", "dispatcher", "responder"})


def has_full_access(user: dict) -> bool:
    return user.get("role") in FULL_ACCESS_ROLES


def has_citywide_data_access(user: dict) -> bool:
    """True when the user sees the whole city's data (not necessarily privileged)."""
    return user.get("role") in CITYWIDE_ROLES


def enforce_building_scope(clauses: list[str], params: dict, user: dict, alias: str = "b") -> None:
    """Append a district restriction to a buildings query for scoped roles.

    No-op for citywide roles (leadership/admin + dispatcher/responder). For
    scoped roles, restricts to the user's district. A scoped user with no
    assigned district gets a clause that matches no rows at all (fail closed) —
    binding NULL would instead match every row with a NULL district via
    `IS NOT DISTINCT FROM`.
    """
    if has_citywide_data_access(user):
        return
    district = user.get("district")
    if district is None:
        clauses.append("FALSE")
        return
    clauses.append(f"{alias}.district IS NOT DISTINCT FROM :scope_district")
    params["scope_district"] = district


# --- Реестр инспекторов ↔ учётные записи ------------------------------------
#
# `inspectors` — реестр (кто ведёт участок), `users` — учётные записи. Связь
# между ними одна: FK `inspectors.user_id` (миграция 0013_scoping_links).
# Сопоставление по ФИО сознательно не используется: в тех же демо-данных
# «Сулейменова А.Б.» — и пользователь Есильского района, и инспектор
# Алматинского, то есть совпадение имени связало бы разные подразделения и
# отдало бы авторство акта не тому человеку.


def linked_inspector(db: Session, user: dict) -> Mapping | None:
    """Строка реестра `inspectors`, привязанная к учётной записи по FK."""
    return db.execute(
        text(
            "SELECT i.id, i.name, i.district FROM inspectors i "
            "JOIN users u ON u.id = i.user_id WHERE u.username = :u"
        ),
        {"u": user.get("username")},
    ).mappings().first()


def resolve_inspector(db: Session, user: dict, inspector_id: int | None) -> Mapping:
    """Определить инспектора, от чьего имени выполняется действие, и проверить право.

    - `inspector` — только собственная запись реестра: чужой `inspector_id` даёт
      403, отсутствие привязки — тоже 403 (fail closed, иначе акт подписывается
      неизвестно кем). Параметр можно не передавать вовсе.
    - `supervisor` — любой инспектор своего района; чужой район — 403.
    - `admin` — любой инспектор (общегородская роль).

    Возвращает строку реестра; вызывающий обязан брать `inspector_id` из неё, а
    не из запроса.
    """
    if user.get("role") == "inspector":
        own = linked_inspector(db, user)
        if own is None:
            raise HTTPException(
                403,
                "Учётная запись не связана с инспектором в реестре — "
                "обратитесь к администратору",
            )
        if inspector_id is not None and int(inspector_id) != int(own["id"]):
            raise HTTPException(403, "Доступен только собственный маршрут")
        return own

    if inspector_id is None:
        own = linked_inspector(db, user)
        if own is not None:
            return own
        raise HTTPException(422, "Укажите инспектора (inspector_id)")

    row = db.execute(
        text("SELECT id, name, district FROM inspectors WHERE id = :id"),
        {"id": inspector_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "Инспектор не найден")
    if not has_citywide_data_access(user):
        district = user.get("district")
        if district is None or row["district"] != district:
            raise HTTPException(403, "Инспектор другого района")
    return row
