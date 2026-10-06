import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import RedirectResponse

import core
from routers import pages, static
from routers.proxy import proxy, thumb
from routers.videos import watch, channel, shorts, search, download, feed, livechat, livehls

AUTH_COOKIE_NAME = "choco_auth"
AUTH_COOKIE_VALUE = "choco_session_ok"
CF_WORKER_URL = "https://api-nemu.myproxy0108.workers.dev"

# パスを完全一致 or prefix で許可するリスト（ログイン不要）
_PUBLIC_EXACT = {"/login", "/api/login", "/forgot", "/api/quiz-login", "/whats", "/version"}
_PUBLIC_PREFIX = ("/static/", "/photo/", "/proxy/", "/thumb/")


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if path in _PUBLIC_EXACT or path.startswith(_PUBLIC_PREFIX):
            return await call_next(request)
        token = request.cookies.get(AUTH_COOKIE_NAME)
        if token != AUTH_COOKIE_VALUE:
            return RedirectResponse(url="/login")
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    core.http_client = httpx.AsyncClient(
        timeout=core._CLIENT_TIMEOUT,
        limits=core._CLIENT_LIMITS,
        follow_redirects=True,
    )
    task = asyncio.create_task(core._periodic_keepalive())
    # LIVE の中継で使う WARP の出口を先に用意しておく (最初の視聴者を待たせないため)
    from routers.videos import warp as _warp
    warp_task = asyncio.create_task(_warp.ensure())
    yield
    warp_task.cancel()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await core.http_client.aclose()


app = FastAPI(lifespan=lifespan)

app.include_router(proxy.router)
app.include_router(thumb.router)
app.include_router(shorts.router)
app.include_router(watch.router)
app.include_router(livechat.router)
app.include_router(livehls.router)
app.include_router(channel.router)
app.include_router(search.router)
app.include_router(download.router)
app.include_router(feed.router)
app.include_router(static.router)
app.include_router(pages.router)

app.mount("/static", StaticFiles(directory="templates/static"), name="static")

class StaticCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "public, max-age=86400"
        else:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


# AuthMiddleware disabled for public access
# app.add_middleware(AuthMiddleware)
app.add_middleware(StaticCacheMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)
