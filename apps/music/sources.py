"""登録不要・無料のデータソース

- iTunes Search / Lookup API (Apple)      : 検索・アルバム・アーティスト・ポッドキャスト (APIキー不要)
- iTunes RSS                              : 日本のランキング (APIキー不要)
- ListenBrainz Labs (MetaBrainz)          : 曲名+アーティスト名 → Spotify トラックID (APIキー不要)
- Spotify oEmbed                          : Spotify URL の存在確認・タイトル取得 (APIキー不要)
"""
import os
import asyncio
import json
import re
import time
import unicodedata
from typing import Any, Optional

import httpx

ITUNES = "https://itunes.apple.com"
LB_SPOTIFY = "https://labs.api.listenbrainz.org/spotify-id-from-metadata/json"
OEMBED = "https://open.spotify.com/oembed"
COUNTRY = os.environ.get("COUNTRY", "JP").upper()[:2] or "JP"
LANG = "ja_jp"
UA = "VysloMusic/2.0 (+https://github.com/; free music frontend)"

http: Optional[httpx.AsyncClient] = None


class SourceError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ── TTL cache ─────────────────────────────────────────────
_cache: dict[str, tuple[float, Any]] = {}
_CACHE_MAX = 4000


def cget(k: str):
    v = _cache.get(k)
    if v and v[0] > time.time():
        return v[1]
    if v:
        _cache.pop(k, None)
    return None


