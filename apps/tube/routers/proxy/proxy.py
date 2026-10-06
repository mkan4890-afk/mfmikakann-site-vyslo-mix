import asyncio
import json
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from core import (
    CHANNEL_VIDEO_CATEGORIES, _CH_TAB_RE,
    _apply_enrichment, _innertube_cont_get, _innertube_cont_set,
    _innertube_to_invidious, fetch_innertube_continuation,
    fetch_innertube_videos, get_instances, get_video_back_instances,
    map_path, proxy_parallel,
)

from routers.proxy import bridge
import jp_filter

router = APIRouter()

_JP_PATHS = ("/api/search", "/api/trending", "/api/popular", "/api/hashtag/", "/api/stream/", "/api/videos/")


def _has_valid_videos_safe(r) -> bool:
    try:
        d = r["data"]
        items = d if isinstance(d, list) else (d.get("videos") or d.get("playlists") or [])
        return any(isinstance(i, dict) and not i.get("errorMessage") and (i.get("videoId") or i.get("playlistId")) for i in items)
    except Exception:
        return False


@router.get("/proxy/main/{path:path}")
async def proxy_main(path: str, request: Request):
    qs = request.url.query
    app_path = "/" + path + ("?" + qs if qs else "")
    resp = await _proxy_main(app_path, request)
    # 日本の動画を優先する (検索・急上昇・関連動画など)
    if app_path.startswith(_JP_PATHS) and not app_path.startswith("/api/search/suggestions"):
        try:
            if getattr(resp, "status_code", 0) == 200 and isinstance(resp, JSONResponse):
                data = json.loads(resp.body)
                return JSONResponse(jp_filter.for_app_path(app_path, data))
        except Exception:
            pass
    return resp


async def _proxy_main(app_path: str, request: Request):
    try:
        bridged = await bridge.handle(app_path)
    except Exception:
        bridged = None
    if bridged is not None:
        return bridged
    category, invidious_path = map_path(app_path)

    ch_match = _CH_TAB_RE.match(app_path) if category in CHANNEL_VIDEO_CATEGORIES else None
    channel_id = ch_match.group(1) if ch_match else None
    tab = ch_match.group(2) if ch_match else None

    if ch_match:
        inv_cont_in = request.query_params.get("continuation")
        innertube_cont_key = _innertube_cont_get(channel_id, tab, inv_cont_in) if inv_cont_in else None

        invidious_task = asyncio.create_task(
            proxy_parallel(category, invidious_path, prefer_valid_videos=True)
        )
        if innertube_cont_key:
            innertube_task = asyncio.create_task(fetch_innertube_continuation(innertube_cont_key))
        else:
            innertube_task = asyncio.create_task(fetch_innertube_videos(channel_id, tab))

        innertube_result = ([], None)
        try:
            innertube_result = await asyncio.wait_for(innertube_task, timeout=8.0)
        except (asyncio.TimeoutError, Exception):
            innertube_result = ([], None)

        try:
            inv_result = await invidious_task
        except Exception as e:
            inv_result = e

        innertube_items, new_innertube_cont_key = (
            innertube_result if isinstance(innertube_result, tuple) else (innertube_result, None)
        )

        if isinstance(inv_result, Exception) or not _has_valid_videos_safe(inv_result):
            fb = await bridge.fallback_channel_tab(app_path)
            if fb:
                return JSONResponse(fb)
        if isinstance(inv_result, Exception):
            if innertube_items:
                fallback = _innertube_to_invidious(innertube_items, channel_id)
                return JSONResponse(fallback if tab == "latest" else {"videos": fallback, "continuation": None})
            return JSONResponse({"error": str(inv_result)}, status_code=502)

        if new_innertube_cont_key:
            inv_data = inv_result["data"]
            inv_cont_out = inv_data.get("continuation") if isinstance(inv_data, dict) else None
            if inv_cont_out:
                _innertube_cont_set(channel_id, tab, inv_cont_out, new_innertube_cont_key)

        data = _apply_enrichment(inv_result["data"], innertube_items, channel_id)
        return JSONResponse(data)

    try:
        result = await proxy_parallel(category, invidious_path)
        return JSONResponse(result["data"])
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@router.get("/proxy/stream/{path:path}")
async def proxy_stream(path: str, request: Request):
    try:
        params = dict(request.query_params)
        exclude_list = [s.strip() for s in params.pop("exclude", "").split(",") if s.strip()]
        qs = urlencode(params) if params else ""
        app_path = "/" + path + ("?" + qs if qs else "")
        _, invidious_path = map_path(app_path)

        try:
            vb_instances = await get_video_back_instances()
        except Exception:
            vb_instances = []
        if not vb_instances:
            vb_instances = await get_instances("video")

        result = await proxy_parallel(
            "video", invidious_path, exclude_list,
            prefer_valid_stream=True, override_instances=vb_instances,
        )
        headers = {}
        if result.get("used_instance"):
            headers["X-Instance-Used"] = result["used_instance"]
        return JSONResponse(result["data"], headers=headers)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
