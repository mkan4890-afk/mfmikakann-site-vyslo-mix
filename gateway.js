/**
 * VYSLO MIX gateway
 * -----------------
 * 単一ドメインで 3 つの VYSLO アプリを提供するリバースプロキシ兼ポータル。
 *
 * - `/`                    : 選択画面 (ポータル)
 * - `/music/`, `/tube/`, `/chat/` : 各アプリのエントリ (Cookie に選択を記録)
 * - それ以外の全パス        : Cookie (vyslo_app) に基づき対応アプリへ転送
 *   (各アプリは絶対パス `/static/...` などを返すため、Cookie でルーティングする)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const httpProxy = require("http-proxy");

const PORT = parseInt(process.env.PORT || "8080", 10);
const APP_COOKIE = "vyslo_app";

const APPS = {
  music: { port: 8001, label: "VYSLO MUSIC" },
  tube: { port: 8002, label: "VYSLO TUBE" },
  chat: { port: 8003, label: "VYSLO CHAT" },
  cloudmoon: { port: 8004, label: "VYSLO CLOUDMOON" },
  utopia: { port: 8005, label: "VYSLO UTOPIA" },
};

const PORTAL_DIR = path.join(__dirname, "portal");
const PORTAL_FILES = {
  "/portal/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/portal/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
  "/portal/google.svg": { file: "google.svg", type: "image/svg+xml" },
  "/portal/google-32.png": { file: "google-32.png", type: "image/png" },
  "/portal/favicon.ico": { file: "favicon.ico", type: "image/x-icon" },
  "/portal/apple-touch-icon.png": { file: "apple-touch-icon.png", type: "image/png" },
  "/portal/sync.html": { file: "sync.html", type: "text/html; charset=utf-8" },
  "/portal/chat-icon.png": { file: "chat-icon.png", type: "image/png" },
  "/portal/tube-icon.png": { file: "tube-icon.png", type: "image/png" },
  "/portal/music-icon.png": { file: "music-icon.png", type: "image/png" },
  "/portal/cloudmoon-icon.png": { file: "cloudmoon-icon.png", type: "image/png" },
  "/portal/utopia-icon.png": { file: "utopia-icon.png", type: "image/png" },
};
// ブラウザのタブ/ホーム画面アイコンは常に Google 風アイコンを返す
const TAB_ICONS = {
  "/favicon.ico": "/portal/favicon.ico",
  "/apple-touch-icon.png": "/portal/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png": "/portal/apple-touch-icon.png",
};

const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
  timeout: 0,
  proxyTimeout: 0,
  selfHandleResponse: false,
  followRedirects: false,
});

proxy.on("error", (err, req, res) => {
  console.error("[gateway] proxy error:", err.message, req.url);
  if (res && typeof res.writeHead === "function" && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("VYSLO MIX gateway: アプリが起動中です。数秒後に再読み込みしてください。");
  } else if (res && res.destroy) {
    res.destroy();
  }
});

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function currentApp(req) {
  const c = parseCookies(req.headers.cookie)[APP_COOKIE];
  return c && APPS[c] ? c : null;
}

function targetFor(appKey) {
  return { target: "http://127.0.0.1:" + APPS[appKey].port, changeOrigin: true };
}

// プロキシ応答に選択 Cookie を付与 (アプリの Set-Cookie は保持する)
proxy.on("proxyRes", (proxyRes, req) => {
  const appKey = req.__vysloApp;
  if (!appKey) return;
  const cookie =
    APP_COOKIE + "=" + appKey + "; Path=/; Max-Age=31536000; SameSite=Lax";
  const existing = proxyRes.headers["set-cookie"];
  if (existing) {
    proxyRes.headers["set-cookie"] = [...existing, cookie];
  } else {
    proxyRes.headers["set-cookie"] = [cookie];
  }
});

function servePortal(res) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(path.join(PORTAL_DIR, "index.html")).pipe(res);
}

function servePortalFile(req, res, key) {
  const entry = PORTAL_FILES[key || req.url.split("?")[0]];
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type": entry.type,
    "Cache-Control": /\.html$/.test(entry.file) ? "no-store" : "public, max-age=3600",
  });
  fs.createReadStream(path.join(PORTAL_DIR, entry.file)).pipe(res);
}


// ---------------------------------------------------------------
// 同じ端末なら別 URL でも同じアカウントにするための同期 (ID sync)
//   POST /__idsync/put  : 自分のオリジンのブラウザが localStorage の控えを預ける → 1回限りのトークン
//   GET  /__idsync/get?t=: 相手オリジン (許可済み) のブラウザがトークンで受け取る (1回限り・2分で失効)
// ---------------------------------------------------------------
const SYNC_PEERS = (process.env.VYSLO_PEERS ||
  "https://mfmikakann-site-vyslo-mix-10032028.up.railway.app,https://mfmikakann-site-vyslo-mix-2.up.railway.app")
  .split(",").map((s) => s.trim()).filter(Boolean);
const syncStore = new Map();
const SYNC_TTL = 120 * 1000;
const SYNC_MAX = 8 * 1024 * 1024;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of syncStore) if (now - v.at > SYNC_TTL) syncStore.delete(k);
}, 30000).unref();

function handleIdSync(req, res, pathname) {
  const origin = req.headers.origin;
  const cors = {};
  if (origin && SYNC_PEERS.includes(origin)) {
    cors["Access-Control-Allow-Origin"] = origin;
    cors["Vary"] = "Origin";
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, Object.assign({ "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "600" }, cors));
    return res.end();
  }
  if (pathname === "/__idsync/put" && req.method === "POST") {
    // 同一オリジンからのみ受け付ける
    if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") {
      res.writeHead(403); return res.end();
    }
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > SYNC_MAX) { res.writeHead(413); res.end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      const body = Buffer.concat(chunks).toString("utf8");
      try { JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
      if (syncStore.size >= 500) { res.writeHead(503); return res.end(); }
      const token = require("crypto").randomBytes(24).toString("hex");
      syncStore.set(token, { at: Date.now(), body });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ t: token }));
    });
    return;
  }
  if (pathname === "/__idsync/get" && req.method === "GET") {
    const t = new URL(req.url, "http://local").searchParams.get("t") || "";
    const item = syncStore.get(t);
    if (item) syncStore.delete(t);
    if (!item || Date.now() - item.at > SYNC_TTL || !cors["Access-Control-Allow-Origin"]) {
      res.writeHead(404, Object.assign({ "Cache-Control": "no-store" }, cors));
      return res.end();
    }
    res.writeHead(200, Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, cors));
    return res.end(item.body);
  }
  res.writeHead(404); res.end();
}

const EXT_RE=/^(?:[a-z0-9-]+\.)*(?:gstatic\.com|googleapis\.com|firebasedatabase\.app|firebaseio\.com|firebasestorage\.app|jsdelivr\.net|unpkg\.com|spotify\.com|scdn\.co|spotifycdn\.com|akamaized\.net)$/i;
const EXT_TXT=/https?:\/\/((?:[a-z0-9-]+\.)*(?:gstatic\.com|googleapis\.com|firebasedatabase\.app|firebaseio\.com|firebasestorage\.app|jsdelivr\.net|unpkg\.com|spotify\.com|scdn\.co|spotifycdn\.com|akamaized\.net))(?=[\/"'`\s?#)\\;,]|$)/gi;
const EXT_WSS=/wss?:\/\/((?:[a-z0-9-]+\.)*(?:spotify\.com|scdn\.co|spotifycdn\.com|akamaized\.net))(?=[\/"'`\s?#)\\;,]|$)/gi;
const EXT_UP="https://vyslo-mix-chat10041958.edgeone.dev";
function extBase(req){const h=String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0].trim();let p=String(req.headers["x-forwarded-proto"]||"").split(",")[0].trim();if(!p)p=/^(localhost|127\.)/.test(h)?"http":"https";return p+"://"+h}
function extRw(t,b){return t.replace(EXT_TXT,(m,h)=>b+"/__x/"+h.toLowerCase()).replace(EXT_WSS,(m,h)=>{const proto=b.startsWith("https")?"wss":"ws";return proto+"://"+b.replace(/^https?:\/\//,"")+"/__x/"+h.toLowerCase()})}
async function handleExt(req,res){const m=req.url.match(/^\/__x\/([^\/?#]+)(.*)$/);if(!m||!EXT_RE.test(m[1])){res.writeHead(403);return res.end()}
const base=extBase(req),url="https://"+m[1].toLowerCase()+(m[2]&&m[2][0]!=="/"?"/"+m[2]:(m[2]||"/"));const h={};
for(const k of Object.keys(req.headers)){if(/^(if-none-match|if-modified-since|host|cookie|connection|upgrade|origin|referer|accept-encoding|content-length|transfer-encoding|keep-alive|te|trailer|proxy-.*|sec-fetch-.*|x-forwarded-(host|proto|port)|x-railway-.*)$/i.test(k))continue;h[k]=req.headers[k]}
h.origin=EXT_UP;h.referer=EXT_UP+"/";
// Spotify系ドメインは適切なOrigin/Refererを設定
if(/\.spotify\.com$|\.scdn\.co$|\.spotifycdn\.com$|\.akamaized\.net$/.test(m[1].toLowerCase())){h.origin="https://open.spotify.com";h.referer="https://open.spotify.com/"}
let body;if(req.method!=="GET"&&req.method!=="HEAD"){const c=[];for await(const x of req)c.push(x);body=Buffer.concat(c)}
const r=await fetch(url,{method:req.method,headers:h,body,redirect:"manual"});const o={};
r.headers.forEach((v,k)=>{if(/^(content-security-policy.*|x-frame-options|content-encoding|content-length|set-cookie|etag|last-modified|transfer-encoding|connection|access-control-.*|strict-transport-security|alt-svc|cross-origin-.*)$/i.test(k))return;o[k]=v});
if(o.location){if(o.location.startsWith("/")&&!o.location.startsWith("/__x/")){o.location="/__x/"+m[1].toLowerCase()+o.location}else{o.location=extRw(o.location,base)}}const ct=r.headers.get("content-type")||"";
if(req.method!=="HEAD"&&r.body&&/javascript|text\/css|text\/html|json/i.test(ct)){const t=extRw(await r.text(),base);o["cache-control"]="no-store, max-age=0";o["content-length"]=Buffer.byteLength(t);res.writeHead(r.status,o);return res.end(t)}
res.writeHead(r.status,o);if(!r.body||req.method==="HEAD")return res.end();require("stream").Readable.fromWeb(r.body).on("error",()=>res.destroy()).pipe(res)}

const VYSLO_PRIMARY_HOST = process.env.VYSLO_REDIRECT === "0" ? "" :
  String(process.env.VYSLO_PRIMARY_HOST || "mfmikakann-site-vyslo-mix-10032028.up.railway.app").toLowerCase();
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
  } catch (e) {
    pathname = "/";
  }

  // ---- 全URLで同じ CHAT ユーザーにする: メインURL以外は即メインURLへ転送 ----
  // (アカウントは URL ごとに保存されるため、メインURLに統一して常に同じユーザーにする)
  if (pathname !== "/version" && VYSLO_PRIMARY_HOST) {
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
    if (host && host !== VYSLO_PRIMARY_HOST && !/^(localhost|127\.|10\.|\[|healthcheck\.railway\.app)/.test(host)) {
      const dest = String(req.headers["sec-fetch-dest"] || "");
      const to = "https://" + VYSLO_PRIMARY_HOST + req.url;
      // 古い Service Worker が残っていると読み込みが止まるので、自動で解除させる
      if (/^\/(graph|service-worker|sw|firebase-messaging-sw)\.js$/.test(pathname)) {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Service-Worker-Allowed": "/" });
        return res.end("self.addEventListener('install',function(){self.skipWaiting()});self.addEventListener('activate',function(e){e.waitUntil(self.registration.unregister().then(function(){return self.clients.matchAll({type:'window'})}).then(function(cs){cs.forEach(function(c){try{c.navigate(" + JSON.stringify("https://" + VYSLO_PRIMARY_HOST + "/") + ")}catch(x){}})}))});self.addEventListener('fetch',function(){});");
      }
      // iframe の中で開かれた場合は、ページ全体をメイン URL に切り替える
      if (dest === "iframe" || dest === "frame") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end('<!doctype html><meta charset="utf-8"><script>try{top.location.replace(' + JSON.stringify(to) + ')}catch(e){location.replace(' + JSON.stringify(to) + ')}</script><a href="' + to.replace(/"/g, "&quot;") + '" target="_top">開く</a>');
      }
      res.writeHead(302, { Location: to, "Cache-Control": "no-store", "Clear-Site-Data": "\"cache\"" });
      return res.end();
    }
  }

  // チャット: サーバー経由で埋め込み元を表示 (URL 直下で配信)
  {
    const dest = req.headers["sec-fetch-dest"];
    const isEmbed = /^\/api\/public\/embed(\/|$)/.test(pathname);
    const isRoot = pathname === "/" || pathname === "/index.html";
    let chat = isEmbed;
    if (!chat && currentApp(req) === "chat" && !/^\/(__x|__idsync|portal|version)(\/|$)/.test(pathname) && !TAB_ICONS[pathname] && !APPS[pathname.split("/")[1]]) {
      chat = isRoot ? (dest === "iframe" || (!dest && !/[?&]app=/.test(req.url))) : dest !== "document";
    }
    if (chat) {
      if (!isEmbed && /^\/(service-worker|firebase-messaging-sw)\.js$/.test(pathname)) { res.writeHead(404, { "Cache-Control": "no-store" }); return res.end(); }
      if (!isEmbed) req.url = "/api/public/embed" + req.url;
      req.__vysloApp = "chat";
      return proxy.web(req, res, targetFor("chat"));
    }
  }
  // ヘルスチェック (Railway)
  if (pathname === "/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ name: "VYSLO MIX", version: "1.0.0", apps: Object.keys(APPS) }));
  }

  // デバッグ: チャットサーバーの状態を確認
  if (pathname === "/debug-chat") {
    const http = require("http");
    const req2 = http.get("http://127.0.0.1:8003/", { timeout: 3000 }, (r) => {
      let body = "";
      r.on("data", (c) => body += c);
      r.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", code: r.statusCode, body: body.substring(0, 200) }));
      });
    });
    req2.on("error", (e) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", message: e.message }));
    });
    req2.on("timeout", () => {
      req2.destroy();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "timeout" }));
    });
    return;
  }

  if (pathname.startsWith("/__x/")) { handleExt(req, res).catch((e) => { console.error("[ext]", e.message, req.url); if (!res.headersSent) res.writeHead(502); res.end(); }); return; }
  if (pathname.startsWith("/__idsync/")) {
    return handleIdSync(req, res, pathname);
  }

  // タブアイコン (どのアプリを開いていても Google 風)
  if (TAB_ICONS[pathname]) {
    return servePortalFile(req, res, TAB_ICONS[pathname]);
  }

  // ポータルの静的ファイル
  if (pathname.startsWith("/portal/")) {
    return servePortalFile(req, res);
  }

  // 各アプリのエントリパス: Cookie を設定してポータル (?app=) へリダイレクト
  // (アプリは直下の "/" で動作する想定のため、プレフィックス付きパスでは開かない)
  for (const key of Object.keys(APPS)) {
    if (pathname === "/" + key || pathname === "/" + key + "/" || pathname.startsWith("/" + key + "/")) {
      res.writeHead(302, {
        Location: "/?app=" + key,
        "Set-Cookie": APP_COOKIE + "=" + key + "; Path=/; Max-Age=31536000; SameSite=Lax",
      });
      return res.end();
    }
  }

  // ルート: 選択画面。ただしアプリ内 iframe やアプリからの同一サイト遷移はアプリのルートへ
  if (pathname === "/" || pathname === "/index.html") {
    const appKey = currentApp(req);
    const dest = req.headers["sec-fetch-dest"];
    const hasAppQuery = /[?&]app=/.test(req.url);
    // トップレベル (タブ) は常にポータル → タブ名/アイコンは常に Google。
    // iframe 内からの読み込みのみアプリへ転送。
    const fromApp = appKey && (dest === "iframe" || (!dest && !hasAppQuery));
    if (fromApp) {
      req.__vysloApp = appKey;
      return proxy.web(req, res, targetFor(appKey));
    }
    return servePortal(res);
  }

  // それ以外: Cookie でルーティング (アプリ内部の絶対パスリクエスト)
  const appKey = currentApp(req);

  // タブ (トップレベル) で直接アプリのページが開かれた場合は、ポータルで包んで表示
  // → タブ名/アイコンは常に Google のまま。ダウンロード/静的/API は対象外。
  if (
    appKey &&
    req.method === "GET" &&
    req.headers["sec-fetch-dest"] === "document" &&
    !/^\/(static|api|proxy|thumb|photo|img|dl|download|_build|assets|math|run-site|classes)(\/|$)/.test(pathname)
  ) {
    res.writeHead(302, {
      Location: "/?app=" + appKey + "&p=" + encodeURIComponent(req.url),
      "Cache-Control": "no-store",
    });
    return res.end();
  }
  if (appKey) {
    req.__vysloApp = appKey;
    return proxy.web(req, res, targetFor(appKey));
  }

  res.writeHead(302, { Location: "/" });
  res.end();
});

// WebSocket (ライブ配信のチャット等) も Cookie でルーティング
server.on("upgrade", (req, socket, head) => {
  { const m = req.url.match(/^\/__x\/([^\/?#]+)(.*)$/); if (m) { if (!EXT_RE.test(m[1])) return socket.destroy(); req.url = m[2] || "/"; const host=m[1].toLowerCase(); if(/\.spotify\.com$|\.scdn\.co$|\.spotifycdn\.com$|\.akamaized\.net$/.test(host)){req.headers.origin="https://open.spotify.com"}else{req.headers.origin=EXT_UP} return proxy.ws(req, socket, head, { target: "https://" + host, changeOrigin: true }); } }
  const appKey = currentApp(req);
  if (appKey) {
    proxy.ws(req, socket, head, targetFor(appKey));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log("[gateway] VYSLO MIX listening on port", PORT);
});
