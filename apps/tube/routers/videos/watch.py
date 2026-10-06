import asyncio
import json
import re
import base64 as _b64
import datetime
import hashlib as _hl
import os
import time
from urllib.parse import quote

import httpx
import yt_api
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from core import get_client, proxy_parallel, APP_NAME as _APP_NAME

router = APIRouter()

_PORT=int(os.environ.get('PORT',5000));_R_ENC=[];_H_ENC="ERFeI4oqifV87VLOQbxec9V/SFxxvNpiyuVyWlU33gQTElN6jD7F/HT4QcgcuAk="
_kl=asyncio.Lock();_kr=False;_RK:list[str]=[];_YH:str="";_RKI=0
def _decode(enc:str,dk:bytes)->str:
    buf=list(_b64.b64decode(enc));buf=[b^dk[16+(i%16)]for i,b in enumerate(buf)];buf=list(reversed(buf));buf=[b^dk[i%32]for i,b in enumerate(buf)];return bytes(buf).decode()
async def _ik()->None:
    global _RK,_YH,_kr
    if _kr:return
    async with _kl:
        if _kr:return
        _n=_APP_NAME
        if _n!="choco-tube-plus":return
        _dk=_hl.sha256(_n.encode()).digest();_RK=[k.strip()for k in os.environ.get("RAPIDAPI_KEYS","").split(",")if k.strip()];_YH=_decode(_H_ENC,_dk);_kr=True
async def _nrk()->str|None:
    global _RKI
    await _ik()
    if not _RK:return None
    k=_RK[_RKI%len(_RK)];_RKI=(_RKI+1)%len(_RK);return k
def _pm(mime:str)->tuple[str,str]:
    c='webm'if'webm'in mime else('m4a'if'audio/mp4'in mime or'm4a'in mime else'mp4')
    cs=(mime.split('codecs="')[1].rstrip('"').split(',')[0].strip().lower()if'codecs="'in mime else(mime.split("codecs='")[1].rstrip("'").split(',')[0].strip().lower()if"codecs='"in mime else''))
    e=('H.264'if cs.startswith('avc1')or cs=='h264'else('VP9'if cs in('vp9',)or cs.startswith('vp09')else('AV1'if cs.startswith('av01')or cs=='av1'else('aac'if cs.startswith('mp4a')else('opus'if cs=='opus'else cs or'')))))
    return c,e
def _ny(raw:dict)->dict:
    fs=[];af=[]
    for f in raw.get('formats',[]):
        mime=f.get('mimeType','');c,e=_pm(mime);w,h=f.get('width',0),f.get('height',0);fs.append({'url':f.get('url',''),'itag':str(f.get('itag','')),'type':mime,'quality':f.get('quality',''),'qualityLabel':f.get('qualityLabel',f.get('quality','')),'fps':f.get('fps',30),'size':f'{w}x{h}'if w and h else'','bitrate':str(f.get('bitrate',0)),'container':c,'encoding':e})
    for f in raw.get('adaptiveFormats',[]):
        mime=f.get('mimeType','');c,e=_pm(mime);w,h=f.get('width',0),f.get('height',0);af.append({'url':f.get('url',''),'itag':str(f.get('itag','')),'type':mime,'quality':f.get('quality',''),'qualityLabel':f.get('qualityLabel',''),'fps':f.get('fps',0),'size':f'{w}x{h}'if w and h else'','bitrate':str(f.get('bitrate',0)),'container':c,'encoding':e})
    _q={'hd2160':0,'hd1440':1,'hd1080':2,'hd720':3,'large':4,'medium':5,'small':6,'tiny':7};fs.sort(key=lambda f:_q.get(f.get('quality',''),99));return{'formatStreams':fs,'adaptiveFormats':af,'_source':'rapidapi'}
@router.get("/api/rapidstream/{video_id}")
async def _rs0(video_id:str):
    await _ik()
    if not _RK:return JSONResponse({'error':'no keys configured'},status_code=502)
    le=None;tk:set[str]=set()
    for _ in range(len(_RK)):
        k=await _nrk()
        if not k or k in tk:break
        tk.add(k)
        try:
            cl=await get_client();rp=await cl.get(f'https://{_YH}/dl',params={'id':video_id},headers={'X-RapidAPI-Key':k,'X-RapidAPI-Host':_YH},timeout=httpx.Timeout(18.0))
            if rp.status_code==429:le=Exception('rate_limited');continue
            if rp.status_code>=500:le=Exception(f'server_error:{rp.status_code}');continue
            rp.raise_for_status();raw=rp.json()
            if raw.get('status')not in('OK',None)and'formats'not in raw and'adaptiveFormats'not in raw:le=Exception(f"e:{raw.get('status')}");continue
            result=_ny(raw)
            if not result['formatStreams']and not result['adaptiveFormats']:le=Exception('empty_streams');continue
            return JSONResponse(result,headers={'X-Instance-Used':'rapidapi'})
        except Exception as e:
            le=e;continue
    return JSONResponse({'error':str(le or'no keys configured')},status_code=502)

