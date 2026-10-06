/* ==========================================================================
   引っ張って更新 (本家 YouTube に近い丸いインジケーター)
   - ページ最上部で下に引くと、丸いインジケーターが指に合わせて下りてくる
   - 矢印付きの円弧は引いた量に合わせて伸びて回る
   - 一定以上引くと「確定」(円が濃くなる)。そのまま指を戻せば取り消し
   - 確定した状態で指を離したときだけ onRefresh() を呼ぶ
   - マウスホイール / トラックパッドも同じ考え方 (最上部でしっかり上に回し続けたときだけ)
   ========================================================================== */
const VyPullRefresh = (() => {
  const SIZE = 40;          // 円の大きさ
  const THRESHOLD = 72;     // ここまで引いたら確定
  const MAX = 130;          // 引き出せる最大量
  const REST = 56;          // 更新中に止まる位置
  const WHEEL_THRESHOLD = 360;

  let el = null, arc = null, head = null;
  let opts = null;
  let startY = 0, startX = 0, tracking = false, pulling = false, dist = 0, armed = false;
  let refreshing = false;
  let wheelAcc = 0, wheelTimer = 0, lastScrollTs = 0;
  window.addEventListener('scroll', () => { lastScrollTs = Date.now(); }, { passive: true });

  function topOffset() {
    const h = document.querySelector('.ys-header, .vy-header, header');
    const r = h ? h.getBoundingClientRect() : null;
    return r && r.bottom > 0 && r.bottom < 200 ? r.bottom : 0;
  }

  function ensureEl() {
    if (el && el.isConnected) return el;
    el = document.createElement('div');
    el.className = 'vy-ptr';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="vy-ptr-disc">' +
        '<svg class="vy-ptr-svg" viewBox="0 0 40 40" width="40" height="40">' +
          '<g class="vy-ptr-rot">' +
            '<circle class="vy-ptr-arc" cx="20" cy="20" r="9" fill="none" stroke-width="2.6" stroke-linecap="round"/>' +
            '<path class="vy-ptr-head" d="M0 -3.6 L4.2 0 L0 3.6 Z"/>' +
          '</g>' +
        '</svg>' +
      '</div>';
    document.body.appendChild(el);
    arc = el.querySelector('.vy-ptr-arc');
    head = el.querySelector('.vy-ptr-head');
    return el;
  }

  const CIRC = 2 * Math.PI * 9;

  function draw(d, animate) {
    ensureEl();
    const p = Math.max(0, Math.min(1, d / THRESHOLD));
    el.classList.toggle('vy-ptr-anim', !!animate);
    el.style.top = topOffset() + 'px';
    el.style.transform = `translate(-50%, ${Math.round(d - SIZE - 4)}px) scale(${0.6 + 0.4 * p})`;
    el.style.opacity = d <= 2 ? '0' : String(Math.min(1, 0.25 + p));
    el.classList.toggle('vy-ptr-armed', d >= THRESHOLD);
    el.classList.toggle('vy-ptr-visible', d > 2);
    // 円弧: 引いた量に合わせて 0 → 約 300° まで伸びる
    const len = CIRC * (0.05 + 0.78 * p);
    arc.style.strokeDasharray = `${len} ${CIRC}`;
    const rot = -90 + p * 270 + Math.max(0, d - THRESHOLD) * 1.6;
    el.querySelector('.vy-ptr-rot').style.transform = `rotate(${rot}deg)`;
    // 矢印を円弧の先に置く
    const ang = (len / CIRC) * 2 * Math.PI;
    const x = 20 + 9 * Math.cos(ang), y = 20 + 9 * Math.sin(ang);
    head.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(ang * 180 / Math.PI + 90).toFixed(1)})`);
    head.style.opacity = String(p);
  }

  function hide() {
    if (!el) return;
    el.classList.add('vy-ptr-anim');
    el.classList.remove('vy-ptr-spinning', 'vy-ptr-armed');
    el.style.transform = `translate(-50%, ${-SIZE - 8}px) scale(.4)`;
    el.style.opacity = '0';
    setTimeout(() => { if (el && !refreshing && !pulling) el.classList.remove('vy-ptr-visible'); }, 260);
  }

  function atTop() { return (document.scrollingElement || document.documentElement).scrollTop <= 0; }
  function enabled() { return !!opts && !refreshing && (!opts.isEnabled || opts.isEnabled()); }

  function blockedTarget(t) {
    // 横スクロールの棚・入力欄・動画・メニューの上では反応しない
    return !!(t && t.closest && t.closest('input, textarea, select, video, [contenteditable="true"], .ys-chips, .vy-chips, .shorts-shelf, .hs-shelf, [data-no-ptr], dialog, .vy-modal'));
  }

  async function commit() {
    refreshing = true;
    armed = false;
    ensureEl();
    draw(REST, true);
    el.classList.add('vy-ptr-spinning', 'vy-ptr-visible');
    el.style.opacity = '1';
    const t0 = Date.now();
    try { await opts.onRefresh(); } catch (e) { console.warn('[pull-refresh]', e); }
    // 一瞬で消えないように最低限は回す
    const wait = Math.max(0, 450 - (Date.now() - t0));
    await new Promise(r => setTimeout(r, wait));
    refreshing = false;
    hide();
  }

  /* ── タッチ ── */
  function onStart(e) {
    tracking = false; pulling = false; dist = 0; armed = false;
    if (!enabled() || e.touches.length !== 1 || !atTop() || blockedTarget(e.target)) return;
    tracking = true;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }
  function onMove(e) {
    if (!tracking) return;
    const t = e.touches[0];
    const dy = t.clientY - startY, dx = t.clientX - startX;
    if (!pulling) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { tracking = false; return; } // 横方向の操作
      if (dy < 6) { if (dy < -4) tracking = false; return; }
      if (!atTop()) { tracking = false; return; }
      pulling = true;
      startY = t.clientY; // ここを 0 として測る
    }
    const raw = t.clientY - startY;
    // 引くほど重くなる (本家と同じくゴムのような抵抗)
    dist = raw <= 0 ? 0 : Math.min(MAX, raw < 60 ? raw * 0.75 : 45 + (raw - 60) * 0.42);
    armed = dist >= THRESHOLD;
    draw(dist, false);
    if (e.cancelable) e.preventDefault(); // ブラウザ標準の引っ張り更新やスクロールを止める
  }
  function onEnd() {
    if (!tracking) return;
    tracking = false;
    const wasPulling = pulling;
    pulling = false;
    if (!wasPulling) return;
    if (armed && dist >= THRESHOLD) commit();
    else { armed = false; hide(); }   // 確定前に戻した → 取り消し
    dist = 0;
  }

  /* ── ホイール / トラックパッド ── */
  function onWheel(e) {
    if (!enabled() || !atTop() || e.ctrlKey) { if (wheelAcc) { wheelAcc = 0; hide(); } return; }
    if (e.deltaY > 0) {
      // 下に戻した → 取り消し
      if (wheelAcc) { wheelAcc = Math.max(0, wheelAcc - e.deltaY * 1.5); draw(wheelAcc / WHEEL_THRESHOLD * THRESHOLD, false); if (!wheelAcc) hide(); }
      return;
    }
    // 上へスクロールしてきた勢いの残り (慣性) では反応しない
    if (!wheelAcc && Date.now() - lastScrollTs < 450) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    wheelAcc = Math.min(WHEEL_THRESHOLD * 1.5, wheelAcc - dy);
    draw(Math.min(MAX, wheelAcc / WHEEL_THRESHOLD * THRESHOLD), false);
    clearTimeout(wheelTimer);
    // 回すのを止めたら判定 (確定ラインを超えていれば更新、足りなければ取り消し)
    wheelTimer = setTimeout(() => {
      const ok = wheelAcc >= WHEEL_THRESHOLD;
      wheelAcc = 0;
      if (ok && enabled()) commit(); else hide();
    }, 220);
  }

  function attach(o) {
    opts = o;
    document.documentElement.classList.add('vy-ptr-on');
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', () => { if (pulling) { pulling = false; tracking = false; armed = false; hide(); } }, { passive: true });
    if (o.wheel !== false) window.addEventListener('wheel', onWheel, { passive: true });
  }

  return { attach, get refreshing() { return refreshing; }, THRESHOLD };
})();
window.VyPullRefresh = VyPullRefresh;
