"""フル再生用の音声をサーバー経由で配信する.

Spotify が使えない環境 (学校・会社のネットワーク等) でも曲を最後まで聴けるように、
同じコンテナ内の VYSLO TUBE (127.0.0.1:8002) を使って曲に対応する動画を探し、
その音声付きストリームを このサーバーが中継して ブラウザに流す。
ブラウザから見ると通信先は このサイトだけなので、Spotify / YouTube が
ブロックされていても再生できる。
"""
import asyncio
import os
import re
import time
import unicodedata
from typing import Optional
from urllib.parse import urlparse

import httpx

TUBE = os.environ.get("TUBE_URL", "http://127.0.0.1:8002").rstrip("/")
VID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

_find_cache: dict[str, tuple[float, Optional[str]]] = {}
_url_cache: dict[str, tuple[float, list]] = {}
_find_sem = asyncio.Semaphore(4)
_inflight: dict[str, asyncio.Future] = {}

BAD_WORDS = ["cover", "カバー", "歌ってみた", "弾いてみた", "叩いてみた", "踊ってみた", "karaoke", "カラオケ", "offvocal", "off vocal",
             "instrumental", "インスト", "piano", "ピアノ", "orgel", "オルゴール", "reaction", "リアクション", "nightcore", "slowed",
             "reverb", "8d", "remix", "live", "ライブ", "tutorial", "lyrics video 和訳", "和訳", "fanmade", "speed up", "sped up",
             "tiktok", "1hour", "1 hour", "耐久", "メドレー", "medley", "shorts", "解説", "ギター", "guitar", "drum", "ドラム", "bass"]
GOOD_WORDS = ["official", "オフィシャル", "公式", "music video", "mv", "pv", "audio", "topic", "provided to youtube"]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").casefold()
    return re.sub(r"[\s\W_]+", "", s)


def _strip_feat(s: str) -> str:
    return re.sub(r"\s*[\(\[（【](feat\.?|ft\.?|with|featuring)[^\)\]）】]*[\)\]）】]", "", s or "", flags=re.I).strip()


def _first_artist(a: str) -> str:
    for sep in [" & ", ", ", " feat. ", " ft. ", " × ", " x ", "、"]:
        if sep in (a or ""):
            return a.split(sep)[0].strip()
    return (a or "").strip()


def _score(v: dict, track: str, artists: list[str], dur_s: Optional[float]) -> float:
    title = v.get("title") or ""
    author = v.get("author") or ""
    tl, al = title.casefold(), author.casefold()
    nt, na = _norm(title), _norm(author)
    tn = _norm(_strip_feat(track))
    tn2 = _norm(re.sub(r"\s*[\(\[（【][^\)\]）】]*[\)\]）】]\s*$", "", _strip_feat(track)))
    s = 0.0
    if tn and tn in nt:
        s += 10
    elif tn2 and tn2 in nt:
        s += 8
    else:
        return -100  # 曲名が入っていない動画は使わない
    hit_artist = False
    for a in artists:
        an = _norm(a)
        if len(an) >= 2 and (an in na or an in nt):
            hit_artist = True
            break
    s += 8 if hit_artist else 0
    if "- topic" in al or al.endswith("topic") or "vevo" in al:
        s += 5
    for w in GOOD_WORDS:
        if w in tl or w in al:
            s += 2
            break
    track_l = track.casefold()
    for w in BAD_WORDS:
        if w in tl and w not in track_l:
            s -= 12
            break
    length = v.get("lengthSeconds") or v.get("duration") or 0
    try:
        length = float(length)
    except (TypeError, ValueError):
        length = 0
    if length and (length < 60 or length > 900):
        s -= 20
    if dur_s and length:
        diff = abs(length - dur_s)
        s += 6 if diff <= 3 else 4 if diff <= 10 else 1 if diff <= 30 else -4 if diff <= 90 else -15
    return s


async def _tube_search(http: httpx.AsyncClient, q: str, flt: str) -> list[dict]:
    try:
        r = await http.get(f"{TUBE}/api/piped-search", params={"q": q, "filter": flt},
                           timeout=httpx.Timeout(14.0, connect=3.0))
        if r.status_code != 200:
            return []
        return [x for x in (r.json().get("results") or []) if x.get("type") == "video" and VID_RE.match(x.get("videoId") or "")]
    except (httpx.HTTPError, ValueError):
        return []