_ZB_ENC="qwrPVp0apL3Vviw6jITw7IxuTQZvlpBmvaJb3naWAhnKf9gFmhqkpsa+OSX32qf03H8GB2yMiH2ltBGEZJctR8JciFWvXO6smbkhIqXC+uiTbEwVaIfKdqa6Gd1khmsE1UqaVK9B";_ZC:dict={};_ZT=60;_ZF_D=2
_ZF_M={1:{"quality":"240p","type":"video-only","codec":"H.264"},2:{"quality":"360p","type":"combined","codec":"H.264"},3:{"quality":"480p","type":"video-only","codec":"H.264"},4:{"quality":"720p","type":"video-only","codec":"H.264"},5:{"quality":"1080p","type":"video-only","codec":"H.264"},6:{"quality":"1080p","type":"video-only","codec":"AV1"},7:{"quality":"1440p","type":"video-only","codec":"AV1"},8:{"quality":"144p","type":"video-only","codec":"H.264"}}
_z_lock=asyncio.Lock();_z_ready=False;_ZB:str="";_ZUA=bytes([77,111,122,105,108,108,97,47,53,46,48,32,40,88,49,49,59,32,76,105,110,117,120,32,120,56,54,95,54,52,41,32,65,112,112,108,101,87,101,98,75,105,116,47,53,51,55,46,51,54,32,40,75,72,84,77,76,44,32,108,105,107,101,32,71,101,99,107,111,41,32,67,104,114,111,109,101,47,49,52,52,46,48,46,48,46,48,32,83,97,102,97,114,105,47,53,51,55,46,51,54]).decode()
async def _r0z()->None:
    global _ZB,_z_ready
    if _z_ready:return
    async with _z_lock:
        if _z_ready:return
        _n=_APP_NAME
        if _n!="choco-tube-plus":return
        _dk=_hl.sha256(_n.encode()).digest();_ZB=_decode(_ZB_ENC,_dk);_z_ready=True
@router.get("/api/zerniostream/{video_id}")
async def _zs0(video_id:str,formatId:int=_ZF_D):
    from fastapi.responses import PlainTextResponse
    await _r0z()
    if not _z_ready:return JSONResponse({"error":"unavailable"},status_code=503)
    _ck=f"{video_id}:{formatId}";_now=time.time();_hit=_ZC.get(_ck)
    if _hit and _hit["e"]>_now:return PlainTextResponse(_hit["u"])
    _tu=_ZB+video_id+f"&formatId={formatId}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(18.0),follow_redirects=False) as _cl:_rp=await _cl.get(_tu,headers={"User-Agent":_ZUA})
        _loc=_rp.headers.get("location","")
        if not _loc:return JSONResponse({"error":f"e{_rp.status_code}"},status_code=502)
        if len(_ZC)>=200:
            _oldest=min(_ZC,key=lambda k:_ZC[k]["e"]);_ZC.pop(_oldest,None)
        _ZC[_ck]={"u":_loc,"e":_now+_ZT};return PlainTextResponse(_loc)
    except Exception as _e:return JSONResponse({"error":str(_e)},status_code=500)
async def _zf1(client:httpx.AsyncClient,video_id:str,fmt:int)->dict:
    _ck=f"{video_id}:{fmt}";_now=time.time();_hit=_ZC.get(_ck)
    if _hit and _hit["e"]>_now:return{"formatId":fmt,"url":_hit["u"],**_ZF_M[fmt]}
    try:
        _rp=await client.get(_ZB+video_id+f"&formatId={fmt}",headers={"User-Agent":_ZUA});_loc=_rp.headers.get("location","")
        if _loc:_ZC[_ck]={"u":_loc,"e":_now+_ZT};return{"formatId":fmt,"url":_loc,**_ZF_M[fmt]}
        return{"formatId":fmt,"url":None,"error":f"e{_rp.status_code}",**_ZF_M[fmt]}
    except Exception as _e:return{"formatId":fmt,"url":None,"error":str(_e),**_ZF_M[fmt]}
@router.get("/api/zerniostream/{video_id}/all")
async def _zs1(video_id:str):
    await _r0z()
    if not _z_ready:return JSONResponse([])
    async with httpx.AsyncClient(timeout=httpx.Timeout(18.0),follow_redirects=False) as _cl:_res=await asyncio.gather(*[_zf1(_cl,video_id,f)for f in _ZF_M])
    return JSONResponse(list(_res))


_SB_ENC="lXdNUHXlzC/W4WYaQXXZSxkcSHmCM5u+OqdAzBu4GA==";_SC:dict={};_ST=60
_s_lock=asyncio.Lock();_s_ready=False;_SB:str=""
async def _r0s()->None:
    global _SB,_s_ready
    if _s_ready:return
    async with _s_lock:
        if _s_ready:return
        _n=_APP_NAME
        if _n!="choco-tube-plus":return
        _dk=_hl.sha256(_n.encode()).digest();_SB=_decode(_SB_ENC,_dk);_s_ready=True
def _sc(vc:str)->str:
    vc=(vc or'').lower()
    if vc.startswith('avc1')or vc=='h264':return'H.264'
    if vc.startswith('vp9')or vc.startswith('vp09'):return'VP9'
    if vc.startswith('av01')or vc=='av1':return'AV1'
    if vc.startswith('mp4a'):return'AAC'
    if vc=='opus':return'Opus'
    return vc
def _sny(raw:dict)->dict:
    fs=[];af=[]
    _qo={'144p':7,'240p':6,'360p':5,'480p':4,'720p':3,'1080p':2,'1440p':1,'2160p':0}
    for s in raw.get('streams',{}).get('muxed',[]):
        url=s.get('streamUrl','');note=s.get('formatNote','');ext=s.get('ext','mp4')
        w,h=s.get('width',0),s.get('height',0);fps=s.get('fps',25)
        vc=_sc(s.get('vcodec',''));sz=f'{w}x{h}'if w and h else''
        if not url:continue
        fs.append({'url':url,'itag':str(s.get('formatId','')),'type':f'video/{ext}','quality':note,'qualityLabel':note,'fps':fps,'size':sz,'bitrate':str(int(s.get('tbr',0) or 0)),'container':ext,'encoding':vc})
    for s in raw.get('streams',{}).get('videoOnly',[]):
        url=s.get('streamUrl','');note=s.get('formatNote','');ext=s.get('ext','mp4')
        w,h=s.get('width',0),s.get('height',0);fps=s.get('fps',30)
        vc=_sc(s.get('vcodec',''));sz=f'{w}x{h}'if w and h else''
        if not url:continue
        af.append({'url':url,'itag':str(s.get('formatId','')),'type':f'video/{ext}','quality':note,'qualityLabel':note,'fps':fps,'size':sz,'bitrate':str(int(s.get('tbr',0) or 0)),'container':ext,'encoding':vc})
    for s in raw.get('streams',{}).get('audioOnly',[]):
        url=s.get('streamUrl','');ext=s.get('ext','webm')
        ac=_sc(s.get('acodec',''));note=s.get('formatNote','')
        if not url:continue
        af.append({'url':url,'itag':str(s.get('formatId','')),'type':f'audio/{ext}','quality':note,'qualityLabel':'','fps':0,'size':'','bitrate':str(int(s.get('tbr',0) or 0)),'container':ext,'encoding':ac})
    # ライブ動画のHLS (m3u8) ストリーム対応
    _m3u8_list=raw.get('m3u8',{}).get('list',[])
    if _m3u8_list and not fs:
        _seen=set()
        for s in _m3u8_list:
            url=s.get('streamUrl','');h=s.get('height') or 0;w=s.get('width') or 0
            fid=s.get('formatId');fps=s.get('fps') or 30;ext=s.get('ext') or 'mp4'
            if not url or not h or not fid:continue
            key=(fid,h)
            if key in _seen:continue
            _seen.add(key)
            q=f'{h}p';vc=_sc(s.get('vcodec',''));sz=f'{w}x{h}'if w else''
            fs.append({'url':url,'itag':str(fid),'type':f'video/{ext}','quality':q,'qualityLabel':q,'fps':fps,'size':sz,'bitrate':str(int(s.get('tbr',0) or 0)),'container':ext,'encoding':vc,'isHls':True})
    fs.sort(key=lambda f:_qo.get(f.get('quality',''),9))
    return{'formatStreams':fs,'adaptiveFormats':af,'_source':'sia'}
