/**
 * VYSLO TALK server
 * -----------------
 * - GET  /                    : 通話アプリ (index.html)
 * - GET  /talk-api/config     : WebRTC の ICE サーバー設定
 * - POST /talk-api/ticket     : 入室チケットの発行 (ユーザーの秘密キー → 内部ユーザーID)
 * - GET  /talk-api/events     : 通話部屋のイベント (Server-Sent Events)
 * - POST /talk-api/send       : 信号 / チャット / 状態 / リアクション / 生存確認 / 退出
 * - POST /talk-api/mod        : モデレーター操作 (権限はすべてサーバーで確認)
 * - POST /talk-api/knock      : 入室待ちの人がパスワードで入る
 * - POST /talk-api/dev        : 開発者用コマンド (TALK_DEV_KEY を知っている人だけ)
 *
 * 外部ライブラリなし (Node 標準モジュールのみ)。映像・音声は参加者どうしが直接 (P2P) つながり、
 * このサーバーは「つなぐための合図」と部屋の管理だけを行う。
 *
 * 環境変数:
 *   PORT              : 待ち受けポート (既定 8006)
 *   TALK_MAX_PEERS    : 1 部屋の最大人数 (既定 8)
 *   TALK_ICE_SERVERS  : 追加の ICE (TURN) サーバー JSON
 *   TALK_DEV_KEY      : 開発者用コマンドのキー (未設定なら開発者用コマンドは無効)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8006", 10);
const MAX_PEERS = Math.max(2, parseInt(process.env.TALK_MAX_PEERS || "8", 10));
const DEV_KEY = String(process.env.TALK_DEV_KEY || "");
const INDEX = path.join(__dirname, "index.html");

const STALE_MS = 40 * 1000;          // 生存確認がこれ以上ない参加者は切断扱い
const ROOM_GRACE_MS = 3 * 60 * 1000; // 全員いなくなってから部屋情報 (作成者・パスワード) を残す時間
const TICKET_MS = 60 * 1000;
const REACTIONS = ["👍", "👏", "😂", "😮", "❤️", "🎉", "🙏", "🔥"];

let ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
if (process.env.TALK_ICE_SERVERS) {
  try {
    const extra = JSON.parse(process.env.TALK_ICE_SERVERS);
    if (Array.isArray(extra)) ICE_SERVERS = ICE_SERVERS.concat(extra);
  } catch (e) {
    console.error("[talk] TALK_ICE_SERVERS が JSON として読めません:", e.message);
  }
}

// 招待コード: 英数字・ひらがな・カタカナ・漢字 (自分で決める合言葉は 6 文字まで、自動作成は英数字 10 文字)
const ROOM_RE = /^[a-z0-9\u3041-\u3096\u30a1-\u30fa\u30fc\u3005\u3006\u4e00-\u9fff]{1,32}$/u;
function normRoom(v) {
  return String(v || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}
const SECRET_RE = /^[a-f0-9]{32,64}$/;
const TAB_RE = /^[a-z0-9]{8,40}$/;

/**
 * room = { code, peers: Map<id, peer>, lobby: Map<id, peer>, mods: Set<userId>, owner, password,
 *          banned: Set<userId>, startedAt, emptySince }
 * peer = { id, token, userId, tab, name, res, state, lastSeen, joinedAt, inRoom, ping, reason }
 */
const rooms = new Map();
const tickets = new Map();
const devFails = new Map(); // ip -> { n, until }

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
function safeEq(a, b) {
  const A = Buffer.from(sha("cmp:" + a), "hex");
  const B = Buffer.from(sha("cmp:" + b), "hex");
  return crypto.timingSafeEqual(A, B);
}
const rid = (n) => crypto.randomBytes(n).toString("hex");

