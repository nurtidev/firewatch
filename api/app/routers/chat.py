from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.chat import ChatError, ask

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


@router.post("")
def chat(req: ChatRequest) -> dict:
    try:
        return ask(req.question)
    except ChatError as err:
        raise HTTPException(400, str(err)) from err
