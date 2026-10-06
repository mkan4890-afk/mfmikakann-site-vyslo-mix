"""LIVE (生放送) の映像をサーバー経由で中継する (YouTube に直接つながらない環境向け)

YouTube から受け取る配信の URL は 30 秒ほどで無効になるため、
- サーバーが十数秒ごとに配信の情報を取り直し (視聴者が何人いても 1 本分だけ)
- ブラウザには変わらない URL (/api/livehls/...) を渡し
- 映像の断片を頼まれたときは、その時点で有効な URL に差し替えて取りに行く
という形で、途中で止まらずに見続けられるようにしている。
"""
from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from routers.videos import warp as _warp

router = APIRouter()

_SESSION_TTL = 3 * 3600  # 配信情報 (マニフェストの URL) を使い続ける最長の時間 (秒)。
                         # マニフェストの URL は数時間有効なので、取り直しは失敗したときと期限前だけにする。
                         # 何度も取りに行くと、YouTube にこのサーバーの回線をボット扱いされやすくなるため
_FORCE_GAP = 30          # 失敗による取り直しの最短の間隔 (秒)
_VARIANT_TTL = 1.5       # 画質ごとのプレイリストの使い回し (秒)
_KEEP_SEGS = 90          # プレイリストに載せる断片の数 (少し前の位置へ戻れるように数分ぶん)
_IDLE_DROP = 120         # 見られなくなった配信の情報を捨てるまで (秒)

_SEG_CACHE_MAX = 48      # 届けた断片をしばらく覚えておく数 (同じ配信を見ている人・再試行で使い回す)

_client: httpx.AsyncClient | None = None
_seg_cache: "OrderedDict[str, bytes]" = OrderedDict()
_seg_inflight: dict[str, asyncio.Future] = {}
_sessions: dict[str, dict] = {}
_locks: dict[str, asyncio.Lock] = {}
_good_client: list[str] = []  # 最近うまくいったクライアント名 (先に試す)
# 取得に失敗したら少し間を空ける (続けて頼むと YouTube に制限されやすくなる)
_fail: dict = {}  # 出口ごと


_warp_client: httpx.AsyncClient | None = None


def _cl(via: str = "direct") -> httpx.AsyncClient:
    # 配信情報の取得と断片の取得は同じ出口から行う (URL が取得元の IP に結び付いているため)
    global _client, _warp_client
    if via == "warp":
        if _warp_client is None or _warp_client.is_closed:
            _warp_client = httpx.AsyncClient(
                proxy=_warp.PROXY_URL,
                timeout=httpx.Timeout(connect=8.0, read=20.0, write=8.0, pool=8.0),
                limits=httpx.Limits(max_connections=60, max_keepalive_connections=30, keepalive_expiry=60),
                follow_redirects=True,
            )
        return _warp_client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=6.0, read=15.0, write=6.0, pool=6.0),
            limits=httpx.Limits(max_connections=80, max_keepalive_connections=40, keepalive_expiry=60),
            follow_redirects=True,
        )
    return _client


def _lock(vid: str) -> asyncio.Lock:
    lk = _locks.get(vid)
    if lk is None:
        lk = _locks[vid] = asyncio.Lock()
    return lk


def _gc():
    now = time.time()
    for k in [k for k, s in _sessions.items() if now - s.get("used", 0) > _IDLE_DROP]:
        _sessions.pop(k, None)
        _locks.pop(k, None)


async def _fetch_player_hls(vid: str) -> tuple[str, str, str]:
    """(マニフェストの URL, 取得できたクライアント, 出口) を返す。
    データセンターの回線は LIVE だけ拒否されやすいので、使えるなら WARP の出口を先に試す"""
    vias = []
    try:
        if await _warp.ensure():
            vias.append("warp")
    except Exception:
        pass
    vias.append("direct")
    for via in vias:
        hls, tag = await _fetch_player_hls_via(vid, via)
        if hls:
            return hls, tag, via
    return "", "", ""


