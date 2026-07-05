from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.audit import audit, client_ip
from app.chat import ChatError, ask
from app.routers.auth import require_roles

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


@router.post("")
def chat(
    req: ChatRequest,
    request: Request,
    # Mirrors ask()'s own restriction: the analyst runs free-form SELECTs across
    # districts, so scoped roles (inspector/supervisor) are excluded (ПДн).
    user: dict = Depends(require_roles("leadership", "admin")),
) -> dict:
    try:
        result = ask(req.question, user)
    except ChatError as err:
        # Audit the attempt too — a rejected/failed analyst query over ПДн data
        # is itself security-relevant.
        audit(
            action="chat.query.failed",
            username=user.get("username"),
            role=user.get("role"),
            method="POST",
            path="/chat",
            status_code=400,
            ip=client_ip(request),
            detail={"question": req.question, "error": str(err)},
        )
        raise HTTPException(400, str(err)) from err

    audit(
        action="chat.query",
        username=user.get("username"),
        role=user.get("role"),
        method="POST",
        path="/chat",
        status_code=200,
        ip=client_ip(request),
        detail={"question": req.question, "sql": result.get("sql"), "rows": result.get("row_count")},
    )
    return result
