/* ==========================================================================
   LIVE (生放送) のチャットをリアルタイムで表示
   - 配信中の動画を開くと、関連動画の上にチャット欄を出す
   - サーバー (/api/livechat) から数秒おきに新しいメッセージを受け取り、
     受け取った分を少しずつ流して本家に近い流れ方にする
   - 下までスクロールしているときだけ自動で最新へ。上を読んでいるときは
     「最新のチャットへ」ボタンを出す
   ========================================================================== */
const VyLiveChat = (() => {
  const MAX_ITEMS = 250;
  let st = null; // { videoId, token, cont, timer, queue, flushTimer, mode, seen }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const img = (u, w) => {
    if (!u) return '';
    try { return typeof wsrv === 'function' ? wsrv(u, w) : u; } catch { return u; }
  };

  function panel() {
    let p = $('vyLiveChat');
    if (p && document.contains(p)) return p;
    const right = $('watchRight');
    if (!right) return null;
    p = document.createElement('section');
    p.id = 'vyLiveChat';
    p.className = 'vy-lc';
    p.setAttribute('aria-label', 'ライブチャット');
    p.innerHTML = `
      <div class="vy-lc-head">
        <div class="vy-lc-title"><span class="vy-lc-dot"></span>ライブチャット</div>
        <select class="vy-lc-mode" id="vyLcMode" aria-label="チャットの表示" hidden></select>
        <button type="button" class="vy-lc-fold" id="vyLcFold" title="チャットをたたむ" aria-expanded="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
      </div>
      <div class="vy-lc-body" id="vyLcBody">
        <div class="vy-lc-list" id="vyLcList" role="log" aria-live="off"></div>
        <div class="vy-lc-status" id="vyLcStatus">チャットを読み込み中…</div>
        <button type="button" class="vy-lc-jump" id="vyLcJump" hidden>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          最新のチャットへ
        </button>
      </div>
    `;
    right.insertBefore(p, right.firstChild);

    const list = p.querySelector('#vyLcList');
    const jump = p.querySelector('#vyLcJump');
    list.addEventListener('scroll', () => {
      if (atBottom(list)) jump.hidden = true;
    }, { passive: true });
    // チャット欄の上でのスクロールはページに伝えない (端まで行ったときにページが動かないように)
    list.addEventListener('wheel', (e) => {
      const dy = e.deltaY;
      if ((dy < 0 && list.scrollTop <= 0) || (dy > 0 && atBottom(list, 1))) e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    jump.addEventListener('click', () => { list.scrollTop = list.scrollHeight; jump.hidden = true; });
    p.querySelector('#vyLcFold').addEventListener('click', () => {
      const folded = p.classList.toggle('folded');
      const b = p.querySelector('#vyLcFold');
      b.setAttribute('aria-expanded', folded ? 'false' : 'true');
      b.title = folded ? 'チャットを表示' : 'チャットをたたむ';
      try { localStorage.setItem('vy-lc-folded', folded ? '1' : '0'); } catch {}
      if (!folded) list.scrollTop = list.scrollHeight;
    });
    try { if (localStorage.getItem('vy-lc-folded') === '1') p.classList.add('folded'); } catch {}
    p.querySelector('#vyLcMode').addEventListener('change', (e) => {
      if (!st) return;
      const c = e.target.value;
      if (!c) return;
      st.cont = c;
      st.queue = [];
      list.innerHTML = '';
      setStatus('チャットを切り替えています…');
      schedule(0);
    });
    return p;
  }

  function atBottom(list, slack = 40) {
    return list.scrollHeight - list.scrollTop - list.clientHeight <= slack;
  }

  function setStatus(t) {
    const s = $('vyLcStatus');
    if (!s) return;
    s.textContent = t || '';
    s.hidden = !t;
  }

  function runsHtml(runs) {
    return (runs || []).map(r => {
      if (r.e) return `<img class="vy-lc-emoji" src="${esc(img(r.e, 48))}" alt="${esc(r.a || '')}" title="${esc(r.a || '')}" loading="lazy" />`;
      return esc(r.t || '');
    }).join('');
  }

  function authorHtml(m) {
    const cls = ['vy-lc-author'];
    if (m.owner) cls.push('is-owner');
    else if (m.mod) cls.push('is-mod');
    else if (m.member) cls.push('is-member');
    const icons = [];
    if (m.mod) icons.push('<svg class="vy-lc-ic" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-label="モデレーター"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>');
    if (m.verified) icons.push('<svg class="vy-lc-ic" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-label="確認済み"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8z"/></svg>');
    if (m.member) icons.push(`<img class="vy-lc-badge" src="${esc(img(m.member, 32))}" alt="" title="${esc(m.memberTip || 'メンバー')}" loading="lazy" />`);
    return `<span class="${cls.join(' ')}">${esc(m.author)}</span>${icons.join('')}`;
  }

  function avatar(m) {
    return m.photo
      ? `<img class="vy-lc-avatar" src="${esc(img(m.photo, 48))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />`
      : '<span class="vy-lc-avatar"></span>';
  }

  function render(m) {
    const el = document.createElement('div');
    el.dataset.id = m.id || '';
    if (m.authorId) el.dataset.author = m.authorId;
    if (m.type === 'paid' || m.type === 'sticker') {
      el.className = 'vy-lc-item vy-lc-paid';
      const bg = m.bg || 'rgba(30,136,229,1)';
      el.innerHTML = `
        <div class="vy-lc-paid-head" style="background:${esc(m.hbg || bg)}">
          ${avatar(m)}
          <div class="vy-lc-paid-who"><span class="vy-lc-paid-name">${esc(m.author)}</span><span class="vy-lc-paid-amount">${esc(m.amount)}</span></div>
          ${m.type === 'sticker' && m.sticker ? `<img class="vy-lc-sticker" src="${esc(img(m.sticker, 96))}" alt="" loading="lazy" />` : ''}
        </div>
        ${m.runs && m.runs.length ? `<div class="vy-lc-paid-body" style="background:${esc(bg)}">${runsHtml(m.runs)}</div>` : ''}`;
    } else if (m.type === 'member') {
      el.className = 'vy-lc-item vy-lc-member';
      el.innerHTML = `
        <div class="vy-lc-member-head">
          ${avatar(m)}
          <div class="vy-lc-member-who"><span class="vy-lc-member-name">${esc(m.author)}</span><span class="vy-lc-member-text">${esc(m.head || '')}${m.sub ? ' ' + esc(m.sub) : ''}</span></div>
        </div>
        ${m.runs && m.runs.length ? `<div class="vy-lc-member-body">${runsHtml(m.runs)}</div>` : ''}`;
    } else {
      el.className = 'vy-lc-item vy-lc-text' + (m.owner ? ' by-owner' : '');
      el.innerHTML = `${avatar(m)}<div class="vy-lc-line">${authorHtml(m)}<span class="vy-lc-msg">${runsHtml(m.runs)}</span></div>`;
    }
    return el;
  }

  function append(msgs) {
    const list = $('vyLcList');
    if (!list || !msgs.length) return;
    const stick = atBottom(list);
    const frag = document.createDocumentFragment();
    for (const m of msgs) {
      if (m.id && st.seen.has(m.id)) continue;
      if (m.id) st.seen.add(m.id);
      frag.appendChild(render(m));
    }
    list.appendChild(frag);
    while (list.children.length > MAX_ITEMS) list.removeChild(list.firstChild);
    if (st.seen.size > 3000) st.seen = new Set([...list.children].map(c => c.dataset.id).filter(Boolean));
    if (stick) list.scrollTop = list.scrollHeight;
    else $('vyLcJump').hidden = false;
    setStatus('');
  }

  function removeDeleted(ids) {
    const list = $('vyLcList');
    if (!list || !ids || !ids.length) return;
    for (const id of ids) {
      if (id.startsWith('author:')) {
        const a = id.slice(7);
        list.querySelectorAll(`[data-author="${CSS.escape(a)}"]`).forEach(n => n.remove());
      } else {
        const n = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (n) n.remove();
      }
      st.queue = st.queue.filter(m => m.id !== id);
    }
  }

  // 受け取ったメッセージを次の取得までの間に少しずつ流す (まとめて一気に出ないように)
  function enqueue(msgs, spanMs) {
    if (!msgs.length) return;
    st.queue.push(...msgs);
    if (st.queue.length > 120) { append(st.queue.splice(0, st.queue.length - 120)); }
    clearInterval(st.flushTimer);
    const per = Math.max(60, Math.min(800, spanMs / Math.max(1, st.queue.length)));
    st.flushTimer = setInterval(() => {
      if (!st || !st.queue.length) { clearInterval(st && st.flushTimer); return; }
      const n = st.queue.length > 30 ? 3 : 1;
      append(st.queue.splice(0, n));
    }, per);
  }

  function alive(token) {
    return st && st.token === token && document.contains($('vyLiveChat'));
  }

  function schedule(ms) {
    if (!st) return;
    clearTimeout(st.timer);
    const token = st.token;
    st.timer = setTimeout(() => poll(token), ms);
  }

  async function poll(token) {
    if (!alive(token)) { if (st && st.token === token) stop(); return; }
    if (document.hidden) { schedule(3000); return; } // 見ていないタブでは取得を控える
    const first = !st.cont;
    let res = null, status = 0;
    try {
      const url = `/api/livechat/${encodeURIComponent(st.videoId)}` + (first ? '' : `?c=${encodeURIComponent(st.cont)}`);
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      status = r.status;
      res = await r.json().catch(() => null);
    } catch { res = null; }
    if (!alive(token)) return;

    if (status === 404) {
      setStatus((res && res.message) || 'この配信ではチャットを利用できません');
      st.errors = 0;
      return;
    }
    if (!res || status !== 200) {
      st.errors = (st.errors || 0) + 1;
      if (st.errors >= 3) setStatus('チャットを読み込めませんでした。再試行しています…');
      if (st.errors > 3 && st.cont && st.errors % 4 === 0) st.cont = ''; // 続きのトークンが古くなったら最初から
      schedule(Math.min(15000, 2000 * st.errors));
      return;
    }
    st.errors = 0;
    if (first && Array.isArray(res.modes) && res.modes.length > 1) {
      const sel = $('vyLcMode');
      if (sel) {
        sel.innerHTML = res.modes.map(m => `<option value="${esc(m.c)}"${m.selected ? ' selected' : ''}>${esc(m.title)}</option>`).join('');
        sel.hidden = false;
      }
    }
    removeDeleted(res.deleted);
    const msgs = res.messages || [];
    const wait = Math.max(1500, Math.min(5000, res.timeoutMs || 4000));
    if (first) {
      append(msgs.slice(-60));
      if (!msgs.length) setStatus('まだチャットはありません');
    } else {
      enqueue(msgs, wait);
    }
    if (res.ended || !res.continuation) {
      setStatus('ライブ配信は終了しました');
      return;
    }
    st.cont = res.continuation;
    schedule(wait);
  }

  function start(videoId) {
    stop();
    const p = panel();
    if (!p) return;
    p.hidden = false;
    document.body.classList.add('vy-has-livechat');
    st = { videoId, token: Math.random(), cont: '', timer: 0, flushTimer: 0, queue: [], seen: new Set(), errors: 0 };
    const list = $('vyLcList'); if (list) list.innerHTML = '';
    const sel = $('vyLcMode'); if (sel) { sel.innerHTML = ''; sel.hidden = true; }
    const jump = $('vyLcJump'); if (jump) jump.hidden = true;
    setStatus('チャットを読み込み中…');
    poll(st.token);
  }

  function stop() {
    if (st) { clearTimeout(st.timer); clearInterval(st.flushTimer); }
    st = null;
    document.body.classList.remove('vy-has-livechat');
    const p = $('vyLiveChat');
    if (p) p.hidden = true;
  }

  // タブに戻ったらすぐに取得
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st) schedule(0); });

  return { start, stop, get active() { return !!st; } };
})();
window.VyLiveChat = VyLiveChat;
