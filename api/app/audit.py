"""Audit trail — who did what, when. Required for ДЧС/gov accountability.

Every state-changing request (POST/PUT/PATCH/DELETE) and every login is written
to audit_log. Writes are best-effort: an audit failure must never break the
business request, but failures are logged to stderr so they are not silent.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text

from app.config import settings
from app.db import engine

log = logging.getLogger("firewatch.audit")


def client_ip(request: Any) -> str | None:
    """Real client IP for the audit trail.

    Behind a trusted proxy (Cloudflare) the socket peer is the proxy, so the
    real client is the leftmost entry of X-Forwarded-For. Only trusted when
    FW_TRUST_PROXY_HEADERS is set — otherwise the header is client-spoofable and
    we use the socket peer.
    """
    if settings.trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def audit(
    *,
    action: str,
    username: str | None,
    role: str | None,
    method: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    ip: str | None = None,
    detail: dict | None = None,
) -> None:
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO audit_log
                        (username, role, action, method, path, status_code, ip, detail)
                    VALUES
                        (:u, :r, :a, :m, :p, :s, :ip, CAST(:d AS JSONB))
                    """
                ),
                {
                    "u": username,
                    "r": role,
                    "a": action,
                    "m": method,
                    "p": path,
                    "s": status_code,
                    "ip": ip,
                    "d": json.dumps(detail, ensure_ascii=False) if detail else None,
                },
            )
    except Exception as err:  # noqa: BLE001 — auditing must not break requests
        log.warning("audit write failed: %s", err)
