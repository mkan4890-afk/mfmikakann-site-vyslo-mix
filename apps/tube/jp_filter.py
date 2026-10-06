"""日本の動画を優先するためのフィルター

方針
- 基本は日本の動画 (タイトル・チャンネル名・説明に かな / 日本の漢字 がある) を優先する
- ユーザーが海外の動画を明確に探している (韓国語・ロシア語などの文字、「洋楽」「韓国」、
  region=JP 以外の指定、海外の動画を見ている) ときは何もしない
- 海外の動画でも、検索語や見ている動画と明確に関係するもの (同じ英単語・チャンネル名を含む) は残す
- 絞り込みで結果が 0 件になるときは元の結果を返す (除外しすぎない・続きの読み込みを止めない)
"""
from __future__ import annotations

import re
import unicodedata

# ── 文字の種類 ────────────────────────────────────────────
_KANA = re.compile(r"[\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u31f0-\u31ff\uff66-\uff9d]")
_KANJI = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")
# 日本語ではまず使わない中国語の字 (簡体字・繁体字)
_ZH_ONLY = re.compile(r"[们這这說说吗嗎么麼频观觀实为發发现该样樣东车门见关關时們个让讓给从從对對还没过进谁啊吧呢哪视颜鱼鸟龙马]")
_FOREIGN_SCRIPT = re.compile(
    r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f"   # ハングル
    r"\u0400-\u04ff"                              # キリル文字
    r"\u0e00-\u0e7f"                              # タイ文字
    r"\u0600-\u06ff\u0750-\u077f"                 # アラビア文字
    r"\u0590-\u05ff"                              # ヘブライ文字
    r"\u0900-\u0dff"                              # インドの文字 (デーヴァナーガリーなど)
    r"\u1000-\u109f"                              # ミャンマー文字
    r"\u0370-\u03ff"                              # ギリシャ文字
    r"ăắằẳẵặâấầẩẫậđêếềểễệôốồổỗộơớờởỡợưứừửữựĂĐƠƯ"  # ベトナム語
    r"ñ¿¡ãõçÃÕÇ"                                   # スペイン語・ポルトガル語
    r"]"
)
_HANGUL = re.compile(r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]")

# 「海外のものを見たい」とはっきり分かる言葉 (「海外の反応」は日本の動画のジャンルなので除く)
_FOREIGN_WORDS = re.compile(
    r"(洋楽|韓国|韓ドラ|中国語|中国ドラマ|台湾ドラマ|海外ドラマ|海外(?!の反応)|外国|英語版|英語字幕なし|"
    r"k-?pop|c-?pop|kdrama|k-drama|english|korean|chinese|hindi|bollywood|"
    r"\beng ?sub\b|\bin english\b|\busa\b|\bamerican\b|\bbrasil\b|\bespañol\b|\bespanol\b)",
    re.I,
)

# 関係があるかを判断するときに無視する、どこにでも出てくる英単語
_STOP = {
    "the", "and", "for", "with", "official", "music", "video", "mv", "pv", "live", "feat", "ft",
    "full", "ver", "version", "short", "shorts", "new", "vs", "of", "in", "on", "to", "a", "an",
    "hd", "4k", "lyrics", "lyric", "audio", "cover", "channel", "tv", "show", "game", "games",
    "part", "ep", "episode", "vlog", "from", "best", "top", "my", "your", "how", "what", "this",
}


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").lower()


def text_kind(text: str) -> str:
    """'jp' / 'foreign' / 'latin' (英数字だけで国が分からない) / 'none' (文字なし)"""
    t = text or ""
    if _KANA.search(t):
        return "jp"
    if _FOREIGN_SCRIPT.search(t):
        return "foreign"
    if _KANJI.search(t):
        return "foreign" if _ZH_ONLY.search(t) else "jp"
    if re.search(r"[A-Za-z]", t):
        return "latin"
    return "none"


def _item_text(it: dict) -> str:
    parts = [it.get("title") or "", it.get("author") or "", it.get("channelName") or "",
             it.get("uploaderName") or ""]
    return " ".join(p for p in parts if isinstance(p, str))


def item_kind(it: dict) -> str:
    k = text_kind(_item_text(it))
    if k in ("latin", "none"):
        # タイトルが英語だけでも、説明が日本語なら日本の動画
        desc = it.get("descriptionSnippet") or it.get("description") or ""
        if isinstance(desc, str) and desc:
            dk = text_kind(desc[:300])
            if dk == "jp":
                return "jp"
            if dk == "foreign" and k == "latin":
                return "foreign"
    return k


def tokens_of(text: str) -> set[str]:
    """関係があるかの判断に使う語 (英数字の語・かな/漢字のまとまり)"""
    t = _norm(text)
    out: set[str] = set()
    for w in re.findall(r"[a-z0-9][a-z0-9'\-\.]+", t):
        w = w.strip("-.'")
        if len(w) >= 2 and w not in _STOP and not w.isdigit():
            out.add(w)
    for w in re.findall(r"[\u3041-\u30ff\u4e00-\u9fff\uac00-\ud7af]{2,}", t):
        out.add(w)
    return out


def query_intent(q: str, region: str | None = None) -> str:
    """検索語から 'foreign' (海外を探している) / 'jp' / 'neutral' (英字だけ) を判断"""
    if region and region.upper() != "JP":
        return "foreign"
    q = q or ""
    if _FOREIGN_WORDS.search(q):
        return "foreign"
    k = text_kind(q)
    if k == "foreign":
        return "foreign"
    if k == "jp":
        return "jp"
    return "neutral"


def _related(it: dict, toks: set[str]) -> bool:
    if not toks:
        return False
    t = _norm(_item_text(it))
    return any(w in t for w in toks)


