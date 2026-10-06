"""LIVE (生放送) のチャットをリアルタイムで取得する

- 最初: https://www.youtube.com/live_chat?v=... の HTML から最初のメッセージと続きのトークンを読む
- 以降: InnerTube の live_chat/get_live_chat に続きのトークンを渡して新しいメッセージだけを受け取る
- 返す形はフロントで扱いやすいように単純化 (本文は「文字」と「絵文字の画像」の並び)
"""
from __future__ import annotations

import asyncio
import json
import re
import time

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
_client: httpx.AsyncClient | None = None
# HTML から読んだ API キー等 (しばらく使い回す)
_cfg: dict = {"key": "", "ver": "", "vd": "", "t": 0.0}
_CFG_TTL = 1800


def _cl() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=6.0, read=12.0, write=6.0, pool=6.0),
            headers={"User-Agent": _UA, "Accept-Language": "ja,en;q=0.8"},
            cookies={"CONSENT": "YES+1", "PREF": "hl=ja&gl=JP"},
            follow_redirects=True,
        )
    return _client


def _txt(o) -> str:
    if not o:
        return ""
    if isinstance(o, str):
        return o
    if "simpleText" in o:
        return o["simpleText"]
    return "".join(r.get("text", "") for r in o.get("runs", []) if isinstance(r, dict))


def _best(thumbs, want: int = 64) -> str:
    lst = [t for t in (thumbs or []) if isinstance(t, dict) and t.get("url")]
    if not lst:
        return ""
    lst.sort(key=lambda t: abs((t.get("width") or want) - want))
    u = lst[0]["url"]
    return "https:" + u if u.startswith("//") else u


def _runs(msg) -> list:
    """本文を [{t: 文字}] / [{e: 絵文字の画像, a: 代わりの文字}] の並びにする"""
    out = []
    for r in (msg or {}).get("runs", []) if isinstance(msg, dict) else []:
        if not isinstance(r, dict):
            continue
        if "text" in r:
            out.append({"t": r["text"]})
        elif "emoji" in r:
            em = r["emoji"]
            img = _best((em.get("image") or {}).get("thumbnails"), 48)
            alt = (em.get("shortcuts") or [""])[0] or em.get("emojiId", "")
            # 普通の絵文字 (Unicode) は文字のまま
            eid = em.get("emojiId", "")
            if eid and not em.get("isCustomEmoji") and len(eid) <= 8 and not eid.startswith("UC"):
                out.append({"t": eid})
            elif img:
                out.append({"e": img, "a": alt})
            else:
                out.append({"t": alt})
    return out


def _color(n) -> str:
    try:
        n = int(n)
    except Exception:
        return ""
    a = ((n >> 24) & 255) / 255
    return f"rgba({(n >> 16) & 255},{(n >> 8) & 255},{n & 255},{a:.2f})"


def _badges(r: dict) -> dict:
    b = {"owner": False, "mod": False, "verified": False, "member": ""}
    for x in r.get("authorBadges") or []:
        br = x.get("liveChatAuthorBadgeRenderer") or {}
        it = (br.get("icon") or {}).get("iconType", "")
        if it == "OWNER":
            b["owner"] = True
        elif it == "MODERATOR":
            b["mod"] = True
        elif it == "VERIFIED":
            b["verified"] = True
        elif br.get("customThumbnail"):
            b["member"] = _best(br["customThumbnail"].get("thumbnails"), 32)
            b["memberTip"] = br.get("tooltip", "")
    return b


def _item(kind: str, r: dict) -> dict | None:
    base = {
        "id": r.get("id", ""),
        "ts": int(r.get("timestampUsec") or 0) // 1000,
        "author": _txt(r.get("authorName")),
        "authorId": r.get("authorExternalChannelId", ""),
        "photo": _best((r.get("authorPhoto") or {}).get("thumbnails"), 64),
    }
    if kind == "liveChatTextMessageRenderer":
        return {**base, "type": "text", "runs": _runs(r.get("message")), **_badges(r)}
    if kind == "liveChatPaidMessageRenderer":
        return {**base, "type": "paid", "runs": _runs(r.get("message")), "amount": _txt(r.get("purchaseAmountText")),
                "bg": _color(r.get("bodyBackgroundColor")), "hbg": _color(r.get("headerBackgroundColor")),
                "fg": _color(r.get("bodyTextColor")), **_badges(r)}
    if kind == "liveChatPaidStickerRenderer":
        return {**base, "type": "sticker", "amount": _txt(r.get("purchaseAmountText")),
                "sticker": _best((r.get("sticker") or {}).get("thumbnails"), 80),
                "bg": _color(r.get("backgroundColor") or r.get("moneyChipBackgroundColor")), **_badges(r)}
    if kind == "liveChatMembershipItemRenderer":
        return {**base, "type": "member", "head": _txt(r.get("headerPrimaryText")) or _txt(r.get("headerSubtext")),
                "sub": _txt(r.get("headerSubtext")) if r.get("headerPrimaryText") else "",
                "runs": _runs(r.get("message")), **_badges(r)}
    if kind == "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer":
        h = ((r.get("header") or {}).get("liveChatSponsorshipsHeaderRenderer") or {})
        return {**base, "type": "member", "author": _txt(h.get("authorName")) or base["author"],
                "photo": _best((h.get("authorPhoto") or {}).get("thumbnails"), 64) or base["photo"],
                "head": _txt(h.get("primaryText")), "sub": "", "runs": []}
    if kind == "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer":
        return {**base, "type": "text", "runs": [{"t": _txt(r.get("message"))}], "system": True}
    return None


