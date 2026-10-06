import asyncio
import re
import time
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response, StreamingResponse

from core import get_client, get_instances

router = APIRouter()

# googlevideo は Range 無しの一括取得だと極端に遅く (帯域制限) なるため、
# 10MB ずつ Range 指定で取りに行き、つなげて返す。
_CHUNK = 10 * 1024 * 1024
_VID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _disposition(filename: str) -> str:
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("_") or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename, safe='')}"


def _is_googlevideo(url: str) -> bool:
    return "googlevideo.com/" in url or "/videoplayback" in url


async def _chunked(client: httpx.AsyncClient, url: str, filename: str):
    first = await client.get(url, headers={"Range": f"bytes=0-{_CHUNK - 1}"}, timeout=httpx.Timeout(30.0))
    if first.status_code not in (200, 206):
        raise Exception(f"HTTP {first.status_code}")
    total = None
    cr = first.headers.get("content-range", "")
    m = re.search(r"/(\d+)$", cr)
    if m:
        total = int(m.group(1))
    elif first.status_code == 200:
        total = len(first.content)
    content_type = first.headers.get("content-type", "application/octet-stream")
    headers = {"Content-Disposition": _disposition(filename), "Content-Type": content_type}
    if total:
        headers["Content-Length"] = str(total)

    async def body():
        yield first.content
        if first.status_code == 200 or not total:
            return
        pos = len(first.content)
        while pos < total:
            end = min(pos + _CHUNK, total) - 1
            last_err = None
            for _ in range(3):
                try:
                    r = await client.get(url, headers={"Range": f"bytes={pos}-{end}"}, timeout=httpx.Timeout(30.0))
                    if r.status_code in (200, 206) and r.content:
                        break
                    last_err = Exception(f"HTTP {r.status_code}")
                except Exception as e:  # 一時的な失敗は少し待って再試行
                    last_err = e
                await asyncio.sleep(0.4)
            else:
                raise last_err or Exception("download failed")
            yield r.content
            pos += len(r.content)

    return StreamingResponse(body(), headers=headers)


@router.get("/download")
async def download(url: str = Query(...), filename: str = Query(default="download")):
    try:
        client = await get_client()
        if _is_googlevideo(url):
            return await _chunked(client, url, filename)
        req = client.build_request("GET", url)
        upstream = await client.send(req, stream=True)
        if not upstream.is_success:
            await upstream.aclose()
            raise Exception(f"HTTP {upstream.status_code}")

        content_type = upstream.headers.get("content-type", "application/octet-stream")
        content_length = upstream.headers.get("content-length")

        response_headers = {
            "Content-Disposition": _disposition(filename),
            "Content-Type": content_type,
        }
        if content_length:
            response_headers["Content-Length"] = content_length

        async def stream_body():
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()

        return StreamingResponse(stream_body(), headers=response_headers)
    except Exception as e:
        return JSONResponse({"error": f"ダウンロードできませんでした ({e})"}, status_code=502)


# ── 字幕 ────────────────────────────────────────────────────────────────────
# Invidious の字幕は、インスタンスによっては空のファイルが返る。
# 実際に中身が取れたインスタンス・字幕だけを一覧として返す。
_CAP_CACHE: dict = {}
_CAP_TTL = 30 * 60


async def _fetch_vtt(client: httpx.AsyncClient, base: str, vid: str, label: str) -> str | None:
    try:
        r = await client.get(f"{base}/api/v1/captions/{vid}", params={"label": label}, timeout=httpx.Timeout(8.0))
        t = r.text if r.status_code == 200 else ""
        if t.lstrip("\ufeff").startswith("WEBVTT") and "-->" in t:
            return t
    except Exception:
        pass
    return None


async def _caption_list(client: httpx.AsyncClient, base: str, vid: str) -> list:
    try:
        r = await client.get(f"{base}/api/v1/captions/{vid}", timeout=httpx.Timeout(8.0))
        if r.status_code != 200:
            return []
        caps = (r.json() or {}).get("captions") or []
        return [c for c in caps if isinstance(c, dict) and c.get("label")]
    except Exception:
        return []


