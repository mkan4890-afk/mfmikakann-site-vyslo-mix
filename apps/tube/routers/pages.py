import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.responses import RedirectResponse

import core
from core import templates
from routers.videos.watch import _EDU_PARAMS_CACHE

import os
HARDCODED_PASSWORD = os.environ.get("LOGIN_PASSWORD", "choco")
AUTH_COOKIE_NAME = "choco_auth"
AUTH_COOKIE_VALUE = "choco_session_ok"
WELCOME_COOKIE_NAME = "choco_welcome_seen"
CURRENT_VERSION = "1.42"

router = APIRouter()

ACCESS_COUNTER_URL = "https://choco-access-counter.onrender.com/api/count"


async def _fetch_access_count() -> int:
    try:
        resp = await core.http_client.get(
            ACCESS_COUNTER_URL,
            headers={
                "Cache-Control": "no-store, no-cache",
                "Pragma": "no-cache",
            },
            extensions={"cache_disabled": True},
        )
        if resp.status_code == 200:
            return resp.json().get("count", 0)
    except Exception:
        pass
    return 0


@router.get("/")
async def index_page(request: Request):
    self_url = str(request.base_url).rstrip("/")
    if not core._keepalive_self_url:
        core._keepalive_self_url = self_url
    asyncio.create_task(core._ping_keepalive(self_url))
    return templates.TemplateResponse(request, "index.html", {"active": "home"})


@router.get("/trending")
async def trending_page(request: Request):
    return templates.TemplateResponse(request, "trending.html", {"active": "trending"})


@router.get("/dl")
async def dl_page(request: Request):
    # ダウンロード用の別画面は廃止 (動画ページのダウンロードボタンに統一)
    v = request.query_params.get("v", "")
    if v:
        from urllib.parse import quote
        return RedirectResponse(f"/watch?v={quote(v)}", status_code=302)
    return RedirectResponse("/", status_code=302)


@router.get("/watch")
async def watch_page(request: Request):
    return templates.TemplateResponse(request, "watch.html")


_SHORTS_SEEDS = ["ショート", "おもしろ", "ゲーム", "音楽", "アニメ", "猫", "料理", "スポーツ"]


@router.get("/shorts")
async def shorts_entry(request: Request):
    """サイドバーの Shorts: 画面側で視聴履歴・人気動画からおすすめの1本目を選ぶ"""
    cached = _EDU_PARAMS_CACHE.get("data")
    edu_params_json = json.dumps(cached["json"] if cached else [])
    return templates.TemplateResponse(request, "shorts.html", {"edu_params_json": edu_params_json})


@router.get("/shorts/{video_id}")
async def shorts_page(request: Request, video_id: str):
    cached = _EDU_PARAMS_CACHE.get("data")
    edu_params_json = json.dumps(cached["json"] if cached else [])
    return templates.TemplateResponse(request, "shorts.html", {"edu_params_json": edu_params_json})


@router.get("/search")
async def search_page(request: Request):
    return templates.TemplateResponse(request, "search.html")


@router.get("/channel")
async def channel_page(request: Request):
    return templates.TemplateResponse(request, "channel.html")


@router.get("/playlist")
async def playlist_page(request: Request):
    return templates.TemplateResponse(request, "playlist.html")


@router.get("/hashtag")
async def hashtag_page(request: Request):
    return templates.TemplateResponse(request, "hashtag.html")


@router.get("/mix")
async def mix_page(request: Request):
    return templates.TemplateResponse(request, "mix.html")


@router.get("/library")
async def library_page(request: Request):
    return templates.TemplateResponse(request, "library.html", {"active": "library"})


@router.get("/history")
async def history_page(request: Request):
    return templates.TemplateResponse(request, "history.html", {"active": "history"})


@router.get("/subscriptions")
async def subscriptions_page(request: Request):
    return templates.TemplateResponse(request, "subscriptions.html", {"active": "subs"})


@router.get("/settings")
async def settings_page(request: Request):
    # 設定ページは廃止
    return RedirectResponse(url="/", status_code=302)


@router.get("/links")
async def links_page(request: Request):
    return RedirectResponse(url="/", status_code=302)


@router.get("/about")
async def about_page(request: Request):
    return RedirectResponse(url="/", status_code=302)


@router.get("/contact")
async def contact_page(request: Request):
    return RedirectResponse(url="/", status_code=302)


@router.get("/login")
async def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html")


@router.get("/forgot")
async def forgot_page(request: Request):
    return templates.TemplateResponse(request, "forgot.html")


@router.post("/api/quiz-login")
async def api_quiz_login(request: Request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "message": "リクエストが無効です"}, status_code=400)

    score = data.get("score", 0)
    total = data.get("total", 5)

    if score < 3:
        return JSONResponse({"ok": False, "message": "正解数が足りません"}, status_code=401)

    seen_welcome = request.cookies.get(WELCOME_COOKIE_NAME)
    redirect_url = "/"
    response = JSONResponse({"ok": True, "redirect": redirect_url})
    response.set_cookie(
        AUTH_COOKIE_NAME,
        AUTH_COOKIE_VALUE,
        httponly=True,
        samesite="lax",
        max_age=86400 * 30,
    )
    return response


@router.post("/api/login")
async def api_login(request: Request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "message": "リクエストが無効です"}, status_code=400)

    password = (data.get("password") or "").strip()

    if password and password != HARDCODED_PASSWORD:
        return JSONResponse({"ok": False, "message": "パスワードが正しくありません"}, status_code=401)

    seen_welcome = request.cookies.get(WELCOME_COOKIE_NAME)
    redirect_url = "/"
    response = JSONResponse({"ok": True, "redirect": redirect_url})
    response.set_cookie(
        AUTH_COOKIE_NAME,
        AUTH_COOKIE_VALUE,
        httponly=True,
        samesite="lax",
        max_age=86400 * 30,
    )
    return response


@router.get("/logout")
async def logout():
    response = RedirectResponse(url="/login")
    response.delete_cookie(AUTH_COOKIE_NAME)
    return response
