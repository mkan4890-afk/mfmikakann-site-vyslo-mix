/* ════════════════════════════════════════════════════════════
   ミニプレイヤー
   動画ページで再生中に別のページへ移動すると、ページを読み直さずに
   移動先を全画面の枠 (iframe) で表示し、いま再生中のプレイヤーは
   そのまま画面の隅に小さく残す。動画の要素そのものを使い続けるので、
   再生状態・再生位置・音量・画質はすべて途切れずに引き継がれる。
     ・PC: 右下に 16:9 の小窓 + タイトル行
     ・スマホ: 下メニューの上に横長のバー
     ・小窓を押す / 拡大ボタン → 元の動画ページへ戻る
     ・× → 再生を止めて閉じる
   ════════════════════════════════════════════════════════════ */
;(() => {
  const PLAYER_ROUTE = /^\/(watch|shorts)(\/|$)/;
  const SKIP_ROUTE = /^\/(api|proxy|static|embed|download)(\/|$)/;

  /* ── 枠 (iframe) の中に表示されているページ側 ───────────────── */
  let parentMini = null;
  try { if (window.top !== window && window.top.VyMini && window.top.location.origin === location.origin) parentMini = window.top.VyMini; } catch (_) { parentMini = null; }
  if (parentMini) {
    document.documentElement.classList.add('vy-in-mini-frame');
    // 動画・ショートのページは枠の中ではなく画面全体で開く
    const goTop = (href) => {
      try { if (parentMini.go) { parentMini.go(href); return; } window.top.location.href = href; }
      catch (_) { location.href = href; }
    };
    if (window.navigation && typeof navigation.addEventListener === 'function') {
      navigation.addEventListener('navigate', (e) => {
        if (!e.cancelable || e.hashChange || e.downloadRequest != null) return;
        let u; try { u = new URL(e.destination.url); } catch (_) { return; }
        if (u.origin !== location.origin || !PLAYER_ROUTE.test(u.pathname)) return;
        e.preventDefault();
        goTop(u.href);
      });
    }
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || (a.target && a.target !== '_self')) return;
      let u; try { u = new URL(a.href, location.href); } catch (_) { return; }
      if (u.origin !== location.origin || !PLAYER_ROUTE.test(u.pathname)) return;
      e.preventDefault();
      goTop(u.href);
    });
    return;
  }

  /* ── 動画ページ (いちばん外側) ──────────────────────────── */
  if (window.top !== window) return;
  if (!document.body.classList.contains('page-watch')) return;

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const wrap = $('playerWrap');
  const video = $('videoPlayer');
  const audio = $('hqAudio');
  const ncPlayer = $('nocookiePlayer');
  const eduPlayer = $('eduPlayer');
  if (!wrap || !video) return;

  let active = false;        // ミニプレイヤー表示中
  let closed = false;        // × で閉じた
  let overlay = null, frame = null;
  let watchUrl = location.href, watchTitle = document.title;
  let iframePaused = false;  // 埋め込み再生のときの再生/停止 (こちらで覚えておく)
  let allowNav = false;      // 利用者が選んだ動画へ画面全体で移動するとき
  function goFull(href) { allowNav = true; location.href = href; }

  const IC = {
    play: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
  };

  // ── 小窓の操作部品 (プレイヤーの中に置くので、動画は動かさずに済む) ──
  const ui = document.createElement('div');
  ui.className = 'vy-mini-ui';
  ui.innerHTML = `
    <button type="button" class="vy-mini-hit" aria-label="動画ページに戻る"></button>
    <button type="button" class="vy-mini-btn vy-mini-expand" title="動画ページに戻る" aria-label="動画ページに戻る">${IC.expand}</button>
    <button type="button" class="vy-mini-btn vy-mini-close" title="閉じる" aria-label="ミニプレイヤーを閉じる">${IC.close}</button>
    <button type="button" class="vy-mini-btn vy-mini-play" title="再生・一時停止" aria-label="再生・一時停止">${IC.pause}</button>
    <div class="vy-mini-meta" role="button" tabindex="0" aria-label="動画ページに戻る">
      <div class="vy-mini-title"></div>
      <div class="vy-mini-ch"></div>
    </div>
    <div class="vy-mini-prog"><i></i></div>`;
  wrap.appendChild(ui);
  const playBtn = ui.querySelector('.vy-mini-play');
  const progBar = ui.querySelector('.vy-mini-prog i');

  const streamMode = () => !video.hidden && !!(video.currentSrc || video.src);
  const embedEl = () => {
    if (ncPlayer && !ncPlayer.hidden && ncPlayer.src && ncPlayer.src !== 'about:blank') return ncPlayer;
    if (eduPlayer && !eduPlayer.hidden && eduPlayer.src && eduPlayer.src !== 'about:blank') return eduPlayer;
    return null;
  };
  // ミニプレイヤーに切り替える価値がある (= 再生を始めている) か
  function eligible() {
    if (closed) return false;
    if (streamMode()) return !video.ended && (!video.paused || video.currentTime > 1);
    return !!embedEl();
  }
  function isPaused() {
    if (streamMode()) return video.paused;
    return iframePaused;
  }
  function syncPlayIcon() {
    const p = isPaused();
    playBtn.innerHTML = p ? IC.play : IC.pause;
    playBtn.setAttribute('aria-label', p ? '再生' : '一時停止');
    playBtn.title = p ? '再生' : '一時停止';
  }
  function togglePlay() {
    if (streamMode()) {
      if (video.paused) { const pr = video.play(); if (pr && pr.catch) pr.catch(() => {}); }
      else video.pause();
    } else {
      const f = embedEl();
      if (f) {
        iframePaused = !iframePaused;
        try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: iframePaused ? 'pauseVideo' : 'playVideo', args: '' }), '*'); } catch (_) {}
      }
    }
    syncPlayIcon();
  }
  function fillMeta() {
    const t = ($('watchTitle') && $('watchTitle').textContent.trim()) || watchTitle.replace(/\s*-\s*Vyslo Tube\s*$/, '');
    const c = ($('channelName') && $('channelName').textContent.trim()) || '';
    ui.querySelector('.vy-mini-title').textContent = t;
    ui.querySelector('.vy-mini-ch').textContent = c;
  }

  // ── 移動先のページを枠で表示 ──
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'vyMiniPage';
    overlay.className = 'vy-mini-page';
    frame = document.createElement('iframe');
    frame.id = 'vyMiniFrame';
    frame.title = 'ページ';
    frame.setAttribute('allow', 'autoplay; fullscreen; clipboard-write; picture-in-picture');
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    frame.addEventListener('load', onFrameLoad);
  }
  function onFrameLoad() {
    if (!active || !frame) return;
    let href = '', title = '';
    try { href = frame.contentWindow.location.href; title = frame.contentDocument.title; } catch (_) { return; }
    if (!href || href === 'about:blank') return;
    const u = new URL(href);
    if (PLAYER_ROUTE.test(u.pathname)) { goFull(href); return; }   // 念のため (動画ページは全体で開く)
    try { history.replaceState({ vyMini: 1 }, '', href); } catch (_) {}
    if (title) document.title = title;
  }

  function enter(url) {
    if (document.fullscreenElement && document.exitFullscreen) { try { document.exitFullscreen(); } catch (_) {} }
    if (!active) {
      watchUrl = location.href;
      watchTitle = document.title;
      try { savePos(); } catch (_) {}
    }
    ensureOverlay();
    fillMeta();
    syncPlayIcon();
    if (!active) {
      try { history.pushState({ vyMini: 1 }, '', url); } catch (_) {}
    } else {
      try { history.replaceState({ vyMini: 1 }, '', url); } catch (_) {}
    }
    active = true;
    root.classList.add('vy-mini-on');
    overlay.hidden = false;
    frame.src = url;
    window.dispatchEvent(new Event('resize'));
  }

  function expand(fromPop) {
    if (!active) return;
    active = false;
    closed = false;
    root.classList.remove('vy-mini-on', 'vy-mini-closed');
    if (overlay) { overlay.remove(); overlay = null; frame = null; }
    if (!fromPop) { try { history.pushState(null, '', watchUrl); } catch (_) {} }
    document.title = watchTitle;
    window.scrollTo({ top: 0 });
    window.dispatchEvent(new Event('resize'));
  }

  function closeMini() {
    if (streamMode()) { try { video.pause(); } catch (_) {} if (audio) try { audio.pause(); } catch (_) {} }
    const f = embedEl();
    if (f) { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*'); } catch (_) {} iframePaused = true; }
    closed = true;
    root.classList.add('vy-mini-closed');
  }

  function savePos() {
    if (!streamMode() || typeof savePosition !== 'function') return;
    const vid = new URLSearchParams(new URL(watchUrl).search).get('v');
    if (!vid || !(typeof getSettings === 'function' && getSettings().savePosition)) return;
    const t = video.currentTime, d = video.duration;
    if (t > 5 && (!isFinite(d) || t < d - 5)) savePosition(vid, t, isFinite(d) ? d : 0);
  }

  // ── 小窓のボタン ──
  ui.querySelector('.vy-mini-hit').addEventListener('click', () => expand(false));
  ui.querySelector('.vy-mini-expand').addEventListener('click', (e) => { e.stopPropagation(); expand(false); });
  ui.querySelector('.vy-mini-close').addEventListener('click', (e) => { e.stopPropagation(); closeMini(); });
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
  const meta = ui.querySelector('.vy-mini-meta');
  meta.addEventListener('click', () => expand(false));
  meta.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expand(false); } });
  ['play', 'pause', 'playing', 'ended'].forEach(ev => video.addEventListener(ev, syncPlayIcon));
  video.addEventListener('timeupdate', () => {
    if (!active) return;
    const d = video.duration;
    progBar.style.width = (d && isFinite(d)) ? `${Math.min(100, video.currentTime / d * 100)}%` : '0%';
  });
  // 新しい動画が始まったら「閉じた」状態を解除
  video.addEventListener('play', () => { if (closed && !active) closed = false; });

  // ── 小窓をドラッグで動かす (離すと画面の端に吸い付く) ──
  const POS_KEY = 'vy-mini-pos';
  const EDGE = 12;
  const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
  let dragMoved = false;
  function bounds() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = wrap.getBoundingClientRect();
    const headH = (document.querySelector('header') || {}).offsetHeight || 56;
    const nav = document.querySelector('.vy-bottom-nav');
    const navH = nav && getComputedStyle(nav).display !== 'none' ? nav.offsetHeight : 0;
    return { vw, vh, w: r.width, h: r.height, minY: (isNarrow() ? headH : 0) + EDGE, maxY: vh - r.height - EDGE - (isNarrow() ? navH : 0) };
  }
  function clearPos() {
    ['left', 'top', 'right', 'bottom'].forEach(k => wrap.style.removeProperty(k));
    wrap.classList.remove('vy-mini-snap', 'vy-mini-dragging');
  }
  function applyPos(pos, animate) {
    if (!active || !pos) return;
    const b = bounds();
    wrap.classList.toggle('vy-mini-snap', !!animate);
    let y = Math.round(pos.fy * (b.vh - b.h));
    y = Math.max(b.minY, Math.min(b.maxY, y));
    wrap.style.setProperty('top', y + 'px', 'important');
    wrap.style.setProperty('bottom', 'auto', 'important');
    if (isNarrow()) {
      wrap.style.removeProperty('left'); wrap.style.removeProperty('right');
    } else {
      const x = pos.side === 'left' ? EDGE : b.vw - b.w - EDGE;
      wrap.style.setProperty('left', x + 'px', 'important');
      wrap.style.setProperty('right', 'auto', 'important');
    }
    if (animate) setTimeout(() => wrap.classList.remove('vy-mini-snap'), 260);
  }
  function loadPos() { try { return JSON.parse(sessionStorage.getItem(POS_KEY) || 'null'); } catch (_) { return null; } }
  function savePosPref(p) { try { sessionStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (_) {} }

  ui.addEventListener('pointerdown', (e) => {
    if (!active || e.button > 0) return;
    if (e.target.closest('.vy-mini-btn')) return;   // ボタンは普通に押せるように
    const r = wrap.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const ox = sx - r.left, oy = sy - r.top;
    let dragging = false;
    dragMoved = false;
    const pid = e.pointerId;
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return;
        dragging = true; dragMoved = true;
        wrap.classList.add('vy-mini-dragging');
        try { ui.setPointerCapture(pid); } catch (_) {}
      }
      ev.preventDefault();
      const b = bounds();
      const y = Math.max(b.minY - EDGE, Math.min(b.maxY + EDGE, ev.clientY - oy));
      wrap.style.setProperty('top', y + 'px', 'important');
      wrap.style.setProperty('bottom', 'auto', 'important');
      if (!isNarrow()) {
        const x = Math.max(0, Math.min(b.vw - b.w, ev.clientX - ox));
        wrap.style.setProperty('left', x + 'px', 'important');
        wrap.style.setProperty('right', 'auto', 'important');
      }
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      try { ui.releasePointerCapture(pid); } catch (_) {}
      if (!dragging) return;
      wrap.classList.remove('vy-mini-dragging');
      const b = bounds();
      const r2 = wrap.getBoundingClientRect();
      const cx = r2.left + r2.width / 2;
      // 上下も端の近くなら端へ、スマホは上か下のどちらかへ
      let top = r2.top;
      if (isNarrow()) top = (r2.top + r2.height / 2) < b.vh / 2 ? b.minY : b.maxY;
      else if (top - b.minY < 90) top = b.minY;
      else if (b.maxY - top < 90) top = b.maxY;
      top = Math.max(b.minY, Math.min(b.maxY, top));
      const pos = { side: cx < b.vw / 2 ? 'left' : 'right', fy: (b.vh - b.h) > 0 ? top / (b.vh - b.h) : 1 };
      savePosPref(pos);
      applyPos(pos, true);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  // ドラッグの直後は「押した」扱いにしない (動画ページに戻ってしまわないように)
  ui.addEventListener('click', (e) => {
    if (dragMoved) { e.stopPropagation(); e.preventDefault(); dragMoved = false; }
  }, true);
  window.addEventListener('resize', () => { if (active) { const p = loadPos(); if (p) applyPos(p, false); } });
  const _origEnter = enter;
  enter = function (url) {
    const was = active;
    _origEnter(url);
    if (!was) { const p = loadPos(); if (p) requestAnimationFrame(() => applyPos(p, false)); }
  };
  const _origExpand = expand;
  expand = function (fromPop) { clearPos(); _origExpand(fromPop); };

  // ブラウザの「戻る」で動画ページの位置まで戻ったら元に戻す
  window.addEventListener('popstate', (e) => {
    if (active && !(e.state && e.state.vyMini)) expand(true);
  });

  // ── 移動を横取りしてミニプレイヤーにする ──
  function shouldIntercept(u) {
    if (u.origin !== location.origin) return false;
    if (SKIP_ROUTE.test(u.pathname) || PLAYER_ROUTE.test(u.pathname)) return false;
    return active || eligible();
  }
  let navApi = false;
  if (window.navigation && typeof navigation.addEventListener === 'function') {
    navApi = true;
    navigation.addEventListener('navigate', (e) => {
      if (allowNav) { allowNav = false; return; }
      if (!e.cancelable || e.hashChange || e.downloadRequest != null || e.formData) return;
      if (e.navigationType === 'reload' || e.navigationType === 'traverse') return;
      if (e.destination && e.destination.sameDocument) return;
      let u; try { u = new URL(e.destination.url); } catch (_) { return; }
      if (u.origin !== location.origin) return;
      // ミニプレイヤー表示中に勝手に次の動画へ移らない (見ているページを奪わない)
      if (active && PLAYER_ROUTE.test(u.pathname) && !e.userInitiated) { e.preventDefault(); return; }
      if (!shouldIntercept(u)) return;
      e.preventDefault();
      enter(u.href);
    });
  }
  // Navigation API が無いブラウザ向け: リンクのクリックと検索欄の送信だけ拾う
  if (!navApi) {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
      let u; try { u = new URL(a.href, location.href); } catch (_) { return; }
      if ((u.pathname === location.pathname && u.search === location.search) || !shouldIntercept(u)) return;
      e.preventDefault();
      enter(u.href);
    }, true);
    const form = $('searchForm');
    if (form) form.addEventListener('submit', (e) => {
      const q = (($('searchInput') || {}).value || '').trim();
      if (!q || !eligible() || typeof buildSearchUrl !== 'function') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (typeof addSearchHistory === 'function') addSearchHistory(q);
      enter(new URL(buildSearchUrl({ q }), location.href).href);
    }, true);
  }

  window.VyMini = {
    isActive: () => active,
    open: (url) => enter(new URL(url || '/', location.href).href),
    expand: () => expand(false),
    close: closeMini,
    go: goFull,
  };
})();