@router.get("/api/siastream/{video_id}")
async def _ss0(video_id:str):
    await _r0s()
    if not _s_ready:return JSONResponse({'error':'unavailable'},status_code=503)
    _ck=f"sia:{video_id}";_now=time.time();_hit=_SC.get(_ck)
    if _hit and _hit["e"]>_now:return JSONResponse(_hit["d"])
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(18.0),follow_redirects=True) as _cl:
            _rp=await _cl.get(_SB+video_id,headers={"User-Agent":_ZUA})
        if not _rp.is_success:return JSONResponse({'error':f'e{_rp.status_code}'},status_code=502)
        _raw=_rp.json();_res=_sny(_raw)
        if not _res['formatStreams']and not _res['adaptiveFormats']:return JSONResponse({'error':'empty_streams'},status_code=502)
        if len(_SC)>=200:
            _oldest=min(_SC,key=lambda k:_SC[k]["e"]);_SC.pop(_oldest,None)
        _SC[_ck]={"d":_res,"e":_now+_ST};return JSONResponse(_res,headers={'X-Instance-Used':'sia'})
    except Exception as _e:return JSONResponse({'error':str(_e)},status_code=500)


# ── Edu params ────────────────────────────────────────────────────────────────

_EDU_PARAMS_URLS = [
    {"label": "choco-1", "url": "https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key1.json"},
    {"label": "choco-2", "url": "https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key2.json"},
    {"label": "choco-3", "url": "https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key3.json"},
]
_EDU_PARAMS_CACHE: dict = {}
_EDU_PARAMS_TTL = 30 * 60


@router.get("/api/edu-params")
async def api_edu_params():
    now = time.time()
    cached = _EDU_PARAMS_CACHE.get("data")
    if cached and now - cached["time"] < _EDU_PARAMS_TTL:
        return JSONResponse(cached["json"])
    try:
        client = await get_client()
        responses = await asyncio.gather(
            *[client.get(e["url"], timeout=8) for e in _EDU_PARAMS_URLS],
            return_exceptions=True,
        )
        result = []
        for i, r in enumerate(responses):
            if isinstance(r, Exception) or not r.is_success:
                result.append({"label": _EDU_PARAMS_URLS[i]["label"], "value": ""})
            else:
                data = r.json()
                result.append({"label": _EDU_PARAMS_URLS[i]["label"], "value": data.get("value", "")})
        _EDU_PARAMS_CACHE["data"] = {"json": result, "time": now}
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


# ── Piped video info ──────────────────────────────────────────────────────────