def _is_media(it) -> bool:
    return isinstance(it, dict) and bool(it.get("videoId") or it.get("playlistId") or it.get("authorId") or it.get("url"))


def prioritize(items, intent: str, toks: set[str] | None = None):
    """一覧を日本の動画優先に並べ替え・絞り込みする。元の形 (リスト) のまま返す"""
    if intent == "foreign" or not isinstance(items, list) or not items:
        return items
    toks = toks or set()
    keep: list[tuple[float, int, dict]] = []      # (並び順のキー, 元の位置, 項目)
    extra_latin: list[tuple[int, dict]] = []      # 関係のない英語だけの動画 (数を絞って後ろへ)
    extra_foreign: list[tuple[int, dict]] = []    # 関係のない海外の動画
    jp_count = 0
    for i, it in enumerate(items):
        if not _is_media(it):
            keep.append((i, i, it))
            continue
        k = item_kind(it)
        if k in ("jp", "none"):
            jp_count += 1
            # 日本の動画は少し前へ寄せる (英字だけの検索語でも日本の動画が上に来やすいように)
            keep.append((i * 0.5 if intent == "neutral" else i, i, it))
        elif k == "latin":
            if _related(it, toks):
                keep.append((i + (0 if intent == "neutral" else 2), i, it))
            elif intent == "neutral":
                keep.append((i + 3, i, it))
            else:
                extra_latin.append((i, it))
        else:  # foreign
            if _related(it, toks):
                keep.append((i + (2 if intent == "neutral" else 3), i, it))
            else:
                extra_foreign.append((i, it))

    media_n = sum(1 for it in items if _is_media(it))
    if jp_count < max(3, media_n // 5):
        # 日本の動画がほとんど無い = そもそも海外の動画が中心の内容。消さずに日本の動画を前へ出すだけ
        rest = [(len(items) + i, i, it) for i, it in extra_latin + extra_foreign]
        return [it for _, _, it in sorted(keep + rest, key=lambda x: (x[0], x[1]))]

    if intent == "jp":
        # 英語だけのタイトル (日本のチャンネルのこともある) は全体の 25% までなら後ろに残す
        cap_latin = max(1, jp_count // 3)
        for n, (i, it) in enumerate(extra_latin[:cap_latin]):
            keep.append((len(items) + i, i, it))
        cap_foreign = 0
    else:
        cap_foreign = max(1, jp_count // 6) if jp_count else 2
    for i, it in extra_foreign[:cap_foreign]:
        keep.append((len(items) * 2 + i, i, it))

    out = [it for _, _, it in sorted(keep, key=lambda x: (x[0], x[1]))]
    if not any(_is_media(it) for it in out):
        return items   # 全部消えてしまうなら元のまま (海外の動画しかない検索など)
    return out


def context_from_video(v: dict) -> tuple[str, set[str]]:
    """見ている動画から、関連動画の扱い (intent, 関係語) を決める"""
    if not isinstance(v, dict):
        return "neutral", set()
    text = _item_text(v)
    k = text_kind(text)
    if k in ("latin", "none"):
        dk = text_kind((v.get("description") or "")[:400])
        if dk in ("jp", "foreign"):
            k = dk
    toks = tokens_of(text)
    if k == "foreign":
        return "foreign", toks     # 海外の動画を見ている → 関連もそのまま
    if k == "jp":
        return "jp", toks
    return "neutral", toks


def majority_intent(items) -> str:
    """検索語がないとき (ショートの続きなど): 一覧の大半がはっきり海外なら海外向けとみなす"""
    if not isinstance(items, list):
        return "neutral"
    kinds = [item_kind(it) for it in items if _is_media(it)]
    if not kinds:
        return "neutral"
    foreign = sum(1 for k in kinds if k == "foreign")
    return "foreign" if foreign / len(kinds) >= 0.6 else "neutral"


def apply_payload(data, intent: str, toks: set[str] | None = None, keys=("results", "items", "videos")):
    """API の返り値 (リスト / {results|items|videos: [...]}) にそのまま適用する"""
    if intent == "foreign":
        return data
    try:
        if isinstance(data, list):
            return prioritize(data, intent, toks)
        if isinstance(data, dict):
            for k in keys:
                if isinstance(data.get(k), list):
                    data[k] = prioritize(data[k], intent, toks)
    except Exception:
        pass
    return data


def for_app_path(app_path: str, data):
    """/proxy/main/* の結果を、パスに応じて日本の動画優先にする"""
    from urllib.parse import parse_qs, urlsplit, unquote
    try:
        sp = urlsplit(app_path)
        path = sp.path
        q = {k: v[0] for k, v in parse_qs(sp.query).items()}
        region = q.get("region")
        if path.startswith("/api/search/suggestions"):
            return data
        if path.startswith("/api/search"):
            query = q.get("q", "")
            return apply_payload(data, query_intent(query, region), tokens_of(query))
        if path.startswith("/api/trending") or path.startswith("/api/popular"):
            if region and region.upper() != "JP":
                return data
            return apply_payload(data, "jp", set())
        if path.startswith("/api/hashtag/"):
            tag = unquote(path[len("/api/hashtag/"):].strip("/"))
            return apply_payload(data, query_intent(tag, region), tokens_of(tag))
        if re.match(r"^/api/(stream|videos)/[A-Za-z0-9_-]{11}", path) and isinstance(data, dict):
            rec = data.get("recommendedVideos")
            if isinstance(rec, list) and rec:
                intent, toks = context_from_video(data)
                data["recommendedVideos"] = prioritize(rec, intent, toks)
            return data
    except Exception:
        pass
    return data