def cset(k: str, val: Any, ttl: int):
    if len(_cache) > _CACHE_MAX:
        now = time.time()
        for key in [k2 for k2, (exp, _) in _cache.items() if exp < now][:1000]:
            _cache.pop(key, None)
        if len(_cache) > _CACHE_MAX:
            for key in list(_cache.keys())[: _CACHE_MAX // 4]:
                _cache.pop(key, None)
    _cache[k] = (time.time() + ttl, val)


_inflight: dict[str, asyncio.Future] = {}
_itunes_sem = asyncio.Semaphore(4)


async def get_json(url: str, params: dict | None = None, ttl: int = 3600, sem: asyncio.Semaphore | None = None) -> Any:
    key = f"{url}?{sorted((params or {}).items())}"
    hit = cget(key)
    if hit is not None:
        return hit
    if key in _inflight:
        return await _inflight[key]
    fut = asyncio.get_event_loop().create_future()
    _inflight[key] = fut
    try:
        async def do():
            r = await http.get(url, params=params, headers={"User-Agent": UA, "Accept": "application/json"})
            return r
        if sem:
            async with sem:
                r = await do()
        else:
            r = await do()
        if r.status_code == 403 or r.status_code == 429:
            raise SourceError(429, "アクセスが集中しています。少し待ってから再度お試しください。")
        if r.status_code >= 400:
            raise SourceError(r.status_code, f"データを取得できませんでした ({r.status_code})")
        try:
            data = r.json()
        except ValueError:
            raise SourceError(502, "データの形式が正しくありません")
        cset(key, data, ttl)
        fut.set_result(data)
        return data
    except Exception as e:
        if not fut.done():
            fut.set_exception(e)
            fut.exception()  # 未取得警告を抑制
        raise
    finally:
        _inflight.pop(key, None)


async def itunes(path: str, params: dict, ttl: int = 3600, country: str | None = None) -> list:
    p = {"country": country or COUNTRY} if country else {"country": COUNTRY, "lang": LANG}
    p.update(params)
    try:
        d = await get_json(f"{ITUNES}{path}", p, ttl, _itunes_sem)
    except httpx.HTTPError:
        raise SourceError(502, "Appleのサーバーに接続できませんでした")
    return d.get("results") or []


# ── Normalizers ───────────────────────────────────────────
def art(url: Optional[str], size: int = 600) -> Optional[str]:
    if not url:
        return None
    return re.sub(r"/\d+x\d+(bb|cc|sr)?(-\d+)?\.(jpg|png|webp)$", f"/{size}x{size}bb.jpg", url)


SUFFIX_RE = re.compile(r"\s+-\s+(Single|EP)$", re.I)


def album_kind(name: str) -> str:
    m = SUFFIX_RE.search(name or "")
    return m.group(1).lower() if m else "album"


def clean_album(name: str) -> str:
    return SUFFIX_RE.sub("", name or "")


def n_track(r: dict) -> Optional[dict]:
    if not r or r.get("kind") not in ("song", "music-video", None) or not r.get("trackId"):
        return None
    if r.get("kind") == "music-video":
        return None
    tid = str(r["trackId"])
    return {
        "type": "track",
        "id": tid,
        "uri": f"itunes:track:{tid}",
        "name": r.get("trackName") or r.get("trackCensoredName"),
        "artists": [{"id": str(r["artistId"]) if r.get("artistId") else None, "name": r.get("artistName")}],
        "album": {"id": str(r["collectionId"]), "name": clean_album(r.get("collectionName"))} if r.get("collectionId") else None,
        "img": art(r.get("artworkUrl100")),
        "duration_ms": r.get("trackTimeMillis"),
        "explicit": r.get("trackExplicitness") == "explicit",
        "track_number": r.get("trackNumber"),
        "disc_number": r.get("discNumber"),
        "preview": r.get("previewUrl"),
        "release_date": (r.get("releaseDate") or "")[:10],
        "genre": r.get("primaryGenreName"),
    }


def n_album(r: dict) -> Optional[dict]:
    if not r or r.get("wrapperType") != "collection" or not r.get("collectionId"):
        return None
    aid = str(r["collectionId"])
    name = r.get("collectionName") or ""
    return {
        "type": "album",
        "id": aid,
        "uri": f"itunes:album:{aid}",
        "name": clean_album(name),
        "album_type": album_kind(name),
        "artists": [{"id": str(r["artistId"]) if r.get("artistId") else None, "name": r.get("artistName")}],
        "img": art(r.get("artworkUrl100")),
        "release_date": (r.get("releaseDate") or "")[:10],
        "total_tracks": r.get("trackCount"),
        "genre": r.get("primaryGenreName"),
        "copyright": r.get("copyright"),
    }


def n_artist(r: dict) -> Optional[dict]:
    if not r or r.get("wrapperType") != "artist" or not r.get("artistId"):
        return None
    aid = str(r["artistId"])
    return {
        "type": "artist",
        "id": aid,
        "uri": f"itunes:artist:{aid}",
        "name": r.get("artistName"),
        "img": None,
        "genres": [r["primaryGenreName"]] if r.get("primaryGenreName") else [],
    }


def n_show(r: dict) -> Optional[dict]:
    if not r or r.get("kind") != "podcast" or not r.get("collectionId"):
        return None
    sid = str(r["collectionId"])
    return {
        "type": "show",
        "id": sid,
        "uri": f"itunes:show:{sid}",
        "name": r.get("collectionName"),
        "description": r.get("artistName") or "",
        "publisher": r.get("artistName"),
        "img": art(r.get("artworkUrl600") or r.get("artworkUrl100")),
        "total": r.get("trackCount"),
        "genre": r.get("primaryGenreName"),
    }


def n_episode(r: dict, show: Optional[dict] = None) -> Optional[dict]:
    if not r or r.get("kind") != "podcast-episode" or not r.get("trackId"):
        return None
    eid = str(r["trackId"])
    return {
        "type": "episode",
        "id": eid,
        "uri": f"itunes:episode:{eid}",
        "name": r.get("trackName"),
        "description": r.get("description") or r.get("shortDescription") or "",
        "img": art(r.get("artworkUrl600") or r.get("artworkUrl160")) or (show or {}).get("img"),
        "duration_ms": r.get("trackTimeMillis"),
        "release_date": (r.get("releaseDate") or "")[:10],
        "audio": r.get("episodeUrl"),
        "show": {"id": str(r.get("collectionId")), "name": r.get("collectionName")} if r.get("collectionId") else None,
        "artists": [],
    }


def clean(lst) -> list:
    return [x for x in lst if x]


_photo_sem = asyncio.Semaphore(4)
_OG_RE = re.compile(rb'<meta property="og:image" content="([^"]+)"')


async def artist_photo(aid: str) -> str:
    """Apple Music のアーティストページの og:image から本人の写真を取る (キー不要)."""
    key = f"artphoto:{aid}"
    c = cget(key)
    if c is not None:
        return c
    url = ""
    err = False
    try:
        async with _photo_sem:
            async with http.stream("GET", f"https://music.apple.com/{COUNTRY.lower()}/artist/{aid}",
                                   headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                                            "Accept-Language": "ja,en;q=0.8"},
                                   timeout=10, follow_redirects=True) as r:
                if r.status_code == 200:
                    buf = b""
                    async for chunk in r.aiter_bytes():
                        buf += chunk
                        m = _OG_RE.search(buf)
                        if m or len(buf) > 400_000:
                            break
                    m = _OG_RE.search(buf)
                    if m:
                        u = m.group(1).decode("utf-8", "ignore").replace("&amp;", "&")
                        # 写真が登録されているアーティストだけ使う (未登録だとアルバム画像などになる)
                        if "ArtistImages" in u or "AMCArtist" in u:
                            url = re.sub(r"/[0-9]+x[0-9]+[a-z]*\.(png|jpg|jpeg|webp)$", "/600x600cc.jpg", u)
                elif r.status_code >= 500 or r.status_code == 429:
                    err = True
    except Exception:
        err = True
    if not err:
        cset(key, url, 86400 * 7 if url else 86400)
    return url


