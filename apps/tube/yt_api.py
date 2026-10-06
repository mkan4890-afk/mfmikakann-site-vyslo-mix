"""YouTube InnerTube 直接取得モジュール

外部の Invidious / Piped が落ちていても、YouTube 本体の InnerTube API から
タイトル・チャンネル名・チャンネルアイコン・再生回数・コメント・ショートなどを取得する。
返す形式は Invidious API 互換 (フロント側のコードをそのまま使えるように)。
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

import httpx

_BASE = "https://www.youtube.com/youtubei/v1"
_WEB_VER = "2.20261001.01.00"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=12.0, write=5.0, pool=5.0),
            limits=httpx.Limits(max_connections=60, max_keepalive_connections=20),
            headers={"User-Agent": _UA, "Accept-Language": "ja,en;q=0.8",
                     "Origin": "https://www.youtube.com", "Referer": "https://www.youtube.com/"},
            http2=False,
        )
    return _client


# ── small TTL cache ─────────────────────────────────────────────────────────
_cache: dict[str, tuple[float, Any]] = {}
_CACHE_MAX = 600


def _cget(key: str):
    e = _cache.get(key)
    if not e:
        return None
    if e[0] < time.time():
        _cache.pop(key, None)
        return None
    return e[1]


def _cset(key: str, val: Any, ttl: int):
    if len(_cache) > _CACHE_MAX:
        now = time.time()
        for k in [k for k, v in _cache.items() if v[0] < now]:
            _cache.pop(k, None)
        while len(_cache) > _CACHE_MAX:
            _cache.pop(next(iter(_cache)))
    _cache[key] = (time.time() + ttl, val)


async def _post(endpoint: str, body: dict, client_name: str = "WEB") -> dict:
    ctx = {"client": {"clientName": client_name, "clientVersion": _WEB_VER,
                      "hl": "ja", "gl": "JP", "timeZone": "Asia/Tokyo", "utcOffsetMinutes": 540}}
    payload = {"context": ctx, **body}
    c = _get_client()
    last = None
    for attempt in range(2):
        try:
            r = await c.post(f"{_BASE}/{endpoint}?prettyPrint=false", json=payload,
                             headers={"X-YouTube-Client-Name": "1", "X-YouTube-Client-Version": _WEB_VER})
            r.raise_for_status()
            return r.json()
        except (httpx.TransportError, httpx.HTTPStatusError) as e:
            last = e
            if attempt == 0:
                await asyncio.sleep(0.2)
                continue
    raise last  # type: ignore[misc]


# ── helpers ────────────────────────────────────────────────────────────────
def txt(o) -> str:
    if o is None:
        return ""
    if isinstance(o, str):
        return o
    if isinstance(o, dict):
        if "simpleText" in o:
            return o["simpleText"] or ""
        if "runs" in o:
            return "".join(r.get("text", "") for r in o["runs"] if isinstance(r, dict))
        if "content" in o and isinstance(o["content"], str):
            return o["content"]
    return ""


_UNIT = {"万": 10_000, "億": 100_000_000, "千": 1_000, "K": 1_000, "k": 1_000, "M": 1_000_000, "B": 1_000_000_000}


def parse_count(s: str) -> int:
    if not s:
        return 0
    s = str(s).replace(",", "").replace("，", "").strip()
    m = re.search(r"([\d.]+)\s*(万|億|千|K|k|M|B)?", s)
    if not m:
        return 0
    try:
        n = float(m.group(1))
    except ValueError:
        return 0
    if m.group(2):
        n *= _UNIT[m.group(2)]
    return int(n)


def parse_duration(s: str) -> int:
    if not s:
        return 0
    parts = [p for p in re.split(r"[:：]", s.strip()) if p.isdigit()]
    if not parts:
        return 0
    sec = 0
    for p in parts:
        sec = sec * 60 + int(p)
    return sec


def _thumbs(lst) -> list:
    out = []
    for t in lst or []:
        if isinstance(t, dict) and t.get("url"):
            u = t["url"]
            if u.startswith("//"):
                u = "https:" + u
            out.append({"url": u, "width": t.get("width", 0), "height": t.get("height", 0)})
    return out


def _avatar_thumbs(lst) -> list:
    """チャンネルアイコンを Invidious と同じく複数サイズで返す"""
    th = _thumbs(lst)
    if not th:
        return []
    base = th[-1]["url"]
    m = re.match(r"(.*?)=s\d+(.*)$", base)
    if m:
        return [{"url": f"{m.group(1)}=s{s}{m.group(2)}", "width": s, "height": s} for s in (32, 48, 76, 100, 176, 512)]
    return th


def _vthumbs(vid: str) -> list:
    return [
        {"quality": "maxres", "url": f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg", "width": 1280, "height": 720},
        {"quality": "sddefault", "url": f"https://i.ytimg.com/vi/{vid}/sddefault.jpg", "width": 640, "height": 480},
        {"quality": "high", "url": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", "width": 480, "height": 360},
        {"quality": "medium", "url": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg", "width": 320, "height": 180},
        {"quality": "default", "url": f"https://i.ytimg.com/vi/{vid}/default.jpg", "width": 120, "height": 90},
    ]


def _walk(o, key: str):
    """o 以下から key を持つ dict の値をすべて列挙"""
    stack = [o]
    while stack:
        x = stack.pop()
        if isinstance(x, dict):
            for k, v in x.items():
                if k == key:
                    yield v
                if isinstance(v, (dict, list)):
                    stack.append(v)
        elif isinstance(x, list):
            stack.extend(reversed(x))


def _first(o, key: str):
    for v in _walk(o, key):
        return v
    return None


def _browse_id(o) -> str:
    be = _first(o, "browseEndpoint")
    if isinstance(be, dict):
        return be.get("browseId", "") or ""
    return ""


# ── item parsers (search / related / channel) ──────────────────────────────
def _from_video_renderer(vr: dict) -> dict | None:
    vid = vr.get("videoId")
    if not vid:
        return None
    owner = vr.get("ownerText") or vr.get("longBylineText") or vr.get("shortBylineText") or {}
    author = txt(owner)
    author_id = _browse_id(owner)
    av = ((vr.get("channelThumbnailSupportedRenderers") or {}).get("channelThumbnailWithLinkRenderer") or {}).get("thumbnail", {}).get("thumbnails") \
        or (vr.get("channelThumbnail") or {}).get("thumbnails")
    length_txt = txt(vr.get("lengthText"))
    if not length_txt:
        for ov in vr.get("thumbnailOverlays") or []:
            ts = ov.get("thumbnailOverlayTimeStatusRenderer")
            if ts:
                length_txt = txt(ts.get("text"))
                break
    badges = " ".join(txt((b.get("metadataBadgeRenderer") or {}).get("label") and {"simpleText": b["metadataBadgeRenderer"].get("label")}) for b in vr.get("badges") or [])
    live = "LIVE" in badges or "ライブ" in badges or any(
        (ov.get("thumbnailOverlayTimeStatusRenderer") or {}).get("style") == "LIVE" for ov in vr.get("thumbnailOverlays") or [])
    vc_txt = txt(vr.get("viewCountText"))
    desc = ""
    for sn in vr.get("detailedMetadataSnippets") or []:
        desc = txt(sn.get("snippetText"))
        break
    verified = any("VERIFIED" in ((b.get("metadataBadgeRenderer") or {}).get("style") or "") for b in vr.get("ownerBadges") or [])
    return {
        "type": "video", "title": txt(vr.get("title")), "videoId": vid,
        "author": author, "authorId": author_id, "authorUrl": f"/channel/{author_id}" if author_id else "",
        "authorVerified": verified,
        "authorThumbnails": _avatar_thumbs(av) if av else [],
        "videoThumbnails": _vthumbs(vid), "description": desc,
        "viewCount": parse_count(vc_txt), "viewCountText": txt(vr.get("shortViewCountText")) or vc_txt,
        "published": 0, "publishedText": txt(vr.get("publishedTimeText")),
        "lengthSeconds": parse_duration(length_txt), "liveNow": bool(live),
        "isUpcoming": bool(vr.get("upcomingEventData")),
    }


def _from_lockup(lv: dict) -> dict | None:
    ctype = lv.get("contentType", "")
    cid = lv.get("contentId")
    if not cid:
        return None
    meta = (lv.get("metadata") or {}).get("lockupMetadataViewModel") or {}
    title = txt(meta.get("title"))
    rows = ((meta.get("metadata") or {}).get("contentMetadataViewModel") or {}).get("metadataRows") or []
    parts = []
    for r in rows:
        parts.append([(p.get("text") or {}).get("content", "") for p in r.get("metadataParts") or []])
    author = parts[0][0] if parts and parts[0] else ""
    av_vm = _first(meta.get("image") or {}, "avatarViewModel") or {}
    av = ((av_vm.get("image") or {}).get("sources")) or []
    author_id = _browse_id(meta.get("image") or {}) or _browse_id(rows)
    if ctype in ("LOCKUP_CONTENT_TYPE_PLAYLIST", "LOCKUP_CONTENT_TYPE_PODCAST"):
        img = _first(lv.get("contentImage") or {}, "sources") or []
        count = ""
        for b in _walk(lv.get("contentImage") or {}, "thumbnailBadgeViewModel"):
            count = b.get("text", "")
            break
        first_vid = ""
        we = _first(lv.get("rendererContext") or {}, "watchEndpoint")
        if isinstance(we, dict):
            first_vid = we.get("videoId", "")
        return {"type": "playlist", "title": title, "playlistId": cid, "author": author, "authorId": author_id,
                "videoCount": parse_count(count), "playlistThumbnail": (_thumbs(img)[-1]["url"] if img else ""),
                "videos": [{"videoId": first_vid}] if first_vid else []}
    vid = cid
    length_txt = ""
    live = False
    for b in _walk(lv.get("contentImage") or {}, "thumbnailBadgeViewModel"):
        t = b.get("text", "")
        if re.match(r"^\d+(:\d+)+$", t):
            length_txt = t
        if b.get("badgeStyle") == "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE" or t in ("ライブ", "LIVE"):
            live = True
    views_txt, pub_txt = "", ""
    flat = [x for p in parts[1:] for x in p] if len(parts) > 1 else []
    for x in flat:
        if "回視聴" in x or "視聴中" in x or "views" in x or re.match(r"^[\d.,]+\s*(万|億|千)?$", x):
            views_txt = views_txt or x
        elif "前" in x or "ago" in x or "配信" in x:
            pub_txt = pub_txt or x
    if not views_txt and flat:
        views_txt = flat[0]
        pub_txt = pub_txt or (flat[1] if len(flat) > 1 else "")
    return {
        "type": "video", "title": title, "videoId": vid, "author": author, "authorId": author_id,
        "authorUrl": f"/channel/{author_id}" if author_id else "",
        "authorThumbnails": _avatar_thumbs(av) if av else [],
        "videoThumbnails": _vthumbs(vid), "viewCount": parse_count(views_txt),
        "viewCountText": views_txt, "published": 0, "publishedText": pub_txt,
        "lengthSeconds": parse_duration(length_txt), "liveNow": live or ("視聴中" in views_txt),
    }


def _from_reel(o: dict) -> dict | None:
    """reelItemRenderer / shortsLockupViewModel"""
    if "videoId" in o and ("headline" in o or "viewCountText" in o):
        vid = o["videoId"]
        return {"type": "video", "isShort": True, "videoId": vid, "title": txt(o.get("headline")),
                "viewCount": parse_count(txt(o.get("viewCountText"))), "viewCountText": txt(o.get("viewCountText")),
                "videoThumbnails": [{"quality": "high", "url": f"https://i.ytimg.com/vi/{vid}/oardefault.jpg"}] + _vthumbs(vid),
                "author": "", "authorId": "", "lengthSeconds": 0, "publishedText": ""}
    rwe = _first(o.get("onTap") or o, "reelWatchEndpoint") or {}
    vid = rwe.get("videoId") if isinstance(rwe, dict) else None
    if not vid:
        eid = o.get("entityId", "")
        m = re.search(r"([A-Za-z0-9_-]{11})$", eid)
        vid = m.group(1) if m else None
    if not vid:
        return None
    ov = o.get("overlayMetadata") or {}
    title = txt(ov.get("primaryText"))
    views = txt(ov.get("secondaryText"))
    return {"type": "video", "isShort": True, "videoId": vid, "title": title,
            "viewCount": parse_count(views), "viewCountText": views,
            "videoThumbnails": [{"quality": "high", "url": f"https://i.ytimg.com/vi/{vid}/oardefault.jpg"}] + _vthumbs(vid),
            "author": "", "authorId": "", "lengthSeconds": 0, "publishedText": ""}


def _from_channel_renderer(cr: dict) -> dict | None:
    cid = cr.get("channelId")
    if not cid:
        return None
    subs = txt(cr.get("videoCountText")) if "@" in txt(cr.get("subscriberCountText")) else txt(cr.get("subscriberCountText"))
    handle = txt(cr.get("subscriberCountText")) if "@" in txt(cr.get("subscriberCountText")) else ""
    return {"type": "channel", "author": txt(cr.get("title")), "authorId": cid, "authorUrl": f"/channel/{cid}",
            "authorThumbnails": _avatar_thumbs((cr.get("thumbnail") or {}).get("thumbnails")),
            "subCount": parse_count(subs), "subCountText": subs, "channelHandle": handle,
            "description": txt(cr.get("descriptionSnippet")), "videoCount": 0,
            "authorVerified": bool(cr.get("ownerBadges"))}


def _from_playlist_renderer(pr: dict) -> dict | None:
    pid = pr.get("playlistId")
    if not pid:
        return None
    th = (pr.get("thumbnails") or [{}])[0].get("thumbnails") or []
    return {"type": "playlist", "title": txt(pr.get("title")), "playlistId": pid,
            "author": txt(pr.get("longBylineText") or pr.get("shortBylineText")),
            "authorId": _browse_id(pr.get("longBylineText") or {}),
            "videoCount": parse_count(pr.get("videoCount") or txt(pr.get("videoCountText"))),
            "playlistThumbnail": _thumbs(th)[-1]["url"] if th else "", "videos": []}


def parse_items(container) -> tuple[list, str | None]:
    """任意のレスポンス片から動画/チャンネル/再生リストと継続トークンを抽出"""
    out: list = []
    cont: str | None = None
    seen: set = set()

    def add(x):
        if not x:
            return
        k = x.get("videoId") or x.get("authorId") if x.get("type") == "channel" else x.get("videoId") or x.get("playlistId")
        if x.get("type") == "channel":
            k = "c:" + x["authorId"]
        if k in seen:
            return
        seen.add(k)
        out.append(x)

    def visit(o):
        nonlocal cont
        if isinstance(o, list):
            for i in o:
                visit(i)
            return
        if not isinstance(o, dict):
            return
        for k, v in o.items():
            if k in ("videoRenderer", "compactVideoRenderer", "gridVideoRenderer"):
                add(_from_video_renderer(v))
            elif k == "lockupViewModel":
                add(_from_lockup(v))
            elif k in ("reelItemRenderer", "shortsLockupViewModel"):
                add(_from_reel(v))
            elif k == "channelRenderer":
                add(_from_channel_renderer(v))
            elif k == "playlistRenderer":
                add(_from_playlist_renderer(v))
            elif k == "continuationItemRenderer":
                tok = _first(v, "token")
                if tok:
                    cont = tok
            elif k in ("adSlotRenderer", "promotedSparklesWebRenderer", "searchPyvRenderer"):
                continue
            elif isinstance(v, (dict, list)):
                visit(v)

    visit(container)
    return out, cont


# ── video ──────────────────────────────────────────────────────────────────
async def _player(video_id: str) -> dict:
    try:
        return await _post("player", {"videoId": video_id, "contentCheckOk": True, "racyCheckOk": True})
    except Exception:
        return {}


async def _next_from_html(video_id: str) -> dict:
    """InnerTube API が使えない環境向け: 視聴ページの HTML に埋め込まれた ytInitialData を読む。
    (タイムゾーンは日本時間で、公開日などが日本の表示と一致するようにする)"""
    try:
        r = await _get_client().get(
            "https://www.youtube.com/watch",
            params={"v": video_id, "hl": "ja", "gl": "JP"},
            headers={"Cookie": "CONSENT=YES+1; PREF=hl=ja&gl=JP&tz=Asia.Tokyo"},
            timeout=httpx.Timeout(10.0),
        )
        if r.status_code != 200:
            return {}
        h = r.text
        i = h.find("ytInitialData = ")
        if i < 0:
            i = h.find("ytInitialData=")
        if i < 0:
            return {}
        j = h.find("{", i)
        data, _ = json.JSONDecoder().raw_decode(h[j:])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


async def get_video(video_id: str) -> dict | None:
    key = f"v:{video_id}"
    c = _cget(key)
    if c is not None:
        return c
    nxt_t = asyncio.create_task(_post("next", {"videoId": video_id, "contentCheckOk": True, "racyCheckOk": True}))
    html_t = asyncio.create_task(_next_from_html(video_id))
    ply_t = asyncio.create_task(_player(video_id))
    _ok = lambda d: isinstance(d, dict) and bool((d.get("contents") or {}).get("twoColumnWatchNextResults"))
    # InnerTube の next と視聴ページの HTML を同時に取りに行き、先に取れた方を使う
    # (環境によって next が 403 で長く待たされるため)
    nxt = {}
    pending = {nxt_t, html_t}
    t_end = asyncio.get_event_loop().time() + 7.0
    while pending and not _ok(nxt):
        left = t_end - asyncio.get_event_loop().time()
        if left <= 0:
            break
        done, pending = await asyncio.wait(pending, timeout=left, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            try:
                r = t.result()
            except Exception:
                r = {}
            if _ok(r):
                nxt = r
                break
    for t in (nxt_t, html_t):
        if not t.done():
            t.cancel()
    try:
        ply = await asyncio.wait_for(ply_t, timeout=2.5 if _ok(nxt) else 6)
    except Exception:
        ply = {}
    res = (((nxt.get("contents") or {}).get("twoColumnWatchNextResults") or {}).get("results") or {}).get("results", {}).get("contents") or []
    pri = next((c["videoPrimaryInfoRenderer"] for c in res if "videoPrimaryInfoRenderer" in c), {})
    sec = next((c["videoSecondaryInfoRenderer"] for c in res if "videoSecondaryInfoRenderer" in c), {})
    vd = ply.get("videoDetails") or {}
    mf = (ply.get("microformat") or {}).get("playerMicroformatRenderer") or {}
    if not pri and not vd:
        return None
    owner = (sec.get("owner") or {}).get("videoOwnerRenderer") or {}
    vvc = ((pri.get("viewCount") or {}).get("videoViewCountRenderer") or {})
    view_txt = txt(vvc.get("viewCount"))
    is_live = bool(vvc.get("isLive")) or bool(vd.get("isLive"))
    view_count = int(vd.get("viewCount") or 0) or parse_count(view_txt)
    desc = (sec.get("attributedDescription") or {}).get("content") or vd.get("shortDescription") or ""
    # like count
    like = 0
    for lb in _walk(pri.get("videoActions") or {}, "likeButtonViewModel"):
        a11y = _first(lb, "accessibilityText") or ""
        t = _first(lb, "title") or ""
        like = parse_count(a11y) or parse_count(t if isinstance(t, str) else "")
        if like:
            break
    if not like:
        for t in _walk(nxt.get("frameworkUpdates") or {}, "likeCountIfIndifferentNumber"):
            like = int(t or 0)
            break
    # comments token & count
    comments_token = None
    comment_count_txt = ""
    for c in res:
        isr = c.get("itemSectionRenderer") or {}
        if isr.get("sectionIdentifier") == "comment-item-section":
            comments_token = _first(isr, "token")
    for p in nxt.get("engagementPanels") or []:
        epr = p.get("engagementPanelSectionListRenderer") or {}
        if epr.get("panelIdentifier") == "engagement-panel-comments-section":
            ct = _first(epr.get("header") or {}, "contextualInfo")
            comment_count_txt = txt(ct)
            if not comments_token:
                comments_token = _first(epr.get("content") or {}, "token")
    sec_res = ((((nxt.get("contents") or {}).get("twoColumnWatchNextResults") or {}).get("secondaryResults") or {})
               .get("secondaryResults") or {}).get("results") or []
    related, _ = parse_items(sec_res)
    related = [r for r in related if r.get("type") == "video"]
    author_id = _browse_id(owner.get("title") or {}) or vd.get("channelId", "")
    sub_txt = txt(owner.get("subscriberCountText")).replace("チャンネル登録者数", "").strip()
    length = int(vd.get("lengthSeconds") or 0)
    pub_date = txt(pri.get("dateText")) or mf.get("publishDate", "")
    published = 0
    m = re.search(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", mf.get("publishDate", "") or pub_date)
    if m:
        try:
            # 日付は日本時間 (JST) の表示なので、JST の 0 時として扱う
            import calendar
            published = int(calendar.timegm(time.strptime(f"{m.group(1)}-{m.group(2)}-{m.group(3)}", "%Y-%m-%d"))) - 9 * 3600
        except Exception:
            published = 0
    data = {
        "type": "video",
        "title": txt(pri.get("title")) or vd.get("title", ""),
        "videoId": video_id,
        "videoThumbnails": _vthumbs(video_id),
        "description": desc,
        "descriptionHtml": desc,
        "published": published,
        "publishedText": txt(pri.get("relativeDateText")) or pub_date,
        "dateText": pub_date,
        "keywords": vd.get("keywords") or [],
        "viewCount": view_count,
        "viewCountText": txt(vvc.get("shortViewCount")) or view_txt,
        "likeCount": like,
        "dislikeCount": 0,
        "isFamilyFriendly": mf.get("isFamilySafe", True),
        "genre": mf.get("category", ""),
        "author": txt(owner.get("title")) or vd.get("author", ""),
        "authorId": author_id,
        "authorUrl": f"/channel/{author_id}" if author_id else "",
        "authorVerified": bool(owner.get("badges")),
        "authorThumbnails": _avatar_thumbs((owner.get("thumbnail") or {}).get("thumbnails")),
        "subCountText": sub_txt,
        "lengthSeconds": length,
        "liveNow": is_live,
        "isUpcoming": bool(vd.get("isUpcoming")),
        "isShort": "/shorts/" in (mf.get("canonicalUrl") or "") or (0 < length <= 180 and False),
        "commentCountText": comment_count_txt,
        "commentCount": parse_count(comment_count_txt),
        "recommendedVideos": related,
        "adaptiveFormats": [], "formatStreams": [], "captions": [],
        "_commentsToken": comments_token,
        "_source": "innertube",
    }
    if not data["author"] and not data["title"]:
        return None
    _cset(key, data, 600)
    return data


# ── comments ───────────────────────────────────────────────────────────────
def _parse_comment_mutations(resp: dict) -> dict:
    ents = {}
    for m in _walk(resp.get("frameworkUpdates") or {}, "mutations"):
        for mu in m or []:
            p = (mu.get("payload") or {})
            ce = p.get("commentEntityPayload")
            if ce:
                ents[ce.get("key") or (ce.get("properties") or {}).get("commentKey")] = ce
            tb = p.get("engagementToolbarStateEntityPayload")
            if tb:
                ents["tb:" + (tb.get("key") or "")] = tb
    return ents


def _comment_from_entity(ce: dict, reply_token: str | None, pinned: bool) -> dict:
    pr = ce.get("properties") or {}
    au = ce.get("author") or {}
    tb = ce.get("toolbar") or {}
    content = (pr.get("content") or {}).get("content", "")
    cid = au.get("channelId", "")
    av = au.get("avatarThumbnailUrl", "")
    return {
        "author": au.get("displayName", ""),
        "authorId": cid,
        "authorUrl": f"/channel/{cid}" if cid else "",
        "authorThumbnails": _avatar_thumbs([{"url": av, "width": 88, "height": 88}]) if av else [],
        "authorIsChannelOwner": bool(au.get("isCreator")),
        "authorVerified": bool(au.get("isVerified")),
        "content": content,
        "contentHtml": content,
        "commentId": pr.get("commentId", ""),
        "publishedText": pr.get("publishedTime", ""),
        "published": 0,
        "likeCount": parse_count(tb.get("likeCountNotliked") or tb.get("likeCountA11y") or ""),
        "replyCount": parse_count(tb.get("replyCount") or ""),
        "isPinned": pinned,
        "isEdited": "編集" in (pr.get("publishedTime") or ""),
        "creatorHeart": bool(tb.get("heartActiveTooltip")),
        "replies": {"replyCount": parse_count(tb.get("replyCount") or ""), "continuation": ("it:" + reply_token) if reply_token else None},
    }


async def _comments_page(token: str) -> tuple[list, str | None, dict]:
    resp = await _post("next", {"continuation": token})
    ents = _parse_comment_mutations(resp)
    comments = []
    nxt = None
    header = {}
    actions = (resp.get("onResponseReceivedEndpoints") or [])
    items = []
    for a in actions:
        cmd = a.get("reloadContinuationItemsCommand") or a.get("appendContinuationItemsAction") or {}
        for it in cmd.get("continuationItems") or []:
            items.append(it)
    for it in items:
        if "commentsHeaderRenderer" in it:
            header = it["commentsHeaderRenderer"]
            continue
        if "commentThreadRenderer" in it:
            th = it["commentThreadRenderer"]
            vm = th.get("commentViewModel") or {}
            if "commentViewModel" in vm:
                vm = vm["commentViewModel"]
            ck = vm.get("commentKey")
            pinned = bool(vm.get("pinnedText")) or bool(_first(th, "pinnedCommentBadge"))
            rt = None
            rep = th.get("replies") or {}
            if rep:
                rt = _first(rep, "token")
            ce = ents.get(ck)
            if ce:
                comments.append(_comment_from_entity(ce, rt, pinned))
        elif "commentViewModel" in it:
            vm = it["commentViewModel"]
            if "commentViewModel" in vm:
                vm = vm["commentViewModel"]
            ce = ents.get(vm.get("commentKey"))
            if ce:
                comments.append(_comment_from_entity(ce, None, False))
        elif "continuationItemRenderer" in it:
            nxt = _first(it, "token")
    return comments, nxt, header


async def get_comments(video_id: str, sort_by: str = "top", continuation: str | None = None) -> dict | None:
    key = f"c:{video_id}:{sort_by}:{continuation or ''}"
    c = _cget(key)
    if c is not None:
        return c
    count = 0
    if continuation:
        tok = continuation[3:] if continuation.startswith("it:") else continuation
        comments, nxt, header = await _comments_page(tok)
    else:
        v = await get_video(video_id)
        tok = v.get("_commentsToken") if v else None
        if not tok:
            return None
        comments, nxt, header = await _comments_page(tok)
        count = parse_count(txt(header.get("countText")))
        if sort_by == "new" and header:
            sub = _first(header.get("sortMenu") or {}, "subMenuItems") or []
            if len(sub) > 1:
                ntok = _first(sub[1], "token")
                if ntok:
                    comments, nxt, _ = await _comments_page(ntok)
    data = {"commentCount": count, "videoId": video_id, "comments": comments,
            "continuation": ("it:" + nxt) if nxt else None}
    if comments or continuation:
        _cset(key, data, 300)
    return data


# ── search ─────────────────────────────────────────────────────────────────
_SEARCH_TYPE = {"video": "EgIQAQ%3D%3D", "channel": "EgIQAg%3D%3D", "playlist": "EgIQAw%3D%3D",
                "shorts": "EgIQCQ%3D%3D", "movie": "EgIQBA%3D%3D"}


async def search(q: str, type_: str = "all", continuation: str | None = None, sort: str = "") -> tuple[list, str | None]:
    key = f"s:{q}:{type_}:{sort}:{continuation or ''}"
    c = _cget(key)
    if c is not None:
        return c
    if continuation:
        resp = await _post("search", {"continuation": continuation})
        part = resp.get("onResponseReceivedCommands") or []
    else:
        body = {"query": q}
        p = _SEARCH_TYPE.get(type_)
        if sort == "upload_date":
            p = "CAI%253D" if not p else p
        if p:
            from urllib.parse import unquote
            body["params"] = unquote(p)
        resp = await _post("search", body)
        part = resp.get("contents") or {}
    items, cont = parse_items(part)
    if not items and not continuation and not _is_search_page(resp):
        # 結果の枠そのものが無い = 取得に失敗した応答 (0 件ではない)
        raise SearchUnavailable("search response has no results container")
    if type_ == "shorts":
        items = [i for i in items if i.get("type") == "video"]
        for i in items:
            i["isShort"] = True
    out = (items, cont)
    if items:
        _cset(key, out, 300)
    return out


class SearchUnavailable(Exception):
    """検索結果を取得できなかった (一時的な失敗)。本当に 0 件のときは空のリストを返す。"""


def _is_search_page(resp: dict) -> bool:
    c = (resp or {}).get("contents") or {}
    return isinstance(c, dict) and bool(c.get("twoColumnSearchResultsRenderer") or c.get("sectionListRenderer"))


async def search_html(q: str, type_: str = "all", sort: str = "") -> tuple[list, str | None]:
    """InnerTube が使えないとき用: 検索結果ページの HTML に埋め込まれた ytInitialData を読む。"""
    import json as _json
    from urllib.parse import unquote
    key = f"sh:{q}:{type_}:{sort}"
    c = _cget(key)
    if c is not None:
        return c
    params = {"search_query": q, "hl": "ja", "gl": "JP"}
    sp = _SEARCH_TYPE.get(type_)
    if sort == "upload_date" and not sp:
        sp = "CAI%253D"
    if sp:
        params["sp"] = unquote(sp)
    r = await _get_client().get("https://www.youtube.com/results", params=params,
                                headers={"Cookie": "CONSENT=YES+1; PREF=hl=ja&gl=JP"},
                                timeout=httpx.Timeout(10.0))
    if r.status_code != 200:
        raise SearchUnavailable(f"html {r.status_code}")
    h = r.text
    i = h.find("ytInitialData = ")
    if i < 0:
        i = h.find("ytInitialData=")
    if i < 0:
        raise SearchUnavailable("html no data")
    data, _ = _json.JSONDecoder().raw_decode(h[h.find("{", i):])
    items, cont = parse_items(data.get("contents") or {})
    if not items and not _is_search_page(data):
        raise SearchUnavailable("html bad data")
    if type_ == "shorts":
        items = [x for x in items if x.get("type") == "video"]
        for x in items:
            x["isShort"] = True
    out = (items, cont)
    if items:
        _cset(key, out, 300)
    return out


async def suggestions(q: str) -> list:
    try:
        r = await _get_client().get("https://suggestqueries-clients6.youtube.com/complete/search",
                                    params={"client": "youtube", "ds": "yt", "hl": "ja", "gl": "jp", "q": q})
        m = re.search(r"\((.*)\)", r.text, re.S)
        if not m:
            return []
        import json
        d = json.loads(m.group(1))
        return [x[0] for x in d[1] if isinstance(x, list) and x]
    except Exception:
        return []


# ── channel ────────────────────────────────────────────────────────────────
_TAB_PARAMS = {"videos": "EgZ2aWRlb3PyBgQKAjoA", "shorts": "EgZzaG9ydHPyBgUKA5oBAA%3D%3D",
               "streams": "EgdzdHJlYW1z8gYECgJ6AA%3D%3D", "playlists": "EglwbGF5bGlzdHPyBgQKAkIA",
               "home": "EghmZWF0dXJlZPIGBAoCMgA%3D"}


async def get_channel(channel_id: str) -> dict | None:
    key = f"ch:{channel_id}"
    c = _cget(key)
    if c is not None:
        return c
    resp = await _post("browse", {"browseId": channel_id})
    md = ((resp.get("metadata") or {}).get("channelMetadataRenderer")) or {}
    hdr = resp.get("header") or {}
    name = md.get("title", "")
    avatar = ((md.get("avatar") or {}).get("thumbnails")) or []
    banner = []
    sub_txt = ""
    handle = ""
    vcount = ""
    phv = _first(hdr, "pageHeaderViewModel")
    if phv:
        name = name or txt((phv.get("title") or {}).get("dynamicTextViewModel", {}).get("text"))
        av = _first(phv.get("image") or {}, "sources")
        if av:
            avatar = av
        bn = _first(phv.get("banner") or {}, "sources")
        if bn:
            banner = bn
        rows = _first(phv.get("metadata") or {}, "metadataRows") or []
        for r in rows:
            for p in r.get("metadataParts") or []:
                t = (p.get("text") or {}).get("content", "")
                if t.startswith("@"):
                    handle = t
                elif "登録者" in t or "subscriber" in t:
                    sub_txt = t.replace("チャンネル登録者数", "").strip()
                elif "本の動画" in t or "videos" in t:
                    vcount = t
    c4 = hdr.get("c4TabbedHeaderRenderer")
    if c4:
        avatar = (c4.get("avatar") or {}).get("thumbnails") or avatar
        banner = (c4.get("banner") or {}).get("thumbnails") or banner
        sub_txt = sub_txt or txt(c4.get("subscriberCountText"))
    if not name:
        return None
    tabs = [((t.get("tabRenderer") or {}).get("title") or "") for t in _first(resp.get("contents") or {}, "tabs") or []]
    tabmap = {"動画": "videos", "ショート": "shorts", "ライブ": "streams", "再生リスト": "playlists", "コミュニティ": "community", "投稿": "community", "ホーム": "home"}
    latest, _ = parse_items(resp.get("contents") or {})
    data = {
        "author": name, "authorId": channel_id, "authorUrl": f"https://www.youtube.com/channel/{channel_id}",
        "authorBanners": _thumbs(banner), "authorThumbnails": _avatar_thumbs(avatar),
        "subCount": parse_count(sub_txt), "subCountText": sub_txt, "channelHandle": handle,
        "videoCountText": vcount, "totalViews": 0, "joined": 0, "autoGenerated": False,
        "isFamilyFriendly": md.get("isFamilySafe", True), "description": md.get("description", ""),
        "descriptionHtml": md.get("description", ""), "allowedRegions": [],
        "tabs": [tabmap.get(t, t.lower()) for t in tabs if t],
        "latestVideos": [x for x in latest if x.get("type") == "video"][:30],
        "relatedChannels": [], "authorVerified": False, "_source": "innertube",
    }
    _cset(key, data, 900)
    return data


async def get_channel_tab(channel_id: str, tab: str, continuation: str | None = None) -> dict:
    key = f"cht:{channel_id}:{tab}:{continuation or ''}"
    c = _cget(key)
    if c is not None:
        return c
    if continuation:
        tok = continuation[3:] if continuation.startswith("it:") else continuation
        resp = await _post("browse", {"continuation": tok})
        part = resp.get("onResponseReceivedActions") or []
    else:
        from urllib.parse import unquote
        p = _TAB_PARAMS.get("videos" if tab == "latest" else tab, _TAB_PARAMS["videos"])
        resp = await _post("browse", {"browseId": channel_id, "params": unquote(p)})
        # 選択されているタブの中身だけを見る
        part = None
        for t in _first(resp.get("contents") or {}, "tabs") or []:
            tr = t.get("tabRenderer") or {}
            if tr.get("selected"):
                part = tr.get("content")
                break
        part = part or resp.get("contents") or {}
    items, cont = parse_items(part)
    md = ((resp.get("metadata") or {}).get("channelMetadataRenderer")) or {}
    name = md.get("title", "")
    av = ((md.get("avatar") or {}).get("thumbnails")) or []
    for i in items:
        if i.get("type") in ("video", "playlist"):
            if not i.get("author") and name:
                i["author"] = name
            if not i.get("authorId"):
                i["authorId"] = channel_id
            if i.get("type") == "video" and not i.get("authorThumbnails") and av:
                i["authorThumbnails"] = _avatar_thumbs(av)
        if tab == "shorts":
            i["isShort"] = True
    if tab == "playlists":
        out_items = [i for i in items if i.get("type") == "playlist"]
        data = {"playlists": out_items, "continuation": ("it:" + cont) if cont else None}
    else:
        out_items = [i for i in items if i.get("type") == "video"]
        data = {"videos": out_items, "continuation": ("it:" + cont) if cont else None}
    if out_items:
        _cset(key, data, 600)
    return data


# ── shorts helpers ─────────────────────────────────────────────────────────
async def enrich_items(items: list, limit: int = 12, timeout: float = 6.0) -> list:
    """作者名/アイコンが無い動画を get_video で補完する"""
    need = [i for i in items if isinstance(i, dict) and i.get("videoId") and (not i.get("author") or not i.get("authorThumbnails") or not i.get("title"))][:limit]
    if not need:
        return items

    async def one(it):
        try:
            v = await get_video(it["videoId"])
        except Exception:
            return
        if not v:
            return
        for k in ("title", "author", "authorId", "authorUrl", "authorThumbnails", "viewCount", "publishedText", "likeCount", "description", "lengthSeconds", "subCountText"):
            if v.get(k) and not it.get(k):
                it[k] = v[k]

    try:
        await asyncio.wait_for(asyncio.gather(*(one(i) for i in need), return_exceptions=True), timeout=timeout)
    except Exception:
        pass
    return items


# ── merge helper ───────────────────────────────────────────────────────────
_MERGE_KEYS = ("title", "author", "authorId", "authorUrl", "authorThumbnails", "viewCount", "likeCount",
               "publishedText", "description", "descriptionHtml", "subCountText", "lengthSeconds",
               "recommendedVideos", "keywords", "published", "genre")


# InnerTube (YouTube 本体・日本語/日本時間) の値を優先する項目
_PREFER_IT_KEYS = ("publishedText", "dateText", "subCountText", "commentCountText")
# タイトル・チャンネル名は Invidious 側のキャッシュが古いことがあるので、YouTube 本体の現在の値を優先
_PREFER_IT_FRESH = ("title", "author")


def merge_video(primary: dict | None, extra: dict | None) -> dict | None:
    if not primary:
        return extra
    if not extra:
        return primary
    for k in _MERGE_KEYS:
        if not primary.get(k) and extra.get(k):
            primary[k] = extra[k]
    # 公開日: Invidious は日付だけ (UTC 0時) なので「1日前」などとずれる。YouTube 本体の表示を優先
    for k in _PREFER_IT_KEYS:
        if extra.get(k):
            primary[k] = extra[k]
    for k in _PREFER_IT_FRESH:
        if isinstance(extra.get(k), str) and extra[k].strip():
            primary[k] = extra[k].strip()
    if extra.get("published") and extra.get("dateText"):
        primary["published"] = extra["published"]
    # 再生回数・高評価数は新しい (大きい) 方
    for k in ("viewCount", "likeCount"):
        try:
            if int(extra.get(k) or 0) > int(primary.get(k) or 0):
                primary[k] = int(extra[k])
        except (TypeError, ValueError):
            pass
    # 関連動画: YouTube 本体の一覧は再生回数・投稿日が日本語で揃っているので優先
    it_rec = [r for r in (extra.get("recommendedVideos") or []) if r.get("videoId")]
    if len(it_rec) >= 5:
        primary["recommendedVideos"] = it_rec
    # Invidious の関連動画にアイコンが無いことが多いので補う
    rec = primary.get("recommendedVideos") or []
    amap = {}
    for r in extra.get("recommendedVideos") or []:
        if r.get("authorId") and r.get("authorThumbnails"):
            amap[r["authorId"]] = r["authorThumbnails"]
    for r in rec:
        if not r.get("authorThumbnails") and amap.get(r.get("authorId")):
            r["authorThumbnails"] = amap[r["authorId"]]
    if extra.get("commentCount") and not primary.get("commentCount"):
        primary["commentCount"] = extra["commentCount"]
    return primary


# ── 表示用の正規化 (英語表記・単位の揺れをなくす) ─────────────────────────────
def ja_count(n: int) -> str:
    """YouTube 日本語版と同じ丸め: 1.2万 / 455万 / 1.8億 (切り捨て)"""
    n = int(n or 0)
    if n >= 100_000_000:
        v = n / 100_000_000
        return (f"{int(v * 10) / 10:.1f}".rstrip("0").rstrip(".") if v < 10 else str(int(v))) + "億"
    if n >= 10_000:
        v = n / 10_000
        return (f"{int(v * 10) / 10:.1f}".rstrip("0").rstrip(".") if v < 10 else str(int(v))) + "万"
    return f"{n:,}"


def _ja_spacing(s: str) -> str:
    # 「5 時間前」「16 年前」「18億 回視聴」→ 詰める
    s = re.sub(r"(\d)\s+(?=[秒分時日週か月年万億回人件])", r"\1", s)
    return re.sub(r"([万億])\s+(?=[回人件])", r"\1", s)


def ja_sub_text(text: str, count: int = 0) -> str:
    t = (text or "").replace("チャンネル登録者数", "").replace("subscribers", "").replace("subscriber", "").strip()
    if t and re.search(r"[人万億]", t):
        return _ja_spacing(t)
    n = parse_count(t) if t else 0
    if not n:
        n = int(count or 0)
    if not n:
        return ""
    return ja_count(n) + "人"


def normalize_video(d: dict | None) -> dict | None:
    if not isinstance(d, dict):
        return d
    sub = ja_sub_text(d.get("subCountText") or "", d.get("subCount") or 0)
    if sub or d.get("subCountText"):
        d["subCountText"] = sub
    if isinstance(d.get("publishedText"), str):
        d["publishedText"] = _ja_spacing(d["publishedText"].strip())
    for r in d.get("recommendedVideos") or []:
        if not isinstance(r, dict):
            continue
        if not r.get("viewCount"):
            vt = r.get("viewCountText") or r.get("shortViewCountText") or ""
            n = parse_count(vt) if vt else 0
            if n:
                r["viewCount"] = n
        if isinstance(r.get("publishedText"), str):
            r["publishedText"] = _ja_spacing(r["publishedText"].strip())
        if r.get("author") is None:
            r["author"] = ""
    return d


async def race_video(inv_coro, video_id: str, grace: float = 2.5, inv_timeout: float = 15.0) -> dict | None:
    """Invidious などと InnerTube を同時に走らせ、早く・欠けのない結果を返す。
    InnerTube が取れたら Invidious には grace 秒だけ猶予を与え、取れていれば合成する。"""
    inv_t = asyncio.ensure_future(inv_coro)
    it_t = asyncio.ensure_future(get_video(video_id))
    it_res = None
    try:
        it_res = await asyncio.wait_for(asyncio.shield(it_t), timeout=8.0)
    except Exception:
        it_res = None
    wait_for = grace if it_res else inv_timeout
    inv_res = None
    try:
        inv_res = await asyncio.wait_for(asyncio.shield(inv_t), timeout=wait_for)
    except Exception:
        inv_res = None
    if not inv_t.done():
        inv_t.cancel()
    if isinstance(inv_res, dict) and (inv_res.get("error") or not inv_res.get("title")):
        inv_res = None
    if inv_res is None and it_res is None:
        return None
    if inv_res is None:
        out = dict(it_res)
    else:
        out = merge_video(dict(inv_res), it_res)
    out.pop("_commentsToken", None)
    return normalize_video(out)


# ── channel home (ホームタブ) ───────────────────────────────────────────────
# 外部 API (youtubei.js 形式) が使えないとき用に、InnerTube / チャンネルページ HTML の
# ホームタブを、フロントエンドが読む youtubei.js 形式 (Shelf / ReelShelf / ChannelVideoPlayer) に変換する

def _fmt_dur(sec) -> str:
    try:
        sec = int(sec or 0)
    except Exception:
        return ""
    if sec <= 0:
        return ""
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _home_item(i: dict) -> dict | None:
    t = i.get("type")
    if t == "video" and i.get("videoId"):
        vid = i["videoId"]
        if i.get("isShort"):
            return {"type": "LockupView", "content_type": "SHORT", "content_id": vid,
                    "metadata": {"title": {"text": i.get("title", "")}},
                    "content_image": {"image": [{"url": f"https://i.ytimg.com/vi/{vid}/oar2.jpg"}]}}
        return {
            "type": "GridVideo", "video_id": vid,
            "title": {"text": i.get("title", "")},
            "thumbnails": [{"url": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"}],
            "duration": {"text": _fmt_dur(i.get("lengthSeconds"))} if i.get("lengthSeconds") else None,
            "views": {"text": i.get("viewCountText") or (f"{i['viewCount']} views" if i.get("viewCount") else "")},
            "published": {"text": i.get("publishedText", "")},
        }
    if t == "playlist" and i.get("playlistId"):
        th = i.get("playlistThumbnail") or ""
        if not th and i.get("videoThumbnails"):
            th = (i["videoThumbnails"][0] or {}).get("url", "")
        return {"type": "LockupView", "content_type": "PLAYLIST", "content_id": i["playlistId"],
                "metadata": {"title": {"text": i.get("title", "")}},
                "content_image": {"image": [{"url": th}] if th else []}}
    if t == "channel" and i.get("authorId"):
        thumbs = i.get("authorThumbnails") or []
        return {"type": "GridChannel", "id": i["authorId"],
                "author": {"id": i["authorId"], "name": i.get("author", ""),
                           "thumbnails": thumbs}}
    return None


def _home_sections(tab_content: dict) -> list:
    out: list = []
    secs = ((tab_content or {}).get("sectionListRenderer") or {}).get("contents") or []
    for s in secs:
        for c in ((s.get("itemSectionRenderer") or {}).get("contents") or []):
            if "channelVideoPlayerRenderer" in c:
                r = c["channelVideoPlayerRenderer"]
                if r.get("videoId"):
                    out.append({"type": "ChannelVideoPlayer", "id": r["videoId"],
                                "title": {"text": txt(r.get("title"))},
                                "description": {"text": txt(r.get("description"))},
                                "view_count": {"text": txt(r.get("viewCountText"))},
                                "published": {"text": txt(r.get("publishedTimeText"))}})
            elif "shelfRenderer" in c:
                r = c["shelfRenderer"]
                items, _ = parse_items(r.get("content") or {})
                conv = [x for x in (_home_item(i) for i in items) if x]
                if conv:
                    out.append({"type": "Shelf", "title": {"text": txt(r.get("title"))}, "content": {"items": conv}})
            elif "reelShelfRenderer" in c:
                r = c["reelShelfRenderer"]
                items, _ = parse_items({"items": r.get("items") or []})
                reels = []
                for i in items:
                    if i.get("type") == "video" and i.get("videoId"):
                        vid = i["videoId"]
                        reels.append({"type": "ShortsLockupView", "accessibility_text": i.get("title", ""),
                                      "on_tap_endpoint": {"payload": {"videoId": vid, "thumbnail": {"thumbnails": [
                                          {"url": f"https://i.ytimg.com/vi/{vid}/oar2.jpg"}]}}}})
                if reels:
                    out.append({"type": "ReelShelf", "title": {"text": txt(r.get("title")) or "ショート"}, "items": reels})
    return out


def _selected_tab(resp: dict) -> tuple[dict | None, str]:
    for t in _first((resp or {}).get("contents") or {}, "tabs") or []:
        tr = t.get("tabRenderer") or {}
        if tr.get("selected"):
            return tr.get("content") or {}, (tr.get("title") or "")
    return None, ""


class ChannelHomeUnavailable(Exception):
    """ホームを一時的に取得できなかった (存在しないのとは区別する)"""


async def get_channel_home(channel_id: str) -> dict:
    """戻り値: {"current_tab": {...}, "has_home": bool}。取得失敗時は ChannelHomeUnavailable"""
    key = f"chhome:{channel_id}"
    c = _cget(key)
    if c is not None:
        return c
    from urllib.parse import unquote
    import json as _json
    resp = None
    try:
        resp = await asyncio.wait_for(_post("browse", {"browseId": channel_id, "params": unquote(_TAB_PARAMS["home"])}), 10)
    except Exception:
        resp = None
    if not resp or not (resp.get("contents") or {}):
        # HTML のチャンネルページから
        try:
            path = f"/channel/{channel_id}" if channel_id.startswith("UC") else f"/{channel_id}"
            r = await _get_client().get(f"https://www.youtube.com{path}/featured", params={"hl": "ja", "gl": "JP"},
                                        headers={"Cookie": "CONSENT=YES+1; PREF=hl=ja&gl=JP"}, timeout=httpx.Timeout(10.0))
            if r.status_code == 404:
                return {"current_tab": None, "has_home": False, "not_found": True}
            h = r.text
            i = h.find("ytInitialData = ")
            if i < 0:
                i = h.find("ytInitialData=")
            if i >= 0:
                resp, _ = _json.JSONDecoder().raw_decode(h[h.find("{", i):])
        except Exception:
            resp = None
    if not resp or not isinstance(resp, dict):
        raise ChannelHomeUnavailable("no response")
    if (resp.get("alerts") and not resp.get("contents")):
        return {"current_tab": None, "has_home": False, "not_found": True}
    content, title = _selected_tab(resp)
    if content is None:
        raise ChannelHomeUnavailable("no tabs")
    sections = _home_sections(content)
    data = {"current_tab": {"type": "Tab", "title": title, "selected": True,
                            "content": {"type": "SectionList", "contents": [{"type": "ItemSection", "contents": sections}]}},
            "has_home": bool(sections), "_source": "innertube"}
    _cset(key, data, 600)
    return data
