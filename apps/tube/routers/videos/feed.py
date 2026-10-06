"""ホームのカテゴリ (音楽・スポーツ・映画…) 用フィード"""
import asyncio
import json
import random
import re
import time
from urllib.parse import unquote

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

import yt_api
import jp_filter

router = APIRouter()

CATS = {
    "music": ["音楽 MV", "新曲 2026", "J-POP", "歌ってみた", "ボカロ", "ライブ 映像"],
    "sports": ["スポーツ ハイライト", "サッカー ハイライト", "プロ野球 ハイライト", "NBA ハイライト", "バスケ", "格闘技"],
    "movie": ["映画 予告編", "映画 公式 予告", "アニメ映画 予告", "映画 解説", "邦画 予告"],
    "news": ["ニュース", "最新ニュース", "ニュース 速報", "経済ニュース", "国際ニュース"],
    "game": ["ゲーム実況", "マイクラ 実況", "スプラトゥーン", "フォートナイト", "ポケモン 実況", "APEX"],
    "cooking": ["料理 レシピ", "簡単レシピ", "料理 作り方", "お弁当 レシピ", "スイーツ 作り方"],
    "travel": ["旅行 vlog", "日本 旅行", "海外旅行", "絶景", "温泉 旅"],
    "tech": ["ガジェット レビュー", "テクノロジー", "iPhone レビュー", "PC 自作", "AI 最新"],
    "learning": ["勉強 解説", "数学 解説", "英語 勉強", "歴史 解説", "科学 解説", "プログラミング 入門"],
    "pets": ["猫 かわいい", "犬 かわいい", "ペット 動画", "動物 癒し", "子猫"],
    "anime": ["アニメ", "アニメ PV", "アニメ OP", "アニメ 公式"],
    "comedy": ["お笑い", "漫才", "コント", "おもしろ動画"],
    "live": ["ライブ配信", "生放送", "LIVE", "同時接続", "配信中"],
}
_SP = {"": None, "week": "EgIIAw%3D%3D", "month": "EgIIBA%3D%3D"}

# 「最近アップロードされた動画」: いろいろな分野の言葉を「アップロード日順」で検索し、公開が新しい順に並べる
_RECENT_WORDS = [
    "ニュース", "ゲーム実況", "音楽", "MV", "vlog", "料理", "アニメ", "スポーツ", "解説", "切り抜き",
    "歌ってみた", "レビュー", "猫", "犬", "旅行", "お笑い", "ドラマ", "映画", "プロ野球", "サッカー",
    "マイクラ", "雑談", "日常", "実況", "検証", "やってみた",
]
_SP_RECENT = {
    "hour": "CAISBAgBEAE%3D",   # アップロード日順 + 1 時間以内 + 動画のみ
    "today": "CAISBAgCEAE%3D",  # アップロード日順 + 今日 + 動画のみ
    "week": "CAISBAgDEAE%3D",   # アップロード日順 + 今週 + 動画のみ
}

_AGE_UNITS = (
    (re.compile(r"(\d+)\s*(?:秒|seconds?|secs?)"), 1),
    (re.compile(r"(\d+)\s*(?:分|minutes?|mins?)"), 60),
    (re.compile(r"(\d+)\s*(?:時間|hours?|hrs?)"), 3600),
    (re.compile(r"(\d+)\s*(?:日|days?)"), 86400),
    (re.compile(r"(\d+)\s*(?:週間|週|weeks?)"), 7 * 86400),
    (re.compile(r"(\d+)\s*(?:か月|ヶ月|ケ月|カ月|months?)"), 30 * 86400),
    (re.compile(r"(\d+)\s*(?:年|years?)"), 365 * 86400),
)


def _age_seconds(v: dict) -> int:
    """「3 時間前」「2 days ago」などから公開からの経過秒数を出す (分からないときはとても古い扱い)"""
    pub = v.get("published") or 0
    if isinstance(pub, (int, float)) and pub > 0:
        return max(0, int(time.time() - pub))
    t = str(v.get("publishedText") or "").strip().lower()
    if not t:
        return 10 ** 9
    for rx, mul in _AGE_UNITS:
        m = rx.search(t)
        if m:
            return int(m.group(1)) * mul
    return 10 ** 9


def _recent_ok(v: dict) -> bool:
    # 配信中・配信予定は「アップロードされた動画」ではないので外す
    return not v.get("liveNow") and not v.get("isUpcoming")


async def _one(q: str, sp: str | None):
    body = {"query": q}
    if sp:
        body["params"] = unquote(sp)
    try:
        resp = await yt_api._post("search", body)
        items, cont = yt_api.parse_items(resp.get("contents") or {})
        return [i for i in items if i.get("type") == "video"], cont
    except Exception:
        return [], None


async def _cont(tok: str):
    try:
        resp = await yt_api._post("search", {"continuation": tok})
        items, cont = yt_api.parse_items(resp.get("onResponseReceivedCommands") or [])
        return [i for i in items if i.get("type") == "video"], cont
    except Exception:
        return [], None