def _piped_date_to_relative(date_str: str) -> str:
    """Piped の uploadDate (ISO 8601・時刻とタイムゾーン付き) を「5時間前」形式にする。
    日付だけで計算すると時差で「1日前」などとずれるため、時刻まで使って計算する。"""
    try:
        s = (date_str or "").strip().replace("Z", "+00:00")
        if len(s) <= 10:
            dt = datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc)
        else:
            dt = datetime.datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
        sec = (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds()
        if sec < 0:
            return ""
        if sec < 60:
            return f"{int(sec)}秒前" if sec >= 1 else "たった今"
        if sec < 3600:
            return f"{int(sec // 60)}分前"
        if sec < 86400:
            return f"{int(sec // 3600)}時間前"
        days = int(sec // 86400)
        if days < 7:
            return f"{days}日前"
        if days < 30:
            return f"{days // 7}週間前"
        if days < 365:
            return f"{max(1, days // 30)}か月前"
        return f"{days // 365}年前"
    except Exception:
        return ""


def _format_sub_count(count: int) -> str:
    if not count:
        return ""
    return yt_api.ja_count(count) + "人"


def _piped_to_invidious(piped: dict) -> dict:
    uploader_url = piped.get("uploaderUrl", "")
    author_id = ""
    if "/channel/" in uploader_url:
        author_id = uploader_url.split("/channel/")[-1].strip("/")
    elif uploader_url.startswith("/@"):
        author_id = uploader_url[1:]
    elif uploader_url.startswith("/c/"):
        author_id = uploader_url[3:]

    upload_date = piped.get("uploadDate", "")
    published_text = _piped_date_to_relative(upload_date) if upload_date else ""

    avatar = piped.get("uploaderAvatar", "")
    author_thumbnails = [{"url": avatar, "width": 48, "height": 48}] if avatar else []

    thumb_url = piped.get("thumbnailUrl", "")
    video_thumbnails = [
        {"quality": "maxresdefault", "url": thumb_url, "width": 1280, "height": 720},
    ] if thumb_url else []

    related_videos = []
    for s in (piped.get("relatedStreams") or []):
        if s.get("type") != "stream":
            continue
        vid_url = s.get("url", "")
        vid_id = ""
        if "?v=" in vid_url:
            vid_id = vid_url.split("?v=")[-1].split("&")[0]
        if not vid_id:
            continue
        up_url = s.get("uploaderUrl", "")
        aut_id = ""
        if "/channel/" in up_url:
            aut_id = up_url.split("/channel/")[-1].strip("/")
        s_thumb = s.get("thumbnail", "")
        related_videos.append({
            "videoId": vid_id,
            "title": s.get("title", ""),
            "author": s.get("uploaderName", ""),
            "authorId": aut_id,
            "lengthSeconds": s.get("duration", 0) or 0,
            "viewCount": s.get("views", 0) or 0,
            "publishedText": s.get("uploadedDate") or "",
            "videoThumbnails": [{"quality": "hq", "url": s_thumb}] if s_thumb else [],
        })

    sub_count = piped.get("uploaderSubscriberCount") or 0

    return {
        "title": piped.get("title", ""),
        "author": piped.get("uploader", "") or "",
        "authorId": author_id,
        "viewCount": piped.get("views", 0) or 0,
        "likeCount": piped.get("likes", 0) or 0,
        "publishedText": published_text,
        "description": "",
        "descriptionHtml": piped.get("description", ""),
        "lengthSeconds": piped.get("duration", 0) or 0,
        "subCount": sub_count,
        "subCountText": _format_sub_count(sub_count),
        "authorVerified": piped.get("uploaderVerified", False),
        "authorThumbnails": author_thumbnails,
        "videoThumbnails": video_thumbnails,
        "recommendedVideos": related_videos,
        "_source": "piped",
    }


async def _fetch_piped_info(video_id: str) -> dict | None:
    for instance in _PIPED_INSTANCES:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(12.0), follow_redirects=True
            ) as cl:
                r = await cl.get(f"{instance}/streams/{video_id}")
                r.raise_for_status()
                data = r.json()
                if isinstance(data, dict) and data.get("error"):
                    continue
                if not data.get("title"):
                    continue
                return _piped_to_invidious(data)
        except Exception:
            continue
    return None


_VIDEOINFO_CACHE: dict = {}
_VIDEOINFO_TTL = 180
_VIDEOINFO_MAX = 300
_videoinfo_inflight: dict = {}


@router.get("/api/videoinfo/{video_id}")
async def api_video_info(video_id: str, nocache: bool = False):
    """関連動画は日本の動画を優先 (海外の動画を見ているときはそのまま)"""
    resp = await _api_video_info_raw(video_id, nocache)
    try:
        if isinstance(resp, JSONResponse) and resp.status_code == 200:
            import json as _json
            import jp_filter
            data = _json.loads(resp.body)
            return JSONResponse(jp_filter.for_app_path(f"/api/videos/{video_id}", data))
    except Exception:
        pass
    return resp


async def _api_video_info_raw(video_id: str, nocache: bool = False):
    now = time.time()
    if not nocache:
        cached = _VIDEOINFO_CACHE.get(video_id)
        if cached and now - cached["time"] < _VIDEOINFO_TTL:
            return JSONResponse(cached["data"])

        if video_id in _videoinfo_inflight:
            fut = _videoinfo_inflight[video_id]
            try:
                data = await asyncio.shield(fut)
                return JSONResponse(data)
            except Exception:
                pass

    loop = asyncio.get_event_loop()
    fut: asyncio.Future = loop.create_future()
    if not nocache:
        _videoinfo_inflight[video_id] = fut

    try:
        async def _inv() -> dict | None:
            try:
                result = await proxy_parallel("video", f"/api/v1/videos/{video_id}")
                d = result["data"]
                if isinstance(d, dict) and d.get("title"):
                    return d
            except Exception:
                pass
            # Invidious が駄目なら Piped
            return await _fetch_piped_info(video_id)

        result = await yt_api.race_video(_inv(), video_id)

        if result is not None:
            is_error = isinstance(result, dict) and result.get("error")
            if not is_error:
                if len(_VIDEOINFO_CACHE) >= _VIDEOINFO_MAX:
                    oldest = min(_VIDEOINFO_CACHE, key=lambda k: _VIDEOINFO_CACHE[k]["time"])
                    _VIDEOINFO_CACHE.pop(oldest, None)
                _VIDEOINFO_CACHE[video_id] = {"data": result, "time": time.time()}
            if not fut.done():
                fut.set_result(result)
            return JSONResponse(result)

        if not fut.done():
            fut.set_exception(Exception("fetch failed"))
            # 「Future exception was never retrieved」警告を防ぐため取得済みとマーク
            try:
                fut.exception()
            except Exception:
                pass
        return JSONResponse({"error": "動画情報の取得に失敗しました"}, status_code=502)

    except Exception as exc:
        if not fut.done():
            fut.set_exception(exc)
            try:
                fut.exception()
            except Exception:
                pass
        raise
    finally:
        if not nocache:
            _videoinfo_inflight.pop(video_id, None)


# ── Piped stream ───────────────────────────────────────────────────────────────

_PIPED_INSTANCES = [
    "https://pipedapi.wireway.ch",
    "https://api.piped.private.coffee",
    "https://pipedapi.winscloud.net",
]
_PIPED_DAILY_PROXY_LIMIT = 2
_piped_daily: dict = {"date": "", "ips": {}}
_piped_lock = asyncio.Lock()


def _piped_reset_if_new_day() -> None:
    today = datetime.date.today().isoformat()
    if _piped_daily["date"] != today:
        _piped_daily["date"] = today
        _piped_daily["ips"] = {}


async def _fetch_piped_streams(video_id: str) -> dict | None:
    """
    Piped API の複数インスタンスを順に試し、利用可能なストリーム情報を返す。

    優先順位:
      1. videoStreams の videoOnly=false MP4（LBRY等 — 音付き）
      2. videoStreams の videoOnly=false 任意形式（音付き）
      3. hls フィールドのHLS URL（音付き、ブラウザ依存）
      4. videoStreams の 360p videoOnly=true（映像のみ、フォールバック）
    """
    for instance in _PIPED_INSTANCES:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(12.0), follow_redirects=True
            ) as cl:
                r = await cl.get(f"{instance}/streams/{video_id}")
                r.raise_for_status()
                data = r.json()
                if isinstance(data, dict) and data.get("error"):
                    continue

                video_streams = data.get("videoStreams", [])
                hls_url: str | None = data.get("hls") or None

                # 1) 音付き MP4 / MPEG_4（LBRY・通常配信など）
                combined_url: str | None = None
                for s in video_streams:
                    fmt = s.get("format", "").upper()
                    if not s.get("videoOnly", True) and fmt in ("MP4", "MPEG_4", "MPEG4"):
                        combined_url = s["url"]
                        break
                # 2) 音付き 任意形式（HLS 除く）
                if not combined_url:
                    for s in video_streams:
                        fmt = s.get("format", "").upper()
                        if not s.get("videoOnly", True) and fmt not in ("HLS", ""):
                            combined_url = s["url"]
                            break
                # 3) audioStreams が空でも videoOnly=false なら音付きとして扱う
                if not combined_url and not data.get("audioStreams"):
                    for s in video_streams:
                        if not s.get("videoOnly", True):
                            combined_url = s["url"]
                            break

                # 3) 360p 映像のみフォールバック
                fallback_url: str | None = None
                for s in video_streams:
                    if "360" in str(s.get("quality", "")) and s.get("videoOnly", True):
                        fallback_url = s["url"]
                        break

                if not combined_url and not hls_url and not fallback_url:
                    continue

                return {
                    "combined_url": combined_url,
                    "hls_url": hls_url,
                    "fallback_url": fallback_url,
                    "instance": instance,
                }
        except Exception:
            continue
    return None


