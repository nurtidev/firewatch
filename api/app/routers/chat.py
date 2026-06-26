from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.chat import ChatError, ask
from app.routers.auth import current_user

router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(current_user)],
)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


@router.post("")
def chat(req: ChatRequest) -> dict:
    try:
        return ask(req.question)
    except ChatError as err:
        raise HTTPException(400, str(err)) from err
