"""Vyslo Music — 登録不要・無料の音楽フロントエンド.

カタログ: Apple iTunes API(キー不要) / 再生: Spotify公式埋め込みプレーヤー
曲を再生すると、サーバーが曲名+アーティスト名からSpotifyの曲IDを探し、
公式プレーヤーをその曲で呼び出します。見つからない曲は30秒試聴で再生します。
"""
import asyncio
import os
import re
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

import sources as src
import ytaudio
import lyralign

VERSION = "2.6.3"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
NUM_RE = re.compile(r"^\d{1,15}$")
SP_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")
IMG_HOSTS = (".mzstatic.com", ".scdn.co", ".spotifycdn.com")
SP_TYPES = {"track", "album", "artist", "playlist", "show", "episode"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    src.http = httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=8.0),
        limits=httpx.Limits(max_connections=60, max_keepalive_connections=20),
        follow_redirects=True,
    )
    yield
    await src.http.aclose()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=800)


@app.middleware("http")
async def headers_mw(request: Request, call_next):
    resp = await call_next(request)
    p = request.url.path
    if p.startswith("/static/"):
        resp.headers["Cache-Control"] = "public, max-age=86400"
    elif not p.startswith("/img"):
        resp.headers.setdefault("Cache-Control", "no-store")
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return resp


@app.exception_handler(src.SourceError)
async def source_error(request: Request, exc: src.SourceError):
    return JSONResponse({"error": exc.message}, status_code=exc.status if 400 <= exc.status < 600 else 502)


def bad(msg: str, status: int = 400):
    return JSONResponse({"error": msg}, status_code=status)


_bg_tasks: set = set()


def bg(coro):
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)


def num(i: str) -> bool:
    return bool(NUM_RE.match(i or ""))


# ── Basic ─────────────────────────────────────────────────
@app.get("/version")
async def version():
    return {"name": "Vyslo Music", "version": VERSION}


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": int(time.time())}


@app.get("/api/config")
async def config():
    return {"mode": "free", "version": VERSION, "country": src.COUNTRY}


# ── Search ────────────────────────────────────────────────
ENTITY = {"track": ("music", "song"), "album": ("music", "album"), "artist": ("music", "musicArtist"),
          "show": ("podcast", "podcast"), "episode": ("podcast", "podcastEpisode")}
NORM = {"track": src.n_track, "album": src.n_album, "artist": src.n_artist, "show": src.n_show, "episode": src.n_episode}


async def _search(q: str, t: str, limit: int, enrich_artist: bool = True) -> list:
    media, entity = ENTITY[t]
    res = await src.itunes("/search", {"term": q, "media": media, "entity": entity, "limit": limit}, ttl=3600)
    items = src.clean(NORM[t](r) for r in res)
    if t == "artist" and enrich_artist:
        await src.enrich_artists(items)
    return items


@app.get("/api/search")
async def search(q: str = Query("", max_length=200), type: str = "track", page: int = 1):
    q = q.strip()
    if not q:
        return {"items": [], "next": None}
    types = [t for t in type.split(",") if t in ENTITY] or ["track"]
    if len(types) > 1:
        lim = {"track": 10, "artist": 8, "album": 12, "show": 8, "episode": 8}
        results = await asyncio.gather(*[_search(q, t, lim[t]) for t in types], return_exceptions=True)
        out = {}
        for t, r in zip(types, results):
            out[t] = {"items": [] if isinstance(r, Exception) else r}
        if "track" in out:
            bg(src.prefetch(out["track"]["items"]))
        return out
    t = types[0]
    page = max(1, min(page, 4))
    size = {1: 25, 2: 50, 3: 100, 4: 200}[page]
    items = await _search(q, t, size)
    if t == "track":
        bg(src.prefetch(items[:25]))
    return {"items": items, "next": page + 1 if len(items) >= size and page < 4 else None}