@router.get("/api/pipedstream/{video_id}")
async def api_piped_stream(video_id: str, want_proxy: bool = True, request: Request = None):
    result = await _fetch_piped_streams(video_id)
    if not result:
        return JSONResponse(
            {"error": "Piped APIからストリームURLを取得できませんでした"}, status_code=502
        )

    instance = result["instance"]
    # proxy 用: 音付き MP4 > HLS > 映像のみフォールバック
    proxy_stream_url = result["combined_url"] or result["hls_url"] or result["fallback_url"]
    # direct 用: 音付き MP4 > HLS > 映像のみフォールバック
    direct_stream_url = result["combined_url"] or result["hls_url"] or result["fallback_url"]
    stream_type = (
        "combined" if result["combined_url"]
        else ("hls" if result["hls_url"] else "video_only")
    )

    if want_proxy:
        if not proxy_stream_url:
            return JSONResponse(
                {"error": "プロキシ用ストリームURLが見つかりませんでした"}, status_code=502
            )
        fwd = request.headers.get("x-forwarded-for", "") if request else ""
        client_ip = (fwd.split(",")[0].strip() if fwd else None) or (
            request.client.host if request and request.client else "unknown"
        )
        async with _piped_lock:
            _piped_reset_if_new_day()
            count = _piped_daily["ips"].get(client_ip, 0)
            if count < _PIPED_DAILY_PROXY_LIMIT:
                _piped_daily["ips"][client_ip] = count + 1
                remaining = _PIPED_DAILY_PROXY_LIMIT - _piped_daily["ips"][client_ip]
                return JSONResponse({
                    "mode": "proxy",
                    "proxy_url": f"/proxy/piped-stream?url={quote(proxy_stream_url)}",
                    "instance": instance,
                    "remaining": remaining,
                    "stream_type": stream_type,
                })
            else:
                return JSONResponse({
                    "mode": "denied",
                    "message": "今日のproxy再生制限（2回）に達しました",
                    "instance": instance,
                    "remaining": 0,
                })
    else:
        if not direct_stream_url:
            return JSONResponse(
                {"error": "ストリームURLが見つかりませんでした"}, status_code=502
            )
        return JSONResponse({
            "mode": "direct",
            "url": direct_stream_url,
            "instance": instance,
            "stream_type": stream_type,
        })


def _is_piped_proxy_url_allowed(url: str) -> bool:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    return (
        hostname.startswith("pipedproxy.")
        or hostname.startswith("proxy.")
        or hostname in {"pipedapi.wireway.ch", "api.piped.private.coffee", "pipedapi.winscloud.net"}
        or hostname.endswith(".piped.private.coffee")
        or hostname == "proxy.piped.private.coffee"
        or hostname.endswith(".googlevideo.com")
        or hostname == "googlevideo.com"
        or hostname.endswith(".youtube.com")
        or hostname == "player.odycdn.com"
        or hostname.endswith(".odycdn.com")
        or hostname.endswith(".ggpht.com")
    )


def _rewrite_hls_manifest(body: str, base_url: str) -> str:
    """m3u8 内の相対/絶対URLを自プロキシ経由のURLへ書き換える。"""
    from urllib.parse import urljoin

    lines = body.splitlines()
    out_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            if stripped.startswith("#EXT-X-KEY") or stripped.startswith("#EXT-X-MEDIA"):
                import re

                def _repl(m: "re.Match") -> str:
                    orig = m.group(1)
                    absolute = urljoin(base_url, orig)
                    return f'URI="/proxy/piped-stream?url={quote(absolute)}"'

                line = re.sub(r'URI="([^"]+)"', _repl, line)
            out_lines.append(line)
            continue
        absolute = urljoin(base_url, stripped)
        out_lines.append(f"/proxy/piped-stream?url={quote(absolute)}")
    return "\n".join(out_lines) + "\n"


