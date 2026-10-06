"""歌詞のタイミングを、実際に流れている音源 (フル再生の動画) に合わせる.

LRCLIB の歌詞は「元の音源 (CD・配信版)」の時間で書かれている。
フル再生では MV など前奏や効果音が足された動画が流れることがあり、
そのままだと歌詞が数秒ずれる (例: マカロニえんぴつ「恋人ごっこ」の MV は約5.7秒遅い)。

ここでは
  1. 歌詞の長さに合う「元の音源」(YouTube Music の公式音源) を探し
  2. 再生中の動画と元の音源の音声を両方デコードして、音の立ち上がり (オンセット) を比べ
  3. 「元の音源の何秒が、動画では何秒か」のズレ (区間ごと) を返す
再生そのもの (どの動画をどう流すか) には一切触れない。
"""
import asyncio
import io
import time
from typing import Optional

import httpx

import ytaudio

try:
    import numpy as np
    import av  # PyAV (ffmpeg 同梱)
    AVAILABLE = True
except Exception:  # ライブラリが無い環境では何もしない
    np = None
    av = None
    AVAILABLE = False

SR = 8000          # デコード後のサンプリング周波数
HOP = 80           # 10ms ごとに 1 点
FPS = SR // HOP    # 100 点/秒
MAX_BYTES = 16 * 1024 * 1024

_cache: dict[str, tuple[float, dict]] = {}
_inflight: dict[str, asyncio.Future] = {}
_sem = asyncio.Semaphore(2)


async def _download(http: httpx.AsyncClient, vid: str) -> Optional[bytes]:
    buf = bytearray()
    total = None
    while len(buf) < MAX_BYTES:
        resp = await ytaudio.open_stream(http, vid, f"bytes={len(buf)}-")
        if resp is None:
            break
        try:
            cr = resp.headers.get("content-range", "")
            if "/" in cr and cr.split("/")[-1].isdigit():
                total = int(cr.split("/")[-1])
            n0 = len(buf)
            async for chunk in resp.aiter_bytes(65536):
                buf.extend(chunk)
                if len(buf) >= MAX_BYTES:
                    break
        except httpx.HTTPError:
            pass
        finally:
            await resp.aclose()
        if resp.status_code == 200 or total is None or len(buf) >= total or len(buf) == n0:
            break
    return bytes(buf) if buf else None


def _decode(data: bytes):
    """音声を 8kHz モノラルにして返す."""
    out = []
    with av.open(io.BytesIO(data)) as c:
        st = next((s for s in c.streams if s.type == "audio"), None)
        if st is None:
            return None
        rs = av.AudioResampler(format="s16", layout="mono", rate=SR)
        try:
            for fr in c.decode(st):
                for r in rs.resample(fr):
                    out.append(r.to_ndarray().reshape(-1))
        except Exception:
            pass  # 途中で切れていても、そこまでで使う
        for r in rs.resample(None):
            out.append(r.to_ndarray().reshape(-1))
    if not out:
        return None
    return np.concatenate(out).astype(np.float32) / 32768.0


def _onset(x):
    n = len(x) // HOP
    if n < FPS * 20:
        return None
    x = x[: n * HOP].reshape(n, HOP)
    e = np.log1p(100.0 * np.sqrt((x * x).mean(axis=1)))
    d = np.diff(e, prepend=e[0])
    return np.maximum(0.0, d)


def _z(a):
    a = a - a.mean()
    s = np.linalg.norm(a)
    return a / s if s > 1e-9 else a


def _xcorr_best(ref, tgt, lo: int, hi: int):
    """tgt[t + lag] ≈ ref[t] となる lag (lo..hi) を FFT で探す. 戻り値 (lag, corr)."""
    n = len(ref) + len(tgt)
    size = 1 << (n - 1).bit_length()
    R = np.fft.rfft(_z(ref), size)
    T = np.fft.rfft(_z(tgt), size)
    cc = np.fft.irfft(T * np.conj(R), size)
    # cc[k] = sum ref[t] * tgt[t + k]  (k<0 は末尾に回り込む)
    lags = np.arange(lo, hi + 1)
    vals = cc[lags % size]
    i = int(np.argmax(vals))
    return int(lags[i]), float(vals[i])


def _local(ref_w, tgt, start: int, center: int, rad: int):
    """ref の1区間 (start から) が tgt のどこにあるか、center±rad の範囲で探す."""
    w = len(ref_w)
    a = max(0, start + center - rad)
    b = min(len(tgt), start + center + rad + w)
    if b - a < w:
        return None, -1.0
    seg = tgt[a:b]
    rz = _z(ref_w)
    best, bc = None, -1.0
    # 正規化相互相関 (区間ごとにノルムで割る)
    c = np.correlate(seg, rz, mode="valid")
    sq = np.convolve(seg * seg, np.ones(w), mode="valid")
    sm = np.convolve(seg, np.ones(w), mode="valid")
    var = np.maximum(sq - sm * sm / w, 1e-12)
    ncc = c / np.sqrt(var)
    i = int(np.argmax(ncc))
    best, bc = a + i - start, float(ncc[i])
    return best, bc


