"""A tiny FastAPI app used to test endpoint discovery."""

from fastapi import APIRouter, Depends, FastAPI
from pydantic import BaseModel


class WidgetIn(BaseModel):
    name: str
    size: int = 1


app = FastAPI()
router = APIRouter(prefix="/items")


def current_user() -> str:
    return "me"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/{item_id}/notes", status_code=201, dependencies=[Depends(current_user)])
def add_note(item_id: int, body: WidgetIn, verbose: bool = False) -> dict[str, int]:
    return {"id": item_id}


app.include_router(router)