async def _fetch_player_hls_via(vid: str, via: str) -> tuple[str, str]:
    from routers.videos import watch as _w
    try:
        from routers.videos import livechat as _lc
        if not _lc._cfg.get("key") or time.time() - _lc._cfg.get("t", 0) > _lc._CFG_TTL:
            await asyncio.wait_for(_lc._initial(vid), 6)
    except Exception:
        pass
    # 失敗の間隔あけは動画ごと (終わった配信の失敗で、他の LIVE まで待たされないように)
    if len(_fail) > 500:
        _fail.clear()
    fail = _fail.setdefault(f"{via}:{vid}", {"n": 0, "until": 0.0})
    if time.time() < fail["until"]:
        return "", ""
    cl = _cl(via)
    # (クライアント, 付け方) の組み合わせ。最近うまくいったものから試す
    # (WARP の出口からは ANDROID / 新しい visitorData 付きの ANDROID_VR が LIVE の HLS を返す)
    pref = [("ANDROID", "bare"), ("ANDROID_VR", "fresh"), ("ANDROID", "fresh"), ("ANDROID_VR", "bare"),
            ("IOS", "fresh"), ("ANDROID_VR", "cfg")]
    byname = {c[0]: c for c in _w._LIVE_CLIENTS}
    combos = [(byname[n], m) for n, m in pref if n in byname]
    good = [g.split("@")[0] for g in _good_client]
    combos.sort(key=lambda x: good.index(f"{x[0][0]}:{x[1]}") if f"{x[0][0]}:{x[1]}" in good else 99)
    for i in range(0, len(combos), 3):
        batch = combos[i:i + 3]
        res = await asyncio.gather(*[_w._live_innertube(cl, vid, c, m) for c, m in batch], return_exceptions=True)
        for (c, m), r in zip(batch, res):
            if isinstance(r, dict) and r.get("hls") and r.get("isLive"):
                tag = f"{c[0]}:{m}"
                if tag in _good_client:
                    _good_client.remove(tag)
                _good_client.insert(0, tag)
                fail.update(n=0, until=0.0)
                return r["hls"], f"{tag}@{via}"
    fail["n"] += 1
    fail["until"] = time.time() + min(300, 15 * (2 ** min(fail["n"] - 1, 4)))  # 15秒→30→60→120→240
    return "", ""


async def _session(vid: str, force: bool = False) -> dict | None:
    s = _sessions.get(vid)
    now = time.time()
    if s and not force and now < s.get("exp", 0):
        s["used"] = now
        return s
    async with _lock(vid):
        s = _sessions.get(vid)
        if s and not force and time.time() < s.get("exp", 0):
            s["used"] = time.time()
            return s
        if s and force and time.time() - s["t"] < _FORCE_GAP:
            return s  # 少し前に取り直したばかり
        hls, src, via = await _fetch_player_hls(vid)
        if not hls:
            return s
        r = await _cl(via).get(hls)
        if r.status_code != 200 or "#EXTM3U" not in r.text[:200]:
            return s
        base = str(r.url)
        variants: dict[str, str] = {}
        lines_out: list[str] = []
        for line in r.text.splitlines():
            st = line.strip()
            if st and not st.startswith("#"):
                u = urljoin(base, st)
                m = re.search(r"/itag/(\d+)/", u)
                itag = m.group(1) if m else str(len(variants))
                variants[itag] = u
                lines_out.append(f"/api/livehls/{vid}/v/{itag}.m3u8")
            else:
                lines_out.append(line)
        exp = time.time() + _SESSION_TTL
        m = re.search(r"/expire/(\d+)", hls) or re.search(r"[?&]expire=(\d+)", hls)
        if m:
            exp = min(exp, int(m.group(1)) - 600)
        s = {"t": time.time(), "exp": exp, "used": time.time(), "src": src, "via": via, "variants": variants,
             "master": "\n".join(lines_out) + "\n", "vcache": {}, "tmpl": {}}
        _sessions[vid] = s
        _gc()
        return s


async def _variant(vid: str, itag: str, force: bool = False) -> tuple[str, dict] | None:
    s = await _session(vid, force=force)
    if not s or itag not in s["variants"]:
        return None
    c = s["vcache"].get(itag)
    if c and not force and time.time() - c["t"] < _VARIANT_TTL:
        return c["text"], s
    r = await _cl(s.get("via", "direct")).get(s["variants"][itag])
    if r.status_code != 200:
        return None
    base = str(r.url)
    head: list[str] = []
    segs: list[tuple[list[str], str]] = []  # (前置きのタグ, URL)
    pending: list[str] = []
    seq0 = 0
    for line in r.text.splitlines():
        st = line.strip()
        if not st:
            continue
        if st.startswith("#EXT-X-MEDIA-SEQUENCE:"):
            try:
                seq0 = int(st.split(":", 1)[1])
            except Exception:
                pass
            continue
        if st.startswith("#EXT-X-PLAYLIST-TYPE") or st.startswith("#EXT-X-ENDLIST"):
            continue
        if st.startswith(("#EXTM3U", "#EXT-X-VERSION", "#EXT-X-TARGETDURATION", "#EXT-X-INDEPENDENT")):
            head.append(st)
            continue
        if st.startswith("#"):
            pending.append(st)  # その断片に付くタグ (#EXTINF など)
            continue
        segs.append((pending, urljoin(base, st)))
        pending = []
    if not segs:
        return None
    drop = max(0, len(segs) - _KEEP_SEGS)
    keep = segs[drop:]
    out = list(head)
    if not any(h.startswith("#EXTM3U") for h in out):
        out.insert(0, "#EXTM3U")
    out.append(f"#EXT-X-MEDIA-SEQUENCE:{seq0 + drop}")
    for i, (tags, u) in enumerate(keep):
        out.extend(tags)
        m = re.search(r"/sq/(\d+)/", u)
        sq = m.group(1) if m else str(seq0 + drop + i)
        out.append(f"/api/livehls/{vid}/s/{itag}/{sq}.ts")
    # 断片の URL のひな形 (sq の部分だけ差し替えて使う)
    sample = keep[-1][1]
    if re.search(r"/sq/\d+/", sample):
        s["tmpl"][itag] = (time.time(), sample)
    text = "\n".join(out) + "\n"
    s["vcache"][itag] = {"t": time.time(), "text": text}
    return text, s


