/* ==========================================================================
   LIVE (生放送) の再生 — 通常動画とは別の LIVE 専用の経路
   1. サーバー経由の中継 (/api/livehls/…) を hls.js で再生
      (YouTube に直接つながらない端末でも、サーバーが映像を受け取れれば見られる)
   2. 中継が使えないときは公式の埋め込みプレーヤー
      - youtube-nocookie.com に届く端末 → 通常の埋め込み
      - 届かない端末 → YouTube for Education の埋め込み (youtubeeducation.com)
      埋め込み中も、中継が使えるようになったら自動で切り替える
   3. シークバーは「いま配信中の位置 (ライブの先端)」と「少し前の位置」を分けて扱う
      - 先端は配信の進みに合わせてなめらかに進める (プレイリストの更新を待ってカクつかない)
      - 先端へのシークは、映像がまだ届いていない位置 (黒画面・停止の原因) ではなく
        確実に再生できる位置に合わせる
      - 再生が止まったら自動で立て直す
   配信終了済み (アーカイブ) は通常動画として扱う
   ========================================================================== */
const VyLive = (() => {
  const blank = () => ({ active: false, videoId: '', gen: 0, hls: null, retries: 0, embed: false, embedKind: '' });
  let state = blank();
  let token = 0;
  // ライブの先端の追跡 (プレイリストが更新されるたびに合わせ直し、その間は時間に合わせて進める)
  let edge = null;      // { safe, start, end, td, t }
  let dispEdge = 0;     // 表示上の先端 (戻らないようにする)
  let watchdog = 0;
  let embedMsgOff = null;

  const $ = (id) => document.getElementById(id);
  const now = () => performance.now();

  function isLive(videoId) {
    return state.active && (!videoId || state.videoId === videoId);
  }
  // サーバー中継 (hls.js / Safari のネイティブ HLS) で再生しているか
  function hlsOn(videoId) {
    const p = $('videoPlayer');
    return isLive(videoId) && !state.embed && !!p && !p.hidden && !!(state.hls || state.native);
  }

  /* ── ライブバッジ ─────────────────────────────── */
  function badge() {
    let b = $('vcLiveBadge');
    if (b) return b;
    const time = $('vcTime');
    if (!time || !time.parentNode) return null;
    b = document.createElement('button');
    b.type = 'button';
    b.id = 'vcLiveBadge';
    b.className = 'vc-live-badge';
    b.title = 'ライブ配信の最新の位置へ';
    b.innerHTML = '<span class="vc-live-dot"></span><span>ライブ</span><span class="vc-live-behind" hidden></span>';
    b.addEventListener('click', (e) => { e.stopPropagation(); jumpToLive(); });
    time.parentNode.insertBefore(b, time.nextSibling);
    return b;
  }

  function fmtBehind(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m >= 60) return `-${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `-${m}:${String(s).padStart(2, '0')}`;
  }

  function updateBadge() {
    const b = badge();
    if (!b) return;
    const r = range();
    const behind = r && !r.atLive ? r.end - r.cur : 0;
    const isBehind = !state.embed && !!r && !r.atLive;
    b.classList.toggle('behind', isBehind);
    const bt = b.querySelector('.vc-live-behind');
    if (bt) {
      bt.hidden = !isBehind;
      if (isBehind) bt.textContent = fmtBehind(behind);
    }
    b.title = isBehind ? 'ライブ配信の最新の位置へ戻る' : 'ライブ配信の最新の位置で再生中';
  }

  function setLiveUi(on) {
    const wrap = $('playerWrap');
    if (wrap) wrap.classList.toggle('vy-is-live', on);
    const b = on ? badge() : $('vcLiveBadge');
    if (b) b.hidden = !on;
  }

  /* ── ライブの先端と、シークできる範囲 ─────────────────── */
  function resetEdge() { edge = null; dispEdge = 0; }

  function onLevelDetails(det) {
    if (!det || !det.fragments || !det.fragments.length) return;
    const td = det.targetduration || det.averagetargetduration || 2;
    const start = det.fragments[0].start;
    const end = det.edge != null ? det.edge : (det.fragments[det.fragments.length - 1].start + det.fragments[det.fragments.length - 1].duration);
    let safe = state.hls && isFinite(state.hls.liveSyncPosition) && state.hls.liveSyncPosition > 0
      ? state.hls.liveSyncPosition : end - 3 * td;
    safe = Math.max(start, Math.min(safe, end - td));
    // 配信の時刻が大きく巻き戻った (配信の切り替わりなど) ときだけ表示の先端も戻す
    if (dispEdge && safe < dispEdge - 4 * td - 10) dispEdge = 0;
    edge = { safe, start, end, td, t: now() };
  }

  // シークできる範囲と今の位置。start..end の end が「ライブの先端」(確実に再生できる一番新しい位置)
  function range() {
    const p = $('videoPlayer');
    if (!p || !hlsOn()) return null;
    let start, end, td = 2;
    if (edge) {
      const el = Math.max(0, (now() - edge.t) / 1000);
      td = edge.td;
      // 次のプレイリストが届くまでは時間の進みに合わせて先端を進める。
      // ただし届いている映像の終わりより 1 断片手前までにとどめる (まだ無い位置へは行かせない)
      end = Math.min(edge.safe + el, edge.end - Math.min(td, 4));
      start = edge.start + el;
    } else {
      try {
        if (!p.seekable || !p.seekable.length) return null;
        start = p.seekable.start(0);
        end = p.seekable.end(p.seekable.length - 1) - 3 * td;
      } catch { return null; }
    }
    if (!isFinite(end) || !isFinite(start)) return null;
    // 表示上の先端は戻さない (プレイリストの更新のたびに行ったり来たりしないように)
    if (end > dispEdge || dispEdge - end > 8 * td + 10) dispEdge = end;
    end = Math.max(end, Math.min(dispEdge, edge ? edge.end - 0.5 : dispEdge));
    if (end - start < 2) start = end - 2;
    const cur = p.currentTime;
    const liveTol = Math.max(3, td * 1.6);
    const atLive = cur >= end - liveTol;
    let buf = 0;
    try {
      for (let i = 0; i < p.buffered.length; i++) {
        if (p.buffered.start(i) <= cur + 0.5 && p.buffered.end(i) >= cur) buf = p.buffered.end(i);
      }
    } catch {}
    return { start, end, cur, td, atLive, buf, minSeek: start + Math.min(2, td) };
  }

  /* ── シーク ─────────────────────────────── */
  function liveTarget() {
    // 先端の「確実に再生できる位置」: hls.js の同期位置に、前回の更新からの経過時間を足したもの
    const r = range();
    if (r) return r.end;
    const p = $('videoPlayer');
    try { if (p && p.seekable && p.seekable.length) return p.seekable.end(p.seekable.length - 1) - 6; } catch {}
    return 0;
  }

  function seekTo(t) {
    const p = $('videoPlayer');
    if (!p || !hlsOn()) return false;
    const r = range();
    if (!r) return false;
    if (t >= r.end - 0.75) { jumpToLive(); return true; }
    t = Math.max(r.minSeek, t);
    if (Math.abs(p.currentTime - t) > 0.05) p.currentTime = t;
    updateBadge();
    return true;
  }
  function seekBy(sec) {
    const p = $('videoPlayer');
    if (!p || !hlsOn()) return false;
    return seekTo(p.currentTime + sec);
  }
  function seekPct(pct) {
    const r = range();
    if (!r) return false;
    if (pct >= 0.995) { jumpToLive(); return true; }
    return seekTo(r.start + Math.max(0, Math.min(1, pct)) * (r.end - r.start));
  }

  function jumpToLive() {
    const p = $('videoPlayer');
    if (!p || state.embed) return;
    const target = liveTarget();
    // すでに先端付近なら動かさない (無駄なシークで止まらないように)
    if (target > 0 && Math.abs(p.currentTime - target) > 1.0) p.currentTime = target;
    if (p.paused) p.play().catch(() => {});
    updateBadge();
  }

  /* ── 再生が止まったときの立て直し ─────────────────── */
  function startWatchdog(videoId, myToken) {
    stopWatchdog();
    let lastT = -1, stuckSince = 0, recoveries = 0, lastOk = now();
    watchdog = setInterval(() => {
      if (myToken !== token || !hlsOn()) return;
      const p = $('videoPlayer');
      if (!p) return;
      updateBadge();
      // 速く再生して先端に追いついたら等速に戻す (先端より先には映像がない)
      if (p.playbackRate > 1) { const r = range(); if (r && p.currentTime >= r.end - 0.5) p.playbackRate = 1; }
      const ct = p.currentTime;
      const moving = Math.abs(ct - lastT) > 0.01;
      lastT = ct;
      if (p.paused || p.seeking || moving) {
        stuckSince = 0;
        if (moving && now() - lastOk > 20000) recoveries = 0;
        if (moving) lastOk = now();
        return;
      }
      if (!stuckSince) { stuckSince = now(); return; }
      const stuck = (now() - stuckSince) / 1000;
      // 1) 少し先に届いている映像があれば、すき間を飛ばす
      if (stuck >= 2) {
        try {
          for (let i = 0; i < p.buffered.length; i++) {
            const s = p.buffered.start(i);
            if (s > ct && s - ct < 6) { p.currentTime = s + 0.05; stuckSince = 0; return; }
          }
        } catch {}
      }
      // 2) 先端より先に出てしまった / 読み込みが止まった → 読み込みを再開し、確実に再生できる先端の位置へ
      if (stuck >= 5 && recoveries < 6) {
        recoveries++;
        stuckSince = now();
        try { if (state.hls) state.hls.startLoad(-1); } catch {}
        const t = liveTarget();
        let ahead = 0;
        try { for (let i = 0; i < p.buffered.length; i++) if (p.buffered.start(i) <= ct && p.buffered.end(i) > ct) ahead = p.buffered.end(i) - ct; } catch {}
        if (t > 0 && (ct > t || ahead < 0.3)) p.currentTime = Math.min(t, Math.max(ct, t - 2 * recoveries));
        else p.currentTime = ct + 0.1;
        p.play().catch(() => {});
        return;
      }
      // 3) それでも動かなければ、プレーヤーを作り直す (ページは再読み込みしない)
      if (stuck >= 12) {
        stuckSince = now();
        recoveries = 0;
        restartHls(videoId, myToken);
      }
    }, 1000);
  }
  function stopWatchdog() { if (watchdog) { clearInterval(watchdog); watchdog = 0; } }

  function restartHls(videoId, myToken) {
    if (myToken !== token) return;
    const url = relayUrl(videoId);
    if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; }
    resetEdge();
    playHls(url, videoId, myToken);
  }

  /* ── 埋め込みプレーヤー ─────────────────────────────── */
  function hideEmbeds() {
    ['nocookiePlayer', 'eduPlayer'].forEach(id => {
      const f = $(id);
      if (f && !f.hidden) { f.setAttribute('hidden', ''); f.src = 'about:blank'; }
    });
    if (embedMsgOff) { embedMsgOff(); embedMsgOff = null; }
  }

  // その端末からドメインに届くかを確かめる (学校などのフィルターでふさがれていないか)
  function reachable(url, ms) {
    return new Promise(res => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; res(v); } };
      setTimeout(() => fin(false), ms || 5000);
      try {
        fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).then(() => fin(true), () => fin(false));
      } catch { fin(false); }
    });
  }

  let _eduParam = null;
  async function eduParam() {
    if (_eduParam !== null) return _eduParam;
    try {
      const r = await fetch('/api/edu-params', { signal: AbortSignal.timeout(8000) });
      const list = r.ok ? await r.json() : [];
      const v = (Array.isArray(list) ? list : []).map(x => x && x.value).find(Boolean) || '';
      _eduParam = v
        .replace(/([?&])(enablejsapi|origin|autoplay|loop|playlist|start)=[^&]*/g, '$1')
        .replace(/[?&]+$/, '').replace(/\?&+/g, '?').replace(/&&+/g, '&');
      if (_eduParam && !_eduParam.startsWith('?')) _eduParam = '?' + _eduParam.replace(/^&/, '');
    } catch { _eduParam = ''; }
    return _eduParam;
  }

  async function embedSrc(kind, videoId) {
    const id = encodeURIComponent(videoId);
    if (kind === 'edu') {
      const prm = await eduParam();
      const sep = prm ? '&' : '?';
      return `https://www.youtubeeducation.com/embed/${id}${prm}${sep}autoplay=1&enablejsapi=1`;
    }
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&enablejsapi=1&playsinline=1`;
  }

  // 埋め込みから返事 (YouTube のプレーヤーが動いている合図) があるか / エラーになったかを見る
  function watchEmbed(frame, onFail) {
    let alive = false;
    const onMsg = (e) => {
      if (!frame.contentWindow || e.source !== frame.contentWindow) return;
      let d = e.data;
      try { if (typeof d === 'string') d = JSON.parse(d); } catch { return; }
      if (!d) return;
      if (d.event === 'onError') { cleanup(); onFail('error'); return; }
      if (d.event === 'onReady' || d.event === 'infoDelivery' || d.event === 'initialDelivery') alive = true;
    };
    const hello = () => {
      try { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'vylive', channel: 'widget' }), '*'); } catch {}
    };
    window.addEventListener('message', onMsg);
    frame.addEventListener('load', hello);
    const t1 = setTimeout(hello, 1500);
    const t2 = setTimeout(() => { if (!alive) { cleanup(); onFail('timeout'); } }, 12000);
    function cleanup() {
      window.removeEventListener('message', onMsg);
      frame.removeEventListener('load', hello);
      clearTimeout(t1); clearTimeout(t2);
    }
    return cleanup;
  }

  function showLiveMsg(text) {
    const er = $('playerError'), msg = $('playerErrorMsg'), rb = $('reloadBtn');
    if (msg) msg.textContent = text;
    if (rb) rb.hidden = false;
    if (er) er.hidden = false;
    const sk = $('playerSkeleton'); if (sk) sk.hidden = true;
  }

  async function playEmbed(videoId, myToken, order) {
    // HLS の中継を使えないときの代わり: 公式の埋め込みプレーヤー (配信中の映像を YouTube 側で再生)
    const kinds = order || state.embedOrder || ['nocookie', 'edu'];
    if (!kinds.length) {
      showLiveMsg('この端末からは YouTube の埋め込みに接続できず、サーバー経由の中継も今は利用できません。自動で再試行しています。');
      state.embed = 'none';
      return false;
    }
    const kind = kinds[0];
    const p = $('videoPlayer');
    const f = $(kind === 'edu' ? 'eduPlayer' : 'nocookiePlayer');
    if (!f) return false;
    stopWatchdog();
    if (state.hls) { try { state.hls.destroy(); } catch {} state.hls = null; }
    if (typeof _hlsInstance !== 'undefined' && _hlsInstance) { try { _hlsInstance.destroy(); } catch {} _hlsInstance = null; }
    state.native = false;
    resetEdge();
    if (p) { try { p.pause(); } catch {} p.setAttribute('hidden', ''); }
    hideEmbeds();
    const sk = $('playerSkeleton'); if (sk) sk.hidden = true;
    const er = $('playerError'); if (er) er.hidden = true;
    const src = await embedSrc(kind, videoId);
    if (myToken !== token) return false;
    f.src = src;
    f.removeAttribute('hidden');
    const vc = $('vctrls'); if (vc) vc.classList.remove('vctrls-show');
    state.embed = true;
    state.embedKind = kind;
    document.body.classList.add('vy-live-embed');
    // 埋め込みで再生している間は、通常動画の再生 (配信中は取得できず黒画面やエラーになる) を出さない
    if (p && !p._vyLiveEmbedBound) {
      p._vyLiveEmbedBound = true;
      p.addEventListener('play', () => { if (state.active && state.embed) { try { p.pause(); } catch {} } });
    }
    setLiveUi(false);
    // 埋め込みが動かない / エラーになったら次の埋め込みへ
    embedMsgOff = watchEmbed(f, () => {
      if (myToken !== token || state.embedKind !== kind || !state.embed) return;
      const rest = kinds.slice(1);
      if (rest.length) playEmbed(videoId, myToken, rest);
    });
    return true;
  }

  /* ── サーバー中継 (HLS) ─────────────────────────────── */
  function relayUrl(videoId) { return `/api/livehls/${encodeURIComponent(videoId)}/master.m3u8`; }

  function playHls(url, videoId, myToken) {
    const p = $('videoPlayer');
    if (!p) return false;
    hideEmbeds();
    if (typeof teardownHQ === 'function' && typeof hqActive !== 'undefined' && hqActive) teardownHQ();
    const sk = $('playerSkeleton'); if (sk) sk.hidden = true;
    const er = $('playerError'); if (er) er.hidden = true;
    p.removeAttribute('hidden');
    try { p.pause(); } catch {}
    state.embed = false;
    state.embedKind = '';
    document.body.classList.remove('vy-live-embed');
    resetEdge();

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      // 通常動画用の hls.js が残っていれば止める
      if (typeof _hlsInstance !== 'undefined' && _hlsInstance) { try { _hlsInstance.destroy(); } catch {} _hlsInstance = null; }
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,            // YouTube の HLS は低遅延 HLS ではない
        liveSyncDurationCount: 3,         // 先端から 3 断片分うしろ = 映像が確実に届いている位置
        liveMaxLatencyDurationCount: Infinity, // 少し前の位置を見ているときに勝手に先端へ飛ばさない
        maxLiveSyncPlaybackRate: 1,       // 再生速度を勝手に変えない (速度の設定と食い違わないように)
        liveDurationInfinity: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 8,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 600,
        nudgeMaxRetry: 8,
      });
      state.hls = hls;
      state.native = false;
      if (typeof _hlsInstance !== 'undefined') _hlsInstance = hls; // 画質の切り替え等で通常どおり片付けられるように
      if (typeof _currentVideoSrc !== 'undefined') _currentVideoSrc = url;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (myToken !== token) return;
        if (window.VyQuality) VyQuality.setHls(hls);
        if (typeof tryAutoplay === 'function') tryAutoplay(p, null); else p.play().catch(() => {});
      });
      hls.on(Hls.Events.LEVEL_UPDATED, (_e, data) => { if (myToken === token && data) onLevelDetails(data.details); });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => { if (myToken === token && data) onLevelDetails(data.details); });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => { if (window.VyQuality) VyQuality.renderHls(); });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { if (myToken === token) state.retries = 0; });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (myToken !== token || !data || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && state.retries < 5) {
          state.retries++;
          setTimeout(() => { if (myToken === token && state.hls === hls) hls.startLoad(-1); }, 800 * state.retries);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && state.retries < 4) {
          state.retries++;
          hls.recoverMediaError();
        } else if (state.retries < 7) {
          state.retries++;
          setTimeout(() => restartHls(videoId, myToken), 1000);
        } else {
          playEmbed(videoId, myToken);
          scheduleRelayRetry(videoId, myToken);
        }
      });
      hls.loadSource(url);
      hls.attachMedia(p);
    } else if (p.canPlayType('application/vnd.apple.mpegurl')) {
      state.hls = null;
      state.native = true;
      p.src = url; // Safari はそのまま再生できる (先端の扱いもブラウザに任せる)
      p.addEventListener('loadedmetadata', () => { if (myToken === token) jumpToLive(); }, { once: true });
      if (typeof tryAutoplay === 'function') tryAutoplay(p, null);
    } else {
      return false;
    }
    setLiveUi(true);
    startWatchdog(videoId, myToken);
    window.dispatchEvent(new CustomEvent('vy-live-hls', { detail: { videoId } }));
    return true;
  }

  // 中継が本当に使えるか (プレイリストだけでなく、映像の断片まで届くか) を確かめる
  async function relayOk(url) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), cache: 'no-store' });
      if (!r.ok) return false;
      const master = await r.text();
      if (!master.startsWith('#EXTM3U')) return false;
      const vline = master.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).pop();
      if (!vline) return false;
      const vu = new URL(vline, location.origin + url).href;
      const v = await fetch(vu, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (!v.ok) return false;
      const vt = await v.text();
      const seg = vt.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).pop();
      if (!seg) return false;
      const s = await fetch(new URL(seg, vu).href, { signal: AbortSignal.timeout(20000) });
      return s.ok;
    } catch { return false; }
  }

  let relayTimer = 0;
  function scheduleRelayRetry(videoId, myToken) {
    if (relayTimer) return;
    const waits = [20000, 30000, 45000, 60000, 90000, 120000, 180000];
    let i = 0;
    const next = () => {
      relayTimer = setTimeout(async () => {
        relayTimer = 0;
        if (myToken !== token || !state.embed) return;
        // 埋め込みで問題なく見られているときは邪魔をしない (届かない・使えないときだけ中継へ)
        if (state.embed === true && state.embedKind && state.embedOk) { next(); return; }
        if (await relayOk(relayUrl(videoId))) {
          if (myToken !== token || !state.embed) return;
          playHls(relayUrl(videoId), videoId, myToken);
          return;
        }
        i = Math.min(i + 1, waits.length - 1);
        next();
      }, waits[i]);
    };
    next();
  }

  async function start(videoId, meta, genOk) {
    const myToken = ++token;
    state = blank();
    state.active = true;
    state.videoId = videoId;
    state.gen = myToken;
    document.body.classList.add('vy-watch-live');
    setLiveUi(true);
    const alive = () => myToken === token && !(genOk && !genOk());
    const url = relayUrl(videoId);
    // サーバー経由の中継と、この端末から埋め込みに届くかを同時に確かめる
    const probes = Promise.all([
      reachable('https://www.youtube-nocookie.com/generate_204', 5000),
      reachable('https://www.youtubeeducation.com/generate_204', 5000),
    ]);
    const relay = await relayOk(url);
    if (!alive()) return;
    if (relay && playHls(url, videoId, myToken)) return;
    const [noc, edu] = await probes;
    if (!alive()) return;
    state.embedOrder = [noc ? 'nocookie' : null, edu ? 'edu' : null].filter(Boolean);
    if (!state.embedOrder.length) state.embedOrder = []; // どちらにも届かない
    await playEmbed(videoId, myToken);
    // 埋め込みが動いているかを覚えておく (動いていれば中継へ無理に切り替えない)
    const onMsg = (e) => {
      if (myToken !== token) { window.removeEventListener('message', onMsg); return; }
      const f = $(state.embedKind === 'edu' ? 'eduPlayer' : 'nocookiePlayer');
      if (f && e.source === f.contentWindow) {
        let d = e.data; try { if (typeof d === 'string') d = JSON.parse(d); } catch { return; }
        if (d && d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number') state.embedOk = d.info.playerState === 1 || d.info.playerState === 3;
        if (d && d.event === 'onError') state.embedOk = false;
      }
    };
    window.addEventListener('message', onMsg);
    if (alive()) scheduleRelayRetry(videoId, myToken);
  }

  function stop() {
    token++;
    stopWatchdog();
    if (relayTimer) { clearTimeout(relayTimer); relayTimer = 0; }
    if (embedMsgOff) { embedMsgOff(); embedMsgOff = null; }
    if (state.hls) { try { state.hls.destroy(); } catch {} }
    state = blank();
    resetEdge();
    document.body.classList.remove('vy-watch-live', 'vy-live-embed');
    setLiveUi(false);
  }

  // 動画情報が届いたら判定する。配信中だけ LIVE 専用の再生に切り替える
  function check(videoId, infoPromise, genOk) {
    stop();
    if (window.VyLiveChat) window.VyLiveChat.stop();
    Promise.resolve(infoPromise).then(meta => {
      if (!meta || (genOk && !genOk())) return;
      if (meta.liveNow) {
        // 再生できるかどうかに関係なく、チャットは別に読み込む
        if (window.VyLiveChat) window.VyLiveChat.start(videoId);
        start(videoId, meta, genOk);
      }
    }).catch(() => {});
  }

  return {
    check, start, stop, isLive, hlsOn, jumpToLive, range, seekTo, seekBy, seekPct, updateBadge,
    get state() { return state; },
  };
})();
window.VyLive = VyLive;