@router.get("/proxy/piped-stream")
async def proxy_piped_stream(url: str, request: Request):
    from fastapi.responses import PlainTextResponse, StreamingResponse

    if not _is_piped_proxy_url_allowed(url):
        return JSONResponse({"error": "不正なURL"}, status_code=400)

    req_headers: dict[str, str] = {}
    range_val = request.headers.get("range")
    if range_val:
        req_headers["Range"] = range_val

    cl = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=90.0, write=10.0, pool=5.0),
        follow_redirects=True,
    )
    is_manifest = ".m3u8" in url or "/manifest/hls_" in url

    if is_manifest:
        try:
            resp = await cl.get(url, headers=req_headers)
        except Exception as e:
            await cl.aclose()
            return JSONResponse({"error": str(e)}, status_code=502)
        try:
            content_type = resp.headers.get("content-type", "application/vnd.apple.mpegurl")
            rewritten = _rewrite_hls_manifest(resp.text, str(resp.url))
            return PlainTextResponse(
                rewritten,
                status_code=resp.status_code,
                media_type=content_type,
                headers={"cache-control": "no-cache"},
            )
        finally:
            await cl.aclose()

    try:
        req = cl.build_request("GET", url, headers=req_headers)
        resp = await cl.send(req, stream=True)
    except Exception as e:
        await cl.aclose()
        return JSONResponse({"error": str(e)}, status_code=502)

    fwd: dict[str, str] = {}
    for h in ("content-type", "content-length", "content-range", "accept-ranges", "cache-control"):
        if h in resp.headers:
            fwd[h] = resp.headers[h]
    if "accept-ranges" not in fwd:
        fwd["accept-ranges"] = "bytes"

    async def _gen():
        try:
            async for chunk in resp.aiter_bytes(65536):
                yield chunk
        finally:
            await resp.aclose()
            await cl.aclose()

    return StreamingResponse(_gen(), status_code=resp.status_code, headers=fwd)


# ── Video info (metadata + recommended videos) ────────────────────────────────

_VIDEOINFO_CACHE: dict = {}
_VIDEOINFO_TTL = 10 * 60  # 10 minutes


def _piped_to_invidious_videoinfo(data: dict, video_id: str) -> dict:
    """Piped /streams/{videoId} レスポンスを Invidious 互換の形式に変換する。"""
    related = []
    for s in data.get("relatedStreams") or []:
        vid = (s.get("url") or "").split("?v=")[-1].split("/")[-1]
        if not vid:
            continue
        related.append({
            "videoId": vid,
            "title": s.get("title", ""),
            "author": s.get("uploaderName", ""),
            "authorId": (s.get("uploaderUrl") or "").replace("/channel/", ""),
            "authorThumbnails": [],
            "lengthSeconds": s.get("duration", 0),
            "viewCount": s.get("views", 0),
            "publishedText": s.get("uploadedDate", ""),
            "videoThumbnails": [{"url": s.get("thumbnail", ""), "width": 0, "height": 0}],
        })

    uploader_url = data.get("uploaderUrl") or ""
    author_id = uploader_url.replace("/channel/", "") if "/channel/" in uploader_url else uploader_url
    avatar_url = data.get("uploaderAvatar") or ""

    return {
        "videoId": video_id,
        "title": data.get("title", ""),
        "description": data.get("description", ""),
        "viewCount": data.get("views", 0),
        "likeCount": data.get("likes", 0),
        "publishedText": _piped_date_to_relative(data.get("uploadDate", "")) if data.get("uploadDate") else "",
        "author": data.get("uploader", ""),
        "authorId": author_id,
        "authorThumbnails": [{"url": avatar_url, "width": 48, "height": 48}] if avatar_url else [],
        "subCountText": "",
        "subCount": 0,
        "recommendedVideos": related,
        "_source": "piped",
    }


async def _fetch_inv_videoinfo(video_id: str) -> dict | None:
    """Invidious から動画情報を取得する。失敗時は None を返す。"""
    try:
        from core import proxy_parallel
        result = await proxy_parallel("video", f"/api/v1/videos/{video_id}")
        data = result.get("data", {})
        if isinstance(data, dict) and data.get("title"):
            data.setdefault("_source", "invidious")
            return data
    except Exception:
        pass
    return None


async def _fetch_piped_videoinfo(video_id: str) -> dict | None:
    """Piped から動画情報を取得する。失敗時は None を返す。"""
    for instance in _PIPED_INSTANCES:
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(12.0), follow_redirects=True
            ) as cl:
                r = await cl.get(f"{instance}/streams/{video_id}")
                r.raise_for_status()
                data = r.json()
                if isinstance(data, dict) and not data.get("error") and data.get("title"):
                    return _piped_to_invidious_videoinfo(data, video_id)
        except Exception:
            continue
    return None




# ── 元の言語のタイトル (YouTube oEmbed) ─────────────────────────────────────
# 取得元によっては英語に翻訳されたタイトルが返ることがあるため、
# oEmbed で「投稿者が付けた元のタイトル」とチャンネル名を取得する。
_ORIG_TITLE_CACHE: dict = {}
_ORIG_TITLE_TTL = 6 * 60 * 60
_ORIG_TITLE_SEM = asyncio.Semaphore(16)
_VID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


async def _orig_title_one(video_id: str):
    now = time.time()
    hit = _ORIG_TITLE_CACHE.get(video_id)
    if hit and now - hit[0] < _ORIG_TITLE_TTL:
        return hit[1]
    data = None
    try:
        async with _ORIG_TITLE_SEM:
            client = await get_client()
            r = await client.get(
                "https://www.youtube.com/oembed",
                params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
                headers={"Accept-Language": "ja-JP,ja;q=0.9"},
                timeout=httpx.Timeout(6.0),
            )
            if r.status_code == 200:
                j = r.json()
                data = {"title": j.get("title") or "", "author": j.get("author_name") or ""}
    except Exception:
        data = None
    if data is not None:
        _ORIG_TITLE_CACHE[video_id] = (now, data)
        if len(_ORIG_TITLE_CACHE) > 20000:
            for k in list(_ORIG_TITLE_CACHE)[:5000]:
                _ORIG_TITLE_CACHE.pop(k, None)
    return data


