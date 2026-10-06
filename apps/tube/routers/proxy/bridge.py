"""/proxy/main/* の前段で InnerTube を使い、取得漏れ・失敗をなくすブリッジ"""
from __future__ import annotations

import asyncio
import random
import re
from urllib.parse import parse_qs, urlsplit

from fastapi.responses import JSONResponse

import yt_api
from core import map_path, proxy_parallel

_VIDEO_RE = re.compile(r"^/api/(videos|stream)/([A-Za-z0-9_-]{11})")
_COMMENTS_RE = re.compile(r"^/api/comments/([A-Za-z0-9_-]{11})")
_CH_RE = re.compile(r"^/api/channels/([^/?]+)(?:/(videos|shorts|streams|latest|playlists))?/?(?:\?|$)")

# 急上昇が取れないとき用の検索ワード (今週・再生回数順)
_TREND_WORDS = {
    "": ["急上昇", "話題", "人気"],
    "music": ["MV", "新曲", "歌ってみた"],
    "gaming": ["ゲーム実況", "マイクラ", "フォートナイト"],
    "news": ["ニュース", "速報"],
    "movies": ["映画 予告", "予告編"],
}
_SP_WEEK_VIEWS = "CAMSAggD"  # 今週 + 再生回数順


def _q(app_path: str) -> dict:
    qs = urlsplit(app_path).query
    return {k: v[0] for k, v in parse_qs(qs).items()}


async def _inv(app_path: str, **kw):
    category, inv_path = map_path(app_path)
    r = await proxy_parallel(category, inv_path, **kw)
    return r["data"]


async def _safe(coro, timeout: float):
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except Exception:
        return None


def _ok_list(d) -> bool:
    if isinstance(d, list):
        return any(isinstance(x, dict) and (x.get("videoId") or x.get("authorId") or x.get("playlistId")) for x in d)
    return False


# 検索の続き (ページ) を取るための継続トークン: (検索語, 種類, 並び) → {ページ番号: トークン}
_SEARCH_CONT: dict = {}
_SEARCH_CONT_MAX = 300


def _cont_slot(q: str, type_: str, sort: str) -> dict:
    k = (q, type_, sort)
    slot = _SEARCH_CONT.get(k)
    if slot is None:
        if len(_SEARCH_CONT) >= _SEARCH_CONT_MAX:
            _SEARCH_CONT.pop(next(iter(_SEARCH_CONT)))
        slot = _SEARCH_CONT[k] = {}
    return slot


async def _search_first(q: str, type_: str, sort: str) -> tuple[list, str | None]:
    """1 ページ目: InnerTube → だめなら検索ページの HTML。どちらも失敗なら例外 (0 件とは区別する)"""
    try:
        return await asyncio.wait_for(yt_api.search(q, type_, sort=sort), timeout=8)
    except Exception:
        return await asyncio.wait_for(yt_api.search_html(q, type_, sort), timeout=10)


async def _search_pages(q: str, type_: str, page: int, sort: str) -> tuple[list, bool]:
    """InnerTube の検索を page まで進める。前回までの継続トークンを覚えておき、毎回 1 ページ目からたどらない。
    戻り値: (結果, 続きがあるか)。取得に失敗したときは例外。"""
    slot = _cont_slot(q, type_, sort)
    if page <= 1:
        items, cont = await _search_first(q, type_, sort)
        slot[1] = cont
        return items, bool(cont)
    # いちばん近い既知のページから進める
    known = max([p for p in slot if p < page and slot.get(p)] or [0])
    if known == 0:
        items, cont = await _search_first(q, type_, sort)
        slot[1] = cont
        known = 1
        if not cont:
            return [], False
    p, cont = known, slot[known]
    items: list = []
    while p < page:
        if not cont:
            return [], False  # 本当に最後まで来た
        items, cont = await asyncio.wait_for(yt_api.search(q, type_, continuation=cont), timeout=8)
        p += 1
        slot[p] = cont
    return items, bool(cont)