@app.get("/api/suggest")
async def suggest(q: str = Query("", max_length=100)):
    q = q.strip()
    if not q:
        return {"items": []}
    try:
        ar, tr = await asyncio.gather(_search(q, "artist", 8, enrich_artist=False), _search(q, "track", 15))
    except src.SourceError:
        return {"items": []}
    ql = q.casefold()
    # 曲の検索結果に多く出るアーティスト = 人気、として並べ替える
    pop: dict[str, int] = {}
    for t in tr:
        for a in t.get("artists") or []:
            pop[a.get("id")] = pop.get(a.get("id"), 0) + 1

    def a_score(a):
        n = (a.get("name") or "").casefold()
        return (pop.get(a.get("id"), 0) * 2 + (3 if n.startswith(ql) else 0) + (1 if n == ql else 0))

    def t_score(t):
        n = (t.get("name") or "").casefold()
        an = " ".join((a.get("name") or "") for a in t.get("artists") or []).casefold()
        return (2 if n.startswith(ql) else 1 if ql in n else 0) + (2 if an.startswith(ql) else 1 if ql in an else 0)

    ar = sorted(ar, key=a_score, reverse=True)[:3]
    tr = sorted(tr, key=t_score, reverse=True)[:5]  # sorted は安定なので同点なら元の順
    return {"items": ar + tr}


# ── Catalog ───────────────────────────────────────────────
@app.get("/api/charts")
async def charts():
    songs, albums = await asyncio.gather(src.chart_songs(50), src.chart_albums(25), return_exceptions=True)
    if not isinstance(songs, Exception):
        bg(src.prefetch(songs, 50))
    return {
        "songs": [] if isinstance(songs, Exception) else songs,
        "albums": [] if isinstance(albums, Exception) else albums,
    }


@app.get("/api/track/{tid}")
async def track(tid: str):
    if not num(tid):
        return bad("invalid id")
    res = await src.itunes("/lookup", {"id": tid}, ttl=86400)
    t = next((src.n_track(r) for r in res if src.n_track(r)), None)
    if not t:
        return bad("曲が見つかりません", 404)
    return t


@app.get("/api/album/{aid}")
async def album(aid: str):
    if not num(aid):
        return bad("invalid id")
    res = await src.itunes("/lookup", {"id": aid, "entity": "song", "limit": 200}, ttl=86400)
    head = next((src.n_album(r) for r in res if r.get("wrapperType") == "collection"), None)
    if not head:
        return bad("アルバムが見つかりません", 404)
    tracks = src.clean(src.n_track(r) for r in res if r.get("wrapperType") == "track")
    tracks.sort(key=lambda t: ((t.get("disc_number") or 1), (t.get("track_number") or 0)))
    for t in tracks:
        t["img"] = t["img"] or head["img"]
    head["tracks"] = tracks
    bg(src.prefetch(tracks, 50))
    return head


@app.get("/api/artist/{aid}")
async def artist(aid: str):
    if not num(aid):
        return bad("invalid id")
    albums_res, songs_res, photo = await asyncio.gather(
        src.itunes("/lookup", {"id": aid, "entity": "album", "limit": 100}, ttl=86400),
        src.itunes("/lookup", {"id": aid, "entity": "song", "limit": 25}, ttl=86400),
        src.artist_photo(aid),
    )
    head = next((src.n_artist(r) for r in albums_res + songs_res if r.get("wrapperType") == "artist"), None)
    if not head:
        return bad("アーティストが見つかりません", 404)
    albums = src.clean(src.n_album(r) for r in albums_res)
    albums = [a for a in albums if any(x["id"] == aid for x in a["artists"])] or albums
    albums.sort(key=lambda a: a.get("release_date") or "", reverse=True)
    full = [a for a in albums if a["album_type"] == "album"]
    singles = [a for a in albums if a["album_type"] != "album"]
    tracks = src.clean(src.n_track(r) for r in songs_res)
    head["photo"] = bool(photo)
    head["img"] = photo or (full[0]["img"] if full else None) or (albums[0]["img"] if albums else None) or (tracks[0]["img"] if tracks else None)
    head.update({"albums": full, "singles": singles, "appears_on": [], "tracks": tracks})
    bg(src.prefetch(tracks, 25))
    return head