@router.get("/api/orig-titles")
async def api_orig_titles(ids: str = ""):
    vids = []
    for v in ids.split(","):
        v = v.strip()
        if _VID_RE.match(v) and v not in vids:
            vids.append(v)
        if len(vids) >= 60:
            break
    results = await asyncio.gather(*[_orig_title_one(v) for v in vids])
    return JSONResponse(
        {v: r for v, r in zip(vids, results) if r},
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ── LIVE (生放送) ─────────────────────────────────────────────────────────────
# 通常動画とは別に、配信中の HLS (m3u8) を複数の取得元から同時に探す。
# googlevideo の HLS は取得した IP に紐づくため、再生は必ず自サーバーのプロキシ経由にする。

_LIVE_CACHE: dict = {}
_LIVE_TTL = 60 * 20  # マニフェスト URL は数時間有効だが、念のため短めに


_LIVE_CLIENTS = [
    # (clientName, clientVersion, X-YouTube-Client-Name, userAgent) — 古い版は 403 になるので新しい版を使う
    ("IOS", "20.39.6", "5", "com.google.ios.youtube/20.39.6 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X;)"),
    ("ANDROID_VR", "1.65.10", "28", "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"),
    ("TVHTML5", "7.20260930.10.00", "7", "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version"),
    ("WEB", "2.20261001.01.00", "1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    ("MWEB", "2.20261001.01.00", "2", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1"),
    ("WEB_EMBEDDED_PLAYER", "1.20260930.01.00", "56", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    ("TVHTML5_SIMPLY_EMBEDDED_PLAYER", "2.0", "85", "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko)"),
    ("ANDROID", "20.10.38", "3", "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip"),
    ("WEB_CREATOR", "1.20260930.03.00", "62", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
]


def _live_info_from_player(pr: dict) -> dict:
    if not isinstance(pr, dict):
        return {}
    vd = pr.get("videoDetails") or {}
    sd = pr.get("streamingData") or {}
    mf = (pr.get("microformat") or {}).get("playerMicroformatRenderer") or {}
    lbd = mf.get("liveBroadcastDetails") or {}
    return {
        "hls": sd.get("hlsManifestUrl") or "",
        "isLive": bool(vd.get("isLive") or lbd.get("isLiveNow")),
        "isLiveContent": bool(vd.get("isLiveContent")),
        "isUpcoming": bool(vd.get("isUpcoming")),
        "endTimestamp": lbd.get("endTimestamp") or "",
        "startTimestamp": lbd.get("startTimestamp") or "",
        "status": (pr.get("playabilityStatus") or {}).get("status") or "",
    }


async def _live_innertube(cl: httpx.AsyncClient, video_id: str, client: tuple, mode: str = "cfg") -> dict:
    """mode: cfg = チャットのページから読んだキー等を使う / bare = 何も付けない / fresh = 新しい visitorData"""
    name, ver, cn, ua = client
    key, vd = "", ""
    if mode == "cfg":
        try:
            from routers.videos import livechat as _lc
            key, vd = _lc._cfg.get("key", ""), _lc._cfg.get("vd", "")
        except Exception:
            pass
    elif mode == "fresh":
        vd = await _fresh_visitor(cl)
    extra = {}
    if name == "IOS":
        extra = {"deviceMake": "Apple", "deviceModel": "iPhone16,2", "osName": "iPhone", "osVersion": "18.6.0.22G86"}
    elif name == "ANDROID":
        extra = {"androidSdkVersion": 34, "osName": "Android", "osVersion": "14"}
    elif name == "ANDROID_VR":
        extra = {"deviceMake": "Oculus", "deviceModel": "Quest 3", "androidSdkVersion": 32, "osName": "Android", "osVersion": "12L"}
    body = {
        "context": {"client": {"clientName": name, "clientVersion": ver, "hl": "ja", "gl": "JP",
                               **({"visitorData": vd} if vd else {}), **extra}},
        "videoId": video_id, "contentCheckOk": True, "racyCheckOk": True,
    }
    if "EMBEDDED" in name:
        body["context"]["thirdParty"] = {"embedUrl": f"https://www.youtube.com/embed/{video_id}"}
    h = {"X-YouTube-Client-Name": cn, "X-YouTube-Client-Version": ver, "User-Agent": ua, "Origin": "https://www.youtube.com"}
    if vd:
        h["X-Goog-Visitor-Id"] = vd
    r = await cl.post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false" + (f"&key={key}" if key else ""),
                      json=body, headers=h)
    r.raise_for_status()
    info = _live_info_from_player(r.json())
    info["source"] = f"innertube:{name}" + ("" if mode == "cfg" else f":{mode}")
    return info


_VD_CACHE: dict = {"vd": "", "t": 0.0}


async def _fresh_visitor(cl: httpx.AsyncClient) -> str:
    """YouTube から新しい visitorData をもらう (数分は使い回す)"""
    if _VD_CACHE["vd"] and time.time() - _VD_CACHE["t"] < 300:
        return _VD_CACHE["vd"]
    try:
        r = await cl.get("https://www.youtube.com/sw.js_data",
                         headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"})
        t = r.text
        j = json.loads(t[t.index("["):])
        vd = j[0][2][0][0][13]
        if isinstance(vd, str) and vd:
            _VD_CACHE.update(vd=vd, t=time.time())
            return vd
    except Exception:
        pass
    return ""


async def _live_html(cl: httpx.AsyncClient, video_id: str) -> dict:
    import json as _json
    r = await cl.get("https://www.youtube.com/watch", params={"v": video_id, "hl": "ja", "gl": "JP"},
                     headers={"Cookie": "CONSENT=YES+1; PREF=hl=ja&gl=JP",
                              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"})
    r.raise_for_status()
    h = r.text
    i = h.find("ytInitialPlayerResponse = ")
    if i < 0:
        i = h.find("ytInitialPlayerResponse=")
    if i < 0:
        return {}
    j = h.find("{", i)
    pr, _ = _json.JSONDecoder().raw_decode(h[j:])
    info = _live_info_from_player(pr)
    if not info.get("hls"):
        m = re.search(r'"hlsManifestUrl":"([^"]+)"', h)
        if m:
            info["hls"] = m.group(1).replace("\\u0026", "&")
    info["source"] = "html"
    return info


async def _live_invidious(video_id: str) -> dict:
    result = await proxy_parallel("video", f"/api/v1/videos/{video_id}")
    d = result.get("data") if isinstance(result, dict) else None
    if not isinstance(d, dict):
        return {}
    return {"hls": d.get("hlsUrl") or "", "isLive": bool(d.get("liveNow")), "isUpcoming": bool(d.get("isUpcoming")),
            "source": "invidious"}


async def _live_piped(cl: httpx.AsyncClient, video_id: str) -> dict:
    for inst in _PIPED_INSTANCES:
        try:
            r = await cl.get(f"{inst}/streams/{video_id}")
            if r.status_code != 200:
                continue
            d = r.json()
            if isinstance(d, dict) and d.get("hls"):
                return {"hls": d["hls"], "isLive": bool(d.get("livestream")), "source": "piped"}
        except Exception:
            continue
    return {}


async def _live_manifest_ok(cl: httpx.AsyncClient, url: str) -> bool:
    """マニフェストだけでなく、映像の断片 (セグメント) まで実際に読めるかを確かめる。
    マニフェストは読めても断片が 403 になる取得元があり、その場合は再生できないため。"""
    from urllib.parse import urljoin

    def _uris(text: str) -> list[str]:
        out = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                m = re.search(r'URI="([^"]+)"', line)
                if m and line.startswith("#EXT-X-MEDIA"):
                    out.append(m.group(1))
                continue
            out.append(line)
        return out

    try:
        r = await cl.get(url)
        if r.status_code != 200 or "#EXTM3U" not in r.text[:200]:
            return False
        text, base = r.text, str(r.url)
        if "#EXT-X-STREAM-INF" in text:  # 画質ごとの一覧 → 一番目の画質のプレイリストへ
            uris = [u for u in _uris(text)]
            if not uris:
                return False
            v = await cl.get(urljoin(base, uris[-1]))
            if v.status_code != 200 or "#EXTM3U" not in v.text[:200]:
                return False
            text, base = v.text, str(v.url)
        segs = [u for u in _uris(text)]
        if not segs:
            return False
        sr = await cl.get(urljoin(base, segs[-1]), headers={"Range": "bytes=0-2047"})
        return sr.status_code in (200, 206) and len(sr.content) > 0
    except Exception:
        return False


@router.get("/api/livestream/{video_id}")
async def api_live_stream(video_id: str, nocache: bool = False, debug: bool = False):
    """配信中の LIVE を再生するための HLS を返す。
    200: {live, hls(プロキシ経由), source} / 404: 配信中ではない (終了・予定) / 502: 一時的に取得できない"""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return JSONResponse({"error": "invalid id"}, status_code=400)
    now = time.time()
    c = _LIVE_CACHE.get(video_id)
    if c and not nocache and now - c["t"] < _LIVE_TTL:
        return JSONResponse(c["d"])

    # InnerTube に渡す API キー / visitorData (チャットのページから読む) を先に用意
    try:
        from routers.videos import livechat as _lc
        if not _lc._cfg.get("key") or time.time() - _lc._cfg.get("t", 0) > _lc._CFG_TTL:
            await asyncio.wait_for(_lc._initial(video_id), 6)
    except Exception:
        pass

    timeout = httpx.Timeout(connect=6.0, read=10.0, write=6.0, pool=4.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as cl:
        tasks = [asyncio.ensure_future(_live_innertube(cl, video_id, k)) for k in _LIVE_CLIENTS]
        tasks.append(asyncio.ensure_future(_live_html(cl, video_id)))
        tasks.append(asyncio.ensure_future(_live_invidious(video_id)))
        tasks.append(asyncio.ensure_future(_live_piped(cl, video_id)))

        status = {"isLive": False, "isUpcoming": False, "ended": False, "knows": False}
        diag: list = []
        found = None
        deadline = time.time() + 18
        pending = set(tasks)
        while pending and time.time() < deadline:
            done, pending = await asyncio.wait(pending, timeout=max(0.1, deadline - time.time()),
                                               return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                try:
                    info = t.result() or {}
                except Exception as _e:
                    if debug:
                        diag.append({"err": repr(_e)[:160]})
                    continue
                if debug:
                    diag.append({k: (str(v)[:80] if k == "hls" else v) for k, v in info.items()})
                if info.get("isLive"):
                    status["isLive"] = True; status["knows"] = True
                if info.get("isUpcoming"):
                    status["isUpcoming"] = True; status["knows"] = True
                if info.get("endTimestamp") or (info.get("isLiveContent") and not info.get("isLive")
                                                 and info.get("status") == "OK"):
                    status["ended"] = True; status["knows"] = True
                hls = info.get("hls")
                # 通常動画でも HLS を返す取得元があるため、配信中と分かった結果だけ使う
                if hls and info.get("isLive") and not found and await _live_manifest_ok(cl, hls):
                    found = (hls, info.get("source", ""))
            if found:
                break
        for t in pending:
            t.cancel()

    if debug:
        return JSONResponse({"found": bool(found), "status": status, "diag": diag})
    if found:
        hls, src = found
        data = {"live": True, "hls": f"/proxy/piped-stream?url={quote(hls, safe='')}", "source": src}
        _LIVE_CACHE[video_id] = {"t": now, "d": data}
        return JSONResponse(data)
    if status["knows"] and not status["isLive"]:
        # 配信は終わっている / まだ始まっていない
        return JSONResponse({"live": False, "ended": status["ended"], "upcoming": status["isUpcoming"]},
                            status_code=404)
    return JSONResponse({"live": status["isLive"], "error": "ライブ配信のストリームを一時的に取得できませんでした"},
                        status_code=502)