async def enrich_artists(artists: list[dict]) -> list[dict]:
    """アーティスト画像: Apple Music の本人写真 → なければ代表アルバムのジャケット."""
    targets = [a for a in artists if a and not a.get("img")][:12]
    if not targets:
        return artists
    photos = await asyncio.gather(*(artist_photo(a["id"]) for a in targets), return_exceptions=True)
    for a, ph in zip(targets, photos):
        if isinstance(ph, str) and ph:
            a["img"] = ph
            a["photo"] = True
    ids = [a["id"] for a in targets if not a.get("img")]
    if not ids:
        return artists
    imgs: dict[str, str] = {}
    need = []
    for i in ids:
        c = cget(f"artimg:{i}")
        if c is not None:
            imgs[i] = c
        else:
            need.append(i)
    if need:
        try:
            res = await itunes("/lookup", {"id": ",".join(need), "entity": "album", "limit": 1}, ttl=86400 * 3)
            for r in res:
                if r.get("wrapperType") == "collection" and r.get("artistId"):
                    k = str(r["artistId"])
                    if k not in imgs:
                        imgs[k] = art(r.get("artworkUrl100")) or ""
        except SourceError:
            pass
        for i in need:
            cset(f"artimg:{i}", imgs.get(i, ""), 86400 * 3)
    for a in artists:
        if a and not a.get("img") and imgs.get(a["id"]):
            a["img"] = imgs[a["id"]]
    return artists


def _lbl(x, *keys):
    for k in keys:
        if not isinstance(x, dict):
            return None
        x = x.get(k)
    return x


def _rss_entries(d) -> list:
    e = (d.get("feed") or {}).get("entry") or []
    return e if isinstance(e, list) else [e]


def _id_from_href(href: str, pat: str) -> Optional[str]:
    m = re.search(pat, href or "")
    return m.group(1) if m else None


async def chart_songs(limit: int = 50) -> list[dict]:
    d = await get_json(f"{ITUNES}/{COUNTRY.lower()}/rss/topsongs/limit={limit}/json", ttl=3600)
    out = []
    for e in _rss_entries(d):
        tid = _lbl(e, "id", "attributes", "im:id")
        if not tid:
            continue
        imgs = e.get("im:image") or []
        img = art(imgs[-1]["label"]) if imgs else None
        preview = None
        links = e.get("link") or []
        if isinstance(links, dict):
            links = [links]
        for l in links:
            at = l.get("attributes") or {}
            if at.get("rel") == "enclosure" or "audio" in (at.get("type") or ""):
                preview = at.get("href")
        artist_href = _lbl(e, "im:artist", "attributes", "href") or ""
        coll = e.get("im:collection") or {}
        coll_href = _lbl(coll, "link", "attributes", "href") or ""
        out.append({
            "type": "track",
            "id": str(tid),
            "uri": f"itunes:track:{tid}",
            "name": _lbl(e, "im:name", "label"),
            "artists": [{"id": _id_from_href(artist_href, r"/(\d+)(?:\?|$)"), "name": _lbl(e, "im:artist", "label")}],
            "album": {"id": _id_from_href(coll_href, r"/(\d+)(?:\?|$)"), "name": clean_album(_lbl(coll, "im:name", "label") or "")} if coll_href else None,
            "img": img,
            "duration_ms": None,
            "preview": preview,
            "release_date": (_lbl(e, "im:releaseDate", "label") or "")[:10],
        })
    return out


async def chart_albums(limit: int = 25) -> list[dict]:
    d = await get_json(f"{ITUNES}/{COUNTRY.lower()}/rss/topalbums/limit={limit}/json", ttl=3600)
    out = []
    for e in _rss_entries(d):
        aid = _lbl(e, "id", "attributes", "im:id")
        if not aid:
            continue
        imgs = e.get("im:image") or []
        artist_href = _lbl(e, "im:artist", "attributes", "href") or ""
        name = _lbl(e, "im:name", "label") or ""
        out.append({
            "type": "album",
            "id": str(aid),
            "uri": f"itunes:album:{aid}",
            "name": clean_album(name),
            "album_type": album_kind(name),
            "artists": [{"id": _id_from_href(artist_href, r"/(\d+)(?:\?|$)"), "name": _lbl(e, "im:artist", "label")}],
            "img": art(imgs[-1]["label"]) if imgs else None,
            "release_date": (_lbl(e, "im:releaseDate", "label") or "")[:10],
        })
    return out


