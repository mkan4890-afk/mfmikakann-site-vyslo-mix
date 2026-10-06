import asyncio
import time

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core import get_client

router = APIRouter()


@router.get("/whats")
async def whats():
    return {"name": "vyslo-tube"}


@router.get("/version")
async def version():
    return {"ver": "2.3"}