async def _trending_fallback(cat: str) -> list:
    words = _TREND_WORDS.get(cat, _TREND_WORDS[""])
    from urllib.parse import unquote
    async def one(w):
        try:
            resp = await yt_api._post("search", {"query": w, "params": unquote(_SP_WEEK_VIEWS)})
            it, _ = yt_api.parse_items(resp.get("contents") or {})
            return [i for i in it if i.get("type") == "video" and i.get("author")]
        except Exception:
            return []
    lists = await asyncio.gather(*(one(w) for w in words))
    seen, out = set(), []
    for lst in lists:
        for v in lst:
            if v["videoId"] in seen:
                continue
            seen.add(v["videoId"])
            out.append(v)
    out.sort(key=lambda v: v.get("viewCount", 0), reverse=True)
    return out[:60]


def _fill_thumbs(items: list, amap: dict) -> None:
    for v in items:
        if isinstance(v, dict) and not v.get("authorThumbnails") and amap.get(v.get("authorId")):
            v["authorThumbnails"] = amap[v["authorId"]]


async def handle(app_path: str):
    # ── 動画情報 ───────────────────────────────────────────
    m = _VIDEO_RE.match(app_path)
    if m:
        vid = m.group(2)
        res = await yt_api.race_video(_inv(app_path), vid, grace=2.5 if m.group(1) == "stream" else 2.0)
        if res is None:
            return JSONResponse({"error": "動画情報を取得できませんでした"}, status_code=502)
        return JSONResponse(res)

    # ── コメント ──────────────────────────────────────────
    m = _COMMENTS_RE.match(app_path)
    if m:
        vid = m.group(1)
        q = _q(app_path)
        cont = q.get("continuation")
        sort = "new" if q.get("sort_by") == "new" else "top"
        if cont and not cont.startswith("it:"):
            return None  # Invidious の継続は従来どおり
        it = await _safe(yt_api.get_comments(vid, sort, cont), 12)
        if it and (it.get("comments") or cont):
            return JSONResponse(it)
        if cont:
            return JSONResponse({"comments": [], "continuation": None, "videoId": vid})
        inv = await _safe(_inv(app_path), 15)
        if isinstance(inv, dict) and inv.get("comments") is not None:
            return JSONResponse(inv)
        return JSONResponse({"commentCount": 0, "videoId": vid, "comments": [], "continuation": None})

    # ── 検索候補 ──────────────────────────────────────────
    if app_path.startswith("/api/search/suggestions"):
        q = _q(app_path).get("q", "")
        s2 = await _safe(yt_api.suggestions(q), 3.5) or []
        if s2:
            return JSONResponse({"query": q, "suggestions": s2})
        inv = await _safe(_inv(app_path), 4)
        if isinstance(inv, dict) and inv.get("suggestions"):
            return JSONResponse(inv)
        return JSONResponse({"query": q, "suggestions": []})

    # ── 検索 ──────────────────────────────────────────────
    if app_path.startswith("/api/search"):
        q = _q(app_path)
        query = q.get("q", "")
        if not query:
            return None
        try:
            page = max(1, int(q.get("page", "1") or 1))
        except ValueError:
            page = 1
        type_ = q.get("type", "all")
        it_type = type_ if type_ in ("video", "channel", "playlist", "shorts") else "all"
        sort_q = q.get("sort") or q.get("sort_by") or "relevance"
        it_sort = "upload_date" if sort_q == "upload_date" else ""
        # 期間・長さ・特徴・再生回数順などは Invidious 側でしか絞り込めない
        has_filters = any(q.get(k) for k in ("date", "duration", "features")) or sort_q not in ("relevance", "", "upload_date")

        async def _it():
            return await _search_pages(query, it_type, page, it_sort)

        if has_filters:
            inv = await _safe(_inv(app_path), 12)
            if _ok_list(inv):
                return JSONResponse(inv)
            if isinstance(inv, list) and page > 1:
                return JSONResponse([])  # 絞り込みの続きが無い
            # 絞り込みなしの結果は返さない (条件と違う結果になるため)。空でも確実でなければ失敗扱い
            if isinstance(inv, list):
                # Invidious が空を返した: 念のためもう一度だけ確認
                inv2 = await _safe(_inv(app_path, ), 10)
                if _ok_list(inv2):
                    return JSONResponse(inv2)
                if isinstance(inv2, list):
                    return JSONResponse([])
            return JSONResponse({"error": "検索結果を一時的に取得できませんでした", "temporary": True}, status_code=502)

        # 通常の検索: InnerTube (本家と同じ並び・1 ページの件数が多い) を主に、Invidious で補う
        it_t = asyncio.ensure_future(_it())
        inv_t = asyncio.ensure_future(_safe(_inv(app_path), 7))
        it_res = None
        it_err = False
        try:
            it_res = await asyncio.wait_for(asyncio.shield(it_t), timeout=12)
        except Exception:
            it_err = True
        if it_res is not None:
            items, more = it_res
            inv = await _safe(asyncio.shield(inv_t), 1.5) if page == 1 else None
            if not inv_t.done():
                inv_t.cancel()
            if items:
                # Invidious にだけあるものを後ろに足す / アイコンを補う
                if _ok_list(inv):
                    have = {v.get("videoId") or v.get("playlistId") or v.get("authorId") for v in items}
                    amap = {v["authorId"]: v["authorThumbnails"] for v in items if v.get("authorId") and v.get("authorThumbnails")}
                    _fill_thumbs(inv, amap)
                    for v in inv:
                        k = v.get("videoId") or v.get("playlistId") or v.get("authorId")
                        if k and k not in have:
                            have.add(k)
                            items.append(v)
                return JSONResponse(items)
            if _ok_list(inv):
                return JSONResponse(inv)
            # InnerTube が「結果の枠はあるが 0 件」と答えた = 本当に 0 件 (2 ページ目以降なら最後まで来た)
            return JSONResponse([])
        inv = await _safe(inv_t, 7)
        if _ok_list(inv):
            return JSONResponse(inv)
        # どちらからも取れなかった: 0 件ではなく一時的な失敗として返す
        return JSONResponse({"error": "検索結果を一時的に取得できませんでした", "temporary": True}, status_code=502)

    # ── チャンネル ────────────────────────────────────────
    m = _CH_RE.match(app_path)
    if m:
        cid, tab = m.group(1), m.group(2)
        q = _q(app_path)
        cont = q.get("continuation")
        if tab is None:
            it_t = asyncio.ensure_future(yt_api.get_channel(cid))
            inv = await _safe(_inv(app_path), 8)
            if isinstance(inv, dict) and inv.get("author"):
                it = await _safe(asyncio.shield(it_t), 1.5)
                if it:
                    for k in ("authorThumbnails", "authorBanners", "subCount", "description", "channelHandle", "subCountText"):
                        if not inv.get(k) and it.get(k):
                            inv[k] = it[k]
                return JSONResponse(inv)
            it = await _safe(it_t, 10)
            if it:
                return JSONResponse(it)
            return JSONResponse({"error": "チャンネルを取得できませんでした"}, status_code=502)
        if cont and cont.startswith("it:"):
            data = await _safe(yt_api.get_channel_tab(cid, tab, cont), 12) or {"videos": [], "continuation": None}
            return JSONResponse(data if tab != "latest" else data.get("videos", []))
        return None  # 既存の処理 (Invidious + 補完) に任せ、失敗時は fallback_channel_tab で拾う

    # ── 急上昇 / 人気 ─────────────────────────────────────
    if app_path.startswith("/api/trending") or app_path.startswith("/api/popular"):
        mm = re.match(r"^/api/trending/(music|gaming|news|movies)", app_path)
        cat = mm.group(1) if mm else ""
        inv = await _safe(_inv(app_path), 9)
        if _ok_list(inv):
            return JSONResponse(inv)
        fb = await _safe(_trending_fallback(cat), 12)
        if fb:
            return JSONResponse(fb)
        return JSONResponse(inv if isinstance(inv, list) else {"error": "取得できませんでした"}, status_code=200 if isinstance(inv, list) else 502)

    return None


async def fallback_channel_tab(app_path: str):
    m = _CH_RE.match(app_path)
    if not m or not m.group(2):
        return None
    cid, tab = m.group(1), m.group(2)
    data = await _safe(yt_api.get_channel_tab(cid, tab), 12)
    if not data:
        return None
    if tab == "latest":
        return data.get("videos", [])
    return data