async def _recent_feed(cont: str):
    """公開日時が新しい順に返す。
    いくつかの検索 (それぞれアップロード日順) を混ぜるので、どの検索でもまだ読んでいない動画より
    新しいと確定した分だけを返し、残りは次のページへ持ち越す (ページをまたいでも新しい順が崩れない)"""
    key = f"feed:recent:{cont}"
    hit = yt_api._cget(key)
    if hit:
        return JSONResponse(hit)
    state = None
    if cont:
        try:
            state = yt_api._cget(f"recent-state:{json.loads(cont).get('k', '')}")
        except Exception:
            state = None
        if not state:
            return JSONResponse({"items": [], "shorts": [], "cont": ""})
        toks, pool, seen = list(state["toks"]), list(state["pool"]), set(state["seen"])
        ages = list(state["ages"])
    else:
        picks = random.sample(_RECENT_WORDS, k=5)
        sps = [_SP_RECENT["hour"], _SP_RECENT["today"], _SP_RECENT["today"], _SP_RECENT["today"], _SP_RECENT["week"]]
        res = await asyncio.gather(*(_one(q, sp) for q, sp in zip(picks, sps)))
        toks, pool, seen, ages = [], [], set(), []
        for lst, tok in res:
            toks.append(tok)
            ages.append(max((_age_seconds(v) for v in lst), default=0))
            for v in lst:
                if v["videoId"] not in seen and _recent_ok(v):
                    seen.add(v["videoId"])
                    pool.append(v)
        state = None
    out: list = []
    for _round in range(3):
        if cont and (_round > 0 or not out):
            # 続きのある検索だけ次のページを読む
            idx = [i for i, t in enumerate(toks) if t]
            if not idx:
                break
            res = await asyncio.gather(*(_cont(toks[i]) for i in idx))
            for i, (lst, tok) in zip(idx, res):
                toks[i] = tok
                ages[i] = max([ages[i]] + [_age_seconds(v) for v in lst])
                for v in lst:
                    if v["videoId"] not in seen and _recent_ok(v):
                        seen.add(v["videoId"])
                        pool.append(v)
        # まだ続きのある検索の「ここまで読んだ」位置のうち一番新しいもの = 確定ライン
        frontier = min([a for a, t in zip(ages, toks) if t] or [10 ** 10])
        pool.sort(key=_age_seconds)
        ready = [v for v in pool if _age_seconds(v) <= frontier]
        pool = [v for v in pool if _age_seconds(v) > frontier]
        out.extend(ready)
        if len(out) >= 24 or not any(toks):
            break
        cont = cont or "1"  # 2 回目以降は続きを読む
    if not any(toks):
        out.extend(sorted(pool, key=_age_seconds))
        pool = []
    # 日本の動画を優先 (同じくらいの新しさの中で) しつつ、公開が新しい順を保つ
    out = jp_filter.prioritize(out, "jp", set())
    out = sorted(out, key=_age_seconds)
    normal = [v for v in out if not v.get("isShort")]
    shorts = [v for v in out if v.get("isShort")]
    await yt_api.enrich_items(shorts, limit=8, timeout=3.0)
    next_cont = ""
    if any(toks) or pool:
        sk = f"{int(time.time() * 1000)}{random.randint(0, 99999)}"
        yt_api._cset(f"recent-state:{sk}", {"toks": toks, "pool": pool, "seen": list(seen), "ages": ages}, 1800)
        next_cont = json.dumps({"k": sk})
    data = {"items": normal, "shorts": shorts[:12], "cont": next_cont}
    if normal:
        yt_api._cset(key, data, 180)  # 新しい動画がすぐ増えるので短めに
    return JSONResponse(data)


@router.get("/api/category-feed")
async def category_feed(cat: str = Query(...), cont: str = ""):
    if cat == "recent":
        return await _recent_feed(cont)
    words = CATS.get(cat)
    if not words:
        return JSONResponse({"items": [], "cont": ""}, status_code=404)
    key = f"feed:{cat}:{cont}"
    hit = yt_api._cget(key)
    if hit:
        return JSONResponse(hit)
    if cont:
        try:
            toks = json.loads(cont)
        except Exception:
            toks = []
        results = await asyncio.gather(*(_cont(t) for t in toks[:4]))
    else:
        picks = random.sample(words, k=min(3, len(words)))
        sps = [None, _SP["month"], _SP["week"]]
        results = await asyncio.gather(*(_one(q, sps[i % 3]) for i, q in enumerate(picks)))
    lists = [r[0] for r in results]
    toks = [r[1] for r in results if r[1]]
    seen, out = set(), []
    for i in range(max((len(l) for l in lists), default=0)):
        for l in lists:
            if i < len(l):
                v = l[i]
                if v["videoId"] in seen:
                    continue
                seen.add(v["videoId"])
                out.append(v)
    # ショートは別扱い (一覧の最後へ)
    out = jp_filter.prioritize(out, "jp", jp_filter.tokens_of(" ".join(words)))
    normal = [v for v in out if not v.get("isShort")]
    shorts = [v for v in out if v.get("isShort")]
    await yt_api.enrich_items(shorts, limit=8, timeout=3.0)
    data = {"items": normal, "shorts": shorts[:12], "cont": json.dumps(toks) if toks else ""}
    if normal:
        yt_api._cset(key, data, 600)
    return JSONResponse(data)


_META_SEM = asyncio.Semaphore(16)


async def _meta_one(vid: str):
    async with _META_SEM:
        try:
            v = await asyncio.wait_for(yt_api.get_video(vid), timeout=8)
        except Exception:
            return None
    if not v:
        return None
    return {k: v.get(k) for k in ("title", "author", "authorId", "authorThumbnails", "viewCount",
                                  "publishedText", "likeCount", "subCountText", "lengthSeconds", "liveNow")}


@router.get("/api/video-meta")
async def video_meta(ids: str = ""):
    """カードで欠けているチャンネル名・アイコン・再生回数をまとめて補う"""
    vids = [v for v in dict.fromkeys(x.strip() for x in ids.split(",")) if len(v) == 11][:40]
    res = await asyncio.gather(*(_meta_one(v) for v in vids))
    return JSONResponse({v: r for v, r in zip(vids, res) if r},
                        headers={"Cache-Control": "public, max-age=600"})