async def find_video(http: httpx.AsyncClient, track: str, artist: str, dur_ms: Optional[int] = None,
                     en: Optional[tuple] = None, en_artist: str = "") -> Optional[str]:
    """曲名+アーティスト名から、その曲の音源 (公式音源/MV) の動画IDを探す."""
    key = f"{_norm(_first_artist(artist))}|{_norm(_strip_feat(track))}|{(dur_ms or 0) // 10000}"
    c = _find_cache.get(key)
    if c and c[0] > time.time():
        return c[1]
    if key in _inflight:
        return await _inflight[key]
    fut = asyncio.get_event_loop().create_future()
    _inflight[key] = fut
    try:
        dur_s = (dur_ms / 1000) if dur_ms else None
        artists = [artist, _first_artist(artist)] + ([en[1]] if en else []) + ([en_artist] if en_artist else [])
        a1 = _first_artist(artist)
        queries = [(f"{a1} {_strip_feat(track)}", "music_songs"), (f"{a1} {_strip_feat(track)}", "videos")]
        if en_artist or en:
            ea = en_artist or _first_artist(en[1])
            et = _strip_feat(en[0]) if en else _strip_feat(track)
            queries.append((f"{ea} {et}", "music_songs"))
        best, best_s = None, -1e9
        async with _find_sem:
            for i in range(0, len(queries), 2):
                part = queries[i:i + 2]
                res = await asyncio.gather(*(_tube_search(http, q, f) for q, f in part))
                for (q, f), vids in zip(part, res):
                    for rank, v in enumerate(vids[:12]):
                        sc = _score(v, track, artists, dur_s) + (2 if f == "music_songs" else 0) - rank * 0.3
                        if en and sc < 0:
                            sc = max(sc, _score(v, en[0], artists, dur_s) - 1)
                        if sc > best_s:
                            best, best_s = v["videoId"], sc
                if best_s >= 16:
                    break
        vid = best if best_s >= 8 else None
        _find_cache[key] = (time.time() + (86400 * 3 if vid else 1800), vid)
        if len(_find_cache) > 5000:
            for k in list(_find_cache)[:1000]:
                _find_cache.pop(k, None)
        fut.set_result(vid)
        return vid
    except Exception as e:
        fut.set_result(None)
        return None
    finally:
        _inflight.pop(key, None)


BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
_ANUBIS_RE = re.compile(r'\{"rules".*?"spent":(?:true|false)\}\}', re.S)
_media_client: Optional[httpx.AsyncClient] = None
_anubis_lock = asyncio.Lock()


def media_client() -> httpx.AsyncClient:
    """音声中継用 (Invidious の bot 対策 Cookie を保持する)."""
    global _media_client
    if _media_client is None:
        _media_client = httpx.AsyncClient(headers={"User-Agent": BROWSER_UA}, follow_redirects=True,
                                          timeout=httpx.Timeout(connect=8.0, read=60.0, write=10.0, pool=10.0),
                                          limits=httpx.Limits(max_connections=80, max_keepalive_connections=20))
    return _media_client


async def solve_anubis(origin: str, html: str) -> bool:
    """Invidious インスタンスの bot 対策 (Anubis) の計算を解いて Cookie をもらう."""
    import hashlib
    import json as _json
    m = _ANUBIS_RE.search(html or "")
    if not m:
        return False
    try:
        ch = _json.loads(m.group(0))["challenge"]
    except (ValueError, KeyError):
        return False
    d = int(ch.get("difficulty") or 2)
    if d > 6:
        return False
    rd = ch.get("randomData") or ""
    n = 0
    while True:
        h = hashlib.sha256(f"{rd}{n}".encode()).hexdigest()
        if h.startswith("0" * d):
            break
        n += 1
        if n > 50_000_000:
            return False
        if n % 20000 == 0:
            await asyncio.sleep(0)
    c = media_client()
    async with _anubis_lock:
        try:
            r = await c.get(f"{origin}/.within.website/x/cmd/anubis/api/pass-challenge",
                            params={"id": ch.get("id"), "response": h, "nonce": n, "redir": "/", "elapsedTime": 900},
                            follow_redirects=False, timeout=httpx.Timeout(10.0))
        except httpx.HTTPError:
            return False
    return r.status_code in (200, 302, 303)


def _pick_audio(data: dict) -> Optional[str]:
    af = data.get("adaptiveFormats") or []
    for want in ("140", "139"):
        for f in af:
            if str(f.get("itag")) == want and f.get("url"):
                return f["url"]
    for f in af:
        if "audio/mp4" in (f.get("type") or "") and f.get("url"):
            return f["url"]
    for f in data.get("formatStreams") or []:
        if f.get("url"):
            return f["url"]
    return None


