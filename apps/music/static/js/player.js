/* Vyslo Music — Player (登録不要版)
 * 再生の流れ:
 *   1. 曲を再生 → サーバーが曲名+アーティスト名からSpotifyの曲IDを探す (/api/resolve)
 *   2. 見つかったら Spotify公式埋め込みプレーヤー(iFrame API)をその曲で呼び出して再生
 *   3. 見つからない曲は Apple の30秒試聴で再生 / ポッドキャストは配信元の音声をそのまま再生
 */
(function () {
  'use strict';

  const S = {
    queue: [], index: -1, ctx: null,
    playing: false, pos: 0, dur: 0,
    shuffle: false, repeat: 'off',
    orig: null,          // シャッフル前の曲順 (解除したら元に戻すため)
    engine: null,        // 'embed' | 'audio'
    source: null,        // 'spotify' | 'preview' | 'podcast'
    resolving: false,
    loading: false,      // 再生ボタンを押してから音が出るまで
    volume: 80,
    muted: false,        // ミュート中 (volume は元の値を覚えておく)
    volFixed: false,     // iPhone/iPad など、ページから音量を変えられない端末
    posAt: 0,            // pos を更新した時刻 (歌詞の同期で、更新の間を補うため)
    current: null,
  };
  const subs = new Set();
  const emit = (why) => subs.forEach((f) => { try { f(S, why); } catch (e) { console.error(e); } });
  let hooks = { onTrackStart: null, toast: null };
  const toast = (m, err) => hooks.toast && hooks.toast(m, err);
  let playToken = 0;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error('load ' + src));
      document.head.appendChild(s);
    });
  }

  /* ── Spotify ID 解決 (結果はブラウザにも保存) ── */
  const RCACHE_KEY = 'vm-resolve2'; // 旧キャッシュ(見つからなかった記録)は使わない
  try { localStorage.removeItem('vm-resolve'); } catch (e) {}
  let rcache = {};
  try { rcache = JSON.parse(localStorage.getItem(RCACHE_KEY) || '{}'); } catch (e) {}
  const saveR = () => { try { const k = Object.keys(rcache); if (k.length > 3000) k.slice(0, 1000).forEach((x) => delete rcache[x]); localStorage.setItem(RCACHE_KEY, JSON.stringify(rcache)); } catch (e) {} };
  const inflight = {};
  // 戻り値: Spotifyの候補URI配列 (先頭が最有力) / 見つからなければ []
  function resolve(item) {
    if (!item || item.type !== 'track') return Promise.resolve([]);
    if (item.uri && item.uri.startsWith('spotify:track:')) return Promise.resolve([item.uri]);
    const k = item.uri;
    const c = rcache[k];
    if (Array.isArray(c) && c.length) return Promise.resolve(c);
    if (c !== undefined && !(Array.isArray(c) ? c.length : c) && Date.now() - (rcache[k + '#t'] || 0) < 3 * 3600e3) return Promise.resolve([]);
    if (typeof c === 'string' && c) return Promise.resolve([c]);
    if (inflight[k]) return inflight[k];
    const a = (item.artists && item.artists[0]) || {};
    const qs = new URLSearchParams({ track: item.name || '', artist: a.name || '', album: (item.album && item.album.name) || '', id: item.id || '', aid: a.id || '', duration: item.duration_ms || 0 });
    const once = () => {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 16000);
      return fetch('/api/resolve?' + qs, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
        .finally(() => clearTimeout(to));
    };
    // 通信エラー時は1回だけ再試行
    inflight[k] = once().catch((e) => (e && e.name === 'AbortError' ? Promise.reject(e) : new Promise((r) => setTimeout(r, 800)).then(once)))
      .then((j) => {
        const list = j.uri ? [j.uri, ...(j.alts || [])] : [];
        rcache[k] = list; if (!list.length) rcache[k + '#t'] = Date.now(); saveR();
        return list;
      })
      .catch(() => [])
      .finally(() => { delete inflight[k]; });
    return inflight[k];
  }

  /* ── フル音源 (サーバー経由。Spotify/YouTube が使えない環境でも最後まで再生できる) ── */
  const FCACHE_KEY = 'vm-full';
  let fcache = {};
  try { fcache = JSON.parse(localStorage.getItem(FCACHE_KEY) || '{}'); } catch (e) {}
  const saveF = () => { try { const k = Object.keys(fcache); if (k.length > 3000) k.slice(0, 1000).forEach((x) => delete fcache[x]); localStorage.setItem(FCACHE_KEY, JSON.stringify(fcache)); } catch (e) {} };
  const finflight = {};
  function resolveFull(item) {
    if (!item || item.type !== 'track' || !item.name) return Promise.resolve(null);
    const k = item.uri;
    const c = fcache[k];
    if (c && c.v && Date.now() - c.t < 7 * 86400e3) return Promise.resolve(`/api/full/stream/${c.v}`);
    if (c && !c.v && Date.now() - c.t < 1800e3) return Promise.resolve(null);
    if (finflight[k]) return finflight[k];
    const a = (item.artists && item.artists[0]) || {};
    const qs = new URLSearchParams({ track: item.name || '', artist: a.name || '', id: item.id || '', aid: a.id || '', duration: item.duration_ms || 0 });
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 28000);
    finflight[k] = fetch('/api/full?' + qs, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : r.status === 404 ? { vid: null } : Promise.reject(new Error('http ' + r.status))))
      .then((j) => { fcache[k] = { v: j.vid || null, t: Date.now() }; saveF(); return j.vid ? `/api/full/stream/${j.vid}` : null; })
      .catch(() => null)
      .finally(() => { clearTimeout(to); delete finflight[k]; });
    return finflight[k];
  }
  function dropFull(item) { if (item && item.uri) { fcache[item.uri] = { v: null, t: Date.now() }; saveF(); } }

  /* ── Engine: Spotify 公式埋め込み (iFrame API) ── */
  const Embed = {
    ctrl: null, ready: null, ended: false, nearEnd: false, lastUri: null, started: null, loadAt: 0, gotPlay: false,
    init() {
      if (this.ready) return this.ready;
      this.ready = new Promise((resolveP, reject) => {
        const t = setTimeout(() => reject(new Error('embed api timeout')), 20000);
        const create = (IFrameAPI) => {
          const host = document.getElementById('embedHost');
          IFrameAPI.createController(host, { width: '100%', height: 80, uri: 'spotify:track:3dPtXHP0oXQ4HCWHsOA9js' }, (ctrl) => {
            clearTimeout(t);
            this.ctrl = ctrl;
            ctrl.addListener('playback_update', (e) => this.onUpdate(e.data || {}));
            resolveP(ctrl);
          });
        };
        if (window.__spIFrameAPI) create(window.__spIFrameAPI);
        else window.onSpotifyIframeApiReady = (api) => { window.__spIFrameAPI = api; create(api); };
        loadScript('/__x/open.spotify.com/embed/iframe-api/v1').catch(() => loadScript('https://open.spotify.com/embed/iframe-api/v1')).catch((e) => { clearTimeout(t); reject(e); });
      }).catch((e) => { this.ready = null; throw e; });
      return this.ready;
    },
    onUpdate(d) {
      if (S.engine !== 'embed') return;
      const paused = !!d.isPaused, pos = d.position || 0, dur = d.duration || 0;
      // 読み込み直後に届く前の曲の通知は無視する
      if (!this.gotPlay) {
        if (!paused && Date.now() - this.loadAt > 250 && pos < 8000) { this.gotPlay = true; S.loading = false; this.vol(effVol()); }
        else { if (Date.now() - this.loadAt > 2500) { S.playing = false; S.pos = pos; S.dur = dur; emit('progress'); } return; }
      }
      S.playing = !paused; S.pos = pos; S.dur = dur; S.posAt = performance.now();
      if (!paused && S.current && this.started !== this.lastUri) { this.started = this.lastUri; hooks.onTrackStart && hooks.onTrackStart(S.current); }
      if (dur > 0 && !S.ctx) {
        if (!paused) this.nearEnd = dur - pos < 1500;
        const fin = (!paused && pos >= dur - 250) || (paused && this.nearEnd && (pos === 0 || pos >= dur - 300));
        if (fin && !this.ended) { this.ended = true; setTimeout(() => P.onEnded(), 150); }
      }
      emit('progress');
    },
    async load(uri) {
      await this.init();
      this.ended = false; this.nearEnd = false; this.lastUri = uri; this.started = null; this.gotPlay = false; this.loadAt = Date.now();
      this.ctrl.loadUri(uri);
      try { this.ctrl.play(); } catch (e) {}
      this.vol(effVol());
    },
    // 埋め込みプレーヤーの音量 (サーバー経由で同じドメインになっているときだけ効く。再生方法は変えない)
    vol(v) {
      try {
        const f = document.querySelector('#plEmbedWrap iframe');
        const w = f && f.contentWindow; const d = w && w.document;
        if (!d) return;
        const val = Math.max(0, Math.min(1, v / 100));
        w.__vmVol = val;
        d.querySelectorAll('audio, video').forEach((m) => { try { m.volume = val; } catch (e) {} });
        if (!w.__vmVolHook) {
          w.__vmVolHook = true;
          // 後から作られる音声にも同じ音量を当てる
          d.addEventListener('play', (e) => { const m = e.target; if (m && 'volume' in m) try { m.volume = w.__vmVol; } catch (er) {} }, true);
          const MP = w.HTMLMediaElement && w.HTMLMediaElement.prototype;
          if (MP && MP.play) { const op = MP.play; MP.play = function () { try { this.volume = w.__vmVol; } catch (e) {} return op.apply(this, arguments); }; }
        }
      } catch (e) { /* 別ドメインのときは触れない */ }
    },
    // 再生が始まるまで待つ。始まらなければ再度 play() を送る
    async waitStart(token, ms) {
      const until = Date.now() + ms;
      let kicked = 0;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 300));
        if (token !== playToken) return 'cancel';
        if (this.gotPlay) return 'ok';
        const el = Date.now() - this.loadAt;
        if ((el > 1200 && kicked === 0) || (el > 3500 && kicked === 1) || (el > 6000 && kicked === 2)) { kicked++; try { this.ctrl.play(); } catch (e) {} }
      }
      return 'timeout';
    },
    toggle() { if (!this.ctrl) return; if (!this.gotPlay) { this.ctrl.play(); } else this.ctrl.togglePlay(); },
    pause() { try { if (this.ctrl && this.lastUri) this.ctrl.pause(); } catch (e) {} },
    resume() { this.ctrl && this.ctrl.resume(); },
    seek(ms) { this.ctrl && this.ctrl.seek(Math.max(0, ms / 1000)); },
  };

  /* ── Engine: HTML Audio (試聴 / ポッドキャスト) ── */
  const audio = new Audio();
  audio.preload = 'auto';
  const Aud = {
    started: null,
    load(url) {
      this.started = null;
      audio.src = url;
      audio.volume = effVol() / 100;
      return audio.play().then(() => true).catch((e) => {
        console.warn(e); S.playing = false; S.loading = false; emit('state');
        if (e && e.name === 'NotAllowedError') toast('▶ を押すと再生します');
        return false;
      });
    },
    toggle() { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); },
    pause() { try { audio.pause(); } catch (e) {} },
    seek(ms) { try { audio.currentTime = ms / 1000; } catch (e) {} },
    vol(v) { audio.volume = v / 100; },
  };
  audio.addEventListener('play', () => { if (S.engine === 'audio') { S.playing = true; emit('state'); } });
  audio.addEventListener('playing', () => { if (S.engine === 'audio' && S.loading) { S.loading = false; emit('state'); } });
  audio.addEventListener('waiting', () => { if (S.engine === 'audio' && !audio.paused) { S.loading = true; emit('state'); } });
  audio.addEventListener('playing', () => { if (S.engine === 'audio' && S.current && Aud.started !== audio.src) { Aud.started = audio.src; hooks.onTrackStart && hooks.onTrackStart(S.current); } });
  audio.addEventListener('pause', () => { if (S.engine === 'audio') { S.playing = false; emit('state'); } });
  audio.addEventListener('timeupdate', () => { if (S.engine === 'audio') { S.pos = audio.currentTime * 1000; S.posAt = performance.now(); S.dur = (isFinite(audio.duration) ? audio.duration : 0) * 1000; emit('progress'); } });
  audio.addEventListener('ended', () => { if (S.engine === 'audio') P.onEnded(); });
  audio.addEventListener('error', () => {
    if (S.engine !== 'audio' || !audio.src) return;
    if (S.source === 'full' && S.current) { P._fullFailed(); return; }
    S.loading = false; toast('音声を再生できませんでした', true); S.playing = false; emit('state');
  });

  const effVol = () => (S.muted ? 0 : S.volume);
  // ページから音量を変えられる端末か調べる (iPhone/iPad は常に本体の音量になる)
  try { const t = new Audio(); t.volume = 0.5; S.volFixed = Math.abs(t.volume - 0.5) > 0.01; } catch (e) {}

  function stopAll(except) {
    if (except !== 'embed') Embed.pause();
    if (except !== 'audio') Aud.pause();
  }

  /* ── Public API ── */
  const P = {
    state: S,
    subscribe(f) { subs.add(f); f(S, 'init'); return () => subs.delete(f); },
    hooks(h) { hooks = Object.assign(hooks, h); },
    resolve,

    /** list: 曲/エピソード配列, start: 開始位置, ctx: Spotifyのプレイリスト等(曲リストなし)を丸ごと再生 */
    async play(list, start = 0, ctx = null) {
      if (ctx && !String(ctx.uri || '').startsWith('spotify:')) ctx = null;
      const items = (list || []).filter((x) => x && x.uri && (x.type === 'track' || x.type === 'episode'));
      if (!items.length && !ctx) return;
      if (items.length) {
        const target = list[start];
        let idx = target ? items.indexOf(target) : 0;
        if (idx < 0) idx = 0;
        S.queue = items.slice(0, 500); S.index = idx; S.ctx = null; S.current = S.queue[idx]; S.orig = null;
        if (S.shuffle && S.queue.length > 1) { S.orig = S.queue.slice(); this._shuffleKeepCurrent(); }
      } else {
        S.queue = []; S.index = -1; S.ctx = ctx; S.orig = null;
        S.current = { type: ctx.type, uri: ctx.uri, id: ctx.id, name: ctx.name, img: ctx.img, artists: [], isContext: true };
      }
      this.saveQueue();
      emit('track');
      await this._start();
    },

    async _start() {
      const my = ++playToken;
      const cur = S.current;
      if (!cur) return;
      S.loading = true; S.playing = false; S.pos = 0; emit('state');
      setTimeout(() => { if (my === playToken && S.loading) { S.loading = false; emit('state'); } }, 25000);
      // Spotify のコンテキスト(プレイリスト・アルバム・アーティスト)
      if (S.ctx) {
        stopAll('embed'); S.engine = 'embed'; S.source = 'spotify'; emit('engine');
        try { await Embed.load(S.ctx.uri); } catch (e) { S.loading = false; emit('state'); toast('Spotifyプレーヤーを読み込めませんでした。通信状況を確認してください', true); return; }
        const r = await Embed.waitStart(my, 9000);
        if (r === 'timeout') { S.loading = false; emit('state'); toast('再生が始まらない場合は ▶ を押してください'); }
        return;
      }
      // ポッドキャスト
      if (cur.type === 'episode') {
        if (!cur.audio) { S.loading = false; emit('state'); toast('このエピソードは再生できません', true); return; }
        stopAll('audio'); S.engine = 'audio'; S.source = 'podcast'; emit('engine');
        Aud.load(cur.audio); return;
      }
      // 曲: まずサーバー経由のフル音源 (どの環境でも最後まで聴ける)
      S.resolving = true; S.playing = false; S.pos = 0; emit('state');
      stopAll();
      const full = await resolveFull(cur);
      if (my !== playToken) return;
      if (full) {
        S.resolving = false;
        S.engine = 'audio'; S.source = 'full'; emit('engine');
        this._fullToken = my;
        const startedAt = Date.now();
        Aud.load(full);
        // 15秒たっても音が出なければ Spotify / 試聴に切り替える
        setTimeout(() => { if (my === playToken && S.source === 'full' && Aud.started !== audio.src && audio.currentTime === 0 && !audio.paused) this._fullFailed(); }, 15000);
        this._prefetchNext();
        return;
      }
      await this._spotify(cur, my);
    },
    _fullFailed() {
      const my = playToken, cur = S.current;
      if (S.source !== 'full' || !cur) return;
      dropFull(cur);
      try { audio.removeAttribute('src'); audio.load(); } catch (e) {}
      S.source = null; S.engine = null;
      this._spotify(cur, my);
    },
    async _spotify(cur, my) {
      // Spotify ID を探す
      S.resolving = true; S.loading = true; S.playing = false; S.pos = 0; emit('state');
      const uris = await resolve(cur);
      if (my !== playToken) return; // 途中で別の曲が選ばれた
      S.resolving = false;
      if (!uris.length) { this._preview(cur, 'Spotifyで見つからなかったため30秒試聴を再生します'); this._prefetchNext(); return; }
      S.engine = 'embed'; S.source = 'spotify'; emit('engine');
      let ok = false;
      for (let i = 0; i < Math.min(uris.length, 3); i++) {
        cur.sp = uris[i];
        try { await Embed.load(uris[i]); } catch (e) { break; }
        const r = await Embed.waitStart(my, i === 0 ? 8000 : 6000);
        if (r === 'cancel') return;
        if (r === 'ok') { ok = true; if (i > 0) { cur.sp = uris[i]; rcache[cur.uri] = [uris[i], ...uris.filter((u) => u !== uris[i])]; saveR(); } break; }
      }
      if (my !== playToken) return;
      if (!ok) {
        if (!Embed.ctrl) this._preview(cur, 'Spotifyプレーヤーを読み込めなかったため試聴を再生します');
        else if (cur.preview) this._preview(cur, 'Spotifyで再生できなかったため30秒試聴を再生します');
        else { S.playing = false; S.loading = false; emit('state'); toast('再生が始まらない場合は ▶ を押してください'); }
      }
      this._prefetchNext();
    },
    _preview(cur, msg) {
      if (!cur.preview) { toast('この曲は再生できませんでした', true); S.playing = false; S.loading = false; emit('state'); return; }
      if (msg) toast(msg);
      S.engine = 'audio'; S.source = 'preview'; emit('engine');
      Aud.load(cur.preview);
    },
    _prefetchNext() {
      for (let i = S.index + 1; i <= S.index + 2 && i < S.queue.length; i++) resolveFull(S.queue[i]);
    },

    toggle() {
      if (S.resolving) return;
      if (S.engine === 'audio' && audio.paused && !audio.src && S.current) { this._start(); return; }
      if (!S.engine) { if (S.current) this._start(); return; }
      if (S.engine === 'embed') Embed.toggle(); else Aud.toggle();
    },
    next() {
      if (S.ctx) { toast('プレイリストの曲送りはSpotifyプレーヤー内で操作できます'); return; }
      if (S.index < S.queue.length - 1) this.jump(S.index + 1);
      else if (S.repeat === 'context' && S.queue.length) this.jump(0);
    },
    prev() {
      if (S.ctx) return;
      if (S.pos > 3000 || S.index <= 0) { this.seek(0); return; }
      this.jump(S.index - 1);
    },
    jump(i) {
      if (i < 0 || i >= S.queue.length) return;
      S.index = i; S.current = S.queue[i]; S.ctx = null;
      this.saveQueue(); emit('track'); this._start();
    },
    onEnded() {
      if (S.repeat === 'track') {
        if (S.engine === 'embed') { Embed.seek(0); setTimeout(() => Embed.resume(), 200); Embed.ended = false; }
        else { audio.currentTime = 0; audio.play().catch(() => {}); }
        return;
      }
      if (S.index < S.queue.length - 1) this.jump(S.index + 1);
      else if (S.repeat === 'context' && S.queue.length) this.jump(0);
      else { S.playing = false; emit('state'); }
    },
    seek(ms) { if (S.engine === 'embed') Embed.seek(ms); else Aud.seek(ms); S.pos = ms; S.posAt = performance.now(); emit('progress'); },
    setVolume(v) {
      v = Math.max(0, Math.min(100, Math.round(+v || 0)));
      S.volume = v; S.muted = false;
      Aud.vol(v); Embed.vol(v);
      try { localStorage.setItem('vm-vol', String(v)); localStorage.setItem('vm-mute', '0'); } catch (e) {}
      emit('volume');
    },
    toggleMute(force) {
      S.muted = typeof force === 'boolean' ? force : !S.muted;
      if (!S.muted && S.volume === 0) S.volume = 50;
      Aud.vol(effVol()); Embed.vol(effVol());
      try { localStorage.setItem('vm-mute', S.muted ? '1' : '0'); localStorage.setItem('vm-vol', String(S.volume)); } catch (e) {}
      emit('volume');
    },
    // フル再生中の動画ID (歌詞のタイミング合わせ用。再生には使わない)
    fullVid() {
      if (S.source !== 'full' || S.engine !== 'audio') return null;
      const m = /\/api\/full\/stream\/([A-Za-z0-9_-]{11})/.exec(audio.src || '');
      return m ? m[1] : null;
    },
    // 今の再生位置 (ms)。歌詞の同期用: 通知の間も滑らかに進める
    position() {
      if (S.engine === 'audio' && audio.src && isFinite(audio.currentTime)) return audio.currentTime * 1000;
      if (S.engine === 'embed' && S.playing && S.posAt) {
        const p = S.pos + (performance.now() - S.posAt);
        return S.dur ? Math.min(p, S.dur) : p;
      }
      return S.pos || 0;
    },
    toggleShuffle(force) {
      const on = typeof force === 'boolean' ? force : !S.shuffle;
      if (on === S.shuffle) return;
      S.shuffle = on;
      if (on) {
        if (S.queue.length > 1) { S.orig = S.queue.slice(); this._shuffleKeepCurrent(); }
      } else if (S.orig) {
        // 元の曲順に戻す (今の曲はそのまま続ける)
        const cur = S.queue[S.index];
        const inQ = new Set(S.queue.map((t) => t.uri));
        const back = S.orig.filter((t) => inQ.has(t.uri));
        const seen = new Set(back.map((t) => t.uri));
        S.queue.forEach((t) => { if (!seen.has(t.uri)) back.push(t); }); // シャッフル中に追加された曲
        S.queue = back; S.index = cur ? Math.max(0, back.findIndex((t) => t.uri === cur.uri)) : -1;
        S.orig = null;
        this.saveQueue(); emit('queue');
      }
      try { localStorage.setItem('vm-shuffle', on ? '1' : '0'); } catch (e) {}
      emit('mode');
    },
    _shuffleKeepCurrent() {
      const cur = S.queue[S.index];
      const rest = S.queue.filter((_, i) => i !== S.index);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      S.queue = cur ? [cur, ...rest] : rest; S.index = cur ? 0 : -1;
      this.saveQueue(); emit('queue');
    },
    cycleRepeat() { S.repeat = { off: 'context', context: 'track', track: 'off' }[S.repeat]; emit('mode'); },
    addToQueue(item, playNext) {
      if (!item || !item.uri) return;
      if (!S.queue.length || S.ctx) { this.play([item], 0); return; }
      S.queue.splice(playNext ? S.index + 1 : S.queue.length, 0, item);
      resolve(item);
      this.saveQueue(); emit('queue');
      toast(playNext ? '次に再生します' : 'キューに追加しました');
    },
    removeAt(i) { if (i === S.index) return; const [t] = S.queue.splice(i, 1); if (S.orig && t) { const k = S.orig.findIndex((x) => x.uri === t.uri); if (k >= 0) S.orig.splice(k, 1); } if (i < S.index) S.index--; this.saveQueue(); emit('queue'); },
    clearQueue() { const c = S.queue[S.index]; S.queue = c ? [c] : []; S.index = c ? 0 : -1; S.orig = S.orig && c ? [c] : null; this.saveQueue(); emit('queue'); },
    saveQueue() { try { localStorage.setItem('vm-queue', JSON.stringify({ q: S.queue.slice(0, 200), i: S.index, o: S.orig ? S.orig.slice(0, 200) : null })); } catch (e) {} },
    snapshotQueue() { return { q: S.queue.slice(), i: S.index, o: S.orig ? S.orig.slice() : null }; },
    restoreSnapshot(sn) { if (!sn) return; const cur = S.queue[S.index]; S.queue = sn.q; S.orig = sn.o; S.index = cur ? Math.max(0, sn.q.findIndex((t) => t.uri === cur.uri)) : sn.i; this.saveQueue(); emit('queue'); },
    restoreQueue() {
      try {
        const v = parseInt(localStorage.getItem('vm-vol') || '80', 10); if (!isNaN(v)) S.volume = Math.max(0, Math.min(100, v));
        S.muted = localStorage.getItem('vm-mute') === '1';
        audio.volume = effVol() / 100; emit('volume');
        const j = JSON.parse(localStorage.getItem('vm-queue') || 'null');
        if (j && Array.isArray(j.q) && j.q.length) { S.queue = j.q; S.index = Math.min(Math.max(0, j.i || 0), j.q.length - 1); S.current = S.queue[S.index]; S.orig = Array.isArray(j.o) ? j.o : null; }
        S.shuffle = localStorage.getItem('vm-shuffle') === '1';
        if (!S.shuffle) S.orig = null;
      } catch (e) {}
      emit('track');
    },
    preloadEmbed() { return Embed.init().then(() => Embed.vol(effVol())).catch(() => {}); },
  };

  if ('mediaSession' in navigator) {
    P.subscribe((s, why) => {
      if (!['track', 'state', 'init'].includes(why) || !s.current) return;
      const c = s.current;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: c.name || '', artist: (c.artists || []).map((a) => a.name).join(', ') || (c.show && c.show.name) || '',
          album: c.album ? c.album.name : '', artwork: c.img ? [{ src: c.img, sizes: '600x600', type: 'image/jpeg' }] : [],
        });
        navigator.mediaSession.playbackState = s.playing ? 'playing' : 'paused';
      } catch (e) {}
    });
    try {
      navigator.mediaSession.setActionHandler('play', () => P.toggle());
      navigator.mediaSession.setActionHandler('pause', () => P.toggle());
      navigator.mediaSession.setActionHandler('nexttrack', () => P.next());
      navigator.mediaSession.setActionHandler('previoustrack', () => P.prev());
    } catch (e) {}
  }

  window.VMPlayer = P;
})();
