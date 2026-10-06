"""LIVE の中継で YouTube に取りに行くときの出口 (Cloudflare WARP)

Railway などのデータセンターの回線からだと、YouTube は配信中の LIVE に限って
「ボットではないことを確認」を返し、映像の情報をくれないことがある。
そこで、無料・登録不要の Cloudflare WARP をコンテナの中で動かし (wireproxy)、
LIVE の中継だけ WARP 経由で YouTube に取りに行く。

- wgcf で WARP の端末を登録して WireGuard の設定を作る (アカウント不要)
- wireproxy でその WireGuard を 127.0.0.1 の HTTP プロキシとして使えるようにする
- うまく動かないとき (UDP が使えない等) は今まで通り直接取りに行く
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import time

import httpx

_DIR = os.environ.get("WARP_DIR", "/tmp/vy-warp")
_PORT = int(os.environ.get("WARP_HTTP_PORT", "40080"))
_SOCKS = int(os.environ.get("WARP_SOCKS_PORT", "40081"))
# https は SOCKS5 経由の方が確実 (wireproxy の HTTP プロキシは CONNECT に失敗することがある)
PROXY_URL = f"socks5://127.0.0.1:{_SOCKS}"

_state = {"ok": False, "tried": 0.0, "err": "", "proc": None, "ip": "", "ep": ""}
# つながる場所を順に試す (UDP のポートが塞がれている環境があるため)
_ENDPOINTS = ["162.159.192.1:2408", "162.159.192.1:500", "162.159.192.1:4500", "162.159.193.10:1701",
              "162.159.192.1:894", "engage.cloudflareclient.com:2408"]
_lock = asyncio.Lock()


def enabled() -> bool:
    return os.environ.get("LIVE_WARP", "1") not in ("0", "false", "off") and bool(shutil.which("wireproxy")) \
        and bool(shutil.which("wgcf"))


def ready() -> bool:
    p = _state["proc"]
    return _state["ok"] and p is not None and p.returncode is None


def status() -> dict:
    return {"enabled": enabled(), "ready": ready(), "err": _state["err"][-600:], "ip": _state["ip"], "ep": _state["ep"]}


async def _run(*args: str, timeout: float = 40) -> tuple[int, str]:
    pr = await asyncio.create_subprocess_exec(*args, cwd=_DIR, stdin=asyncio.subprocess.PIPE,
                                              stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(pr.communicate(b"y\n"), timeout)
    except asyncio.TimeoutError:
        pr.kill()
        return -1, "timeout"
    return pr.returncode or 0, out.decode("utf-8", "replace")


async def _check() -> bool:
    try:
        async with httpx.AsyncClient(proxy=PROXY_URL, timeout=6) as c:
            r = await c.get("https://www.cloudflare.com/cdn-cgi/trace")
            if "warp=on" in r.text or "warp=plus" in r.text:
                m = re.search(r"^ip=(.+)$", r.text, re.M)
                _state["ip"] = m.group(1).strip() if m else ""
                return True
    except Exception as e:
        _state["err"] = f"check: {e!r}"
    return False


async def _start() -> bool:
    os.makedirs(_DIR, exist_ok=True)
    acct = os.path.join(_DIR, "wgcf-account.toml")
    prof = os.path.join(_DIR, "wgcf-profile.conf")
    # 一度作った WARP の設定を環境変数に入れておけば、再起動のたびに登録し直さなくて済む
    # (登録は短時間に何度も行うと 429 で断られるため)
    envp = os.environ.get("WARP_PROFILE", "").strip()
    if envp and not os.path.exists(prof):
        import base64
        try:
            open(prof, "w").write(base64.b64decode(envp).decode())
        except Exception:
            pass
    if not os.path.exists(acct) and not os.path.exists(prof):
        code, out = await _run("wgcf", "register", "--accept-tos")
        if code != 0 or not os.path.exists(acct):
            _state["err"] = "register: " + out[-200:]
            return False
    if not os.path.exists(prof):
        code, out = await _run("wgcf", "generate")
        if code != 0 or not os.path.exists(prof):
            _state["err"] = "generate: " + out[-200:]
            return False
    conf = open(prof).read()
    # IPv6 のアドレスは使わない (コンテナ側で使えないことがある)
    conf = re.sub(r"^Address\s*=\s*(.+)$",
                  lambda m: "Address = " + ",".join(a.strip() for a in m.group(1).split(",") if ":" not in a),
                  conf, flags=re.M)
    conf = re.sub(r"^DNS\s*=.*$", "DNS = 1.1.1.1", conf, flags=re.M)
    # MTU が大きいと https の大きなパケットが通らずに止まるので小さめにする
    conf = re.sub(r"^MTU\s*=.*$", "MTU = 1000", conf, flags=re.M)
    last = ""
    for ep in _ENDPOINTS:
        c2 = re.sub(r"^Endpoint\s*=.*$", f"Endpoint = {ep}", conf, flags=re.M)
        c2 += f"\n[Socks5]\nBindAddress = 127.0.0.1:{_SOCKS}\n\n[http]\nBindAddress = 127.0.0.1:{_PORT}\n"
        wp = os.path.join(_DIR, "wireproxy.conf")
        open(wp, "w").write(c2)
        old = _state["proc"]
        if old is not None and old.returncode is None:
            try:
                old.kill()
                await asyncio.wait_for(old.wait(), 3)
            except Exception:
                pass
        logf = open(os.path.join(_DIR, "wireproxy.log"), "wb")
        _state["proc"] = await asyncio.create_subprocess_exec("wireproxy", "-c", wp, cwd=_DIR,
                                                              stdout=logf, stderr=logf)
        t0 = time.time()
        while time.time() - t0 < 14:
            await asyncio.sleep(1)
            if _state["proc"].returncode is not None:
                break
            if await _check():
                _state["ep"] = ep
                return True
        try:
            last = open(os.path.join(_DIR, "wireproxy.log"), "rb").read()[-300:].decode("utf-8", "replace")
        except Exception:
            pass
        _state["err"] = f"{ep}: {_state['err']} | {last}"
    return False


async def ensure(force: bool = False) -> bool:
    """WARP の出口を使える状態にする。使えれば True"""
    if force:
        _state["tried"] = 0.0
    if not enabled():
        return False
    if ready():
        return True
    if time.time() - _state["tried"] < 120:  # 失敗したら 2 分は直接取りに行く
        return False
    async with _lock:
        if ready():
            return True
        if time.time() - _state["tried"] < 120:
            return False
        _state["tried"] = time.time()
        try:
            _state["ok"] = await _start()
        except Exception as e:
            _state["ok"] = False
            _state["err"] = repr(e)[:200]
        return _state["ok"]