# ── Spotify ID 解決 (ListenBrainz Labs + oEmbed) ───────────
_FEAT_RE = re.compile(r"\s*[\(\[（【](feat\.?|ft\.?|with|featuring)[^\)\]）】]*[\)\]）】]", re.I)
_TAIL_RE = re.compile(r"\s*[\(\[（【][^\)\]）】]*[\)\]）】]\s*$")
_lb_sem = asyncio.Semaphore(3)       # 再生時の解決
_lb_bg_sem = asyncio.Semaphore(1)    # 裏での先読み


class LBError(Exception):
    pass


def _clean_track(n: str) -> str:
    return _FEAT_RE.sub("", n or "").strip()


def _first_artist(a: str) -> str:
    a = a or ""
    for sep in [" & ", ", ", " feat. ", " ft. ", " × ", " x ", "、"]:
        if sep in a:
            return a.split(sep)[0].strip()
    return a.strip()


def _key(artist: str, track: str) -> str:
    return f"lb:{_first_artist(artist).lower()}|{_clean_track(track).lower()}"


def _variants(artist: str, track: str, album: str) -> list[tuple[str, str, str]]:
    a1, t1 = _first_artist(artist), _clean_track(track)
    t2 = _TAIL_RE.sub("", t1).strip()
    out = [(a1, t1, "")]
    if artist != a1 or track != t1:
        out.append((artist, track, ""))
    if album:
        out.append((a1, t1, clean_album(album)))
    if t2 and t2 != t1:
        out.append((a1, t2, ""))
    seen, uniq = set(), []
    for v in out:
        if v not in seen and v[0] and v[1]:
            seen.add(v)
            uniq.append(v)
    return uniq


_lb_down_until = 0.0  # ListenBrainz が応答しない間は問い合わせを止める (待ち続けないため)


def lb_down() -> bool:
    return time.time() < _lb_down_until


async def _lb_batch(rows: list[tuple[str, str, str]], timeout: float, background: bool = False) -> list[list[str]]:
    """ListenBrainz に問い合わせ。結果は送った行と照合して返す (行が欠けたら None 扱い)."""
    global _lb_down_until
    if lb_down():
        raise LBError(503)
    out: list = [None] * len(rows)
    for start in range(0, len(rows), 10):  # 大きな一括は切断されるので10件ずつ
        part = rows[start:start + 10]
        body = [{"artist_name": a, "release_name": r, "track_name": t} for a, t, r in part]
        try:
            async with (_lb_bg_sem if background else _lb_sem):
                r = await http.post(LB_SPOTIFY, json=body, headers={"User-Agent": UA},
                                    timeout=httpx.Timeout(timeout, connect=4.0))
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError):
            _lb_down_until = time.time() + 600
            raise
        if r.status_code >= 500:
            _lb_down_until = time.time() + 300
        if r.status_code != 200:
            raise LBError(r.status_code)
        d = r.json()
        by = {}
        for x in d if isinstance(d, list) else []:
            by[(x.get("artist_name"), x.get("track_name"), x.get("release_name") or "")] = x.get("spotify_track_ids") or []
        for i, (a, t, rel) in enumerate(part):
            ids = by.get((a, t, rel))
            if ids is None and i < len(d) and d[i].get("track_name") == t:
                ids = d[i].get("spotify_track_ids") or []
            if ids is not None:
                out[start + i] = [x for x in ids if re.match(r"^[A-Za-z0-9]{22}$", x or "")]
    return out


# ── Spotify 検索 (埋め込みページの匿名トークン + Web版の検索) ──
SP_TOKEN_PAGE = "https://open.spotify.com/embed/track/3dPtXHP0oXQ4HCWHsOA9js"
SP_PATHFINDER = "https://api-partner.spotify.com/pathfinder/v1/query"
SP_SEARCH_HASH = os.environ.get("SP_SEARCH_HASH", "220d098228a4eaf216b39e8c147865244959c4cc6fd82d394d88afda0b710929")
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
_TOK_RE = re.compile(r'"accessToken":"([^"]+)"')
_EXP_RE = re.compile(r'"accessTokenExpirationTimestampMs":(\d+)')
_sp_tok: dict = {"v": None, "exp": 0.0}
_sp_tok_lock = asyncio.Lock()
_sp_sem = asyncio.Semaphore(4)
_sp_bg_sem = asyncio.Semaphore(2)