@app.get("/api/artist_images")
async def artist_images(ids: str = Query("", max_length=600)):
    lst = [i for i in ids.split(",") if num(i)][:30]
    res = await asyncio.gather(*(src.artist_photo(i) for i in lst), return_exceptions=True)
    return {"images": {i: r for i, r in zip(lst, res) if isinstance(r, str) and r}}


@app.get("/api/show/{sid}")
async def show(sid: str):
    if not num(sid):
        return bad("invalid id")
    res = await src.itunes("/lookup", {"id": sid, "media": "podcast", "entity": "podcastEpisode", "limit": 100}, ttl=1800)
    head = next((src.n_show(r) for r in res if r.get("kind") == "podcast"), None)
    if not head:
        return bad("番組が見つかりません", 404)
    eps = src.clean(src.n_episode(r, head) for r in res)
    eps.sort(key=lambda e: e.get("release_date") or "", reverse=True)
    head["episodes"] = eps
    head["next"] = None
    return head


@app.get("/api/episode/{eid}")
async def episode(eid: str):
    if not num(eid):
        return bad("invalid id")
    res = await src.itunes("/lookup", {"id": eid, "media": "podcast", "entity": "podcastEpisode"}, ttl=3600)
    e = next((src.n_episode(r) for r in res if src.n_episode(r)), None)
    if not e:
        return bad("エピソードが見つかりません", 404)
    return e


# ── フル再生 (サーバー経由の音声。Spotify/YouTube がブロックされた環境でも再生できる) ──
@app.get("/api/full")
async def full(track: str = Query("", max_length=300), artist: str = Query("", max_length=300),
               duration: int = 0, id: str = "", aid: str = ""):
    if not track.strip() or not artist.strip():
        return bad("track と artist が必要です")
    track, artist = track.strip(), artist.strip()
    tid = id if num(id) else ""
    aid = aid if num(aid) else ""

    async def go():
        vid = await ytaudio.find_video(src.http, track, artist, duration or None)
        if not vid and (tid or aid):
            en = (await src.en_names([tid])).get(tid) if tid else None
            ena = (await src.en_artists([aid])).get(aid, "") if aid else ""
            if en or ena:
                vid = await ytaudio.find_video(src.http, track, artist, duration or None, en, ena)
        return vid
    try:
        vid = await asyncio.wait_for(go(), timeout=25)
    except asyncio.TimeoutError:
        vid = None
    if not vid:
        return bad("フル音源が見つかりませんでした", 404)
    bg(ytaudio.media_urls(src.http, vid))  # 先に音声URLを用意しておく
    return {"vid": vid, "src": f"/api/full/stream/{vid}"}


@app.get("/api/full/debug/{vid}")
async def full_debug(vid: str, request: Request):
    if not ytaudio.VID_RE.match(vid):
        return bad("invalid id")
    t = time.time()
    if request.query_params.get("open"):
        r = await ytaudio.open_stream(src.http, vid, "bytes=0-")
        if r is not None:
            await r.aclose()
        return {"open": r is not None and r.status_code, "diag": ytaudio.last_diag.get(vid)}
    us = await ytaudio.media_urls(src.http, vid, force=True)
    return {"took": round(time.time() - t, 2), "warp": ytaudio._warp_up(),
            "urls": [{"via": e["via"], "host": e["u"].split("/")[2]} for e in us], "diag": ytaudio.last_diag.get(vid)}


@app.get("/api/full/stream/{vid}")
async def full_stream(vid: str, request: Request):
    if not ytaudio.VID_RE.match(vid):
        return bad("invalid id")
    resp = await ytaudio.open_stream(src.http, vid, request.headers.get("range"))
    if resp is None:
        return bad("音声を取得できませんでした", 502)
    out = {"Cache-Control": "no-store", "Accept-Ranges": "bytes", "Content-Encoding": "identity"}
    for h in ("content-length", "content-range"):
        if h in resp.headers:
            out[h] = resp.headers[h]
    ct = resp.headers.get("content-type", "audio/mp4")
    if not ct.startswith(("audio/", "video/")):
        ct = "audio/mp4"

    async def gen():
        try:
            async for chunk in resp.aiter_bytes(65536):
                yield chunk
        except httpx.HTTPError:
            pass
        finally:
            await resp.aclose()
    return StreamingResponse(gen(), status_code=resp.status_code, media_type=ct, headers=out)