@router.get("/api/livehls/{video_id}/master.m3u8")
async def live_master(video_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return JSONResponse({"error": "invalid id"}, status_code=400)
    try:
        s = await asyncio.wait_for(_session(video_id), 20)
    except Exception:
        s = None
    if not s:
        return JSONResponse({"error": "配信の映像を取得できませんでした"}, status_code=502)
    return PlainTextResponse(s["master"], media_type="application/vnd.apple.mpegurl",
                             headers={"Cache-Control": "no-store"})


@router.get("/api/livehls/{video_id}/v/{itag}.m3u8")
async def live_variant(video_id: str, itag: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) or not itag.isdigit():
        return JSONResponse({"error": "invalid"}, status_code=400)
    try:
        res = await asyncio.wait_for(_variant(video_id, itag), 20)
        if not res:
            res = await asyncio.wait_for(_variant(video_id, itag, force=True), 20)
    except Exception:
        res = None
    if not res:
        return JSONResponse({"error": "プレイリストを取得できませんでした"}, status_code=502)
    return PlainTextResponse(res[0], media_type="application/vnd.apple.mpegurl",
                             headers={"Cache-Control": "no-store"})


async def _seg_url(video_id: str, itag: str, sq: str, force: bool = False) -> tuple[str, str]:
    s = await _session(video_id, force=force)
    if not s:
        return "", ""
    t = s["tmpl"].get(itag)
    # ひな形が今の配信情報より古いときは、画質のプレイリストを取り直して作り直す
    if force or not t or t[0] < s["t"]:
        await _variant(video_id, itag, force=True)
        t = s["tmpl"].get(itag)
    if not t:
        return "", ""
    return re.sub(r"/sq/\d+/", f"/sq/{sq}/", t[1], count=1), s.get("via", "direct")


async def _fetch_segment(video_id: str, itag: str, sq: str) -> tuple[int, bytes]:
    last = 0
    for attempt in range(3):
        try:
            u, via = await asyncio.wait_for(_seg_url(video_id, itag, sq, force=attempt > 0), 20)
        except Exception:
            u, via = "", ""
        if not u:
            last = 502
            continue
        try:
            r = await _cl(via).get(u)
        except Exception:
            last = 502
            continue
        if r.status_code == 200 and r.content:
            return 200, r.content
        last = r.status_code
        if r.status_code == 404:
            break  # まだできていない / もう消えた断片
    return (last if last in (404, 410) else 502), b""


@router.get("/api/livehls/{video_id}/s/{itag}/{sq}.ts")
async def live_segment(video_id: str, itag: str, sq: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) or not itag.isdigit() or not sq.isdigit():
        return JSONResponse({"error": "invalid"}, status_code=400)
    key = f"{video_id}:{itag}:{sq}"
    hit = _seg_cache.get(key)
    if hit is not None:
        _seg_cache.move_to_end(key)
        return Response(hit, media_type="video/mp2t", headers={"Cache-Control": "public, max-age=60"})
    # 同じ断片を同時に頼まれたら、YouTube へは 1 回だけ取りに行く
    fut = _seg_inflight.get(key)
    if fut is None:
        fut = asyncio.get_running_loop().create_future()
        _seg_inflight[key] = fut
        try:
            res = await _fetch_segment(video_id, itag, sq)
        except Exception:
            res = (502, b"")
        _seg_inflight.pop(key, None)
        if not fut.done():
            fut.set_result(res)
        if res[0] == 200:
            _seg_cache[key] = res[1]
            while len(_seg_cache) > _SEG_CACHE_MAX:
                _seg_cache.popitem(last=False)
    else:
        try:
            res = await asyncio.wait_for(asyncio.shield(fut), 45)
        except Exception:
            res = (502, b"")
    code, body = res
    if code == 200:
        return Response(body, media_type="video/mp2t", headers={"Cache-Control": "public, max-age=60"})
    return Response(status_code=code)