async def _sp_token(force: bool = False) -> Optional[str]:
    def valid():
        return _sp_tok["v"] and _sp_tok["exp"] - 60_000 > time.time() * 1000
    if not force and valid():
        return _sp_tok["v"]
    async with _sp_tok_lock:
        if not force and valid():
            return _sp_tok["v"]
        r = await http.get(SP_TOKEN_PAGE, headers={"User-Agent": BROWSER_UA, "Accept-Language": "ja,en;q=0.8"},
                           timeout=httpx.Timeout(8.0, connect=5.0))
        m = _TOK_RE.search(r.text or "")
        if not m:
            return None
        e = _EXP_RE.search(r.text)
        _sp_tok["v"] = m.group(1)
        _sp_tok["exp"] = float(e.group(1)) if e else time.time() * 1000 + 1_800_000
        return _sp_tok["v"]


async def _sp_search(term: str, limit: int = 10, background: bool = False) -> list[dict]:
    tok = await _sp_token()
    if not tok:
        return []
    v = {"searchTerm": term, "offset": 0, "limit": limit, "numberOfTopResults": 5,
         "includeAudiobooks": False, "includePreReleases": False}
    params = {"operationName": "searchTracks", "variables": json.dumps(v, ensure_ascii=False),
              "extensions": json.dumps({"persistedQuery": {"version": 1, "sha256Hash": SP_SEARCH_HASH}})}
    for attempt in range(2):
        async with (_sp_bg_sem if background else _sp_sem):
            r = await http.get(SP_PATHFINDER, params=params,
                               headers={"Authorization": f"Bearer {tok}", "User-Agent": BROWSER_UA,
                                        "Accept": "application/json", "app-platform": "WebPlayer"},
                               timeout=httpx.Timeout(8.0, connect=5.0))
        if r.status_code == 401 and attempt == 0:
            tok = await _sp_token(force=True)
            if not tok:
                return []
            continue
        if r.status_code != 200:
            raise LBError(r.status_code)
        d = r.json() or {}
        items = ((((d.get("data") or {}).get("searchV2") or {}).get("tracksV2") or {}).get("items")) or []
        out = []
        for it in items:
            t = (it.get("item") or {}).get("data") or {}
            if not t.get("id") or not SP_ID_RE.match(t["id"]):
                continue
            out.append({
                "id": t["id"], "name": t.get("name") or "",
                "artists": [((a.get("profile") or {}).get("name") or "") for a in ((t.get("artists") or {}).get("items") or [])],
                "dur": (t.get("duration") or {}).get("totalMilliseconds"),
                "playable": (t.get("playability") or {}).get("playable", True),
            })
        return out
    return []


SP_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").casefold()
    return re.sub(r"[\s\W_]+", "", s)


def _sp_score(c: dict, names: list[str], artists: list[str], dur: Optional[int]) -> int:
    cn = _norm(_clean_track(c["name"]))
    cn2 = _norm(_TAIL_RE.sub("", _clean_track(c["name"])))
    sn = 0
    for n in names:
        for nn in {_norm(n), _norm(_TAIL_RE.sub("", _clean_track(n)))}:
            if not nn:
                continue
            if nn in (cn, cn2):
                sn = max(sn, 10)
            elif nn in cn or (cn2 and cn2 in nn):
                sn = max(sn, 5)
    ca = [_norm(a) for a in c["artists"] if a]
    sa = 0
    for a in artists:
        an = _norm(a)
        if an and any(an == x or (len(an) > 1 and (an in x or x in an)) for x in ca):
            sa = 6
            break
    s = sn + sa
    if dur and c.get("dur"):
        diff = abs(int(c["dur"]) - int(dur))
        s += 4 if diff < 3000 else 2 if diff < 10000 else -6 if diff > 30000 else 0
    if not c.get("playable", True):
        s -= 3
    return s