# ── Spotify 連携 (公式プレーヤーを呼び出すためのID解決) ──────
@app.get("/api/resolve")
async def resolve(track: str = Query("", max_length=300), artist: str = Query("", max_length=300),
                  album: str = Query("", max_length=300), id: str = "", aid: str = "", duration: int = 0):
    if not track.strip() or not artist.strip():
        return bad("track と artist が必要です")
    try:
        ids = await asyncio.wait_for(src.resolve_spotify_all(artist.strip(), track.strip(), album.strip(), id if num(id) else "",
                                                             aid if num(aid) else "", duration or None), timeout=14)
    except asyncio.TimeoutError:
        ids = []
    sid = ids[0] if ids else None
    return {"spotify_id": sid, "uri": f"spotify:track:{sid}" if sid else None,
            "alts": [f"spotify:track:{x}" for x in ids[1:]]}


@app.get("/api/lyrics")
async def lyrics(track: str = Query("", max_length=300), artist: str = Query("", max_length=300),
                 album: str = Query("", max_length=300), duration: int = 0, id: str = "", aid: str = ""):
    if not track.strip() or not artist.strip():
        return bad("track と artist が必要です")
    return await src.lyrics(track.strip(), artist.strip(), album.strip(), duration or None,
                            id if num(id) else "", aid if num(aid) else "")


@app.get("/api/lyrics/align")
async def lyrics_align(vid: str = "", track: str = Query("", max_length=300), artist: str = Query("", max_length=300), lrc: int = 0):
    """フル再生中の動画と、歌詞の元になった音源のズレを調べる (再生には影響しない)."""
    if not ytaudio.VID_RE.match(vid) or not track.strip() or not artist.strip() or lrc < 30000:
        return bad("vid, track, artist, lrc が必要です")
    try:
        return await asyncio.wait_for(asyncio.shield(lyralign.get(src.http, vid, track.strip(), artist.strip(), lrc)), timeout=90)
    except asyncio.TimeoutError:
        return {"ok": False, "reason": "timeout"}


@app.get("/api/spotify/{kind}/{sid}")
async def spotify_info(kind: str, sid: str):
    if kind not in SP_TYPES or not SP_ID_RE.match(sid):
        return bad("invalid spotify id")
    info = await src.spotify_exists(kind, sid)
    if not info:
        return bad("Spotifyで見つかりませんでした", 404)
    return {"type": kind, "id": sid, "uri": f"spotify:{kind}:{sid}", "name": info.get("title") or "",
            "img": info.get("thumbnail"), "url": f"https://open.spotify.com/{kind}/{sid}"}


# ── Image proxy ───────────────────────────────────────────
@app.get("/img")
async def img(u: str = ""):
    try:
        pu = urlparse(u)
    except Exception:
        return bad("bad url")
    host = (pu.hostname or "").lower()
    if pu.scheme != "https" or not host.endswith(IMG_HOSTS):
        return bad("host not allowed", 403)
    try:
        r = await src.http.get(u, headers={"User-Agent": src.UA})
    except httpx.HTTPError:
        return bad("fetch failed", 502)
    if r.status_code != 200:
        return Response(status_code=r.status_code)
    ct = r.headers.get("content-type", "image/jpeg")
    if not ct.startswith("image/"):
        return bad("not image", 415)
    return Response(r.content, media_type=ct, headers={"Cache-Control": "public, max-age=604800, immutable"})


# ── Static & SPA ──────────────────────────────────────────
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(os.path.join(STATIC_DIR, "img", "favicon.ico"))


SPA = {"", "lyrics", "playlist", "collection", "search", "album", "artist", "show", "episode", "track", "library", "history", "settings", "spotify", "charts"}


@app.get("/{full_path:path}")
async def spa(full_path: str):
    if full_path.split("/")[0] in SPA:
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
    return JSONResponse({"error": "not found"}, status_code=404)
