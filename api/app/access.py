"""Role-based district scoping.

Leadership and admin see the whole city; inspectors and supervisors are confined
to their assigned district (defence in depth — enforced server-side regardless of
any client-supplied `district` filter). A scoped user without an assigned district
sees nothing, which is the safe default.
"""

from __future__ import annotations

FULL_ACCESS_ROLES = frozenset({"leadership", "admin"})


def has_full_access(user: dict) -> bool:
    return user.get("role") in FULL_ACCESS_ROLES


def enforce_building_scope(clauses: list[str], params: dict, user: dict, alias: str = "b") -> None:
    """Append a district restriction to a buildings query for scoped roles.

    No-op for leadership/admin. For scoped roles, restricts to the user's
    district; if they have none, the clause matches no rows (fail closed).
    """
    if has_full_access(user):
        return
    clauses.append(f"{alias}.district IS NOT DISTINCT FROM :scope_district")
    params["scope_district"] = user.get("district")