async def sp_find(artist: str, track: str, dur: Optional[int] = None, en: Optional[tuple] = None,
                  en_artist: str = "", background: bool = False) -> list[str]:
    """Spotify で曲を検索して、曲名・アーティスト・長さが一致する曲IDを返す."""
    names = [track]
    artists = [artist, _first_artist(artist)]
    terms = [f"{_clean_track(track)} {_first_artist(artist)}"]
    if en:
        names.append(en[0])
        artists += [en[1], _first_artist(en[1])]
        terms.append(f"{_clean_track(en[0])} {_first_artist(en[1])}")
    if en_artist:
        artists.append(en_artist)
        terms.append(f"{_clean_track(track)} {en_artist}")
    scored: dict[str, int] = {}
    seen = set()
    for term in terms:
        if term in seen:
            continue
        seen.add(term)
        for i, c in enumerate(await _sp_search(term, 10, background)):
            sc = _sp_score(c, names, artists, dur) + (1 if i == 0 else 0)  # 検索1位は少しだけ優先
            if sc > scored.get(c["id"], -99):
                scored[c["id"]] = sc
        if any(v >= 14 for v in scored.values()):
            break
    good = sorted(((v, k) for k, v in scored.items() if v >= 11), reverse=True)
    return [k for _, k in good][:4]


async def spotify_exists(kind: str, sid: str) -> Optional[dict]:
    key = f"oembed:{kind}:{sid}"
    c = cget(key)
    if c is not None:
        return c or None
    try:
        r = await http.get(OEMBED, params={"url": f"https://open.spotify.com/{kind}/{sid}"},
                           headers={"User-Agent": UA}, timeout=httpx.Timeout(8.0, connect=5.0))
        if r.status_code == 200:
            j = r.json()
            v = {"title": j.get("title"), "thumbnail": j.get("thumbnail_url"), "iframe_url": j.get("iframe_url")}
            cset(key, v, 86400 * 7)
            return v
        if r.status_code in (400, 404):
            cset(key, {}, 86400)
    except (httpx.HTTPError, ValueError):
        pass
    return None


async def en_names(ids: list[str]) -> dict[str, tuple[str, str]]:
    """Spotifyは日本のアーティストを英語表記で登録していることが多いので、US版iTunesの表記も取得."""
    out: dict[str, tuple[str, str]] = {}
    need = []
    for i in ids:
        if not i or not str(i).isdigit():
            continue
        c = cget(f"en:{i}")
        if c is not None:
            if c:
                out[i] = tuple(c)
        else:
            need.append(i)
    for j in range(0, len(need), 50):
        chunk = need[j:j + 50]
        got = {}
        try:
            res = await itunes("/lookup", {"id": ",".join(chunk)}, ttl=86400 * 7, country="US")
            for r in res:
                if r.get("trackId") and r.get("trackName"):
                    got[str(r["trackId"])] = (r["trackName"], r.get("artistName") or "")
        except SourceError:
            pass
        rest = [i for i in chunk if i not in got]
        if rest:  # 日本版ストアの英語表記 (海外アーティストのカタカナ表記対策)
            try:
                p2 = {"country": COUNTRY, "lang": "en_us", "id": ",".join(rest)}
                d2 = await get_json(f"{ITUNES}/lookup", p2, 86400 * 7, _itunes_sem)
                for r in d2.get("results") or []:
                    if r.get("trackId") and r.get("trackName"):
                        got[str(r["trackId"])] = (r["trackName"], r.get("artistName") or "")
            except (SourceError, httpx.HTTPError):
                pass
        for i in chunk:
            v = got.get(i)
            cset(f"en:{i}", list(v) if v else [], 86400 * 7)
            if v:
                out[i] = v
    return out


async def en_artists(ids: list[str]) -> dict[str, str]:
    """アーティストIDは全ストア共通。US版で英語名を取得 (テイラー・スウィフト → Taylor Swift)."""
    out, need = {}, []
    for i in {x for x in ids if x and str(x).isdigit()}:
        c = cget(f"enart:{i}")
        if c is not None:
            if c:
                out[i] = c
        else:
            need.append(i)
    for j in range(0, len(need), 50):
        chunk = need[j:j + 50]
        got = {}
        try:
            res = await itunes("/lookup", {"id": ",".join(chunk)}, ttl=86400 * 7, country="US")
            for r in res:
                if r.get("wrapperType") == "artist" and r.get("artistId"):
                    got[str(r["artistId"])] = r.get("artistName") or ""
        except SourceError:
            pass
        for i in chunk:
            cset(f"enart:{i}", got.get(i, ""), 86400 * 7)
            if got.get(i):
                out[i] = got[i]
    return out


def _rows_for(artist: str, track: str, en: Optional[tuple[str, str]], en_artist: str = "") -> list[tuple[str, str, str]]:
    rows = [(_first_artist(artist), _clean_track(track), "")]
    cands = []
    if en:
        cands.append((en[1], en[0]))
    if en_artist:
        cands.append((en_artist, en[0] if en else track))
        cands.append((en_artist, track))
    for a, t in cands:
        r2 = (_first_artist(a), _clean_track(t), "")
        if r2 not in rows and r2[0] and r2[1]:
            rows.append(r2)
    return rows[:3]