function sse(p, event, data) {
  if (!p || !p.res || p.res.writableEnded) return;
  try { p.res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"); } catch (e) {}
}
function broadcast(room, event, data, exceptId) {
  for (const p of room.peers.values()) if (p.id !== exceptId) sse(p, event, data);
}
function presentMods(room) {
  return Array.from(room.peers.values()).filter((p) => room.mods.has(p.userId));
}
function notifyMods(room, event, data) {
  for (const p of presentMods(room)) sse(p, event, data);
}
function pub(p) {
  return { id: p.id, userId: p.userId, tag: p.userId.slice(0, 4), name: p.name, state: p.state, joinedAt: p.joinedAt };
}
function roomInfo(room) {
  return { mods: Array.from(room.mods), owner: room.owner, hasPassword: !!room.password, startedAt: room.startedAt };
}
function sendRoomInfo(room) { broadcast(room, "room", roomInfo(room)); }
function knockInfo(p) { return { id: p.id, userId: p.userId, tag: p.userId.slice(0, 4), name: p.name, reason: p.reason }; }

function cleanName(s) {
  s = String(s || "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 30);
  return s || "ゲスト";
}
function json(res, status, obj) {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readJson(req, res, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 128 * 1024) { json(res, 413, { error: "too large" }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let m;
    try { m = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return json(res, 400, { error: "bad json" }); }
    cb(m || {});
  });
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

/** 認証: 部屋・接続ID・トークンが一致する参加者 (入室待ちを含む) を返す */
function auth(m) {
  const room = rooms.get(normRoom(m.room));
  if (!room) return null;
  const id = String(m.id || "");
  const p = room.peers.get(id) || room.lobby.get(id);
  if (!p || typeof m.token !== "string" || !safeEq(p.token, m.token)) return null;
  p.lastSeen = Date.now();
  return { room, me: p };
}

// ---------------- 入退室 ----------------
function admit(room, p) {
  const wasLobby = room.lobby.delete(p.id);
  if (wasLobby) notifyMods(room, "knock-end", { id: p.id });
  p.inRoom = true;
  p.joinedAt = Date.now();
  p.reason = null;
  room.peers.set(p.id, p);
  room.admitted.add(p.userId); // 一度入室した人は、通信が切れて入り直すときに許可・パスワードはいらない
  room.emptySince = 0;
  if (!room.startedAt) room.startedAt = Date.now();
  let modsChanged = false;
  if (presentMods(room).length === 0) { room.mods.add(p.userId); modsChanged = true; }

  const others = Array.from(room.peers.values()).filter((q) => q.id !== p.id).map(pub);
  sse(p, "welcome", { id: p.id, token: p.token, userId: p.userId, peers: others, room: roomInfo(room), now: Date.now(), max: MAX_PEERS });
  broadcast(room, "join", pub(p), p.id);
  if (modsChanged) sendRoomInfo(room);
  if (room.mods.has(p.userId)) for (const q of room.lobby.values()) sse(p, "knock", knockInfo(q));
}

function toLobby(room, p, reason) {
  p.reason = reason;
  room.lobby.set(p.id, p);
  sse(p, "lobby", { id: p.id, token: p.token, reason, hasMods: presentMods(room).length > 0 });
  notifyMods(room, "knock", knockInfo(p));
}

function drop(room, p, replacing) {
  if (p.dropped) return;
  p.dropped = true;
  clearInterval(p.ping);
  const inRoom = room.peers.get(p.id) === p;
  const inLobby = room.lobby.get(p.id) === p;
  if (inRoom) room.peers.delete(p.id);
  if (inLobby) room.lobby.delete(p.id);
  try { p.res.end(); } catch (e) {}
  if (inRoom) {
    broadcast(room, "leave", { id: p.id });
    // その場にモデレーターがいなくなったら、いちばん長くいる人をモデレーターにする
    if (!replacing && room.peers.size > 0 && presentMods(room).length === 0) {
      const oldest = Array.from(room.peers.values()).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      room.mods.add(oldest.userId);
      sendRoomInfo(room);
    }
  }
  if (inLobby) notifyMods(room, "knock-end", { id: p.id });
  if (room.peers.size === 0 && room.lobby.size === 0) room.emptySince = Date.now();
}

function handleTicket(req, res) {
  readJson(req, res, (m) => {
    const code = normRoom(m.room);
    const secret = String(m.secret || "").toLowerCase();
    const tab = String(m.tab || "").toLowerCase();
    if (!ROOM_RE.test(code)) return json(res, 400, { error: "bad room" });
    if (!SECRET_RE.test(secret) || !TAB_RE.test(tab)) return json(res, 400, { error: "bad identity" });
    const userId = sha("vyslo-talk-user:" + secret).slice(0, 24);
    const ticket = rid(16);
    tickets.set(ticket, {
      code, userId, tab, name: cleanName(m.name),
      password: typeof m.password === "string" ? m.password.slice(0, 64) : "",
      create: !!m.create,
      takeover: !!m.takeover,
      exp: Date.now() + TICKET_MS,
    });
    json(res, 200, { ticket, userId });
  });
}

function handleEvents(req, res, url) {
  const t = tickets.get(String(url.searchParams.get("ticket") || ""));
  if (t) tickets.delete(String(url.searchParams.get("ticket")));

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.write("retry: 600000\n\n");
  const once = (ev, data) => { try { res.write("event: " + ev + "\ndata: " + JSON.stringify(data || {}) + "\n\n"); } catch (e) {} res.end(); };
  if (!t || t.exp < Date.now()) return once("expired");

  let room = rooms.get(t.code);
  // 「新しい通話を作成」で、すでに使われている合言葉を選んだとき
  if (t.create && room && room.owner !== t.userId && (room.peers.size > 0 || room.lobby.size > 0 || (room.emptySince && Date.now() - room.emptySince < ROOM_GRACE_MS))) {
    return once("taken");
  }
  if (!room) {
    room = { code: t.code, peers: new Map(), lobby: new Map(), mods: new Set(), owner: null, password: "", banned: new Set(), admitted: new Set(), startedAt: 0, emptySince: Date.now() };
    rooms.set(t.code, room);
  }

  // 同じユーザーの二重参加チェック (同じタブの再接続・切断済みの古い接続は置き換える)
  const now = Date.now();
  for (const q of [...room.peers.values(), ...room.lobby.values()]) {
    if (q.userId !== t.userId) continue;
    const stale = now - q.lastSeen > STALE_MS || q.res.writableEnded || q.res.destroyed;
    if (q.tab === t.tab || stale) drop(room, q, true);
    else if (t.takeover) { sse(q, "replaced", {}); drop(room, q, true); } // 本人が「このタブで参加し直す」を選んだとき
    else return once("duplicate");
  }
  if (room.peers.size >= MAX_PEERS) return once("full", { max: MAX_PEERS });

  const p = {
    id: rid(8), token: rid(16), userId: t.userId, tab: t.tab, name: t.name, res,
    state: { mic: true, cam: true, screen: false, hand: false },
    lastSeen: now, joinedAt: now, inRoom: false, reason: null, dropped: false,
  };
  p.ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 15000);
  const bye = () => drop(room, p);
  req.on("close", bye);
  res.on("close", bye);
  res.on("error", bye);

  const fresh = room.peers.size === 0 && !room.owner;
  if (fresh) {
    room.owner = t.userId;
    room.mods.add(t.userId);
    if (t.password) room.password = t.password;
    return admit(room, p);
  }
  if (room.mods.has(t.userId)) return admit(room, p);              // 作成者・モデレーターの再入室
  if (room.banned.has(t.userId)) return toLobby(room, p, "kicked"); // 強制退出された人は許可制
  if (room.admitted.has(t.userId)) return admit(room, p);           // 入室済みの人の再接続
  if (room.password && !(t.password && safeEq(t.password, room.password))) return toLobby(room, p, "password");
  return admit(room, p);
}

// ---------------- 送信 ----------------
function handleSend(req, res) {
  readJson(req, res, (m) => {
    const a = auth(m);
    if (!a) return json(res, 403, { error: "not in room" });
    const { room, me } = a;
    const type = String(m.type || "");
    if (type === "ping") {
      return json(res, 200, { ok: true, inRoom: me.inRoom, peers: me.inRoom ? Array.from(room.peers.values()).filter((q) => q.id !== me.id).map(pub) : [] });
    }
    if (type === "leave") { drop(room, me); return json(res, 200, { ok: true }); }
    if (!me.inRoom) return json(res, 403, { error: "waiting" });

    let data = m.data || {};
    let to = null;
    if (m.to) {
      to = room.peers.get(String(m.to));
      if (!to) return json(res, 404, { error: "no peer" });
    }

    if (type === "signal") {
      if (!to) return json(res, 400, { error: "no target" });
      sse(to, "msg", { from: me.id, type, data });
      return json(res, 200, { ok: true });
    }
    if (type === "chat") {
      const text = String(data.text || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 500);
      if (!text) return json(res, 400, { error: "empty" });
      const msg = { from: me.id, type, data: { text, name: me.name, at: Date.now(), private: !!to, to: to ? to.id : null } };
      if (to) sse(to, "msg", msg); else broadcast(room, "msg", msg, me.id);
      return json(res, 200, { ok: true });
    }
    if (type === "state") {
      me.state = { mic: !!data.mic, cam: !!data.cam, screen: !!data.screen, hand: !!data.hand };
      broadcast(room, "msg", { from: me.id, type, data: me.state }, me.id);
      return json(res, 200, { ok: true });
    }
    if (type === "reaction") {
      if (REACTIONS.indexOf(data.emoji) < 0) return json(res, 400, { error: "bad reaction" });
      const now = Date.now();
      if (me.lastReact && now - me.lastReact < 300) return json(res, 429, { error: "slow down" });
      me.lastReact = now;
      broadcast(room, "msg", { from: me.id, type, data: { emoji: data.emoji } }, me.id);
      return json(res, 200, { ok: true });
    }
    json(res, 400, { error: "bad type" });
  });
}

// ---------------- モデレーター操作 ----------------
function handleMod(req, res) {
  readJson(req, res, (m) => {
    const a = auth(m);
    if (!a || !a.me.inRoom) return json(res, 403, { error: "not in room" });
    const { room, me } = a;
    if (!room.mods.has(me.userId)) return json(res, 403, { error: "not moderator" });

    const action = String(m.action || "");
    if (action === "password") {
      room.password = typeof m.value === "string" ? m.value.slice(0, 64) : "";
      sendRoomInfo(room);
      return json(res, 200, { ok: true, hasPassword: !!room.password });
    }

    const tid = String(m.target || "");
    if (action === "admit" || action === "deny") {
      const t = room.lobby.get(tid);
      if (!t) return json(res, 404, { error: "no such request" });
      if (action === "deny") { sse(t, "denied", { by: me.name }); drop(room, t); return json(res, 200, { ok: true }); }
      if (room.peers.size >= MAX_PEERS) return json(res, 409, { error: "full" });
      room.banned.delete(t.userId);
      admit(room, t);
      return json(res, 200, { ok: true });
    }

    const t = room.peers.get(tid);
    if (!t) return json(res, 404, { error: "no peer" });
    const protectedOwner = t.userId === room.owner && me.userId !== room.owner;

    switch (action) {
      case "promote":
        room.mods.add(t.userId);
        sendRoomInfo(room);
        return json(res, 200, { ok: true });
      case "demote": {
        if (protectedOwner) return json(res, 403, { error: "owner" });
        const others = presentMods(room).filter((q) => q.userId !== t.userId);
        if (others.length === 0) return json(res, 409, { error: "last moderator" });
        room.mods.delete(t.userId);
        sendRoomInfo(room);
        return json(res, 200, { ok: true });
      }
      case "kick":
        if (t.id === me.id) return json(res, 400, { error: "self" });
        if (protectedOwner) return json(res, 403, { error: "owner" });
        room.banned.add(t.userId);
        room.admitted.delete(t.userId);
        if (t.userId !== room.owner) room.mods.delete(t.userId);
        sse(t, "kicked", { by: me.name });
        drop(room, t);
        sendRoomInfo(room);
        return json(res, 200, { ok: true });
      case "mic":
      case "cam":
      case "screen":
      case "hand":
        if (action !== "hand" && protectedOwner) return json(res, 403, { error: "owner" });
        t.state = Object.assign({}, t.state, { [action]: false });
        sse(t, "force", { what: action, by: me.name });
        broadcast(room, "msg", { from: t.id, type: "state", data: t.state }, t.id);
        return json(res, 200, { ok: true });
    }
    json(res, 400, { error: "bad action" });
  });
}

function handleKnock(req, res) {
  readJson(req, res, (m) => {
    const a = auth(m);
    if (!a) return json(res, 403, { error: "not waiting" });
    const { room, me } = a;
    if (me.inRoom) return json(res, 200, { ok: true });
    if (me.reason !== "password" || !room.password) return json(res, 403, { error: "approval required" });
    if (typeof m.password !== "string" || !safeEq(m.password.slice(0, 64), room.password)) return json(res, 403, { error: "wrong password" });
    if (room.peers.size >= MAX_PEERS) return json(res, 409, { error: "full" });
    admit(room, me);
    json(res, 200, { ok: true });
  });
}

// ---------------- 開発者用コマンド ----------------
function handleDev(req, res) {
  readJson(req, res, (m) => {
    const ip = clientIp(req);
    const f = devFails.get(ip);
    if (f && f.n >= 5 && f.until > Date.now()) return json(res, 429, { error: "locked" });
    const a = auth(m);
    if (!a || !a.me.inRoom) return json(res, 403, { error: "not in room" });
    if (!DEV_KEY || typeof m.key !== "string" || !safeEq(m.key, DEV_KEY)) {
      const cur = f && f.until > Date.now() ? f : { n: 0, until: 0 };
      cur.n += 1;
      cur.until = Date.now() + 10 * 60 * 1000;
      devFails.set(ip, cur);
      console.warn("[talk] 開発者コマンドの認証に失敗しました ip=" + ip);
      return json(res, 403, { error: "forbidden" });
    }
    devFails.delete(ip);
    const { room, me } = a;
    const cmd = String(m.cmd || "");
    if (cmd === "check") return json(res, 200, { ok: true });
    if (cmd === "mod") {
      room.mods.add(me.userId);
      sendRoomInfo(room);
      console.log("[talk] 開発者がモデレーター権限を有効にしました room=" + room.code);
      return json(res, 200, { ok: true });
    }
    json(res, 400, { error: "bad command" });
  });
}

// ---------------- 掃除 (切断された参加者・空き部屋) ----------------
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const p of [...room.peers.values(), ...room.lobby.values()]) {
      if (now - p.lastSeen > STALE_MS || p.res.destroyed || p.res.writableEnded) drop(room, p);
    }
    if (room.peers.size === 0 && room.lobby.size === 0 && room.emptySince && now - room.emptySince > ROOM_GRACE_MS) rooms.delete(code);
  }
  for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k);
  for (const [k, f] of devFails) if (f.until < now) devFails.delete(k);
}, 10000).unref();

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://local"); } catch (e) { res.writeHead(400); return res.end(); }
  const p = url.pathname;
  const post = req.method === "POST";

  if (p === "/talk-api/config" && req.method === "GET") return json(res, 200, { iceServers: ICE_SERVERS, max: MAX_PEERS, reactions: REACTIONS });
  if (p === "/talk-api/ticket" && post) return handleTicket(req, res);
  if (p === "/talk-api/events" && req.method === "GET") return handleEvents(req, res, url);
  if (p === "/talk-api/send" && post) return handleSend(req, res);
  if (p === "/talk-api/mod" && post) return handleMod(req, res);
  if (p === "/talk-api/knock" && post) return handleKnock(req, res);
  if (p === "/talk-api/dev" && post) return handleDev(req, res);
  if (p === "/talk-api/health") return json(res, 200, { ok: true, rooms: rooms.size });

  if ((p === "/" || p === "/index.html") && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(INDEX).pipe(res);
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log("[talk] VYSLO TALK listening on port " + PORT + (DEV_KEY ? " (開発者コマンド有効)" : ""));
});