async def _find_caption_source(vid: str):
    hit = _CAP_CACHE.get(vid)
    # 見つからなかった結果は短い時間だけ覚えておく (取得元が一時的に失敗していることがあるため)
    if hit and time.time() - hit["time"] < (_CAP_TTL if hit.get("tracks") else 90):
        return hit
    client = await get_client()
    try:
        instances = [i.rstrip("/") for i in (await get_instances("video")) if isinstance(i, str)]
    except Exception:
        instances = []

    async def probe(base: str):
        caps = await _caption_list(client, base, vid)
        if not caps:
            return None
        if await _fetch_vtt(client, base, vid, caps[0]["label"]):
            return base, caps
        return None

    tasks = [asyncio.ensure_future(probe(b)) for b in instances]
    found = None
    try:
        for fut in asyncio.as_completed(tasks, timeout=12):
            try:
                res = await fut
            except Exception:
                res = None
            if res:
                found = res
                break
    except asyncio.TimeoutError:
        pass
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()
    if not found:
        data = {"base": None, "tracks": [], "time": time.time()}
        _CAP_CACHE[vid] = data
        return data
    base, caps = found
    # 同じインスタンスで各字幕の中身を確認 (取れたものだけ)
    sem = asyncio.Semaphore(6)

    async def check(c):
        async with sem:
            return c if await _fetch_vtt(client, base, vid, c["label"]) else None

    ok = [c for c in await asyncio.gather(*(check(c) for c in caps[:24])) if c]
    data = {
        "base": base,
        "tracks": [{"label": c["label"], "languageCode": c.get("languageCode") or c.get("language_code") or ""} for c in ok],
        "time": time.time(),
    }
    _CAP_CACHE[vid] = data
    if len(_CAP_CACHE) > 500:
        for k in list(_CAP_CACHE)[:100]:
            _CAP_CACHE.pop(k, None)
    return data


def _vtt_to_srt(vtt: str) -> str:
    lines = vtt.replace("\r\n", "\n").lstrip("\ufeff").split("\n")
    out, buf, n = [], [], 0
    ts_re = re.compile(r"((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})")

    def fix(t: str) -> str:
        if t.count(":") == 1:
            t = "00:" + t
        return t.replace(".", ",")

    i = 0
    while i < len(lines):
        m = ts_re.search(lines[i])
        if m:
            i += 1
            buf = []
            while i < len(lines) and lines[i].strip():
                buf.append(re.sub(r"<[^>]+>", "", lines[i]))
                i += 1
            text = "\n".join(b for b in buf if b.strip())
            if text:
                n += 1
                out.append(f"{n}\n{fix(m.group(1))} --> {fix(m.group(2))}\n{text}\n")
        else:
            i += 1
    return "\n".join(out)


@router.get("/api/captions/{video_id}")
async def api_captions(video_id: str):
    if not _VID_RE.match(video_id):
        return JSONResponse({"tracks": []})
    data = await _find_caption_source(video_id)
    return JSONResponse({"tracks": data["tracks"]})


@router.get("/api/caption/{video_id}")
async def api_caption(video_id: str, label: str = Query(...), fmt: str = Query(default="vtt"),
                      filename: str = Query(default="")):
    if not _VID_RE.match(video_id):
        return JSONResponse({"error": "動画IDが正しくありません"}, status_code=400)
    data = await _find_caption_source(video_id)
    if not data.get("base"):
        return JSONResponse({"error": "この動画の字幕は取得できませんでした"}, status_code=404)
    client = await get_client()
    vtt = await _fetch_vtt(client, data["base"], video_id, label)
    if not vtt:
        return JSONResponse({"error": "この字幕は取得できませんでした"}, status_code=404)
    fmt = "srt" if fmt == "srt" else "vtt"
    body = _vtt_to_srt(vtt) if fmt == "srt" else vtt
    name = filename or f"{video_id}_{label}.{fmt}"
    if not name.lower().endswith("." + fmt):
        name += "." + fmt
    return Response(
        content=body.encode("utf-8"),
        media_type="application/x-subrip; charset=utf-8" if fmt == "srt" else "text/vtt; charset=utf-8",
        headers={"Content-Disposition": _disposition(name)},
    )