_prefetching: set[str] = set()


async def prefetch(tracks: list[dict], limit: int = 50):
    """一覧ページを返した直後に裏でまとめてSpotify IDを調べておく (再生を即時にするため)."""
    pending = []
    for t in tracks[:limit]:
        if not t or t.get("type") != "track":
            continue
        artist = (t.get("artists") or [{}])[0].get("name") or ""
        k = _key(artist, t.get("name") or "")
        if cget(k) is not None or k in _prefetching:
            continue
        _prefetching.add(k)
        aid = (t.get("artists") or [{}])[0].get("id") or ""
        pending.append((k, t.get("id"), artist, t.get("name") or "", aid, t.get("duration_ms")))
    if not pending:
        return
    try:
        # まず Spotify 本体の検索で探す (速い)。見つからない曲だけ ListenBrainz へ
        async def one(p):
            k, tid, artist, name, aid, dur = p
            try:
                ids = await sp_find(artist, name, dur, background=True)
            except Exception:
                ids = []
            if ids:
                cset(k, ids, 86400 * 7)
                _prefetching.discard(k)  # 見つかったらすぐ再生側に渡す
            return bool(ids)
        head = pending[:20]
        oks = []
        for i in range(0, len(head), 4):
            oks += await asyncio.gather(*(one(p) for p in head[i:i + 4]))
        pending = [p for p, ok in zip(head, oks) if not ok] + pending[20:]
        if not pending or lb_down():
            return
        en = await en_names([p[1] for p in pending])
        ena = await en_artists([p[4] for p in pending])
        for i in range(0, len(pending), 5):
            if lb_down():
                break
            chunk = pending[i:i + 5]
            rows, owner = [], []
            for idx, (k, tid, artist, name, aid, _dur) in enumerate(chunk):
                for r in _rows_for(artist, name, en.get(tid), ena.get(aid, "")):
                    rows.append(r)
                    owner.append(idx)
            try:
                res = await _lb_batch(rows, timeout=15.0, background=True)
            except (httpx.HTTPError, LBError, ValueError):
                continue
            merged: dict[int, list[str]] = {}
            for o, ids in zip(owner, res):
                lst = merged.setdefault(o, [])
                for x in ids or []:
                    if x not in lst:
                        lst.append(x)
            for idx, (k, *_rest) in enumerate(chunk):
                ids = merged.get(idx) or []
                if ids:
                    cset(k, ids, 86400 * 7)
    finally:
        for p in pending:
            _prefetching.discard(p[0])


async def resolve_spotify(artist: str, track: str, album: str = "", tid: str = "", aid: str = "",
                          dur: Optional[int] = None) -> Optional[str]:
    k = _key(artist, track)
    ids = cget(k)
    if ids is None:
        for _ in range(6):  # 裏で調べ中なら少しだけ待つ
            if k not in _prefetching or cget(k):
                break
            await asyncio.sleep(0.5)
        ids = cget(k)
    if ids:
        return ids[0]
    if ids is None:
        # 1) Spotify 本体の検索
        found: list[str] = []
        try:
            found = await sp_find(artist, track, dur)
            if not found and (tid or aid):
                en = (await en_names([tid])).get(tid) if tid else None
                ena = (await en_artists([aid])).get(aid, "") if aid else ""
                if en or ena:
                    found = await sp_find(artist, track, dur, en, ena)
        except Exception:
            found = []
        if found:
            cset(k, found, 86400 * 7)
            return found[0]
        # 2) ListenBrainz (応答しないときはすぐ諦める)
        if lb_down():
            return None
        en = (await en_names([tid])).get(tid) if tid else None
        ena = (await en_artists([aid])).get(aid, "") if aid else ""
        rows = _variants(artist, track, album)
        for r in _rows_for(artist, track, en, ena):
            if r not in rows:
                rows.append(r)
        try:
            res = await _lb_batch(rows, timeout=8.0)
        except (httpx.HTTPError, LBError, ValueError):
            return None
        ids = []
        for lst in res:
            for x in lst or []:
                if x not in ids:
                    ids.append(x)
        complete = all(x is not None for x in res)
        if ids or complete:
            cset(k, ids, 86400 * 7 if ids else 3600 * 3)
    return (await _ordered(ids))[0] if ids else None