def _parse_actions(actions) -> tuple[list, list]:
    msgs, deleted = [], []
    for a in actions or []:
        if not isinstance(a, dict):
            continue
        if "replayChatItemAction" in a:  # アーカイブのチャット (念のため)
            _m, _d = _parse_actions(a["replayChatItemAction"].get("actions"))
            msgs += _m
            deleted += _d
            continue
        add = a.get("addChatItemAction")
        if add:
            for k, v in (add.get("item") or {}).items():
                m = _item(k, v) if isinstance(v, dict) else None
                if m and (m.get("runs") or m["type"] != "text"):
                    msgs.append(m)
            continue
        for key in ("markChatItemAsDeletedAction", "markChatItemsByAuthorAsDeletedAction"):
            d = a.get(key)
            if d:
                if d.get("targetItemId"):
                    deleted.append(d["targetItemId"])
                elif d.get("externalChannelId"):
                    deleted.append("author:" + d["externalChannelId"])
        rep = a.get("replaceChatItemAction")
        if rep:
            for k, v in (rep.get("replacementItem") or {}).items():
                m = _item(k, v) if isinstance(v, dict) else None
                if m:
                    msgs.append(m)
    return msgs, deleted


def _next_cont(conts) -> tuple[str, int]:
    for c in conts or []:
        for v in c.values():
            if isinstance(v, dict) and v.get("continuation"):
                return v["continuation"], int(v.get("timeoutMs") or 5000)
    return "", 0


async def _initial(video_id: str) -> dict:
    r = await _cl().get("https://www.youtube.com/live_chat", params={"v": video_id, "is_popout": "1", "hl": "ja"})
    if r.status_code != 200:
        return {"error": f"chat page {r.status_code}"}
    h = r.text
    for k, rx in (("key", r'"INNERTUBE_API_KEY":"([^"]+)"'), ("ver", r'"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"'),
                  ("vd", r'"VISITOR_DATA":"([^"]+)"')):
        m = re.search(rx, h)
        if m:
            _cfg[k] = m.group(1)
    _cfg["t"] = time.time()
    i = h.find("ytInitialData")
    if i < 0:
        return {"error": "no chat"}
    j = h.find("{", i)
    try:
        data, _ = json.JSONDecoder().raw_decode(h[j:])
    except Exception:
        return {"error": "parse"}
    lc = (data.get("contents") or {}).get("liveChatRenderer")
    if not lc:
        # チャットが無効 / 終了 / まだ始まっていない
        msg = ""
        try:
            msg = _txt(data["contents"]["messageRenderer"]["text"])
        except Exception:
            pass
        return {"error": "disabled", "message": msg}
    # 「トップチャット」「チャット」の切り替え用トークン
    modes = []
    try:
        items = lc["header"]["liveChatHeaderRenderer"]["viewSelector"]["sortFilterSubMenuRenderer"]["subMenuItems"]
        for it in items:
            c = ((it.get("continuation") or {}).get("reloadContinuationData") or {}).get("continuation")
            if c:
                modes.append({"title": it.get("title", ""), "selected": bool(it.get("selected")), "c": c})
    except Exception:
        pass
    msgs, deleted = _parse_actions(lc.get("actions"))
    cont, tmo = _next_cont(lc.get("continuations"))
    return {"messages": msgs, "deleted": deleted, "continuation": cont, "timeoutMs": tmo, "modes": modes[:2]}


async def _poll(cont: str) -> dict:
    if not _cfg["key"] or time.time() - _cfg["t"] > _CFG_TTL:
        try:
            await _initial("jfKfPfyJRdk")  # キー等の取り直し (常時配信中のチャンネル)
        except Exception:
            pass
    body = {"context": {"client": {"clientName": "WEB", "clientVersion": _cfg["ver"] or "2.20261001.01.00",
                                   "hl": "ja", "gl": "JP", "visitorData": _cfg["vd"]}},
            "continuation": cont}
    headers = {"X-YouTube-Client-Name": "1", "X-YouTube-Client-Version": _cfg["ver"] or "2.20261001.01.00",
               "Origin": "https://www.youtube.com", "Referer": "https://www.youtube.com/"}
    if _cfg["vd"]:
        headers["X-Goog-Visitor-Id"] = _cfg["vd"]
    url = "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false"
    if _cfg["key"]:
        url += "&key=" + _cfg["key"]
    r = await _cl().post(url, json=body, headers=headers)
    if r.status_code != 200:
        return {"error": f"poll {r.status_code}"}
    d = r.json()
    lcc = (d.get("continuationContents") or {}).get("liveChatContinuation")
    if not lcc:
        return {"ended": True, "messages": [], "continuation": ""}
    msgs, deleted = _parse_actions(lcc.get("actions"))
    nc, tmo = _next_cont(lcc.get("continuations"))
    return {"messages": msgs, "deleted": deleted, "continuation": nc, "timeoutMs": tmo, "ended": not nc}


@router.get("/api/livechat/{video_id}")
async def api_live_chat(video_id: str, c: str = ""):
    """c なし: 最初のメッセージと続きのトークン / c あり: その続きから新しいメッセージ"""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return JSONResponse({"error": "invalid id"}, status_code=400)
    try:
        if c:
            res = await asyncio.wait_for(_poll(c), 15)
        else:
            res = await asyncio.wait_for(_initial(video_id), 15)
    except Exception as e:
        return JSONResponse({"error": "取得できませんでした", "detail": type(e).__name__}, status_code=502)
    if res.get("error") == "disabled":
        return JSONResponse(res, status_code=404)
    if res.get("error"):
        return JSONResponse(res, status_code=502)
    # 一度に大量に返さない (最初はとくに多い)
    res["messages"] = res.get("messages", [])[-150:]
    return JSONResponse(res, headers={"Cache-Control": "no-store"})