WARP_PROXY = os.environ.get("WARP_PROXY", "socks5://127.0.0.1:" + os.environ.get("WARP_SOCKS_PORT", "40081"))
_IT_CLIENTS = [
    ("ANDROID", "20.10.38", "3", "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
     {"androidSdkVersion": 34, "osName": "Android", "osVersion": "14"}),
    ("ANDROID_VR", "1.65.10", "28", "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
     {"deviceMake": "Oculus", "deviceModel": "Quest 3", "androidSdkVersion": 32, "osName": "Android", "osVersion": "12L"}),
    ("IOS", "20.39.6", "5", "com.google.ios.youtube/20.39.6 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X;)",
     {"deviceMake": "Apple", "deviceModel": "iPhone16,2", "osName": "iPhone", "osVersion": "18.6.0.22G86"}),
]
_via_clients: dict[str, httpx.AsyncClient] = {}
_vd = {"v": "", "t": 0.0}
_good: list[str] = []
last_diag: dict = {}


def via_client(via: str) -> httpx.AsyncClient:
    """YouTube への出口ごとのクライアント (URL は取得した出口の IP に結び付くため、取得と中継は同じ出口で行う)."""
    if via == "inv":
        return media_client()
    c = _via_clients.get(via)
    if c is None or c.is_closed:
        kw = {"proxy": WARP_PROXY} if via == "warp" else {}
        c = httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(connect=8.0, read=40.0, write=10.0, pool=10.0),
                              limits=httpx.Limits(max_connections=80, max_keepalive_connections=20), **kw)
        _via_clients[via] = c
    return c


def _warp_up() -> bool:
    import socket
    try:
        port = int(WARP_PROXY.rsplit(":", 1)[1])
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except (OSError, ValueError):
        return False


async def _visitor(cl: httpx.AsyncClient) -> str:
    import json as _json
    if _vd["v"] and time.time() - _vd["t"] < 600:
        return _vd["v"]
    try:
        r = await cl.get("https://www.youtube.com/sw.js_data", headers={"User-Agent": BROWSER_UA}, timeout=8)
        t = r.text
        v = _json.loads(t[t.index("["):])[0][2][0][0][13]
        if isinstance(v, str) and v:
            _vd.update(v=v, t=time.time())
            return v
    except Exception:
        pass
    return ""


async def _innertube(vid: str, via: str) -> Optional[dict]:
    cl = via_client(via)
    order = sorted(_IT_CLIENTS, key=lambda c: _good.index(c[0]) if c[0] in _good else 9)
    diag = last_diag.setdefault(vid, {})
    for name, ver, cn, ua, extra in order:
        for fresh in (True, False):
            vd = await _visitor(cl) if fresh else ""
            body = {"context": {"client": {"clientName": name, "clientVersion": ver, "hl": "ja", "gl": "JP",
                                           **({"visitorData": vd} if vd else {}), **extra}},
                    "videoId": vid, "contentCheckOk": True, "racyCheckOk": True}
            h = {"X-YouTube-Client-Name": cn, "X-YouTube-Client-Version": ver, "User-Agent": ua, "Origin": "https://www.youtube.com"}
            if vd:
                h["X-Goog-Visitor-Id"] = vd
            try:
                r = await cl.post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", json=body, headers=h, timeout=10)
                j = r.json()
            except Exception as e:
                diag[f"{via}:{name}:{fresh}"] = repr(e)[:120]
                continue
            ps = j.get("playabilityStatus") or {}
            sd = j.get("streamingData") or {}
            cands = [f for f in (sd.get("formats") or []) if f.get("itag") == 18 and f.get("url")]
            cands += [f for want in (140, 139) for f in (sd.get("adaptiveFormats") or []) if f.get("itag") == want and f.get("url")]
            diag[f"{via}:{name}:{fresh}"] = f"{ps.get('status')} {str(ps.get('reason', ''))[:60]} n={len(cands)}"
            pick = None
            for f in cands:
                # 曲の途中まで取れるか確かめる (PO トークンが無いと先頭しか取れない形式があるため)
                size = int(f.get("contentLength") or 0)
                mid = max(0, min(size - 2048, 1_600_000)) if size else 1_600_000
                try:
                    t = await cl.get(f["url"], headers={"Range": f"bytes={mid}-{mid + 1023}", "User-Agent": ua}, timeout=8)
                except httpx.HTTPError as e:
                    diag[f"{via}:{name}:{f.get('itag')}:get"] = repr(e)[:80]
                    continue
                diag[f"{via}:{name}:{f.get('itag')}:get"] = t.status_code
                if t.status_code in (200, 206):
                    pick = f
                    break
            if not pick:
                continue
            if name in _good:
                _good.remove(name)
            _good.insert(0, name)
            return {"u": pick["url"], "via": via, "ua": ua, "chunk": True, "itag": pick.get("itag"),
                    "ct": (pick.get("mimeType") or "audio/mp4").split(";")[0]}
    return None


