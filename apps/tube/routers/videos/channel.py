import asyncio
import time

import yt_api

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core import get_client, get_instances

router = APIRouter()

# ── Channel home ──────────────────────────────────────────────────────────────

_CHANNEL_HOME_BASE = "https://choco-youtube-js.onrender.com"


_HOME_CACHE: dict = {}
_HOME_TTL = 600


def _home_sections_of(d) -> list:
    try:
        secs = (((d or {}).get("current_tab") or {}).get("content") or {}).get("contents") or []
        return [it for sec in secs for it in (sec.get("contents") or [])]
    except Exception:
        return []


async def _choco_home(channel_id: str) -> dict:
    client = await get_client()
    last = None
    # 外部 API は休止からの起動に時間がかかることがあるため、長めに待ち 1 回だけやり直す
    for attempt in range(2):
        try:
            resp = await client.get(f"{_CHANNEL_HOME_BASE}/channel/{channel_id}", timeout=25 if attempt == 0 else 15)
            if resp.status_code == 404:
                return {"_not_found": True}
            resp.raise_for_status()
            d = resp.json()
            if isinstance(d, dict) and not d.get("error") and d.get("current_tab") is not None:
                return d
            last = Exception(str(d.get("error") if isinstance(d, dict) else "bad data"))
        except Exception as e:
            last = e
        await asyncio.sleep(0.8)
    raise last or Exception("choco failed")


@router.get("/api/channel-home/{channel_id}")
async def api_channel_home(channel_id: str):
    """チャンネルのホームタブ。
    200 + セクションあり: 表示できる / 200 + has_home=false: 本当にホームが無い / 502: 一時的に取得できない"""
    now = time.time()
    c = _HOME_CACHE.get(channel_id)
    if c and now - c["t"] < _HOME_TTL:
        return JSONResponse(c["d"])

    choco_t = asyncio.ensure_future(_choco_home(channel_id))
    it_t = asyncio.ensure_future(yt_api.get_channel_home(channel_id))
    choco = it = None
    choco_err = it_err = None

    # 本家のデータ (InnerTube) をまず待ち、外部 API が少し遅れても間に合えばそちらを使う
    try:
        it = await asyncio.wait_for(asyncio.shield(it_t), timeout=14)
    except Exception as e:
        it_err = e
    try:
        choco = await asyncio.wait_for(asyncio.shield(choco_t), timeout=2.0 if it and it.get("has_home") else 30)
    except Exception as e:
        choco_err = e
    for t in (choco_t, it_t):
        if not t.done():
            t.cancel()

    data = None
    if choco and _home_sections_of(choco):
        data = choco
    elif it and it.get("has_home"):
        data = it
    if data is not None:
        data = dict(data)
        data["has_home"] = True
        _HOME_CACHE[channel_id] = {"t": now, "d": data}
        if len(_HOME_CACHE) > 300:
            _HOME_CACHE.pop(next(iter(_HOME_CACHE)))
        return JSONResponse(data)

    # どこかが正常に答えたうえでセクションが無い = 本当にホームが無い
    if (it and not it_err) or (choco and not choco_err):
        return JSONResponse({"has_home": False, "current_tab": None, "not_found": bool((it or {}).get("not_found") or (choco or {}).get("_not_found"))})
    return JSONResponse({"error": "ホームを一時的に取得できませんでした", "temporary": True}, status_code=502)


# ── Instances list ────────────────────────────────────────────────────────────

@router.get("/api/instances")
async def api_instances():
    categories = [
        "video", "search", "trending", "trending_music", "trending_gaming",
        "trending_news", "trending_movies", "channel", "channel_videos",
        "channel_shorts", "channel_streams", "channel_latest", "channel_playlists",
        "channel_comments", "channel_search", "playlist", "mix", "hashtag",
        "comments", "transcripts", "captions", "annotations", "clip",
        "resolveurl", "popular", "stats", "search_suggestions", "search_filters",
    ]
    results = await asyncio.gather(
        *[get_instances(cat) for cat in categories],
        return_exceptions=True,
    )
    all_instances = {
        cat: result
        for cat, result in zip(categories, results)
        if not isinstance(result, Exception)
    }
    return JSONResponse({"all": all_instances})
