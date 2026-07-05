"""Role-based district scoping.

Leadership and admin see the whole city; inspectors and supervisors are confined
to their assigned district (defence in depth — enforced server-side regardless of
any client-supplied `district` filter). A scoped user without an assigned district
sees nothing, which is the safe default.
"""

from __future__ import annotations

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
