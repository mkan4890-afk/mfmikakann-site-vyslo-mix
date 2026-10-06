/* Vyslo Music — App (SPA router + views) */
(function () {
  'use strict';
  const P = window.VMPlayer;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const view = $('#view');

  /* ───────── Utils ───────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stripTags = (s) => { const d = document.createElement('div'); d.innerHTML = String(s || ''); return d.textContent || ''; };
  const fmt = (ms) => { if (!ms && ms !== 0) return ''; const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtLong = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`; };
  const year = (d) => (d || '').slice(0, 4);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const settings = Object.assign({ theme: 'dark', proxyImg: true, embedVisible: true }, store.get('vm-settings', {}));
  const saveSettings = () => store.set('vm-settings', settings);
  const img = (u) => (!u ? '' : settings.proxyImg ? `/img?u=${encodeURIComponent(u)}` : u);
  const KIND = { track: '曲', album: 'アルバム', artist: 'アーティスト', playlist: 'プレイリスト', show: 'ポッドキャスト', episode: 'エピソード', single: 'シングル', compilation: 'コンピレーション' };
  const isSp = (it) => !!(it && it.uri && it.uri.startsWith('spotify:'));
  const spPath = (uri) => { const m = (uri || '').match(/^spotify:(\w+):([A-Za-z0-9]+)$/); return m ? `/spotify/${m[1]}/${m[2]}` : null; };
  const pathOf = (it) => (it.liked ? '/collection/tracks' : it.local ? `/playlist/${it.id}` : isSp(it) ? spPath(it.uri) : `/${it.type}/${it.id}`);

  let CONFIG = { version: '' };

  async function api(path, opts = {}) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts));
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((j && j.error) || `エラー (${r.status})`); err.status = r.status; throw err; }
    return j;
  }

  function toast(msg, err, action) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '') + (action ? ' has-act' : '');
    const m = document.createElement('span'); m.textContent = msg; t.appendChild(m);
    const life = action ? 6000 : 2800;
    if (action) {
      const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = action.label || '元に戻す';
      b.onclick = () => { t.remove(); action.fn(); };
      t.appendChild(b);
    }
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; }, life);
    setTimeout(() => t.remove(), life + 400);
  }
  // 取り消せる操作: 実行前の保存データを控えておき、トーストの「元に戻す」で戻す
  function undoable(keys, msg, after) {
    const snap = keys.map((k) => [k, JSON.stringify(store.get(k, null))]);
    return () => toast(msg, false, { label: '元に戻す', fn: () => {
      snap.forEach(([k, v]) => store.set(k, JSON.parse(v)));
      if (keys.includes('vm-playlists')) libChanged();
      toast('元に戻しました'); if (after) after(); else route();
    } });
  }

  /* ───────── Local library (お気に入り / 履歴) ───────── */
  const slim = (it) => ({
    type: it.type, id: it.id, uri: it.uri, name: it.name, img: it.img || null,
    artists: it.artists || [], album: it.album || null, duration_ms: it.duration_ms || null,
    owner: it.owner || null, show: it.show || null, release_date: it.release_date || null,
    preview: it.preview || null, audio: it.audio || null, sp: it.sp || null, album_type: it.album_type || null, photo: it.photo || undefined,
  });
  const Favs = {
    all() { return store.get('vm-favs', []); },
    has(uri) { return this.all().some((x) => x.uri === uri); },
    toggle(it) {
      let a = this.all();
      const on = a.some((x) => x.uri === it.uri);
      a = on ? a.filter((x) => x.uri !== it.uri) : [slim(it), ...a];
      store.set('vm-favs', a.slice(0, 2000));
      toast(on ? (it.type === 'album' ? 'ライブラリから削除しました' : 'お気に入りの曲から削除しました') : (it.type === 'album' ? 'ライブラリに保存しました' : 'お気に入りの曲に追加しました'));
      libChanged();
      return !on;
    },
  };
  (function migrate() {
    if (store.get('vm-migr-follow', false)) return;
    const f = store.get('vm-favs', []);
    const mv = f.filter((x) => x.type === 'artist' || x.type === 'show');
    if (mv.length) { store.set('vm-follows', [...mv, ...store.get('vm-follows', [])]); store.set('vm-favs', f.filter((x) => !mv.includes(x))); }
    store.set('vm-migr-follow', true);
  })();
  const Hist = {
    all() { return store.get('vm-history', []); },
    add(it) {
      if (!it || !it.uri || it.isContext) return;
      const a = this.all().filter((x) => x.uri !== it.uri);
      a.unshift(Object.assign(slim(it), { at: Date.now() }));
      store.set('vm-history', a.slice(0, 300));
    },
    clear() { store.set('vm-history', []); },
  };

  /* ───────── プレイリスト / フォロー (このブラウザに保存) ───────── */
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const PL = {
    all() { return store.get('vm-playlists', []); },
    _save(a) { store.set('vm-playlists', a); libChanged(); },
    get(id) { return this.all().find((p) => p.id === id) || null; },
    create(name, tracks) {
      const a = this.all();
      const p = { id: uid(), name: name || `マイプレイリスト #${a.length + 1}`, desc: '', created: Date.now(), updated: Date.now(), tracks: (tracks || []).map(slim) };
      a.unshift(p); this._save(a); return p;
    },
    update(id, patch) { const a = this.all(); const p = a.find((x) => x.id === id); if (!p) return; Object.assign(p, patch, { updated: Date.now() }); this._save(a); },
    remove(id) { this._save(this.all().filter((p) => p.id !== id)); },
    add(id, items) {
      const a = this.all(); const p = a.find((x) => x.id === id); if (!p) return 0;
      const have = new Set(p.tracks.map((t) => t.uri));
      const add = items.filter((t) => t && t.uri && (t.type === 'track' || t.type === 'episode') && !have.has(t.uri)).map(slim);
      p.tracks.push(...add); p.updated = Date.now();
      // 最近使ったプレイリストを上へ
      a.splice(a.indexOf(p), 1); a.unshift(p);
      this._save(a); return add.length;
    },
    removeAt(id, idx) { const a = this.all(); const p = a.find((x) => x.id === id); if (!p) return; p.tracks.splice(idx, 1); p.updated = Date.now(); this._save(a); },
    move(id, from, to) {
      const a = this.all(); const p = a.find((x) => x.id === id); if (!p || from === to) return;
      const [t] = p.tracks.splice(from, 1); p.tracks.splice(to, 0, t); p.updated = Date.now(); this._save(a);
    },
    card(p) { return { type: 'playlist', local: true, id: p.id, uri: `vm:playlist:${p.id}`, name: p.name, description: p.desc, count: p.tracks.length, img: null, arts: plArts(p) }; },
  };
  const plArts = (p) => { const out = []; for (const t of p.tracks) { if (t.img && !out.includes(t.img)) out.push(t.img); if (out.length >= 4) break; } return out; };
  const LIKED = { type: 'playlist', liked: true, id: 'liked', uri: 'vm:collection:tracks', name: 'お気に入りの曲' };
  const Follow = {
    all() { return store.get('vm-follows', []); },
    has(uri) { return this.all().some((x) => x.uri === uri); },
    toggle(it) {
      let a = this.all(); const on = a.some((x) => x.uri === it.uri);
      a = on ? a.filter((x) => x.uri !== it.uri) : [Object.assign(slim(it), { at: Date.now() }), ...a];
      store.set('vm-follows', a); libChanged();
      toast(on ? 'フォローを解除しました' : 'フォローしました');
      return !on;
    },
    // フォロー済みアーティストの画像を最新(本人の写真)に差し替える
    refresh(it) {
      const a = this.all(); const f = a.find((x) => x.uri === it.uri);
      if (f && it.img && (f.img !== it.img || f.photo !== !!it.photo)) { f.img = it.img; f.photo = !!it.photo; store.set('vm-follows', a); libChanged(); }
    },
    async refreshAll() {
      const need = this.all().filter((x) => x.type === 'artist' && !x.photo && !x.photoChecked).slice(0, 30);
      if (!need.length) return;
      try {
        const d = await api(`/api/artist_images?ids=${need.map((x) => x.id).join(',')}`);
        const a = this.all();
        a.forEach((x) => { if (x.type !== 'artist' || !need.some((n) => n.uri === x.uri)) return; const u = d.images && d.images[x.id]; if (u) { x.img = u; x.photo = true; } else x.photoChecked = true; });
        store.set('vm-follows', a); libChanged();
      } catch (e) {}
    },
  };
  const likedTracks = () => Favs.all().filter((x) => x.type === 'track' || x.type === 'episode');
  let libChanged = () => {};

  /* ───────── Icons ───────── */
  const I = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    checkS: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#3d91f4"/><path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 19v3"/></svg>',
    queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h13M3 12h13M3 18h9"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    disc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    lyr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>',
  };
  const phFor = (t) => `<div class="ph">${t === 'artist' ? I.user : t === 'show' || t === 'episode' ? I.mic : t === 'album' ? I.disc : I.note}</div>`;
  const mosaic = (arts) => arts.length >= 4 ? `<div class="mosaic">${arts.slice(0, 4).map((u) => `<img src="${esc(img(u))}" alt="" loading="lazy">`).join('')}</div>` : arts.length ? `<img src="${esc(img(arts[0]))}" alt="" loading="lazy" />` : `<div class="pl-cover-empty">${I.note}</div>`;
  const cover = (it) => it.liked ? `<div class="liked-cover">${I.heart}</div>` : it.local ? mosaic(it.arts || []) : (it.img ? `<img src="${esc(img(it.img))}" alt="" loading="lazy" />` : phFor(it.type));

  /* ───────── List registry (クリックで元データを引けるように) ───────── */
  let LISTS = {};
  let listSeq = 0;
  const reg = (arr, ctx) => { const k = 'l' + (++listSeq); LISTS[k] = { items: arr, ctx: ctx || null }; return k; };
  const getItem = (el) => { const k = el.closest('[data-l]'); if (!k) return null; const L = LISTS[k.dataset.l]; return L ? { L, i: +el.closest('[data-i]').dataset.i, item: L.items[+el.closest('[data-i]').dataset.i] } : null; };

  const artistLinks = (arr) => (arr || []).map((a) => a.id ? `<a href="/artist/${esc(a.id)}" data-link>${esc(a.name)}</a>` : esc(a.name)).join(', ');
  function subFor(it) {
    switch (it.type) {
      case 'track': return artistLinks(it.artists);
      case 'album': return `${year(it.release_date)}${it.release_date ? ' • ' : ''}${artistLinks(it.artists) || esc(KIND[it.album_type] || 'アルバム')}`;
      case 'artist': return 'アーティスト';
      case 'playlist': if (it.liked) return `プレイリスト • ${likedTracks().length}曲`; if (it.local) return `プレイリスト • ${it.count || 0}曲`; return esc(stripTags(it.description) || (it.owner && it.owner.name ? `作成: ${it.owner.name}` : 'プレイリスト'));
      case 'show': return esc(stripTags(it.description) || 'ポッドキャスト');
      case 'episode': return esc(it.show ? it.show.name : fmtLong(it.duration_ms || 0));
      default: return '';
    }
  }

  function cardsHTML(items, opts = {}) {
    if (!items || !items.length) return opts.empty ? `<div class="empty"><p>${esc(opts.empty)}</p></div>` : '';
    const k = reg(items);
    const cls = opts.scroller ? 'scroller' : 'grid';
    return `<div class="${cls}" data-l="${k}">${items.map((it, i) => `
      <div class="card ${it.type}" data-i="${i}" data-act="open" tabindex="0">
        <div class="cover">${cover(it)}</div>
        <button class="c-play" data-act="playcard" aria-label="再生">${I.play}</button>
        <div class="c-title" title="${esc(it.name)}">${esc(it.name)}</div>
        <div class="c-sub">${subFor(it)}</div>
      </div>`).join('')}</div>`;
  }

  // 本家ホーム上部の「よく聴くもの」タイル
  function quickTilesHTML() {
    const seen = new Set(); const out = [];
    const push = (it) => { if (it && it.uri && !seen.has(it.uri) && out.length < 8) { seen.add(it.uri); out.push(it); } };
    push(LIKED);
    PL.all().slice(0, 4).forEach((p) => push(PL.card(p)));
    Follow.all().slice(0, 3).forEach(push);
    Favs.all().filter((x) => x.type === 'album').slice(0, 3).forEach(push);
    Hist.all().filter((x) => x.type === 'track' && x.album && x.album.id).slice(0, 10).forEach((t) => push({ type: 'album', id: t.album.id, uri: `itunes:album:${t.album.id}`, name: t.album.name, img: t.img, artists: t.artists }));
    if (out.length < 4) return '';
    const k = reg(out);
    return `<div class="qtiles" data-l="${k}">${out.map((it, i) => `
      <div class="qtile ${it.type}" data-i="${i}" data-act="open" tabindex="0">
        <div class="qt-cover">${cover(it)}</div>
        <div class="qt-name ellipsis" title="${esc(it.name)}">${esc(it.name)}</div>
        <button class="qt-play" data-act="playcard" aria-label="再生">${I.play}</button>
      </div>`).join('')}</div>`;
  }

  function tracksHTML(items, opts = {}) {
    if (!items || !items.length) return opts.empty ? `<div class="empty"><p>${esc(opts.empty)}</p></div>` : '';
    const k = reg(items, opts.ctx);
    if (opts.pl) LISTS[k].pl = opts.pl;
    const noalb = opts.noAlbum ? ' noalb' : '';
    const curUri = P.state.current && P.state.current.uri;
    const head = opts.head === false ? '' : `<div class="tr tr-head${noalb}"><div class="t-idx">#</div><div>タイトル</div><div class="t-alb">${opts.noAlbum ? '' : 'アルバム'}</div><div class="t-dur">時間</div><div></div></div>`;
    return `<div class="tracks" data-l="${k}">${head}${items.map((t, i) => `
      <div class="tr${noalb}${t.uri === curUri ? ' playing' : ''}" data-i="${i}" data-uri="${esc(t.uri)}" data-act="playrow" draggable="true">
        <div class="t-idx"><span class="num">${opts.useTrackNo && t.track_number ? t.track_number : i + 1}</span><span class="pi">${I.play}</span></div>
        <div class="t-main">
          ${opts.noArt ? '' : (t.img ? `<img src="${esc(img(t.img))}" alt="" loading="lazy" />` : phFor(t.type))}
          <div class="t-text">
            <div class="t-name">${t.explicit ? '<span class="explicit">E</span>' : ''}${esc(t.name)}</div>
            <div class="t-art">${t.type === 'episode' ? esc(t.show ? t.show.name : (t.release_date || '')) : artistLinks(t.artists)}</div>
          </div>
        </div>
        <div class="t-alb">${t.album && t.album.id && !opts.noAlbum ? `<a href="/album/${esc(t.album.id)}" data-link>${esc(t.album.name)}</a>` : ''}</div>
        <div class="t-dur"><button class="icon-btn sm heart t-add${Favs.has(t.uri) ? ' on' : ''}" data-act="fav" aria-label="お気に入りの曲" title="お気に入りの曲">${I.heart}</button>${fmt(t.duration_ms)}</div>
        <button class="icon-btn sm t-more" data-act="menu" aria-label="その他">${I.more}</button>
      </div>`).join('')}</div>`;
  }

  const skCards = (n = 6) => `<div class="grid">${Array.from({ length: n }, () => '<div class="sk sk-card"></div>').join('')}</div>`;
  const skRows = (n = 8) => Array.from({ length: n }, () => '<div class="sk sk-row"></div>').join('');
  const errorHTML = (e) => `<div class="empty">${I.x}<h3>読み込めませんでした</h3><p>${esc(e.message || e)}</p><button class="btn btn-ghost" onclick="location.reload()">再読み込み</button></div>`;
  const section = (title, body, more) => body ? `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${more || ''}</div>${body}</section>` : '';

  /* ───────── Views ───────── */
  const GENRES = [
    ['J-POP', 'J-POP', '#e11d48', 'track'], ['アニソン', 'アニメ 主題歌', '#7c3aed', 'track'], ['ボカロ', 'ボカロ', '#0891b2', 'track'],
    ['J-ROCK', 'ロック バンド', '#ea580c', 'track'], ['K-POP', 'K-POP', '#db2777', 'track'], ['ヒップホップ', 'Japanese hip hop', '#65a30d', 'track'],
    ['シティポップ', 'city pop', '#c026d3', 'track'], ['Lo-fi', 'lofi', '#4f46e5', 'track'], ['ジャズ', 'jazz', '#a16207', 'album'],
    ['クラシック', 'クラシック 名曲', '#0f766e', 'album'], ['EDM', 'EDM', '#9333ea', 'track'], ['ゲーム音楽', 'ゲーム サウンドトラック', '#2563eb', 'album'],
    ['洋楽', 'pop hits', '#be185d', 'track'], ['作業用BGM', '作業用BGM', '#475569', 'track'],
    ['ニュース番組', 'ニュース', '#059669', 'show'], ['ポッドキャスト', 'ラジオ', '#0d9488', 'show'],
  ];
  const genreHTML = () => `<div class="genres">${GENRES.map(([n, q, c, t]) => `<a class="genre" style="background:linear-gradient(135deg, ${c}, ${c}aa)" href="/search?q=${encodeURIComponent(q)}${t ? `&type=${t}` : ''}" data-link>${esc(n)}</a>`).join('')}</div>`;

  async function vHome() {
    const h = new Date().getHours();
    const greet = h < 5 ? 'こんばんは' : h < 11 ? 'おはようございます' : h < 18 ? 'こんにちは' : 'こんばんは';
    const hist = Hist.all().filter((x) => x.type === 'track').slice(0, 12);
    const favs = Favs.all().slice(0, 12);
    const tiles = quickTilesHTML();
    view.innerHTML = tiles ? `
      <div class="home-top"><h1 class="home-greet">${greet}</h1>${tiles}</div>
      ${section('最近再生した曲', hist.length ? tracksHTML(hist.slice(0, 6), { head: false }) : '', '<a href="/history" data-link>すべて表示</a>')}
      <section class="section"><div class="section-head"><h2>今日のランキング</h2><span class="muted" style="font-size:.8rem">iTunes 日本 総合</span></div><div id="hChart">${skRows(10)}</div></section>
      ${section('あなたのプレイリスト', cardsHTML([LIKED, ...PL.all().map((p) => PL.card(p))], { scroller: true }), '<a href="/library?tab=playlist" data-link>すべて表示</a>')}
      ${section('フォロー中', Follow.all().length ? cardsHTML(Follow.all().slice(0, 16), { scroller: true }) : '', '<a href="/library?tab=artist" data-link>すべて表示</a>')}
      <section class="section"><div class="section-head"><h2>人気のアルバム</h2></div><div id="hAlb">${skCards(6)}</div></section>
      ${section('ジャンルから探す', genreHTML())}` : `
      <div class="hero">
        <h1>${greet}</h1>
        <p>登録もログインも不要で、無料で使えます。曲はサーバー経由でフル再生するので、Spotifyが使えない環境でも最後まで聴けます。</p>
        <div class="row gap-s wrap">
          <a class="btn btn-grad" href="/search" data-link>${I.search}曲を探す</a>
          <button class="btn btn-ghost" data-act="playcharts">${I.play}ランキングを再生</button>
        </div>
      </div>
      ${section('最近再生した曲', hist.length ? tracksHTML(hist.slice(0, 6), { head: false }) : '', '<a href="/history" data-link>すべて表示</a>')}
      <section class="section"><div class="section-head"><h2>今日のランキング</h2><span class="muted" style="font-size:.8rem">iTunes 日本 総合</span></div><div id="hChart">${skRows(10)}</div></section>
      ${section('あなたのプレイリスト', cardsHTML([LIKED, ...PL.all().map((p) => PL.card(p))], { scroller: true }), '<a href="/library?tab=playlist" data-link>すべて表示</a>')}
      ${section('フォロー中', Follow.all().length ? cardsHTML(Follow.all().slice(0, 16), { scroller: true }) : '', '<a href="/library?tab=artist" data-link>すべて表示</a>')}
      ${section('保存したアルバム', favs.filter((x) => x.type === 'album').length ? cardsHTML(favs.filter((x) => x.type === 'album'), { scroller: true }) : '', '<a href="/library?tab=album" data-link>すべて表示</a>')}
      <section class="section"><div class="section-head"><h2>人気のアルバム</h2></div><div id="hAlb">${skCards(6)}</div></section>
      ${section('ジャンルから探す', genreHTML())}`;
    try {
      const d = await api('/api/charts');
      CHARTS = d.songs || [];
      const c = $('#hChart'); if (c) c.innerHTML = tracksHTML(CHARTS.slice(0, 20), { empty: 'ランキングを取得できませんでした' }) + (CHARTS.length > 20 ? '<div class="load-more"><a class="btn btn-ghost" href="/charts" data-link>50位まで見る</a></div>' : '');
      const a = $('#hAlb'); if (a) a.innerHTML = cardsHTML(d.albums || [], { scroller: true, empty: '取得できませんでした' });
    } catch (e) { const c = $('#hChart'); if (c) c.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  let CHARTS = [];
  async function vCharts() {
    view.innerHTML = `<h1 class="page-title">今日のランキング</h1>${skRows(12)}`;
    const d = await api('/api/charts');
    CHARTS = d.songs || [];
    PAGE = { tracks: CHARTS, ctx: null };
    view.innerHTML = `<h1 class="page-title">今日のランキング</h1>
      <div class="actions"><button class="btn btn-grad sm" data-act="playpage">${I.play}すべて再生</button><button class="btn btn-ghost sm" data-act="shufflepage">${I.shuffle}シャッフル</button><span class="muted">iTunes 日本 総合ソングチャート</span></div>` +
      tracksHTML(CHARTS) + section('人気のアルバム', cardsHTML(d.albums || []));
  }

  const SEARCH_TABS = [['all', 'すべて'], ['track', '曲'], ['artist', 'アーティスト'], ['album', 'アルバム'], ['show', 'ポッドキャスト'], ['episode', 'エピソード']];

  function parseSpotifyLink(q) {
    const m = q.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|artist|playlist|show|episode)\/([A-Za-z0-9]{8,40})/) || q.match(/^spotify:(track|album|artist|playlist|show|episode):([A-Za-z0-9]{8,40})$/);
    return m ? `/spotify/${m[1]}/${m[2]}` : null;
  }

  async function vSearch(params) {
    const q = (params.get('q') || '').trim();
    const type = params.get('type') || 'all';
    $('#searchInput').value = q;
    if (!q) {
      const hist = store.get('vm-searches', []);
      view.innerHTML = `<h1 class="page-title">検索</h1>
        ${hist.length ? section('最近の検索', `<div class="chips">${hist.map((s) => `<a class="chip" href="/search?q=${encodeURIComponent(s)}" data-link>${esc(s)}</a>`).join('')}</div>`, '<button data-act="clearsearch">クリア</button>') : ''}
        ${section('ジャンルから探す', genreHTML())}
        <div class="note">SpotifyのプレイリストやアルバムのURLを貼り付けると、そのまま公式プレーヤーで再生できます。</div>`;
      setTimeout(() => $('#searchInput').focus(), 50);
      return;
    }
    const link = parseSpotifyLink(q);
    if (link) { navigate(link, true); return; }
    const sh = store.get('vm-searches', []).filter((x) => x !== q); sh.unshift(q); store.set('vm-searches', sh.slice(0, 15));
    const tabs = `<div class="tabs">${SEARCH_TABS.map(([t, n]) => `<a class="chip${t === type ? ' active' : ''}" href="/search?q=${encodeURIComponent(q)}&type=${t}" data-link>${n}</a>`).join('')}</div>`;
    view.innerHTML = `<h1 class="page-title">「${esc(q)}」の検索結果</h1>${tabs}<div id="sRes">${type === 'track' || type === 'episode' ? skRows() : skCards(10)}</div>`;
    const box = $('#sRes');
    try {
      if (type === 'all') {
        const d = await api(`/api/search?q=${encodeURIComponent(q)}&type=track,artist,album,show`);
        if (!box.isConnected) return;
        const any = ['track', 'artist', 'album', 'show'].some((t) => d[t] && d[t].items.length);
        box.innerHTML = !any ? `<div class="empty">${I.search}<h3>見つかりませんでした</h3><p>別のキーワードで検索してください</p></div>` :
          section('曲', tracksHTML(d.track.items.slice(0, 10)), `<a href="/search?q=${encodeURIComponent(q)}&type=track" data-link>もっと見る</a>`) +
          section('アーティスト', cardsHTML(d.artist.items, { scroller: true }), `<a href="/search?q=${encodeURIComponent(q)}&type=artist" data-link>もっと見る</a>`) +
          section('アルバム', cardsHTML(d.album.items, { scroller: true }), `<a href="/search?q=${encodeURIComponent(q)}&type=album" data-link>もっと見る</a>`) +
          section('ポッドキャスト', cardsHTML(d.show.items, { scroller: true }), `<a href="/search?q=${encodeURIComponent(q)}&type=show" data-link>もっと見る</a>`);
      } else {
        let offset = 1; let acc = [];
        const loadPage = async () => {
          const d = await api(`/api/search?q=${encodeURIComponent(q)}&type=${type}&page=${offset}`);
          if (!box.isConnected) return;
          const seen = new Set(acc.map((x) => x.uri));
          acc = acc.concat(d.items.filter((x) => !seen.has(x.uri)));
          offset = d.next;
          if (type === 'track' || type === 'episode') PAGE = { tracks: acc, ctx: null };
          const list = type === 'track' || type === 'episode' ? tracksHTML(acc, { noAlbum: type === 'episode' }) : cardsHTML(acc);
          box.innerHTML = (acc.length ? list : `<div class="empty">${I.search}<h3>見つかりませんでした</h3></div>`) +
            (offset != null && acc.length ? '<div class="load-more"><button class="btn btn-ghost" id="moreBtn">さらに読み込む</button></div>' : '');
          const mb = $('#moreBtn'); if (mb) mb.onclick = () => { mb.disabled = true; mb.textContent = '読み込み中…'; loadPage().catch((e) => toast(e.message, true)); };
        };
        await loadPage();
      }
    } catch (e) { box.innerHTML = errorHTML(e); }
  }

  function detHeader(it, kind, sub, desc) {
    if (it.type === 'artist' && it.photo && it.img) {
      // 本家のアーティストページと同じく、写真を大きく敷いた見出し
      return `<div class="det artist hero" style="--hero:url('${esc(img(it.img))}')">
        <div class="grow">
          <div class="det-kind"><span class="verified">${I.check || ''}</span>${esc(kind)}</div>
          <h1>${esc(it.name)}</h1>
          <div class="det-sub">${sub || ''}</div>
        </div></div>`;
    }
    if (it.img) tintPage(it.img);
    return `<div class="det ${it.type}">
      <div class="det-cover">${cover(it)}</div>
      <div class="grow">
        <div class="det-kind">${esc(kind)}</div>
        <h1>${esc(it.name)}</h1>
        <div class="det-sub">${sub || ''}</div>
        ${desc ? `<div class="det-desc">${esc(stripTags(desc))}</div>` : ''}
      </div></div>`;
  }
  function actionsHTML(it, extra = '', opt = {}) {
    const fav = Favs.has(it.uri);
    const followable = it.type === 'artist' || it.type === 'show';
    const fol = followable && Follow.has(it.uri);
    return `<div class="actions" data-l="${reg([it])}"><div data-i="0" class="row gap-m wrap">
      <button class="play-big" data-act="playmain" aria-label="再生">${I.play}</button>
      ${opt.shuffle ? `<button class="icon-btn shuf-big${P.state.shuffle ? ' on' : ''}" data-act="shufflepage" aria-label="シャッフル再生" title="シャッフル再生">${I.shuffle}</button>` : ''}
      ${extra}
      ${followable ? `<button class="btn-follow${fol ? ' on' : ''}" data-act="follow">${fol ? 'フォロー中' : 'フォローする'}</button>` :
        opt.noFav ? '' : `<button class="icon-btn heart${fav ? ' on' : ''}" data-act="fav" aria-label="${it.type === 'track' ? 'お気に入りの曲' : 'ライブラリに保存'}" title="${it.type === 'track' ? 'お気に入りの曲に追加' : 'ライブラリに保存'}">${I.heart}</button>`}
      <button class="icon-btn" data-act="menu" aria-label="その他">${I.more}</button>
    </div></div>`;
  }

  let PAGE = null; // 現在ページの再生対象 {tracks, ctx}

  async function vAlbum(id) {
    view.innerHTML = skRows(10);
    const a = await api(`/api/album/${id}`);
    const total = a.tracks.reduce((s, t) => s + (t.duration_ms || 0), 0);
    PAGE = { tracks: a.tracks, ctx: { uri: a.uri, type: 'album', id: a.id, name: a.name, img: a.img } };
    a.tracks.forEach((t) => { t.img = t.img || a.img; });
    view.innerHTML = detHeader(a, KIND[a.album_type] || 'アルバム',
      `<b>${artistLinks(a.artists)}</b> • ${year(a.release_date)} • ${a.tracks.length}曲, ${fmtLong(total)}`) +
      actionsHTML(a, '', { shuffle: true }) +
      tracksHTML(a.tracks, { noAlbum: true, noArt: true, useTrackNo: true, ctx: PAGE.ctx }) +
      (a.copyright ? `<p class="dim" style="font-size:.75rem;margin-top:1.2rem">${esc(a.copyright)}</p>` : '');
  }

  async function vArtist(id) {
    view.innerHTML = skRows(10);
    const a = await api(`/api/artist/${id}`);
    PAGE = { tracks: a.tracks, ctx: { uri: a.uri, type: 'artist', id: a.id, name: a.name, img: a.img } };
    Follow.refresh(a);
    view.innerHTML = detHeader(a, 'アーティスト', (a.genres || []).slice(0, 4).map(esc).join(' • ')) +
      '' +
      actionsHTML(a, '', { shuffle: true }) +
      section('人気の曲', tracksHTML(a.tracks.slice(0, 10), { head: false })) +
      section('アルバム', cardsHTML(a.albums, { scroller: true })) +
      section('シングル・EP', cardsHTML(a.singles, { scroller: true })) +
      '';
  }

  function plHeader(p, tracks, opts = {}) {
    const total = tracks.reduce((s, t) => s + (t.duration_ms || 0), 0);
    const card = opts.liked ? LIKED : PL.card(p);
    return `<div class="det playlist">
      <div class="det-cover${opts.liked ? '' : ' editable'}" ${opts.liked ? '' : 'data-act="editpl" title="詳細を編集"'}>${cover(card)}</div>
      <div class="grow">
        <div class="det-kind">プレイリスト</div>
        <h1 ${opts.liked ? '' : 'data-act="editpl" style="cursor:pointer" title="詳細を編集"'}>${esc(card.name)}</h1>
        ${!opts.liked && p.desc ? `<div class="det-desc">${esc(p.desc)}</div>` : ''}
        <div class="det-sub"><b>あなた</b> • ${tracks.length}曲${total ? `, 約${fmtLong(total)}` : ''}</div>
      </div></div>`;
  }
  function plActions(p, liked) {
    const k = reg([liked ? LIKED : PL.card(p)]);
    return `<div class="actions" data-l="${k}"><div data-i="0" class="row gap-m wrap">
      <button class="play-big" data-act="playpage" aria-label="再生">${I.play}</button>
      <button class="icon-btn" data-act="shufflepage" aria-label="シャッフル再生" title="シャッフル再生">${I.shuffle}</button>
      ${liked ? '' : `<button class="icon-btn" data-act="editpl" aria-label="編集" title="詳細を編集">${I.edit}</button>
      <button class="icon-btn" data-act="menu" aria-label="その他">${I.more}</button>`}
    </div></div>`;
  }
  let CUR_PL = null;
  function vPlaylist(id) {
    const p = PL.get(id);
    if (!p) { view.innerHTML = `<div class="empty"><h3>プレイリストが見つかりません</h3><p>削除されたか、別のブラウザで作成されたプレイリストです。</p><a class="btn btn-ghost" href="/library" data-link>ライブラリへ</a></div>`; return; }
    CUR_PL = id;
    PAGE = { tracks: p.tracks, ctx: null, playlist: id };
    view.innerHTML = plHeader(p, p.tracks) + plActions(p) +
      (p.tracks.length ? `<div id="plRows">${tracksHTML(p.tracks, { pl: id })}</div>` : '') +
      `<section class="section"><div class="section-head"><h2>${p.tracks.length ? 'おすすめの曲を追加' : 'プレイリストに追加する曲を探そう'}</h2></div>
        <div class="search-box inline-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input id="plFind" type="search" placeholder="曲名やアーティスト名で検索" /></div>
        <div id="plFindRes"></div></section>`;
    const inp = $('#plFind'); let tmr = null;
    const runFind = async (q) => {
      const box = $('#plFindRes'); if (!box) return;
      if (!q) { box.innerHTML = ''; return; }
      box.innerHTML = skRows(4);
      try {
        const d = await api(`/api/search?q=${encodeURIComponent(q)}&type=track`);
        if (!$('#plFindRes') || inp.value.trim() !== q) return;
        const k = reg(d.items);
        box.innerHTML = d.items.length ? `<div class="tracks" data-l="${k}">${d.items.slice(0, 15).map((t, i) => `
          <div class="tr noalb" data-i="${i}" data-act="playrow">
            <div class="t-idx"><span class="num">${i + 1}</span><span class="pi">${I.play}</span></div>
            <div class="t-main">${t.img ? `<img src="${esc(img(t.img))}" alt="" loading="lazy" />` : phFor('track')}<div class="t-text"><div class="t-name">${esc(t.name)}</div><div class="t-art">${artistLinks(t.artists)}</div></div></div>
            <div class="t-alb"></div>
            <div class="t-dur" style="display:flex"><button class="btn btn-ghost sm" data-act="pladd">追加</button></div><div></div>
          </div>`).join('')}</div>` : '<p class="muted">見つかりませんでした</p>';
      } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    };
    inp.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => runFind(inp.value.trim()), 350); });
    if (!p.tracks.length) setTimeout(() => inp.focus(), 60);
  }
  function vLiked() {
    const tr = likedTracks();
    PAGE = { tracks: tr, ctx: null, liked: true };
    view.innerHTML = plHeader(null, tr, { liked: true }) + plActions(null, true) +
      (tr.length ? tracksHTML(tr) : `<div class="empty">${I.heart}<h3>お気に入りの曲はまだありません</h3><p>曲の ♡ を押すとここに追加されます</p><a class="btn btn-ghost" href="/search" data-link>曲を探す</a></div>`);
  }

  async function vSpotify(type, id) {
    view.innerHTML = skRows(4);
    const p = await api(`/api/spotify/${type}/${id}`);
    const ctx = { uri: p.uri, type: p.type, id: p.id, name: p.name, img: p.img };
    if (type === 'track' || type === 'episode') {
      const item = { type, id: p.id, uri: p.uri, name: p.name, img: p.img, artists: [] };
      PAGE = { tracks: [item], ctx: null };
    } else PAGE = { tracks: [], ctx };
    const h = type === 'track' || type === 'episode' ? 232 : 452;
    view.innerHTML = detHeader(Object.assign({}, p, { type }), `Spotify ${KIND[type] || ''}`, 'Spotify公式プレーヤーで再生します') + actionsHTML(Object.assign({}, p, { type })) +
      `<div class="embed-big"><iframe style="height:${h}px" src="/__x/open.spotify.com/embed/${esc(type)}/${esc(p.id)}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="${esc(p.name)}"></iframe></div>
      <div class="note">▶ を押すと画面下のプレーヤーで再生します。曲送りはSpotifyプレーヤー内で操作できます。ブラウザでSpotifyにログインしていない場合は各曲30秒のプレビューになります。</div>`;
  }

  async function vShow(id) {
    view.innerHTML = skRows(10);
    const s = await api(`/api/show/${id}`);
    PAGE = { tracks: s.episodes, ctx: { uri: s.uri, type: 'show', id: s.id, name: s.name, img: s.img } };
    PAGE.ctx = null;
    view.innerHTML = detHeader(s, 'ポッドキャスト', `<b>${esc(s.publisher || '')}</b>${s.episodes.length ? ` • 最新${s.episodes.length}エピソード` : ''}`, s.description) + actionsHTML(s) +
      `<div id="epRows">${tracksHTML(s.episodes, { noAlbum: true, head: false, empty: 'エピソードがありません' })}</div>`;
  }

  async function vEpisode(id) {
    view.innerHTML = skRows(4);
    const e = await api(`/api/episode/${id}`);
    PAGE = { tracks: [e], ctx: null };
    view.innerHTML = detHeader(e, 'エピソード', `${e.show ? `<a href="/show/${esc(e.show.id)}" data-link><b>${esc(e.show.name)}</b></a> • ` : ''}${esc(e.release_date || '')} • ${fmtLong(e.duration_ms || 0)}`) +
      actionsHTML(e) + `<div class="note" style="white-space:pre-wrap">${esc(stripTags(e.description))}</div>`;
  }

  async function vTrack(id) {
    view.innerHTML = skRows(4);
    const t = await api(`/api/track/${id}`);
    PAGE = { tracks: [t], ctx: null };
    view.innerHTML = detHeader(t, '曲', `<b>${artistLinks(t.artists)}</b>${t.album ? ` • <a href="/album/${esc(t.album.id)}" data-link>${esc(t.album.name)}</a>` : ''} • ${fmt(t.duration_ms)}`) +
      actionsHTML(t, `<button class="btn btn-ghost sm" data-act="openlyrics">${I.lyr}歌詞</button>`) +
      `<section class="section" id="lyrics"><div class="section-head"><h2>歌詞</h2></div><div id="trLyr"><div class="sk sk-row"></div><div class="sk sk-row"></div></div></section>` +
      '<div id="trMore"></div>';
    Lyrics.get(t).then((L) => {
      const box = $('#trLyr'); if (!box) return;
      if (!L || !L.found) { box.innerHTML = `<p class="muted">${L && L.error ? '歌詞を読み込めませんでした。時間をおいて再度お試しください。' : 'この曲の歌詞は見つかりませんでした。'}</p>`; return; }
      if (L.instrumental) { box.innerHTML = '<p class="muted">インストゥルメンタル(歌詞なし)の曲です。</p>'; return; }
      const text = L.plain || (L.synced || []).map((x) => x[1]).join('\n');
      box.innerHTML = `<div class="lyrics-box">${esc(text)}</div><p class="dim" style="font-size:.75rem;margin-top:.6rem">歌詞提供: LRCLIB</p>`;
      if (location.hash === '#lyrics') $('#lyrics').scrollIntoView({ behavior: 'smooth' });
    });
    if (t.artists[0] && t.artists[0].id) {
      api(`/api/artist/${t.artists[0].id}`).then((a) => {
        const el = $('#trMore'); if (!el) return;
        el.innerHTML = section(`${a.name} の人気曲`, tracksHTML(a.tracks.slice(0, 8), { head: false })) + section(`${a.name} のアルバム`, cardsHTML(a.albums, { scroller: true }));
      }).catch(() => {});
    }
  }

  const LIB_FILTERS = [['all', 'すべて'], ['playlist', 'プレイリスト'], ['artist', 'アーティスト'], ['album', 'アルバム'], ['show', 'ポッドキャスト']];
  // ライブラリの全項目 (Spotifyの「マイライブラリ」相当)
  function libItems(filter) {
    const out = [];
    const pls = PL.all();
    if (filter === 'all' || filter === 'playlist') {
      out.push(Object.assign({}, LIKED, { at: Infinity }));
      pls.forEach((p) => out.push(Object.assign(PL.card(p), { at: p.updated || p.created })));
      Favs.all().filter((x) => x.type === 'playlist').forEach((x) => out.push(x));
    }
    if (filter === 'all' || filter === 'artist') Follow.all().filter((x) => x.type === 'artist').forEach((x) => out.push(x));
    if (filter === 'all' || filter === 'album') Favs.all().filter((x) => x.type === 'album').forEach((x) => out.push(x));
    if (filter === 'all' || filter === 'show') Follow.all().filter((x) => x.type === 'show').forEach((x) => out.push(x));
    return out;
  }
  const libSub = (it) => it.liked ? `プレイリスト • ${likedTracks().length}曲` : it.local ? `プレイリスト • ${it.count}曲` :
    it.type === 'artist' ? 'アーティスト' : it.type === 'album' ? `アルバム • ${esc((it.artists || []).map((a) => a.name).join(', '))}` : it.type === 'show' ? 'ポッドキャスト' : esc(KIND[it.type] || '');
  async function vLibrary(params, forceTab) {
    const tab = forceTab || params.get('tab') || 'all';
    if (tab === 'history') {
      const h = Hist.all();
      PAGE = { tracks: h, ctx: null };
      view.innerHTML = `<h1 class="page-title">再生履歴</h1>` + (!h.length ? `<div class="empty">${I.note}<h3>履歴はまだありません</h3></div>` :
        `<div class="actions"><button class="btn btn-grad sm" data-act="playpage">${I.play}すべて再生</button><button class="btn btn-ghost sm" data-act="clearhist">履歴を消去</button></div>` + tracksHTML(h));
      return;
    }
    const f = LIB_FILTERS.some(([k]) => k === tab) ? tab : 'all';
    const tabs = `<div class="tabs">${LIB_FILTERS.map(([t, n]) => `<a class="chip${t === f ? ' active' : ''}" href="/library?tab=${t}" data-link>${n}</a>`).join('')}</div>`;
    const items = libItems(f);
    view.innerHTML = `<div class="row gap-s" style="justify-content:space-between;align-items:center;margin-bottom:.8rem"><h1 class="page-title" style="margin:0;white-space:nowrap;font-size:clamp(1.35rem,5vw,2rem)">マイライブラリ</h1>
      <button class="btn btn-grad sm" data-act="newpl">${I.plus}プレイリストを作成</button></div>${tabs}` +
      cardsHTML(items, { empty: f === 'artist' ? 'フォロー中のアーティストはまだいません' : f === 'album' ? '保存したアルバムはまだありません' : f === 'show' ? 'フォロー中のポッドキャストはまだありません' : '' });
  }

  function vSettings() {
    const seg = (key, opts) => `<div class="seg" data-set="${key}">${opts.map(([v, n]) => `<button data-v="${v}" class="${settings[key] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const sw = (key) => `<button class="switch${settings[key] ? ' on' : ''}" data-switch="${key}" aria-label="${key}"></button>`;
    view.innerHTML = `<h1 class="page-title">設定</h1>
      <div class="set-group"><h3>再生</h3>
        <div class="set-row"><div class="grow"><b>Spotifyプレーヤーを表示</b><small>公式埋め込みプレーヤーを画面右下に表示します</small></div>${sw('embedVisible')}</div>
        <div class="set-row"><div class="grow"><b>現在の再生方式</b><small>${P.state.source === 'full' ? 'サーバー経由のフル再生' : P.state.source === 'spotify' ? 'Spotify公式プレーヤー' : P.state.source === 'preview' ? '30秒試聴 (Spotifyで見つからなかった曲)' : P.state.source === 'podcast' ? 'ポッドキャスト配信元の音声' : 'まだ再生していません'}</small></div></div>
        <div class="set-row"><div class="grow"><b>Spotify検索結果の記録</b><small>見つかった曲のIDをこのブラウザに保存して次回から即再生します</small></div><button class="btn btn-ghost sm" data-act="clearresolve">消去</button></div>
      </div>
      <div class="set-group"><h3>表示</h3>
        <div class="set-row"><div class="grow"><b>テーマ</b></div>${seg('theme', [['dark', 'ダーク'], ['light', 'ライト']])}</div>
        <div class="set-row"><div class="grow"><b>画像をサーバー経由で読み込む</b><small>ジャケット画像をこのサーバーを通して配信します</small></div>${sw('proxyImg')}</div>
      </div>
      <div class="set-group"><h3>データ</h3>
        <div class="set-row"><div class="grow"><b>再生履歴</b><small>${Hist.all().length}件 (このブラウザに保存)</small></div><button class="btn btn-ghost sm" data-act="clearhist">消去</button></div>
        <div class="set-row"><div class="grow"><b>ライブラリ</b><small>プレイリスト ${PL.all().length}件 • お気に入りの曲 ${likedTracks().length}曲 • フォロー ${Follow.all().length}件 (このブラウザに保存)</small></div></div>
        <div class="set-row"><div class="grow"><b>バックアップ</b><small>プレイリスト・お気に入り・フォロー・履歴をファイルに保存し、別のブラウザで読み込めます</small></div><div class="row gap-s"><button class="btn btn-ghost sm" data-act="export">書き出す</button><button class="btn btn-ghost sm" data-act="import">読み込む</button></div></div>
      </div>
      <div class="set-group"><h3>このアプリについて</h3>
        <div class="set-row"><div class="grow"><b>Vyslo Music v${esc(CONFIG.version || '')}</b><small>登録・ログイン・APIキー不要。曲情報: Apple iTunes Search API / Spotify ID検索: ListenBrainz Labs / 再生: Spotify公式埋め込みプレーヤー</small></div></div>
        <div class="set-row"><div class="grow"><small>曲はこのサイトのサーバーを経由してフル再生します。SpotifyやYouTubeがブロックされている環境でも最後まで聴けます。サーバー経由で再生できなかった曲だけ、Spotifyプレーヤーまたは30秒試聴に切り替わります。</small></div></div>
      </div>`;
  }

  /* ───────── Router ───────── */
  const ROUTES = [
    [/^\/$/, () => vHome()],
    [/^\/search$/, (m, p) => vSearch(p)],
    [/^\/charts$/, () => vCharts()],
    [/^\/playlist\/(p[a-z0-9]+)$/, (m) => vPlaylist(m[1])],
    [/^\/collection\/tracks$/, () => vLiked()],
    [/^\/album\/(\d+)$/, (m) => vAlbum(m[1])],
    [/^\/artist\/(\d+)$/, (m) => vArtist(m[1])],
    [/^\/show\/(\d+)$/, (m) => vShow(m[1])],
    [/^\/episode\/(\d+)$/, (m) => vEpisode(m[1])],
    [/^\/track\/(\d+)$/, (m) => vTrack(m[1])],
    [/^\/spotify\/(track|album|artist|playlist|show|episode)\/([A-Za-z0-9]{22})$/, (m) => vSpotify(m[1], m[2])],
    [/^\/library$/, (m, p) => vLibrary(p)],
    [/^\/history$/, (m, p) => vLibrary(p, 'history')],
    [/^\/settings$/, () => vSettings()],
  ];
  const NAV_OF = { '': 'home', search: 'search', library: 'library', history: 'history', settings: 'settings' };

  async function route() {
    LISTS = {}; PAGE = null; CUR_PL = null;
    closeMenu(); hideSuggest(); closeSide(); $('.main') && $('.main').style.removeProperty('--page-tint'); if (typeof LyrUI !== 'undefined' && LyrUI.isOpen()) LyrUI.close();
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(location.search);
    const nav = NAV_OF[path.split('/')[1] || ''] || (/^\/(playlist|collection)\//.test(path) ? 'library' : '');
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    view.scrollTop = 0;
    const r = ROUTES.find(([re]) => re.test(path));
    if (!r) { view.innerHTML = `<div class="empty"><h3>ページが見つかりません</h3><a class="btn btn-ghost" href="/" data-link>ホームへ</a></div>`; return; }
    try { await r[1](path.match(r[0]), params); }
    catch (e) { console.error(e); view.innerHTML = errorHTML(e); }
    document.title = (($('.det h1') || $('.page-title') || {}).textContent || 'ホーム') + ' - Vyslo Music';
    renderSideLib();
  }
  function navigate(url, replace) {
    if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
    route();
  }
  window.addEventListener('popstate', route);

  /* ───────── Events (delegation) ───────── */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.origin === location.origin) {
      e.preventDefault(); e.stopPropagation();
      navigate(a.getAttribute('href'));
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) handleAct(act.dataset.act, act, e);
    const seg = e.target.closest('[data-set] button');
    if (seg) { const k = seg.parentElement.dataset.set; settings[k] = seg.dataset.v; saveSettings(); applySettings(k); vSettings(); }
    const sw = e.target.closest('[data-switch]');
    if (sw) { const k = sw.dataset.switch; settings[k] = !settings[k]; saveSettings(); applySettings(k); vSettings(); }
    if (!e.target.closest('#ctxMenu') && !e.target.closest('[data-act="menu"]')) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('card')) handleAct('open', e.target, e);
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); P.toggle(); }
    if (e.key === '/' ) { e.preventDefault(); $('#searchInput').focus(); }
    if (e.shiftKey && e.key === 'N') P.next();
    if (e.shiftKey && e.key === 'P') P.prev();
  });

  function playPage(shuffle) {
    if (!PAGE) return;
    const tracks = PAGE.tracks || [];
    if (tracks.length) {
      // このページの曲を再生中にシャッフルを押したら、本家と同じくシャッフルのオン/オフを切り替える
      const q = P.state.queue || [];
      const same = q.length === tracks.length && tracks.every((t) => q.some((x) => x.uri === t.uri));
      if (shuffle && same) { P.toggleShuffle(); toast(P.state.shuffle ? 'シャッフルをオンにしました' : 'シャッフルをオフにしました(元の曲順に戻しました)'); return; }
      if (shuffle) P.toggleShuffle(true);
      const start = shuffle ? Math.floor(Math.random() * tracks.length) : 0;
      P.play(tracks, start, PAGE.ctx);
    } else if (PAGE.ctx) P.play([], 0, PAGE.ctx);
  }

  async function playEntity(it) {
    try {
      if (it.liked) { const t = likedTracks(); if (t.length) P.play(t, 0); else toast('お気に入りの曲はまだありません'); return; }
      if (it.local) { const p = PL.get(it.id); if (p && p.tracks.length) P.play(p.tracks, 0); else toast('このプレイリストには曲がありません'); return; }
      if (isSp(it) && it.type !== 'track' && it.type !== 'episode') { P.play([], 0, { uri: it.uri, type: it.type, id: it.id, name: it.name, img: it.img }); return; }
      if (it.type === 'track' || it.type === 'episode') { P.play([it], 0); return; }
      if (it.type === 'album') { const a = await api(`/api/album/${it.id}`); a.tracks.forEach((t) => { t.img = t.img || a.img; }); P.play(a.tracks, 0, { uri: a.uri, type: 'album', id: a.id, name: a.name, img: a.img }); return; }
      if (it.type === 'artist') { const a = await api(`/api/artist/${it.id}`); if (a.tracks.length) P.play(a.tracks, 0); else P.play([], 0, { uri: a.uri, type: 'artist', id: a.id, name: a.name, img: a.img }); return; }
      if (it.type === 'show') { const s = await api(`/api/show/${it.id}`); P.play(s.episodes, 0); }
    } catch (e) { toast(e.message, true); }
  }

  function handleAct(act, el, e) {
    const ref = getItem(el);
    switch (act) {
      case 'open': {
        if (!ref) return;
        if (e.target.closest('a,button')) return;
        navigate(pathOf(ref.item));
        break;
      }
      case 'playcard': e.stopPropagation(); if (ref) playEntity(ref.item); break;
      case 'playrow': {
        if (!ref || e.target.closest('a,button')) return;
        const items = ref.L.items;
        const isPageList = PAGE && PAGE.tracks === items;
        P.play(items, ref.i, isPageList ? PAGE.ctx : ref.L.ctx);
        break;
      }
      case 'playmain': {
        if (!ref) return;
        const it = ref.item;
        if (PAGE && PAGE.tracks && PAGE.tracks.length && (it.type !== 'track' && it.type !== 'episode')) P.play(PAGE.tracks, 0, PAGE.ctx);
        else if (PAGE && PAGE.ctx && (!PAGE.tracks || !PAGE.tracks.length)) P.play([], 0, PAGE.ctx);
        else playEntity(it);
        break;
      }
      case 'shuffleplay': playPage(true); break;
      case 'playpage': playPage(false); break;
      case 'shufflepage': playPage(true); break;
      case 'fav': if (ref) { e.stopPropagation(); const on = Favs.toggle(ref.item); el.classList.toggle('on', on); syncLike(); if (PAGE && PAGE.liked && !on) route(); } break;
      case 'follow': if (ref) { const on = Follow.toggle(ref.item); el.classList.toggle('on', on); el.textContent = on ? 'フォロー中' : 'フォローする'; } break;
      case 'newpl': createPlaylist(); break;
      case 'export': {
        const data = { app: 'vyslo-music', v: 1, at: new Date().toISOString(), playlists: PL.all(), favs: Favs.all(), follows: Follow.all(), history: Hist.all() };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        a.download = `vyslo-music-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        toast('バックアップを書き出しました');
        break;
      }
      case 'import': {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
        inp.onchange = async () => {
          try {
            const d = JSON.parse(await inp.files[0].text());
            if (d.app !== 'vyslo-music') throw new Error('Vyslo Musicのバックアップではありません');
            const merge = (key, list, keyOf) => { const cur = store.get(key, []); const seen = new Set(cur.map(keyOf)); store.set(key, [...cur, ...(list || []).filter((x) => x && !seen.has(keyOf(x)))]); };
            merge('vm-playlists', d.playlists, (x) => x.id);
            merge('vm-favs', d.favs, (x) => x.uri);
            merge('vm-follows', d.follows, (x) => x.uri);
            merge('vm-history', d.history, (x) => x.uri);
            toast('バックアップを読み込みました'); libChanged(); route();
          } catch (er) { toast('読み込めませんでした: ' + er.message, true); }
        };
        inp.click();
        break;
      }
      case 'editpl': if (CUR_PL && PAGE && PAGE.playlist) editPlaylist(CUR_PL); break;
      case 'pladd': if (ref && CUR_PL) { e.stopPropagation(); const n = PL.add(CUR_PL, [ref.item]); toast(n ? `「${PL.get(CUR_PL).name}」に追加しました` : 'すでに追加されています'); if (n) { const y = view.scrollTop; const q = $('#plFind').value; vPlaylist(CUR_PL); $('#plFind').value = q; $('#plFind').dispatchEvent(new Event('input')); view.scrollTop = y; } } break;
      case 'menu': e.stopPropagation(); if (ref) openMenu(ref.item, el); break;
      case 'clearhist': { const u = undoable(['vm-history'], '履歴を消去しました'); Hist.clear(); u(); route(); break; }
      case 'openlyrics': if (ref) LyrUI.open(ref.item); break;
      case 'clearsearch': store.set('vm-searches', []); route(); break;
      case 'clearresolve': try { localStorage.removeItem('vm-resolve'); } catch (er) {} toast('消去しました'); break;
      case 'playcharts': if (CHARTS.length) P.play(CHARTS, 0); else api('/api/charts').then((d) => { CHARTS = d.songs || []; P.play(CHARTS, 0); }).catch((er) => toast(er.message, true)); break;
      default: break;
    }
  }

  /* ───────── Context menu ───────── */
  const menu = $('#ctxMenu');
  function openMenu(it, anchor) {
    const playable = it.type === 'track' || it.type === 'episode';
    const fav = Favs.has(it.uri);
    const ref = getItem(anchor);
    const inPl = ref && ref.L && ref.L.pl ? ref.L.pl : null;
    if (it.local || it.liked) {
      menu.innerHTML = `<button data-m="play">${I.play}再生</button>` + (it.local ? `<hr><button data-m="editpl">${I.edit}詳細を編集</button><button data-m="dup">${I.plus}複製</button><hr><button data-m="delpl" class="danger">${I.trash}削除</button>` : '');
    } else menu.innerHTML = `
      ${playable ? `<button data-m="next">${I.next}次に再生</button><button data-m="queue">${I.queue}キューに追加</button><hr>` : `<button data-m="play">${I.play}再生</button><hr>`}
      ${it.type === 'artist' || it.type === 'show' ? '' : `<button data-m="fav">${I.heart}${it.type === 'album' || it.type === 'playlist' ? (fav ? 'ライブラリから削除' : 'ライブラリに保存') : (fav ? 'お気に入りの曲から削除' : 'お気に入りの曲に追加')}</button>`}
      ${it.type === 'track' && it.album && it.album.id ? `<a href="/album/${esc(it.album.id)}" data-link>${I.disc}アルバムを表示</a>` : ''}
      ${it.type === 'track' && it.artists && it.artists[0] && it.artists[0].id ? `<a href="/artist/${esc(it.artists[0].id)}" data-link>${I.user}アーティストを表示</a>` : ''}
      ${it.type === 'episode' && it.show && it.show.id ? `<a href="/show/${esc(it.show.id)}" data-link>${I.mic}番組を表示</a>` : ''}
      <hr>
      ${playable || it.type === 'album' ? `<button data-m="addpl">${I.plus}プレイリストに追加</button>` : ''}
      ${inPl ? `<button data-m="rmpl">${I.trash}このプレイリストから削除</button>${ref.i > 0 ? `<button data-m="mvup">${I.up}上へ移動</button>` : ''}${ref.i < ref.L.items.length - 1 ? `<button data-m="mvdown">${I.down}下へ移動</button>` : ''}` : ''}
      ${it.type === 'artist' || it.type === 'show' ? `<button data-m="follow">${I.user}${Follow.has(it.uri) ? 'フォローを解除' : 'フォローする'}</button>` : ''}
      <hr>
      ${it.type === 'track' && !isSp(it) ? `<button data-m="lyrics">${I.lyr}歌詞を表示</button>` : ''}
      <button data-m="copy">${I.link}リンクをコピー</button>`;
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = r.right - mw, y = r.bottom + 6;
    if (x < 8) x = 8;
    if (y + mh > innerHeight - 100) y = Math.max(8, r.top - mh - 6);
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    menu.onclick = (ev) => {
      const b = ev.target.closest('[data-m]'); if (!b) { if (ev.target.closest('a')) closeMenu(); return; }
      const m = b.dataset.m;
      if (m === 'next') P.addToQueue(it, true);
      if (m === 'queue') P.addToQueue(it, false);
      if (m === 'play') playEntity(it);
      if (m === 'fav') { Favs.toggle(it); syncLike(); if (PAGE && PAGE.liked) route(); }
      if (m === 'copy') { const u = location.origin + (pathOf(it) || '/'); navigator.clipboard && navigator.clipboard.writeText(u).then(() => toast('リンクをコピーしました')); }
      if (m === 'lyrics') LyrUI.open(it);
      if (m === 'addpl') addToPlaylist(it);
      if (m === 'follow') { Follow.toggle(it); if (location.pathname === pathOf(it)) route(); }
      if (m === 'rmpl') { const u = undoable(['vm-playlists'], 'プレイリストから削除しました'); PL.removeAt(inPl, ref.i); u(); route(); }
      if (m === 'mvup') { PL.move(inPl, ref.i, ref.i - 1); route(); }
      if (m === 'mvdown') { PL.move(inPl, ref.i, ref.i + 1); route(); }
      if (m === 'editpl') editPlaylist(it.id);
      if (m === 'dup') { const src = PL.get(it.id); if (src) { const c = PL.create(`${src.name} のコピー`, src.tracks); toast('複製しました'); navigate(`/playlist/${c.id}`); } }
      if (m === 'delpl') deletePlaylist(it.id);
      closeMenu();
    };
  }
  function closeMenu() { menu.hidden = true; }

  /* ───────── Search box & suggest ───────── */
  const sInput = $('#searchInput'), sBox = $('#suggest');
  let sgTimer = null, sgItems = [], sgHl = -1, sgSeq = 0, sgQ = '';
  const sgCache = new Map();
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = sInput.value.trim();
    if (sgHl > 0 && sgItems[sgHl - 1]) { const it = sgItems[sgHl - 1]; hideSuggest(); sInput.blur(); sgPick(it); return; }
    hideSuggest(); sInput.blur();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  });
  function sgRender(q) {
    const kw = `<div class="sg-item sg-kw" data-sg="0"><span class="ph sg-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span><div class="grow ellipsis"><div class="ellipsis">「${esc(q)}」を検索</div></div></div>`;
    sBox.innerHTML = kw + sgItems.map((it, i) => `<div class="sg-item ${it.type}" data-sg="${i + 1}">${it.img ? `<img src="${esc(img(it.img))}" alt="">` : phFor(it.type)}<div class="grow ellipsis"><div class="ellipsis">${esc(it.name)}</div><small>${it.type === 'artist' ? 'アーティスト' : '曲 • ' + esc((it.artists || []).map((a) => a.name).join(', '))}</small></div></div>`).join('');
    sBox.hidden = false;
  }
  function sgFetch() {
    clearTimeout(sgTimer);
    const q = sInput.value.trim();
    if (!q || parseSpotifyLink(q)) { hideSuggest(); return; }
    const my = ++sgSeq;
    const show = (items) => {
      // 古い結果・検索確定後・フォーカスが外れた後は表示しない
      if (my !== sgSeq || document.activeElement !== sInput || sInput.value.trim() !== q) return;
      sgItems = items; sgHl = -1; sgQ = q; sgRender(q);
    };
    // 即時表示: API結果待ちでも「qを検索」だけ出す
    if (document.activeElement === sInput) { sgItems = []; sgHl = -1; sgQ = q; sgRender(q); }
    if (sgCache.has(q)) { show(sgCache.get(q)); return; }
    sgTimer = setTimeout(async () => {
      try {
        const d = await api(`/api/suggest?q=${encodeURIComponent(q)}`);
        sgCache.set(q, d.items || []); if (sgCache.size > 80) sgCache.delete(sgCache.keys().next().value);
        show(d.items || []);
      } catch (e) { if (my === sgSeq) hideSuggest(); }
    }, 200);
  }
  // 日本語変換中(確定前)も本家と同じく候補を出す
  sInput.addEventListener('input', () => sgFetch());
  sInput.addEventListener('compositionend', sgFetch);
  sInput.addEventListener('focus', () => { if (sInput.value.trim()) sgFetch(); });
  sInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 日本語変換中はキー操作を奪わない
    if (sBox.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = sgItems.length + 1;
      if (e.key === 'ArrowDown') sgHl = sgHl + 1 >= n ? -1 : sgHl + 1;
      else sgHl = sgHl - 1 < -1 ? n - 1 : sgHl - 1;
      $$('.sg-item', sBox).forEach((el, i) => el.classList.toggle('hl', i === sgHl));
      const h = sBox.querySelector('.sg-item.hl'); if (h) h.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Escape') { e.preventDefault(); hideSuggest(); }
  });
  sBox.addEventListener('mousedown', (e) => e.preventDefault()); // クリック中にフォーカスを外さない
  sBox.addEventListener('click', (e) => {
    const el = e.target.closest('[data-sg]'); if (!el) return;
    const i = +el.dataset.sg;
    hideSuggest(); sInput.blur();
    if (i === 0) { const q = sInput.value.trim(); navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search'); }
    else if (sgItems[i - 1]) sgPick(sgItems[i - 1]);
  });
  function sgPick(it) {
    if (it.type === 'track') { P.play([it], 0); navigate(`/track/${it.id}`); }
    else navigate(`/${it.type}/${it.id}`);
  }
  sInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== sInput) hideSuggest(); }, 120));
  document.addEventListener('pointerdown', (e) => { if (!sBox.hidden && !e.target.closest('#searchForm')) hideSuggest(); });
  function hideSuggest() { sgSeq++; clearTimeout(sgTimer); sBox.hidden = true; sgHl = -1; $$('.sg-item.hl', sBox).forEach((x) => x.classList.remove('hl')); }

  /* ───────── Sidebar (mobile) ───────── */
  const side = $('#side'), scrim = $('#scrim');
  $('#menuBtn').onclick = () => { side.classList.add('open'); scrim.hidden = false; };
  scrim.onclick = () => closeSide();
  function closeSide() { side.classList.remove('open'); scrim.hidden = true; }
  $('#backBtn').onclick = () => history.back();
  $('#fwdBtn').onclick = () => history.forward();

  /* ───────── Player UI ───────── */
  const el = {
    player: $('#player'), art: $('#plArt'), title: $('#plTitle'), sub: $('#plSub'), like: $('#plLike'),
    play: $('#plPlay'), prev: $('#plPrev'), next: $('#plNext'), shuffle: $('#plShuffle'), repeat: $('#plRepeat'),
    seek: $('#plSeek'), cur: $('#plCur'), dur: $('#plDur'), vol: $('#plVol'), volWrap: $('#plVolWrap'),
    engine: $('#plEngine'), queue: $('#plQueue'), embedToggle: $('#plEmbedToggle'), embedWrap: $('#plEmbedWrap'),
  };
  let seeking = false;
  const setRange = (r, v, max) => { r.value = v; r.style.setProperty('--p', `${max ? (v / max) * 100 : 0}%`); };

  function syncLike() {
    const c = P.state.current;
    el.like.hidden = !c || c.isContext;
    if (c) el.like.classList.toggle('on', Favs.has(c.uri));
    $$('.actions .heart').forEach((b) => { const ref = getItem(b); if (ref) b.classList.toggle('on', Favs.has(ref.item.uri)); });
  }

  P.subscribe((s, why) => {
    const c = s.current;
    if (why === 'track' || why === 'state' || why === 'init' || why === 'engine' || why === 'queue') {
      if (c) {
        el.art.src = c.img ? img(c.img) : '';
        el.title.textContent = c.name || '';
        el.title.href = pathOf(c) || '/';
        el.sub.innerHTML = s.loading ? `<span class="pl-loading"><i class="spin"></i>${s.resolving ? '曲を探しています…' : '読み込み中…'}</span>` : c.isContext ? esc(KIND[c.type] || '') + ' • Spotifyプレーヤーで再生中' : c.type === 'episode' ? esc(c.show ? c.show.name : '') : (artistLinks(c.artists) || 'Spotify');
      }
      syncLike();
      el.player.classList.toggle('playing', !!s.playing);
      el.player.classList.toggle('loading', !!s.loading);
      $$('.tr[data-uri]').forEach((r) => r.classList.toggle('loading', !!s.loading && !!c && r.dataset.uri === c.uri));
      el.engine.textContent = s.loading ? '読込中' : { spotify: 'SPOTIFY', full: 'FULL', preview: '試聴', podcast: 'PODCAST' }[s.source] || '—';
      el.engine.classList.toggle('sdk', (s.source === 'spotify' || s.source === 'full') && !s.resolving);
      el.engine.title = { spotify: 'Spotify公式埋め込みプレーヤーで再生中', full: 'サーバー経由でフル再生中 (Spotifyが使えない環境でも再生できます)', preview: 'Spotifyで見つからなかったため30秒試聴を再生中', podcast: '配信元の音声を再生中' }[s.source] || '';
      el.shuffle.classList.toggle('on', s.shuffle);
      $$('[data-act=shufflepage], [data-act=shuffleplay]').forEach((b) => b.classList.toggle('on', !!s.shuffle));
      el.repeat.classList.toggle('on', s.repeat !== 'off');
      $('.rep-one', el.repeat).hidden = s.repeat !== 'track';
      const ctxMode = !!s.ctx && s.engine === 'embed';
      el.seek.disabled = ctxMode;
      $$('.tr[data-uri]').forEach((r) => r.classList.toggle('playing', !!c && r.dataset.uri === c.uri));
      if (!$('#queueDrawer').hidden) renderQueue();
      embedVisibility();
    }
    if (why === 'progress' || why === 'state' || why === 'track') {
      el.player.classList.toggle('playing', !!s.playing);
      if (el.player.classList.contains('loading') !== !!s.loading) {
        el.player.classList.toggle('loading', !!s.loading);
        $$('.tr[data-uri]').forEach((r) => r.classList.toggle('loading', !!s.loading && !!c && r.dataset.uri === c.uri));
        if (c && !s.loading) el.sub.innerHTML = c.isContext ? esc(KIND[c.type] || '') + ' • Spotifyプレーヤーで再生中' : c.type === 'episode' ? esc(c.show ? c.show.name : '') : (artistLinks(c.artists) || 'Spotify');
      }
      if (!seeking) {
        const dur = s.dur || (c && c.duration_ms) || 0;
        setRange(el.seek, dur ? Math.round((s.pos / dur) * 1000) : 0, 1000);
        el.cur.textContent = fmt(s.pos || 0);
        el.dur.textContent = fmt(dur);
      }
    }
    if (why === 'volume' || why === 'init') syncVol(s);
  });

  el.play.onclick = () => P.toggle();
  el.next.onclick = () => P.next();
  el.prev.onclick = () => P.prev();
  el.shuffle.onclick = () => P.toggleShuffle();
  el.repeat.onclick = () => P.cycleRepeat();
  el.like.onclick = () => { const c = P.state.current; if (c) { Favs.toggle(c); syncLike(); } };
  el.seek.addEventListener('input', () => {
    seeking = true;
    const dur = P.state.dur || (P.state.current && P.state.current.duration_ms) || 0;
    el.seek.style.setProperty('--p', `${el.seek.value / 10}%`);
    el.cur.textContent = fmt((el.seek.value / 1000) * dur);
  });
  el.seek.addEventListener('change', () => {
    const dur = P.state.dur || (P.state.current && P.state.current.duration_ms) || 0;
    P.seek((el.seek.value / 1000) * dur);
    setTimeout(() => { seeking = false; }, 400);
  });
  /* 音量: スライダー / ミュート / 狭い画面ではボタンで開くポップアップ */
  const volNarrow = () => window.matchMedia('(max-width: 1100px)').matches;
  function syncVol(s) {
    const volBtn = $('#plMute'), volNum = $('#plVolNum');
    const v = s.muted ? 0 : s.volume;
    setRange(el.vol, v, 100);
    volNum.textContent = String(v);
    el.volWrap.classList.toggle('muted', v === 0);
    el.volWrap.classList.toggle('low', v > 0 && v < 50);
    volBtn.title = s.muted ? 'ミュート解除 (M)' : 'ミュート (M)';
    el.vol.title = s.volFixed ? 'この端末では本体の音量ボタンで調整してください' : `音量 ${v}%`;
  }
  let volFixedWarned = false;
  const warnFixed = () => { if (P.state.volFixed && !volFixedWarned) { volFixedWarned = true; toast('iPhone/iPadでは本体の音量ボタンで音量を調整してください'); } };
  el.vol.addEventListener('input', () => { P.setVolume(+el.vol.value); warnFixed(); });
  el.vol.addEventListener('wheel', (e) => { e.preventDefault(); P.setVolume(P.state.volume + (e.deltaY < 0 ? 5 : -5)); }, { passive: false });
  $('#plMute').addEventListener('click', (e) => {
    e.stopPropagation();
    if (volNarrow()) { el.volWrap.classList.toggle('open'); return; }
    P.toggleMute(); warnFixed();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#plVolWrap')) el.volWrap.classList.remove('open'); });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('input, textarea, [contenteditable]')) return;
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) { P.toggleMute(); return; }
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); P.setVolume((P.state.muted ? 0 : P.state.volume) + (e.key === 'ArrowUp' ? 5 : -5)); }
  });
  el.embedToggle.onclick = () => { settings.embedVisible = !settings.embedVisible; saveSettings(); embedVisibility(); };
  function embedVisibility() {
    const active = P.state.engine === 'embed';
    el.embedWrap.classList.toggle('off', !active);
    el.embedWrap.classList.toggle('collapsed', active && !settings.embedVisible);
    el.embedToggle.classList.toggle('on', active && settings.embedVisible);
    el.embedToggle.style.display = active ? '' : 'none';
    document.body.classList.toggle('has-embed', active && settings.embedVisible);
  }

  /* Queue drawer */
  const drawer = $('#queueDrawer');
  el.queue.onclick = () => { drawer.hidden = !drawer.hidden; if (!drawer.hidden) renderQueue(); };
  $('#queueClose').onclick = () => { drawer.hidden = true; };
  $('#queueClear').onclick = () => {
    const sn = P.snapshotQueue(); P.clearQueue(); renderQueue();
    toast('キューを消去しました', false, { label: '元に戻す', fn: () => { P.restoreSnapshot(sn); renderQueue(); } });
  };
  function renderQueue() {
    const s = P.state;
    const row = (t, i, cur) => `<div class="q-item${cur ? ' cur' : ''}" data-qi="${i}">${t.img ? `<img src="${esc(img(t.img))}" alt="" loading="lazy">` : phFor(t.type)}<div class="grow"><b>${esc(t.name)}</b><small>${esc((t.artists || []).map((a) => a.name).join(', ') || (t.show && t.show.name) || '')}</small></div>${cur ? '' : `<button class="icon-btn sm" data-qrm="${i}" aria-label="削除">${I.x}</button>`}</div>`;
    let html = '';
    if (s.ctx) html += `<h4>再生中</h4>${row({ name: s.ctx.name, img: s.ctx.img, type: s.ctx.type, artists: [{ name: KIND[s.ctx.type] }] }, -1, true)}<p class="muted" style="padding:.5rem .6rem;font-size:.82rem">このコンテキストの曲順はSpotifyプレーヤー側で管理されます。</p>`;
    else if (s.queue[s.index]) html += `<h4>再生中</h4>${row(s.queue[s.index], s.index, true)}`;
    const up = s.queue.map((t, i) => [t, i]).filter(([, i]) => i > s.index);
    html += `<h4>次に再生 (${up.length})</h4>` + (up.length ? up.map(([t, i]) => row(t, i, false)).join('') : '<p class="muted" style="padding:.5rem .6rem;font-size:.85rem">キューは空です</p>');
    $('#queueList').innerHTML = html;
  }
  $('#queueList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-qrm]');
    if (rm) { const sn = P.snapshotQueue(); P.removeAt(+rm.dataset.qrm); renderQueue(); toast('キューから削除しました', false, { label: '元に戻す', fn: () => { P.restoreSnapshot(sn); renderQueue(); } }); return; }
    const it = e.target.closest('[data-qi]');
    if (it && +it.dataset.qi >= 0 && +it.dataset.qi !== P.state.index) P.jump(+it.dataset.qi);
  });

  /* ───────── Settings apply ───────── */
  function applySettings(k) {
    if (!k || k === 'theme') { document.documentElement.setAttribute('data-theme', settings.theme); try { localStorage.setItem('vm-theme', settings.theme); } catch (e) {} }
    if (!k || k === 'embedVisible') embedVisibility();
  }

  /* ───────── モーダル ───────── */
  const modal = $('#modal'), modalBox = $('#modalBox');
  function openModal(html, onReady) {
    modalBox.innerHTML = html; modal.hidden = false;
    onReady && onReady(modalBox);
    const f = modalBox.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
  }
  function closeModal() { modal.hidden = true; modalBox.innerHTML = ''; }
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  function createPlaylist(items) {
    const p = PL.create('', items || []);
    toast(items && items.length ? `「${p.name}」を作成して追加しました` : 'プレイリストを作成しました');
    navigate(`/playlist/${p.id}`);
    if (!items || !items.length) setTimeout(() => editPlaylist(p.id, true), 120);
    return p;
  }
  function editPlaylist(id, isNew) {
    const p = PL.get(id); if (!p) return;
    openModal(`<h3>${isNew ? 'プレイリストの名前を付ける' : '詳細の編集'}</h3>
      <form id="plForm"><div class="m-row">
        <div class="m-cover">${cover(PL.card(p))}</div>
        <div class="grow">
          <label for="plName">名前</label><input id="plName" maxlength="100" value="${esc(p.name)}" autofocus />
          <label for="plDesc">説明 (任意)</label><textarea id="plDesc" maxlength="300" placeholder="説明を追加">${esc(p.desc || '')}</textarea>
        </div></div>
        <div class="m-actions"><button type="button" class="btn btn-ghost sm" id="mCancel">キャンセル</button><button class="btn btn-grad sm" type="submit">保存</button></div>
      </form>`, (box) => {
      $('#mCancel', box).onclick = closeModal;
      const nm = $('#plName', box); nm.select();
      $('#plForm', box).onsubmit = (e) => {
        e.preventDefault();
        const name = nm.value.trim();
        if (!name) { nm.focus(); toast('名前を入力してください', true); return; }
        PL.update(id, { name, desc: $('#plDesc', box).value.trim() });
        closeModal(); if (location.pathname === `/playlist/${id}`) route();
      };
    });
  }
  function deletePlaylist(id) {
    const p = PL.get(id); if (!p) return;
    openModal(`<h3>ライブラリから削除しますか</h3><p>「${esc(p.name)}」を削除します。この操作は取り消せません。</p>
      <div class="m-actions"><button class="btn btn-ghost sm" id="mCancel">キャンセル</button><button class="btn btn-danger btn sm" id="mOk">削除</button></div>`, (box) => {
      $('#mCancel', box).onclick = closeModal;
      $('#mOk', box).onclick = () => { const u = undoable(['vm-playlists'], 'プレイリストを削除しました', () => navigate(`/playlist/${id}`)); PL.remove(id); closeModal(); u(); if (location.pathname === `/playlist/${id}`) navigate('/library', true); };
    });
  }
  async function addToPlaylist(it) {
    let items = [it];
    if (it.type === 'album') {
      try { const a = await api(`/api/album/${it.id}`); a.tracks.forEach((t) => { t.img = t.img || a.img; }); items = a.tracks; } catch (e) { toast(e.message, true); return; }
    }
    const pls = PL.all();
    const has = (p) => items.length === 1 && p.tracks.some((t) => t.uri === items[0].uri);
    openModal(`<h3>プレイリストに追加</h3>
      <div class="pick">
        <button data-new="1"><span class="lc">${I.plus}</span><span><b>新しいプレイリスト</b></span></button>
        ${pls.map((p) => `<button data-pid="${esc(p.id)}"><span class="lc">${mosaic(plArts(p))}</span><span class="grow ellipsis"><b>${esc(p.name)}</b><small>${p.tracks.length}曲</small></span>${has(p) ? '<span class="chk">追加済み</span>' : ''}</button>`).join('')}
      </div>
      <div class="m-actions"><button class="btn btn-ghost sm" id="mCancel">閉じる</button></div>`, (box) => {
      $('#mCancel', box).onclick = closeModal;
      box.querySelector('.pick').onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        closeModal();
        if (b.dataset.new) { createPlaylist(items); return; }
        const n = PL.add(b.dataset.pid, items);
        const p = PL.get(b.dataset.pid);
        toast(n ? `「${p.name}」に${items.length > 1 ? n + '曲' : ''}追加しました` : 'すでにプレイリストに入っています');
        if (location.pathname === `/playlist/${p.id}`) route();
      };
    });
  }

  /* ───────── サイドバー: マイライブラリ ───────── */
  let sideFilter = store.get('vm-side-filter', 'all');
  let sideSort = store.get('vm-side-sort', 'recent');
  const SORTS = [['recent', '最近'], ['added', '最近追加'], ['alpha', 'アルファベット順'], ['creator', '作成者']];
  const creatorOf = (it) => it.liked || it.local ? 'あなた' : it.type === 'artist' ? it.name || '' : ((it.artists || [])[0] || {}).name || (it.owner && it.owner.name) || '';
  function sortLib(items) {
    const pinned = items.filter((x) => x.liked), rest = items.filter((x) => !x.liked);
    const coll = new Intl.Collator('ja');
    if (sideSort === 'alpha') rest.sort((x, y) => coll.compare(x.name || '', y.name || ''));
    else if (sideSort === 'creator') rest.sort((x, y) => coll.compare(creatorOf(x), creatorOf(y)) || coll.compare(x.name || '', y.name || ''));
    else if (sideSort === 'added') rest.sort((x, y) => (y.created || y.at || 0) - (x.created || x.at || 0));
    else rest.sort((x, y) => (y.at || 0) - (x.at || 0));
    return [...pinned, ...rest];
  }
  function renderSideLib() {
    $('#sideChips').innerHTML = LIB_FILTERS.map(([k, n]) => `<button data-sf="${k}" class="${k === sideFilter ? 'on' : ''}">${n}</button>`).join('');
    $('#sideSortName').textContent = (SORTS.find((x) => x[0] === sideSort) || SORTS[0])[1];
    const q = ($('#sideFilter').value || '').trim().toLowerCase();
    let items = sortLib(libItems(sideFilter));
    if (q) items = items.filter((x) => (x.name || '').toLowerCase().includes(q) || (x.artists || []).some((a) => (a.name || '').toLowerCase().includes(q)));
    const curPath = location.pathname;
    const k = reg(items);
    $('#sideLib').innerHTML = (items.length ? `<div data-l="${k}" style="display:contents">${items.map((it, i) => `
      <a class="lib-row${pathOf(it) === curPath ? ' active' : ''}" href="${esc(pathOf(it))}" data-link data-i="${i}" title="${esc(it.name)}" ${it.local ? `data-droppl="${esc(it.id)}"` : it.liked ? 'data-droppl="liked"' : ''}>
        <span class="lc${it.type === 'artist' ? ' round' : ''}${it.liked ? ' liked' : ''}">${it.liked ? I.heart : cover(it)}</span>
        <span class="lt"><b>${esc(it.name)}</b><small>${libSub(it)}</small></span>
      </a>`).join('')}</div>` : '') +
      (!q && sideFilter === 'all' && !PL.all().length ? `<div class="lib-empty"><b>最初のプレイリストを作成しよう</b><p>簡単に作れます。お手伝いします。</p><button class="btn btn-grad sm" data-act="newpl">プレイリストを作成する</button></div>` : '') +
      (!q && sideFilter === 'all' && !Follow.all().length ? `<div class="lib-empty"><b>フォローするアーティストを探そう</b><p>お気に入りのアーティストをフォローすると、ここに表示されます。</p><a class="btn btn-ghost sm" href="/search?type=artist" data-link>アーティストを探す</a></div>` : '') +
      (q && !items.length ? '<p class="muted" style="padding:.6rem .8rem;font-size:.9rem">見つかりませんでした</p>' : '');
    chipArrows();
  }
  libChanged = () => renderSideLib();
  $('#sideChips').addEventListener('click', (e) => { const b = e.target.closest('[data-sf]'); if (!b) return; sideFilter = b.dataset.sf === sideFilter && b.dataset.sf !== 'all' ? 'all' : b.dataset.sf; store.set('vm-side-filter', sideFilter); renderSideLib(); });
  $('#sideFilter').addEventListener('input', () => renderSideLib());
  $('#sideCreate').onclick = () => createPlaylist();

  // チップ: 横スクロール (ホイールでも動く) と左右の矢印
  const chipsEl = $('#sideChips');
  function chipArrows() {
    const max = chipsEl.scrollWidth - chipsEl.clientWidth;
    $('#chipL').hidden = chipsEl.scrollLeft <= 2;
    $('#chipR').hidden = max <= 2 || chipsEl.scrollLeft >= max - 2;
  }
  chipsEl.addEventListener('scroll', chipArrows, { passive: true });
  chipsEl.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && chipsEl.scrollWidth > chipsEl.clientWidth) { e.preventDefault(); chipsEl.scrollLeft += e.deltaY; } }, { passive: false });
  $('#chipL').onclick = () => chipsEl.scrollBy({ left: -160, behavior: 'smooth' });
  $('#chipR').onclick = () => chipsEl.scrollBy({ left: 160, behavior: 'smooth' });

  // ライブラリ内検索: 本家と同じく虫めがねを押すと開く
  const sBoxLib = $('#sideSearchBox'), sFilter = $('#sideFilter');
  $('#sideSearchBtn').onclick = () => { sBoxLib.classList.add('open'); sFilter.focus(); };
  sFilter.addEventListener('blur', () => { if (!sFilter.value) sBoxLib.classList.remove('open'); });
  sFilter.addEventListener('keydown', (e) => { if (e.key === 'Escape') { sFilter.value = ''; renderSideLib(); sFilter.blur(); } });

  // 並べ替えメニュー
  $('#sideSort').onclick = (e) => {
    e.stopPropagation();
    let m = $('#sortMenu');
    if (m) { m.remove(); return; }
    m = document.createElement('div'); m.className = 'menu sort-menu'; m.id = 'sortMenu';
    m.innerHTML = '<div class="menu-label">並べ替え</div>' + SORTS.map(([k, n]) => `<button data-sort="${k}" class="${k === sideSort ? 'on' : ''}"><span>${n}</span>${k === sideSort ? I.checkS : ''}</button>`).join('');
    document.body.appendChild(m);
    const r = e.currentTarget.getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px'; m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px';
    m.onclick = (ev) => { const b = ev.target.closest('[data-sort]'); if (!b) return; sideSort = b.dataset.sort; store.set('vm-side-sort', sideSort); m.remove(); renderSideLib(); };
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
  };

  /* ───────── サイドバーの幅 (ドラッグで変更 / 折りたたみ) ───────── */
  const SideW = {
    MINI: 72,
    isMobile: () => window.innerWidth <= 640,
    auto() { const w = window.innerWidth; return w >= 1500 ? 380 : w >= 1200 ? 340 : w >= 900 ? 300 : this.MINI; },
    max() { return Math.max(this.MINI, Math.min(620, window.innerWidth - 16 - 460)); },
    apply(w, save) {
      const sideEl = $('#side');
      if (this.isMobile()) { document.documentElement.style.removeProperty('--side-w'); sideEl.classList.remove('mini', 'wide'); return; }
      if (w == null) w = store.get('vm-side-w', null);
      if (w == null) w = this.auto();
      let v = w < 180 ? this.MINI : Math.min(Math.max(240, w), this.max());
      if (v < 240) v = this.MINI; // 画面が狭いときは自動で折りたたむ
      document.documentElement.style.setProperty('--side-w', v + 'px');
      sideEl.classList.toggle('mini', v === this.MINI);
      sideEl.classList.toggle('wide', v >= 460);
      if (save) { store.set('vm-side-w', w < 180 ? this.MINI : v); if (v !== this.MINI) store.set('vm-side-last', v); }
      chipArrows();
    },
    cur() { return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--side-w'), 10) || this.auto(); },
    toggleMini() { this.apply(this.cur() === this.MINI ? Math.max(store.get('vm-side-last', 0) || 0, this.auto(), 300) : this.MINI, true); },
  };
  $('#sideCollapse').onclick = () => {
    if (SideW.isMobile()) { closeSide(); navigate('/library'); return; }
    SideW.toggleMini();
  };
  $('#sideExpand').onclick = () => SideW.apply(SideW.cur() >= 460 ? 340 : 520, true);
  (() => {
    const h = $('#sideResize'); let drag = null;
    h.addEventListener('pointerdown', (e) => { if (SideW.isMobile()) return; drag = { x: e.clientX, w: SideW.cur() }; h.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); e.preventDefault(); });
    h.addEventListener('pointermove', (e) => { if (!drag) return; const w = drag.w + (e.clientX - drag.x); SideW.apply(w < 180 ? SideW.MINI : w, false); });
    const end = (e) => { if (!drag) return; const w = drag.w + (e.clientX - drag.x); drag = null; document.body.classList.remove('resizing'); SideW.apply(w < 180 ? SideW.MINI : w, true); };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    h.addEventListener('dblclick', () => SideW.toggleMini());
  })();
  let rzT = null;
  window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => SideW.apply(), 80); });
  SideW.apply();

  /* ───────── ドラッグ&ドロップ (曲をプレイリストへ / 並べ替え) ───────── */
  let drag = null;
  document.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.tr[data-i]');
    if (!row) return;
    const ref = getItem(row); if (!ref || !ref.item) return;
    drag = { item: ref.item, i: ref.i, pl: ref.L.pl || null, row };
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copyMove';
    try { e.dataTransfer.setData('text/plain', ref.item.name || ''); } catch (er) {}
  });
  document.addEventListener('dragend', () => { if (drag && drag.row) drag.row.classList.remove('dragging'); drag = null; $$('.drop, .drop-above, .drop-below').forEach((x) => x.classList.remove('drop', 'drop-above', 'drop-below')); });
  document.addEventListener('dragover', (e) => {
    if (!drag) return;
    const side = e.target.closest && e.target.closest('[data-droppl]');
    const row = e.target.closest && e.target.closest('.tr[data-i]');
    $$('.drop, .drop-above, .drop-below').forEach((x) => x.classList.remove('drop', 'drop-above', 'drop-below'));
    if (side) { e.preventDefault(); side.classList.add('drop'); return; }
    if (row && drag.pl) { const r2 = getItem(row); if (r2 && r2.L.pl === drag.pl) { e.preventDefault(); const rc = row.getBoundingClientRect(); row.classList.add(e.clientY < rc.top + rc.height / 2 ? 'drop-above' : 'drop-below'); } }
  });
  document.addEventListener('drop', (e) => {
    if (!drag) return;
    const side = e.target.closest && e.target.closest('[data-droppl]');
    const row = e.target.closest && e.target.closest('.tr[data-i]');
    if (side) {
      e.preventDefault();
      const id = side.dataset.droppl;
      if (id === 'liked') { if (!Favs.has(drag.item.uri)) { Favs.toggle(drag.item); syncLike(); } else toast('すでにお気に入りの曲に入っています'); }
      else { const n = PL.add(id, [drag.item]); toast(n ? `「${PL.get(id).name}」に追加しました` : 'すでにプレイリストに入っています'); if (location.pathname === `/playlist/${id}`) route(); }
    } else if (row && drag.pl) {
      const r2 = getItem(row);
      if (r2 && r2.L.pl === drag.pl) {
        e.preventDefault();
        const rc = row.getBoundingClientRect();
        let to = r2.i + (e.clientY < rc.top + rc.height / 2 ? 0 : 1);
        if (to > drag.i) to--;
        if (to !== drag.i) { PL.move(drag.pl, drag.i, to); const y = view.scrollTop; route(); view.scrollTop = y; }
      }
    }
  });

  /* ───────── Lyrics (LRCLIB) ───────── */
  const Lyrics = {
    mem: {},
    key(t) { return t.uri; },
    get(t) {
      if (!t || t.type !== 'track' || !t.name) return Promise.resolve({ found: false });
      const k = this.key(t);
      if (this.mem[k]) return this.mem[k];
      const a = (t.artists && t.artists[0]) || {};
      if (!a.name) return Promise.resolve({ found: false });
      const qs = new URLSearchParams({ track: t.name, artist: a.name, album: (t.album && t.album.name) || '', duration: t.duration_ms || 0, id: /^\d+$/.test(t.id || '') ? t.id : '', aid: a.id || '' });
      const p = api('/api/lyrics?' + qs).catch(() => ({ found: false, error: true }));
      this.mem[k] = p;
      p.then((r) => { if (r.error) delete this.mem[k]; });
      return p;
    },
    // 実際に流れている音源の長さに合う版の歌詞を取り直す (MV・別バージョンなどで長さが違うとき用)
    getForDur(t, durMs) {
      const a = (t.artists && t.artists[0]) || {};
      if (!t.name || !a.name || !durMs) return Promise.resolve(null);
      const qs = new URLSearchParams({ track: t.name, artist: a.name, album: (t.album && t.album.name) || '', duration: Math.round(durMs), id: /^\d+$/.test(t.id || '') ? t.id : '', aid: a.id || '' });
      return api('/api/lyrics?' + qs).catch(() => null);
    },
  };
  /* 歌詞のタイミング調整 (曲ごとに保存) */
  const LyrOff = {
    KEY: 'vm-lyr-off', m: {},
    load() { try { this.m = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch (e) { this.m = {}; } },
    get(uri) { return (uri && +this.m[uri]) || 0; },
    set(uri, ms) {
      if (!uri) return;
      ms = Math.max(-30000, Math.min(30000, Math.round(ms / 100) * 100));
      if (ms) this.m[uri] = ms; else delete this.m[uri];
      const k = Object.keys(this.m); if (k.length > 2000) k.slice(0, 500).forEach((x) => delete this.m[x]);
      try { localStorage.setItem(this.KEY, JSON.stringify(this.m)); } catch (e) {}
    },
  };
  LyrOff.load();
  /* ───────── ジャケットから色を取る (本家と同じく背景色に使う) ───────── */
  const Colors = {
    mem: {},
    get(url) {
      if (!url) return Promise.resolve(null);
      if (this.mem[url]) return this.mem[url];
      this.mem[url] = new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          try {
            const c = document.createElement('canvas'); c.width = c.height = 24;
            const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 24, 24);
            const d = x.getImageData(0, 0, 24, 24).data;
            let r = 0, g = 0, bl = 0, w = 0;
            for (let i = 0; i < d.length; i += 4) {
              const R = d[i], G = d[i + 1], B = d[i + 2];
              const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
              const sat = mx ? (mx - mn) / mx : 0, lum = (mx + mn) / 510;
              const wt = 0.15 + sat * sat * 3 * (lum > 0.12 && lum < 0.92 ? 1 : 0.2);
              r += R * wt; g += G * wt; bl += B * wt; w += wt;
            }
            res(rgbToHsl(r / w, g / w, bl / w));
          } catch (e) { res(null); }
        };
        im.onerror = () => res(null);
        im.src = `/img?u=${encodeURIComponent(url)}`; // 同一オリジン経由で読む
      });
      return this.mem[url];
    },
  };
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s2 = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s2 = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return { h, s: s2, l };
  }
  const hsl = (c, l, sMin = 0.35, sMax = 0.7) => c ? `hsl(${Math.round(c.h)} ${Math.round(Math.min(sMax, Math.max(sMin, c.s)) * 100)}% ${Math.round(l * 100)}%)` : null;
  // 詳細ページのヘッダーに色を付ける
  function tintPage(url) {
    const main = $('.main');
    main.style.removeProperty('--page-tint');
    if (!url) return;
    const path = location.pathname;
    Colors.get(url).then((c) => { if (!c || location.pathname !== path) return; main.style.setProperty('--page-tint', `linear-gradient(180deg, ${hsl(c, 0.32, 0.3, 0.65)} 0%, transparent 100%)`); });
  }

  const LyrUI = {
    panel: $('#lyrPanel'), body: $('#lyrBody'), btn: $('#plLyrics'), resync: $('#lyrResync'),
    item: null, data: null, lines: [], cur: -1, synced: false, userScroll: 0, durTried: null, raf: 0, align: null, alignKey: '', alignLag: 0,
    off: $('#lyrOff'), offVal: $('#lyrOffVal'),
    isOpen() { return !this.panel.hidden; },
    open(it) {
      this.panel.hidden = false; this.btn.classList.add('on'); document.body.classList.add('lyr-open');
      this.show(it || P.state.current);
      this.loop();
    },
    close() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } this.panel.hidden = true; this.btn.classList.remove('on'); document.body.classList.remove('lyr-open'); },
    toggle() { if (this.isOpen()) this.close(); else this.open(); },
    empty(title, sub) { this.body.className = 'lyr-body'; this.body.innerHTML = `<div class="lyr-empty"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`; this.resync.hidden = true; },
    color(it) {
      this.panel.style.setProperty('--lyr-bg', '#4b3a66');
      if (!it || !it.img) return;
      Colors.get(it.img).then((c) => { if (c && this.item === it) this.panel.style.setProperty('--lyr-bg', hsl(c, 0.36, 0.38, 0.62)); });
    },
    async show(it) {
      this.item = it; this.data = null; this.lines = []; this.cur = -1; this.synced = false; this.userScroll = 0; this.durTried = null;
      this.align = null; this.alignKey = ''; this.alignFailed = ''; this.setAuto('');
      this.off.hidden = true;
      $('#lyrTitle').textContent = it ? it.name || '' : '再生していません';
      $('#lyrSub').textContent = it ? ((it.artists || []).map((a) => a.name).join(', ') || '') : '';
      $('#lyrArt').src = it && it.img ? img(it.img) : '';
      this.color(it);
      if (!it) { this.empty('歌詞を表示するには曲を再生してください'); return; }
      if (it.type !== 'track' || isSp(it) || it.isContext) { this.empty(it.type === 'episode' ? 'ポッドキャストには歌詞がありません' : 'この項目の歌詞は表示できません'); return; }
      this.body.className = 'lyr-body';
      this.body.innerHTML = `<div class="lyr-inner">${[72, 55, 80, 48, 66, 58].map((w) => `<div class="lyr-sk" style="width:${w}%"></div>`).join('')}</div>`;
      const L = await Lyrics.get(it);
      if (this.item !== it) return;
      this.data = L;
      if (!L || !L.found) { this.empty(L && L.error ? '歌詞を読み込めませんでした' : '歌詞が見つかりませんでした', L && L.error ? '時間をおいてもう一度お試しください' : 'この曲の歌詞はまだ登録されていないようです'); return; }
      if (L.instrumental) { this.empty('この曲はインストゥルメンタルです', '歌詞はありません'); return; }
      this.render();
    },
    render() {
      const L = this.data, it = this.item;
      this.synced = !!(L.synced && L.synced.length);
      let html;
      if (this.synced) {
        this.lines = L.synced;
        this.showOff();
        html = '<div class="lyr-note" id="lyrNote" style="display:none"></div>' + this.lines.map(([t, w], i) => w ? `<p class="lyr-line sync" data-li="${i}" data-t="${t}">${esc(w)}</p>` : `<p class="lyr-line gap" data-li="${i}"></p>`).join('');
        this.body.className = 'lyr-body';
      } else {
        html = '<div class="lyr-note">この歌詞はまだ曲と同期されていません</div>' + (L.plain || '').split('\n').map((w) => w.trim() ? `<p class="lyr-line">${esc(w)}</p>` : '<p class="lyr-line gap"></p>').join('');
        this.body.className = 'lyr-body lyr-plain';
      }
      this.body.innerHTML = `<div class="lyr-inner">${html}<p class="lyr-credit">歌詞提供: LRCLIB</p></div>`;
      this.cur = -1;
      this.body.scrollTop = 0;
      this.tick(true);
    },
    // フル再生中(曲の長さで判定)のときだけ歌詞を自動で追いかける
    canSync() {
      const s = P.state;
      if (!this.synced || !s.current || !this.item || s.current.uri !== this.item.uri) return false;
      // 長さの差が大きくても(MVの前奏・後奏など)自動補正が効くように、
      // 60秒以上再生していることだけを条件にする
      return s.dur > 60000;
    },
    tick(force) {
      if (!this.isOpen() || !this.synced) return;
      const note = $('#lyrNote');
      const ok = this.canSync();
      if (note) {
        const s = P.state;
        const msg = ok ? '' : (s.current && this.item && s.current.uri === this.item.uri && s.dur > 0 && s.dur <= 60000)
          ? 'プレビュー(30秒)再生中のため歌詞は自動で流れません。ブラウザでSpotifyにログインするとフル再生で同期します' : '';
        note.textContent = msg; note.style.display = msg ? '' : 'none';
      }
      this.body.classList.toggle('nosync', !ok);
      if (!ok) { this.resync.hidden = true; if (this.cur !== -1 || force) { $$('.lyr-line.on, .lyr-line.past', this.body).forEach((e) => e.classList.remove('on', 'past')); this.cur = -1; } return; }
      this.resync.hidden = !this.userScroll;
      this.matchDur();
      // 実際の再生位置 (通知の間も補間) + 曲ごとの調整 + 少しだけ先読み (表示の遅れ分)
      this.ensureAlign();
      const pos = this.toLyr(P.position()) - LyrOff.get(this.item && this.item.uri) + 150;
      let i = -1;
      for (let j = 0; j < this.lines.length; j++) { if (this.lines[j][0] <= pos) i = j; else break; }
      if (i === this.cur && !force) return;
      this.cur = i;
      $$('.lyr-line', this.body).forEach((e) => { const li = +e.dataset.li; e.classList.toggle('on', li === i); e.classList.toggle('past', li < i); });
      if (!this.userScroll) this.scrollToCur();
    },
    // 再生中は画面の更新ごとに歌詞を進める (timeupdate や Spotify の通知を待つとズレて見えるため)
    loop() {
      if (this.raf) return;
      const step = () => {
        this.raf = 0;
        if (!this.isOpen()) return;
        if (P.state.playing && this.synced) this.tick();
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    },
    // フル再生の動画と、歌詞の元の音源とのズレを自動で測って補正する
    ensureAlign() {
      const it = this.item, L = this.data, vid = P.fullVid();
      const key = vid && L && L.duration_ms && it ? `${vid}|${it.uri}|${L.duration_ms}` : '';
      if (key === this.alignKey) return;
      this.alignKey = key; this.align = null; this.setAuto('');
      if (!key) return;
      const a = (it.artists && it.artists[0]) || {};
      this.setAuto('音源に合わせています…', 'busy');
      const qs = new URLSearchParams({ vid, track: it.name || '', artist: a.name || '', lrc: L.duration_ms });
      api('/api/lyrics/align?' + qs).catch(() => null).then((r) => {
        if (this.alignKey !== key) return;
        if (r && r.ok && Array.isArray(r.segs) && r.segs.length) {
          this.align = r.segs.map((x) => [+x[0], +x[1]]).sort((p, q) => p[0] - q[0]);
          const lag = this.align[0][1];
          this.setAuto(Math.abs(lag) >= 100 ? `自動補正 ${lag > 0 ? '+' : '−'}${(Math.abs(lag) / 1000).toFixed(1)}秒` : '自動補正: ズレなし', 'done');
          this.tick(true);
        } else { this.alignFailed = key; this.setAuto(''); }
      });
    },
    setAuto(t, cls) { const e = $('#lyrAuto'); if (!e) return; e.textContent = t; e.hidden = !t; e.className = 'lyr-auto' + (cls ? ' ' + cls : ''); },
    // 動画の再生位置 → 歌詞の時間
    // セグメントは歌詞時間で区切られているので、現在のラグで一旦変換してから
    // 次のセグメントの境界を越えているか確認する (r+l<=p だと境界でズレる)
    toLyr(p) {
      const A = this.align; if (!A || !A.length) return p;
      let lag = A[0][1];
      for (let i = 1; i < A.length; i++) {
        const [r] = A[i];
        if (p - lag >= r) lag = A[i][1];
        else break;
      }
      return p - lag;
    },
    // 歌詞の時間 → 動画の再生位置
    toMedia(t) {
      const A = this.align; if (!A || !A.length) return t;
      let lag = A[0][1];
      for (const [r, l] of A) { if (r <= t) lag = l; else break; }
      return t + lag;
    },
    showOff() {
      const ms = LyrOff.get(this.item && this.item.uri);
      this.off.hidden = !this.synced;
      this.offVal.textContent = (ms > 0 ? '+' : ms < 0 ? '−' : '±') + (Math.abs(ms) / 1000).toFixed(1) + '秒';
      this.offVal.classList.toggle('set', !!ms);
    },
    // 流れている音源と歌詞の長さが違うときは、その長さに合う版の歌詞を探し直す
    matchDur() {
      const s = P.state, it = this.item, L = this.data;
      if (!it || !L || !L.duration_ms || this.durTried === it.uri) return;
      // フル再生(動画)のときは、曲の長さに合う正しい歌詞のまま自動補正でズレを合わせる。
      // ここで動画の長さに合わせて別の歌詞に差し替えると、タイミングの雑な歌詞に
      // 自動補正が二重にかかってズレる (例: 夜の踊り子の MV は 308秒 → 306.8秒版の歌詞に差し替わっていた)。
      // 自動補正ができなかったとき・曲の長さが分からないときだけ差し替える。
      if (P.fullVid() && it.duration_ms && !(this.alignFailed && this.alignFailed === this.alignKey)) return;
      if (!(s.dur > 60000) || s.current !== it && (!s.current || s.current.uri !== it.uri)) return;
      if (Math.abs(s.dur - L.duration_ms) < 2500) { this.durTried = it.uri; return; }
      this.durTried = it.uri;
      const want = s.dur;
      Lyrics.getForDur(it, want).then((N) => {
        if (this.item !== it || !N || !N.found || !(N.synced && N.synced.length) || !N.duration_ms) return;
        if (Math.abs(N.duration_ms - want) + 500 >= Math.abs(L.duration_ms - want)) return;
        this.data = N; Lyrics.mem[Lyrics.key(it)] = Promise.resolve(N);
        this.render();
      });
    },
    scrollToCur() {
      const el = this.body.querySelector(`[data-li="${this.cur}"]`);
      if (el) this.body.scrollTo({ top: el.offsetTop - this.body.clientHeight * 0.32, behavior: 'smooth' });
    },
  };
  LyrUI.btn.onclick = () => LyrUI.toggle();
  LyrUI.off.addEventListener('click', (e) => {
    const b = e.target.closest('[data-off]'); if (!b || !LyrUI.item) return;
    const d = +b.dataset.off, u = LyrUI.item.uri;
    LyrOff.set(u, d ? LyrOff.get(u) + d : 0);
    LyrUI.showOff(); LyrUI.tick(true);
  });
  $('#lyrClose').onclick = () => LyrUI.close();
  // 手動でスクロールしたら自動追従を止め、「歌詞を同期」ボタンを出す (本家と同じ動き)
  const lyrManual = () => { if (LyrUI.canSync()) { LyrUI.userScroll = Date.now(); LyrUI.resync.hidden = false; } };
  LyrUI.body.addEventListener('wheel', lyrManual, { passive: true });
  LyrUI.body.addEventListener('touchmove', lyrManual, { passive: true });
  LyrUI.resync.onclick = () => { LyrUI.userScroll = 0; LyrUI.resync.hidden = true; LyrUI.scrollToCur(); };
  LyrUI.body.addEventListener('click', (e) => {
    const l = e.target.closest('.lyr-line.sync'); if (!l || !LyrUI.canSync()) return;
    LyrUI.userScroll = 0; LyrUI.resync.hidden = true; P.seek(Math.max(0, LyrUI.toMedia(+l.dataset.t) + LyrOff.get(LyrUI.item && LyrUI.item.uri)));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && LyrUI.isOpen()) LyrUI.close(); });
  P.subscribe((s, why) => {
    if (!LyrUI.isOpen()) return;
    if (why === 'track' && s.current && (!LyrUI.item || s.current.uri !== LyrUI.item.uri)) LyrUI.show(s.current);
    else if (why === 'progress' || why === 'state') LyrUI.tick();
  });

  /* ───────── Boot ───────── */
  P.hooks({ onTrackStart: (it) => Hist.add(it), toast });
  async function boot() {
    applySettings();
    try { CONFIG = await api('/api/config'); } catch (e) {}
    $('#topRight').innerHTML = '<span class="engine-badge free-badge" title="登録・ログイン不要">無料・登録不要</span>';
    P.restoreQueue();
    await route();
    setTimeout(() => P.preloadEmbed(), 800);
    setTimeout(() => Follow.refreshAll(), 1500);
  }
  boot();
})();