async def media_urls(http: httpx.AsyncClient, vid: str, force: bool = False) -> list[dict]:
    """再生用URLの候補 (先頭から試す)."""
    c = _url_cache.get(vid)
    if c and c[0] > time.time() and not force:
        return c[1]
    if len(last_diag) > 50:
        last_diag.clear()
    out: list[dict] = []
    # 1) このサーバーから YouTube に直接 (速い)。だめなら WARP の出口から
    vias = (["warp"] if _warp_up() else []) + ["direct"]
    for via in vias:
        try:
            it = await _innertube(vid, via)
        except Exception as e:
            last_diag.setdefault(vid, {})[via] = repr(e)[:120]
            it = None
        if it:
            out.append(it)
            break
    # 2) Invidious 経由 (インスタンスが中継するので IP 制限を受けない。遅め)
    if not out:
        try:
            r = await http.get(f"{TUBE}/proxy/stream/api/stream/{vid}", timeout=httpx.Timeout(30.0, connect=3.0))
            if r.status_code == 200:
                inst = (r.headers.get("x-instance-used") or "").rstrip("/")
                u = _pick_audio(r.json())
                if u:
                    pu = urlparse(u)
                    if inst.startswith("https://") and (pu.hostname or "").endswith(".googlevideo.com"):
                        out.append({"u": f"{inst}{pu.path}?{pu.query}&host={pu.hostname}", "via": "inv", "ua": BROWSER_UA, "chunk": False})
        except (httpx.HTTPError, ValueError):
            pass
    if out:
        exp = time.time() + 3 * 3600
        m = re.search(r"[?&]expire=(\d+)", out[0]["u"])
        if m:
            exp = min(exp, int(m.group(1)) - 600)
        _url_cache[vid] = (exp, out)
        if len(_url_cache) > 2000:
            for k in list(_url_cache)[:500]:
                _url_cache.pop(k, None)
    return out


CHUNK = 2 * 1024 * 1024


def _clamp_range(rng: Optional[str]) -> str:
    """YouTube は大きな範囲を一度に頼むと遅くされるので、数MBずつに区切る."""
    m = re.match(r"bytes=(\d+)-(\d*)", rng or "bytes=0-")
    if not m:
        return f"bytes=0-{CHUNK - 1}"
    a = int(m.group(1))
    b = int(m.group(2)) if m.group(2) else a + CHUNK - 1
    return f"bytes={a}-{min(b, a + CHUNK - 1)}"


async def open_stream(http: httpx.AsyncClient, vid: str, rng: Optional[str]):
    """音声ストリームを開く。成功したら httpx.Response (stream) を返す."""
    for attempt in range(2):
        for e in await media_urls(http, vid, force=attempt > 0):
            u = e["u"]
            c = via_client(e["via"])
            origin = re.match(r"^(https://[^/]+)", u).group(1)
            for _try in range(2):
                headers = {"User-Agent": e["ua"]}
                if e.get("chunk"):
                    headers["Range"] = _clamp_range(rng)
                elif rng:
                    headers["Range"] = rng
                try:
                    resp = await c.send(c.build_request("GET", u, headers=headers), stream=True)
                except httpx.HTTPError as ex:
                    last_diag.setdefault(vid, {})[f"open:{e['via']}:{attempt}"] = repr(ex)[:120]
                    break
                ct = resp.headers.get("content-type", "")
                last_diag.setdefault(vid, {})[f"open:{e['via']}:{attempt}"] = f"{resp.status_code} {ct}"
                if resp.status_code in (200, 206) and not ct.startswith("text/"):
                    return resp
                body = b""
                if ct.startswith("text/html"):
                    try:
                        body = await resp.aread()
                    except httpx.HTTPError:
                        pass
                await resp.aclose()
                if body and b"anubis" in body and await solve_anubis(origin, body.decode("utf-8", "ignore")):
                    continue
                break
    return None