async def _ordered(ids: list[str]) -> list[str]:
    """存在確認できたIDを先頭に並べ替える."""
    ok, rest = [], []
    for sid in ids[:3]:
        (ok if await spotify_exists("track", sid) else rest).append(sid)
    return ok + rest + ids[3:]


async def resolve_spotify_all(artist: str, track: str, album: str = "", tid: str = "", aid: str = "",
                              dur: Optional[int] = None) -> list[str]:
    first = await resolve_spotify(artist, track, album, tid, aid, dur)
    if not first:
        return []
    ids = cget(_key(artist, track)) or [first]
    return [first] + [x for x in ids if x != first][:3]


# ── 歌詞 (LRCLIB: 無料・キー不要) ─────────────────────────
LRCLIB = "https://lrclib.net/api"
_LRC_RE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
_lrc_sem = asyncio.Semaphore(4)


_LRC_OFF_RE = re.compile(r"^\s*\[offset:\s*([+-]?\d+)\s*\]", re.I | re.M)


def _parse_lrc(text: str) -> list:
    out = []
    # [offset:+/-ms] (LRC の標準タグ。プラスなら歌詞を早める) を反映する
    mo = _LRC_OFF_RE.search(text or "")
    off = int(mo.group(1)) if mo else 0
    for line in (text or "").splitlines():
        stamps = _LRC_RE.findall(line)
        if not stamps:
            continue
        words = _LRC_RE.sub("", line).strip()
        for m, s in stamps:
            out.append([max(0, int((int(m) * 60 + float(s)) * 1000) - off), words])
    out.sort(key=lambda x: x[0])
    return out


def _lrc_pick(cands: list, track: str, dur_s: Optional[float]) -> Optional[dict]:
    best, score = None, -1e9
    tl = _clean_track(track).lower()
    for c in cands or []:
        if not (c.get("syncedLyrics") or c.get("plainLyrics") or c.get("instrumental")):
            continue
        sc = 0.0
        name = (c.get("trackName") or "").lower()
        if name == tl:
            sc += 30
        elif tl and tl in name:
            sc += 10
        if c.get("syncedLyrics"):
            sc += 8
        if dur_s and c.get("duration"):
            diff = abs(float(c["duration"]) - dur_s)
            sc -= diff * 0.8
            if diff > 20:
                sc -= 40
        if sc > score:
            best, score = c, sc
    return best if score > -20 else None


async def _lrc_get(path: str, params: dict):
    async with _lrc_sem:
        r = await http.get(f"{LRCLIB}{path}", params=params,
                           headers={"User-Agent": "VysloMusic/2.0 (https://mfmikakann-site-vyslo-mix-10032028.up.railway.app)"},
                           timeout=httpx.Timeout(12.0, connect=6.0))
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise LBError(r.status_code)
    return r.json()


async def lyrics(track: str, artist: str, album: str = "", duration_ms: Optional[int] = None,
                 tid: str = "", aid: str = "") -> dict:
    key = f"lyr:{_first_artist(artist).lower()}|{_clean_track(track).lower()}|{(duration_ms or 0) // 5000}"
    c = cget(key)
    if c is not None:
        return c
    dur_s = (duration_ms / 1000) if duration_ms else None
    names = [(_first_artist(artist), _clean_track(track))]
    try:
        en = (await en_names([tid])).get(tid) if tid else None
        ena = (await en_artists([aid])).get(aid, "") if aid else ""
    except Exception:
        en, ena = None, ""
    if en:
        names.append((_first_artist(en[1]), _clean_track(en[0])))
    if ena:
        names.append((_first_artist(ena), _clean_track(track)))
    seen, found, errored = set(), None, False
    for a, t in names:
        if (a, t) in seen or not a or not t:
            continue
        seen.add((a, t))
        try:
            res = await _lrc_get("/search", {"track_name": t, "artist_name": a})
            found = _lrc_pick(res, t, dur_s)
            if not found:
                res = await _lrc_get("/search", {"q": f"{t} {a}"})
                found = _lrc_pick(res, t, dur_s)
        except (httpx.HTTPError, LBError, ValueError):
            errored = True
            continue
        if found:
            break
    if not found:
        out = {"found": False}
        if not errored:
            cset(key, out, 3600 * 12)
        return out
    out = {
        "found": True,
        "instrumental": bool(found.get("instrumental")),
        "synced": _parse_lrc(found.get("syncedLyrics") or "") or None,
        "plain": found.get("plainLyrics") or "",
        "duration_ms": int(float(found["duration"]) * 1000) if found.get("duration") else None,
        "source": "LRCLIB",
    }
    cset(key, out, 86400 * 7)
    return out