def align(ref_x, tgt_x) -> Optional[dict]:
    ro, to = _onset(ref_x), _onset(tgt_x)
    if ro is None or to is None:
        return None
    # まず全体のズレ (-20秒 .. +90秒)
    g, gc = _xcorr_best(ro, to, -20 * FPS, 90 * FPS)
    if gc < 0.25:
        return {"ok": False, "conf": round(gc, 3)}
    # 10秒ごとに細かく見る (MVで途中に間が入っている場合に対応)
    W = 10 * FPS
    segs = []
    for s in range(0, len(ro) - W // 2, W):
        w = ro[s: s + W]
        if len(w) < W // 2 or w.std() < 1e-4:
            continue
        lag, c = _local(w, to, s, g, 8 * FPS)
        if lag is None or c < 0.45:
            continue
        segs.append([s, lag, c])
    if not segs:
        segs = [[0, g, gc]]
    # 外れ値を除く: 前後と大きく違う1区間だけのズレは捨てる
    lags = [x[1] for x in segs]
    clean = []
    for i, x in enumerate(segs):
        nb = lags[max(0, i - 2): i] + lags[i + 1: i + 3]
        if nb and min(abs(x[1] - v) for v in nb) > 30:  # 0.3秒以上どの隣とも合わない
            continue
        clean.append(x)
    if not clean:
        clean = [[0, g, gc]]
    # 同じズレの区間はまとめる
    out = []
    for s, lag, c in clean:
        if out and abs(out[-1][1] - lag * 10) <= 60:
            continue
        out.append([int(s * 1000 / FPS), int(lag * 1000 / FPS)])
    out[0][0] = 0
    return {"ok": True, "segs": out, "conf": round(gc, 3)}


async def _find_ref(http: httpx.AsyncClient, track: str, artist: str, lrc_ms: int, vid: str) -> Optional[str]:
    """歌詞と同じ長さの「元の音源」(YouTube Music の公式音源) を探す."""
    a1 = ytaudio._first_artist(artist)
    q = f"{a1} {ytaudio._strip_feat(track)}"
    vids = await ytaudio._tube_search(http, q, "music_songs")
    want = lrc_ms / 1000
    best, bd = None, 1e9
    for v in vids[:10]:
        try:
            length = float(v.get("lengthSeconds") or v.get("duration") or 0)
        except (TypeError, ValueError):
            length = 0
        if not length:
            continue
        if ytaudio._score(v, track, [artist, a1], want) < 8:
            continue
        d = abs(length - want)
        if d <= 10 and d < bd:
            best, bd = v["videoId"], d
    return best


async def get(http: httpx.AsyncClient, vid: str, track: str, artist: str, lrc_ms: int) -> dict:
    if not AVAILABLE:
        return {"ok": False, "reason": "unavailable"}
    key = f"{vid}|{ytaudio._norm(artist)}|{ytaudio._norm(track)}|{lrc_ms // 1000}"
    c = _cache.get(key)
    if c and c[0] > time.time():
        return c[1]
    if key in _inflight:
        return await _inflight[key]
    fut = asyncio.get_event_loop().create_future()
    _inflight[key] = fut
    res: dict = {"ok": False}
    try:
        async with _sem:
            ref = await _find_ref(http, track, artist, lrc_ms, vid)
            if not ref:
                res = {"ok": False, "reason": "noref"}
            elif ref == vid:
                res = {"ok": True, "segs": [[0, 0]], "ref": ref, "same": True}
            else:
                a, b = await asyncio.gather(_download(http, ref), _download(http, vid))
                if not a or not b:
                    res = {"ok": False, "reason": "download"}
                else:
                    def work():
                        ra, rb = _decode(a), _decode(b)
                        if ra is None or rb is None:
                            return {"ok": False, "reason": "decode"}
                        return align(ra, rb) or {"ok": False, "reason": "short"}
                    res = await asyncio.to_thread(work)
                    res["ref"] = ref
        ttl = 86400 * 7 if res.get("ok") or res.get("reason") in ("noref", "short") else 600
        _cache[key] = (time.time() + ttl, res)
        if len(_cache) > 3000:
            for k in list(_cache)[:500]:
                _cache.pop(k, None)
    except Exception as e:
        res = {"ok": False, "reason": "error"}
        _cache[key] = (time.time() + 300, res)
    finally:
        fut.set_result(res)
        _inflight.pop(key, None)
    return res
