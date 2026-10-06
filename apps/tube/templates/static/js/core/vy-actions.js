/* ════════════════════════════════════════════════════════
   動画ページとショートで共通の操作
   - いいねボタン (数はボタンの中に表示・押しても数は変えない)
   - プレイリストに追加ポップアップ
   - ダウンロード選択画面
   ════════════════════════════════════════════════════════ */

const VY_LIKE_SVG = '<svg class="vy-like-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';

/* ── いいね ───────────────────────────────────────────── */
const _vyLikeCache = new Map();
const _vyLikeInflight = new Map();
function vyFetchLikeCount(videoId) {
  if (_vyLikeCache.has(videoId)) return Promise.resolve(_vyLikeCache.get(videoId));
  if (_vyLikeInflight.has(videoId)) return _vyLikeInflight.get(videoId);
  const p = fetch('/api/likes/' + encodeURIComponent(videoId), { signal: AbortSignal.timeout(15000) })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      const n = d && d.likeCount != null ? Number(d.likeCount) : NaN;
      if (n >= 0) { _vyLikeCache.set(videoId, n); return n; }
      return null;
    })
    .catch(() => null)
    .finally(() => _vyLikeInflight.delete(videoId));
  _vyLikeInflight.set(videoId, p);
  return p;
}

/**
 * いいねボタンを初期化する (動画ページ・ショート共通)。
 * btn の中身は「アイコン + 数」に置き換える。押すと「いいねした」状態だけが切り替わり、数は変えない。
 */
function vySetupLikeButton(btn, videoId, getVideo, opts = {}) {
  if (!btn) return;
  if (!btn.querySelector('.vy-like-ic')) {
    btn.innerHTML = `${VY_LIKE_SVG}<span class="vy-like-num" ${opts.countId ? `id="${opts.countId}"` : ''}>…</span>`;
  }
  btn.classList.add('vy-like-btn');
  btn.setAttribute('role', 'button');
  if (btn.tagName !== 'BUTTON') btn.tabIndex = 0;
  const num = btn.querySelector('.vy-like-num');
  btn.dataset.videoId = videoId;

  function setState(on) {
    btn.classList.toggle('is-liked', on);
    btn.classList.toggle('liked', on);   // 旧スタイル互換
    btn.classList.toggle('faved', false);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'いいねを取り消す' : 'いいね';
    btn.setAttribute('aria-label', on ? 'いいね済み (押すと取り消し)' : 'いいね');
  }
  function setCount(n) {
    if (btn.dataset.videoId !== videoId || !num) return;
    num.textContent = (n != null && n > 0) ? jaCount(n) : 'いいね';
  }

  setState(typeof isFavorite === 'function' && isFavorite(videoId));
  const v0 = getVideo() || {};
  const lc = Number(v0.likeCount) || 0;
  const cached = _vyLikeCache.has(videoId) ? Number(_vyLikeCache.get(videoId)) || 0 : 0;
  if (lc > 0 || cached > 0) setCount(Math.max(lc, cached));
  else if (num) num.textContent = '…';
  // 取得元によって古い数が返ることがあるので、新しく取れた数と比べて大きい方 (= 新しい方) を使う
  vyFetchLikeCount(videoId).then(n => {
    const best = Math.max(Number(n) || 0, lc);
    const v = getVideo();
    if (best > 0 && v) v.likeCount = best;
    setCount(best > 0 ? best : null);
    if (typeof opts.onCount === 'function') opts.onCount(best > 0 ? best : null);
  });

  const toggle = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (typeof toggleFavorite !== 'function') return;
    const v = getVideo() || {};
    const on = toggleFavorite({
      videoId,
      title: v.title || '',
      author: v.author || '',
      authorId: v.authorId || '',
      authorThumbnails: v.authorThumbnails || null,
      lengthSeconds: v.lengthSeconds || 0,
      videoThumbnails: v.videoThumbnails || null,
      viewCount: v.viewCount || 0,
      publishedText: v.publishedText || ''
    });
    setState(on);
    btn.classList.remove('vy-pop');
    void btn.offsetWidth;
    btn.classList.add('vy-pop');
  };
  btn.onclick = toggle;
  btn.onkeydown = (e) => { if (btn.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) toggle(e); };
}

/* ── プレイリストに追加 ──────────────────────────────── */
const VY_PL_ICON_ADD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19"><line x1="3" y1="5" x2="15" y2="5"/><line x1="3" y1="10" x2="15" y2="10"/><line x1="3" y1="15" x2="11" y2="15"/><line x1="18" y1="12" x2="18" y2="20"/><line x1="14" y1="16" x2="22" y2="16"/></svg>';
const VY_PL_ICON_ADDED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19"><line x1="3" y1="5" x2="15" y2="5"/><line x1="3" y1="10" x2="15" y2="10"/><line x1="3" y1="15" x2="11" y2="15"/><polyline points="14 18 17 21 22 14" stroke-width="2.3"/></svg>';

function vyRenderPlaylistPopup(popup, videoData, onChange) {
  const videoId = videoData.videoId;
  const pls = getPlaylists();
  const inPls = getPlaylistsContaining(videoId);
  popup.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'watch-pl-head';
  head.textContent = 'プレイリストに保存';
  popup.appendChild(head);

  if (!pls.length) {
    const hint = document.createElement('div');
    hint.className = 'watch-pl-hint';
    hint.textContent = 'プレイリストがありません';
    popup.appendChild(hint);
  } else {
    pls.forEach(pl => {
      const row = document.createElement('label');
      row.className = 'watch-pl-row';
      const checked = inPls.includes(pl.id);
      row.innerHTML = `
        <input type="checkbox" class="watch-pl-check" data-id="${escapeHtml(pl.id)}" ${checked ? 'checked' : ''} />
        <span class="watch-pl-name">${escapeHtml(pl.name)}</span>
        <span class="watch-pl-cnt">${pl.videos.length}本</span>
      `;
      row.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) addVideoToPlaylist(pl.id, videoData);
        else removeVideoFromPlaylist(pl.id, videoId);
        onChange && onChange();
      });
      popup.appendChild(row);
    });
  }

  const divider = document.createElement('div');
  divider.className = 'watch-pl-divider';
  popup.appendChild(divider);

  const newRow = document.createElement('button');
  newRow.type = 'button';
  newRow.className = 'watch-pl-new-btn';
  newRow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 新しいプレイリストを作成';
  newRow.addEventListener('click', (e) => {
    e.stopPropagation();
    const name = prompt('プレイリスト名を入力してください');
    if (name && name.trim()) {
      const pl = createPlaylist(name.trim());
      addVideoToPlaylist(pl.id, videoData);
      onChange && onChange();
      vyRenderPlaylistPopup(popup, videoData, onChange);
    }
  });
  popup.appendChild(newRow);
}

/* ── ダウンロード ─────────────────────────────────────── */
const VyDownload = (() => {
  const streamCache = new Map();
  const capCache = new Map();
  let root = null;
  let state = null;

  const ICON = {
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>',
    combined: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="2" y="4" width="20" height="14" rx="2"/><polygon points="10 8.5 15 11 10 13.5" fill="currentColor" stroke="none"/><path d="M8 21h8"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    caption: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h2M11 11h6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  };

  const TABS = [
    { key: 'combined', label: '動画', sub: '映像＋音声', icon: ICON.combined },
    { key: 'video', label: '映像のみ', sub: '高画質・音声なし', icon: ICON.video },
    { key: 'audio', label: '音声のみ', sub: '音楽・ラジオ向け', icon: ICON.audio },
    { key: 'caption', label: '字幕', sub: 'VTT / SRT', icon: ICON.caption },
    { key: 'thumb', label: 'サムネイル', sub: '画像', icon: ICON.image },
  ];

  function fmtSize(bytes, approx) {
    const b = Number(bytes) || 0;
    if (!b) return '';
    const p = approx ? '約' : '';
    if (b >= 1024 ** 3) return `${p}${(b / 1024 ** 3).toFixed(2)} GB`;
    if (b >= 1024 ** 2) return `${p}${(b / 1024 ** 2).toFixed(b >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
    return `${p}${Math.max(1, Math.round(b / 1024))} KB`;
  }
  function codecOf(f) {
    const t = `${f.encoding || ''} ${f.type || ''}`.toLowerCase();
    if (/av01|av1/.test(t)) return 'AV1';
    if (/vp9|vp09/.test(t)) return 'VP9';
    if (/avc1|h264|h\.264/.test(t)) return 'H.264';
    if (/opus/.test(t)) return 'Opus';
    if (/mp4a|aac/.test(t)) return 'AAC';
    return '';
  }
  function isAudio(f) { return /^audio\//.test(f.type || ''); }
  function extOf(f) {
    const t = (f.type || '').toLowerCase();
    const c = (f.container || '').toLowerCase();
    if (isAudio(f)) return (t.includes('webm') || c === 'webm') ? 'webm' : 'm4a';
    if (t.includes('webm') || c === 'webm') return 'webm';
    return 'mp4';
  }
  function heightOf(f) {
    const n = parseInt(f.qualityLabel || f.resolution || '', 10);
    if (n) return n;
    const m = String(f.size || '').match(/x(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function sizeOf(f, lengthSec) {
    if (Number(f.clen) > 0) return { bytes: Number(f.clen), approx: false };
    const br = Number(f.bitrate) || 0;
    if (br && lengthSec) return { bytes: br * lengthSec / 8, approx: true };
    return { bytes: 0, approx: false };
  }
  function absUrl(url, instance) {
    if (!url) return '';
    if (/^https?:\/\//.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (instance && /^https?:\/\//.test(instance)) return instance.replace(/\/$/, '') + (url.startsWith('/') ? '' : '/') + url;
    return '';
  }
  function safeName(s) {
    return String(s || '').replace(/[\/\\?%*:|"<>\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || 'video';
  }
  function langName(code, label) {
    let name = '';
    try {
      if (code && typeof Intl !== 'undefined' && Intl.DisplayNames) {
        name = new Intl.DisplayNames(['ja'], { type: 'language' }).of(code) || '';
      }
    } catch (_) {}
    if (!name) name = label || code || '字幕';
    if (/auto-generated|自動生成/i.test(label || '')) name += '（自動生成）';
    return name;
  }

  function buildOptions(sd, meta, videoId, instance) {
    const len = Number(meta.lengthSeconds || sd.lengthSeconds) || 0;
    const seen = new Set();
    const combined = [], video = [], audio = [];
    (sd.formatStreams || []).forEach(f => {
      const url = absUrl(f.url, instance);
      if (!url) return;
      const key = 'c' + (f.itag || url);
      if (seen.has(key)) return; seen.add(key);
      const h = heightOf(f);
      const sz = sizeOf(f, len);
      combined.push({
        kind: 'combined', url, ext: extOf(f), h, fps: Number(f.fps) || 0,
        title: f.qualityLabel || (h ? h + 'p' : (f.quality || '標準')),
        codec: codecOf(f), size: sz, sortKey: h * 1000 + (Number(f.fps) || 0)
      });
    });
    (sd.adaptiveFormats || []).forEach(f => {
      const url = absUrl(f.url, instance);
      if (!url || !f.type) return;
      const key = 'a' + (f.itag || url);
      if (seen.has(key)) return; seen.add(key);
      const sz = sizeOf(f, len);
      if (isAudio(f)) {
        const kbps = Math.round((Number(f.bitrate) || 0) / 1000);
        const q = f.audioQuality === 'AUDIO_QUALITY_HIGH' ? '高音質' : f.audioQuality === 'AUDIO_QUALITY_LOW' ? '低音質' : '標準音質';
        const ext = extOf(f);
        audio.push({
          kind: 'audio', url, ext, codec: codecOf(f), kbps, quality: q,
          title: kbps ? `${kbps} kbps` : q,
          rate: Number(f.audioSampleRate) || 0, ch: Number(f.audioChannels) || 0,
          size: sz, sortKey: kbps
        });
      } else if (/^video\//.test(f.type)) {
        const h = heightOf(f);
        const fps = Number(f.fps) || 0;
        video.push({
          kind: 'video', url, ext: extOf(f), h, fps, codec: codecOf(f),
          title: (f.qualityLabel || (h ? h + 'p' : '?')).replace(/p(\d+)$/, 'p'),
          hdr: /hdr/i.test(f.qualityLabel || ''),
          size: sz, sortKey: h * 1000 + fps
        });
      }
    });
    const cPref = { 'H.264': 0, 'VP9': 1, 'AV1': 2 };
    // 別の取得元から同じ画質が重なった場合は、情報が多い方だけ残す
    const dedupe = (list, keyFn) => {
      const m = new Map();
      list.forEach(o => {
        const k = keyFn(o);
        const cur = m.get(k);
        const score = x => (x.size ? 2 : 0) + (x.codec ? 1 : 0) + (x.fps ? 1 : 0);
        if (!cur || score(o) > score(cur)) m.set(k, o);
      });
      return [...m.values()];
    };
    const c2 = dedupe(combined, o => `${o.h}|${o.ext}`);
    combined.length = 0; combined.push(...c2);
    combined.sort((a, b) => b.sortKey - a.sortKey);
    video.sort((a, b) => (b.sortKey - a.sortKey) || ((cPref[a.codec] ?? 9) - (cPref[b.codec] ?? 9)));
    audio.sort((a, b) => b.sortKey - a.sortKey);
    return { combined, video, audio };
  }

  function thumbCandidates(videoId) {
    return [
      { key: 'maxresdefault', label: '最高画質', w: 1280, h: 720 },
      { key: 'sddefault', label: '高画質', w: 640, h: 480 },
      { key: 'hqdefault', label: '標準画質', w: 480, h: 360 },
      { key: 'mqdefault', label: '中画質', w: 320, h: 180 },
    ].map(t => ({ ...t, url: `https://i.ytimg.com/vi/${videoId}/${t.key}.jpg` }));
  }
  // 実在するサムネイルだけ (無いサイズは YouTube が 120×90 の灰色画像を返す)
  function probeThumb(t) {
    return new Promise(resolve => {
      const img = new Image();
      const done = (ok) => { img.onload = img.onerror = null; resolve(ok ? { ...t, w: img.naturalWidth, h: img.naturalHeight } : null); };
      img.onload = () => done(img.naturalWidth > 120);
      img.onerror = () => done(false);
      setTimeout(() => done(false), 8000);
      img.src = wsrv(t.url, t.w);
    });
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'vdl-backdrop';
    root.hidden = true;
    root.innerHTML = `
      <div class="vdl" role="dialog" aria-modal="true" aria-labelledby="vdlTitle">
        <div class="vdl-head">
          <img class="vdl-thumb" alt="" />
          <div class="vdl-head-text">
            <div class="vdl-head-label">${ICON.dl}<span id="vdlTitle">ダウンロード</span></div>
            <div class="vdl-video-title"></div>
          </div>
          <button type="button" class="vdl-close" title="閉じる (Esc)" aria-label="閉じる">${ICON.close}</button>
        </div>
        <div class="vdl-tabs" role="tablist"></div>
        <div class="vdl-body"></div>
        <div class="vdl-foot">
          <div class="vdl-summary"><span class="vdl-summary-label">選択中</span><span class="vdl-summary-text">形式を選んでください</span></div>
          <div class="vdl-foot-actions">
            <div class="vdl-sub-fmt" hidden></div>
            <button type="button" class="vdl-go" disabled>${ICON.dl}<span>ダウンロード</span></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    root.querySelector('.vdl-close').addEventListener('click', close);
    root.querySelector('.vdl-go').addEventListener('click', start);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root && !root.hidden) close(); });
    return root;
  }

  function close() {
    if (!root) return;
    root.classList.remove('open');
    setTimeout(() => { if (!root.classList.contains('open')) root.hidden = true; }, 180);
    document.documentElement.classList.remove('vdl-lock');
  }

  async function loadStreams(videoId, given) {
    const has = (d) => d && ((d.adaptiveFormats || []).length || (d.formatStreams || []).length);
    if (streamCache.has(videoId)) return streamCache.get(videoId);
    let data = null, instance = null;
    try {
      const r = await fetchStream(`/api/stream/${videoId}`);
      data = r.data; instance = r.instanceUrl;
    } catch (_) {}
    // 再生中の取得結果にしか無い形式も足す
    if (has(given && given.data)) {
      if (!has(data)) { data = given.data; instance = given.instanceUrl || instance; }
      else {
        const seen = new Set([...(data.formatStreams || []), ...(data.adaptiveFormats || [])].map(f => f.itag + '|' + (f.qualityLabel || '')));
        (given.data.formatStreams || []).forEach(f => { if (!seen.has(f.itag + '|' + (f.qualityLabel || ''))) (data.formatStreams = data.formatStreams || []).push(f); });
      }
    }
    const res = { data: data || {}, instanceUrl: instance };
    if (has(data)) streamCache.set(videoId, res);
    return res;
  }

  function renderTabs() {
    const tabs = root.querySelector('.vdl-tabs');
    tabs.innerHTML = '';
    TABS.forEach(t => {
      const list = state.opts[t.key];
      const loading = list === null;
      if (!loading && (!list || !list.length)) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vdl-tab' + (state.tab === t.key ? ' active' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.tab === t.key ? 'true' : 'false');
      b.innerHTML = `<span class="vdl-tab-ic">${t.icon}</span><span class="vdl-tab-txt"><b>${t.label}</b><small>${loading ? '確認中…' : `${list.length}件`}</small></span>`;
      b.disabled = loading;
      b.addEventListener('click', () => { state.tab = t.key; renderTabs(); renderBody(); });
      tabs.appendChild(b);
    });
    if (!tabs.children.length) tabs.innerHTML = '';
  }

  function chips(o) {
    const c = [];
    if (o.kind === 'combined' || o.kind === 'video') {
      if (o.fps) c.push(`${o.fps}fps`);
      if (o.hdr) c.push('HDR');
      if (o.codec) c.push(o.codec);
      c.push(o.ext.toUpperCase());
    } else if (o.kind === 'audio') {
      if (o.codec) c.push(o.codec);
      c.push(o.ext.toUpperCase());
      if (o.rate) c.push(`${(o.rate / 1000).toFixed(o.rate % 1000 ? 1 : 0)}kHz`);
      if (o.ch) c.push(o.ch >= 2 ? 'ステレオ' : 'モノラル');
    } else if (o.kind === 'thumb') {
      c.push(`${o.w}×${o.h}`, 'JPG');
    } else if (o.kind === 'caption') {
      if (o.code) c.push(o.code);
    }
    return c.map(x => `<span class="vdl-chip">${escapeHtml(String(x))}</span>`).join('');
  }

  function badge(o) {
    if (o.kind === 'combined' || o.kind === 'video') {
      if (o.h >= 2160) return '4K';
      if (o.h >= 1440) return '2K';
      if (o.h >= 720) return 'HD';
      return 'SD';
    }
    if (o.kind === 'audio') return o.ext === 'm4a' ? 'M4A' : 'WEBM';
    if (o.kind === 'thumb') return 'JPG';
    if (o.kind === 'caption') return 'CC';
    return '';
  }

  function optionTitle(o) {
    if (o.kind === 'audio') return `${o.title}<small>${escapeHtml(o.quality)}</small>`;
    if (o.kind === 'thumb') return `${escapeHtml(o.label)}`;
    if (o.kind === 'caption') return escapeHtml(o.name);
    return escapeHtml(o.title);
  }

  function renderBody() {
    const body = root.querySelector('.vdl-body');
    const key = state.tab;
    const list = state.opts[key];
    body.innerHTML = '';
    if (state.loading) {
      body.innerHTML = '<div class="vdl-loading"><span class="vdl-spin"></span>この動画で使える形式を確認しています…</div>';
      updateFoot();
      return;
    }
    if (!key || !list || !list.length) {
      body.innerHTML = '<div class="vdl-empty">この動画でダウンロードできる形式が見つかりませんでした。<br>時間をおいてもう一度お試しください。</div>';
      updateFoot();
      return;
    }
    const note = {
      combined: 'そのまま再生できる、映像と音声がひとつになったファイルです。',
      video: '高画質の映像だけのファイルです。<b>音声は入っていません。</b>',
      audio: '音声だけのファイルです。M4A は多くの機器でそのまま再生できます。',
      caption: '字幕ファイルです。形式 (VTT / SRT) を右下で選べます。',
      thumb: 'この動画で実際に用意されているサイズだけを表示しています。',
    }[key];
    const n = document.createElement('div');
    n.className = 'vdl-note' + (key === 'video' ? ' warn' : '');
    n.innerHTML = (key === 'video' ? ICON.mute : '') + `<span>${note}</span>`;
    body.appendChild(n);

    const grid = document.createElement('div');
    grid.className = 'vdl-grid vdl-grid-' + key;
    grid.setAttribute('role', 'radiogroup');
    list.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const sel = state.sel && state.sel.kind === key && state.sel.idx === i;
      b.className = 'vdl-opt' + (sel ? ' selected' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', sel ? 'true' : 'false');
      const size = o.size && o.size.bytes ? fmtSize(o.size.bytes, o.size.approx) : '';
      b.innerHTML = `
        <span class="vdl-radio">${ICON.check}</span>
        ${o.kind === 'thumb' ? `<img class="vdl-opt-img" src="${wsrv(o.url, 240)}" alt="" loading="lazy" />` : `<span class="vdl-badge vdl-badge-${escapeHtml(badge(o).toLowerCase())}">${escapeHtml(badge(o))}</span>`}
        <span class="vdl-opt-main">
          <span class="vdl-opt-title">${optionTitle(o)}</span>
          <span class="vdl-chips">${chips(o)}</span>
        </span>
        ${size ? `<span class="vdl-size">${escapeHtml(size)}</span>` : ''}`;
      b.addEventListener('click', () => { state.sel = { kind: key, idx: i }; renderBody(); });
      grid.appendChild(b);
    });
    body.appendChild(grid);
    updateFoot();
  }

  function hasAny() { return ['combined', 'video', 'audio', 'caption', 'thumb'].some(k => state.opts[k] && state.opts[k].length); }

  function selected() {
    if (!state.sel) return null;
    const list = state.opts[state.sel.kind];
    return list ? list[state.sel.idx] : null;
  }

  function updateFoot() {
    const o = selected();
    const txt = root.querySelector('.vdl-summary-text');
    const go = root.querySelector('.vdl-go');
    const sub = root.querySelector('.vdl-sub-fmt');
    sub.hidden = !(o && o.kind === 'caption');
    if (!o) { txt.textContent = '一覧から形式を選んでください'; go.disabled = true; return; }
    const kindLabel = { combined: '動画 (映像＋音声)', video: '映像のみ (音声なし)', audio: '音声のみ', caption: '字幕', thumb: 'サムネイル' }[o.kind];
    const parts = [kindLabel];
    if (o.kind === 'combined' || o.kind === 'video') parts.push(o.title + (o.fps ? ` ${o.fps}fps` : ''), o.codec, o.ext.toUpperCase());
    else if (o.kind === 'audio') parts.push(o.title, o.codec, o.ext.toUpperCase());
    else if (o.kind === 'thumb') parts.push(`${o.w}×${o.h}`, 'JPG');
    else if (o.kind === 'caption') parts.push(o.name, state.capFmt.toUpperCase());
    if (o.size && o.size.bytes) parts.push(fmtSize(o.size.bytes, o.size.approx));
    txt.textContent = parts.filter(Boolean).join(' · ');
    go.disabled = false;
    if (o.kind === 'caption') {
      sub.innerHTML = ['vtt', 'srt'].map(f => `<button type="button" class="vdl-sub-btn${state.capFmt === f ? ' active' : ''}" data-f="${f}">${f.toUpperCase()}</button>`).join('');
      sub.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.capFmt = b.dataset.f; updateFoot(); }));
    }
  }

  function start() {
    const o = selected();
    if (!o) return;
    const base = safeName(state.title);
    let href = '';
    if (o.kind === 'caption') {
      href = `/api/caption/${encodeURIComponent(state.videoId)}?label=${encodeURIComponent(o.label)}&fmt=${state.capFmt}&filename=${encodeURIComponent(`${base}_${o.name}.${state.capFmt}`)}`;
    } else {
      let name;
      if (o.kind === 'thumb') name = `${base}_サムネイル_${o.w}x${o.h}.jpg`;
      else if (o.kind === 'audio') name = `${base}_音声_${o.kbps || ''}kbps.${o.ext}`;
      else if (o.kind === 'video') name = `${base}_${o.title}${o.fps > 30 ? o.fps : ''}_映像のみ.${o.ext}`;
      else name = `${base}_${o.title}.${o.ext}`;
      href = `/download?url=${encodeURIComponent(o.url)}&filename=${encodeURIComponent(name)}`;
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (typeof showCopyToast === 'function') showCopyToast('ダウンロードを開始しました');
  }

  async function open(opts) {
    const videoId = opts.videoId;
    if (!videoId) return;
    ensureRoot();
    const meta = opts.meta || {};
    state = {
      videoId, title: meta.title || videoId, meta, tab: null, sel: null, loading: true, capFmt: 'srt',
      opts: { combined: null, video: null, audio: null, caption: null, thumb: null },
    };
    const myState = state;
    root.querySelector('.vdl-video-title').textContent = meta.title || '';
    const th = root.querySelector('.vdl-thumb');
    th.src = wsrv(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, 320);
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('open'));
    document.documentElement.classList.add('vdl-lock');
    renderTabs(); renderBody();

    const pickTab = () => {
      if (state !== myState) return;
      if (state.streamsDone && (!state.tab || !(state.opts[state.tab] && state.opts[state.tab].length))) {
        state.tab = ['combined', 'video', 'audio', 'caption', 'thumb'].find(k => state.opts[k] && state.opts[k].length) || null;
        if (state.tab && !state.sel) state.sel = { kind: state.tab, idx: 0 };
      }
      renderTabs(); renderBody();
    };

    const streamsP = loadStreams(videoId, opts.streamData).then(r => {
      if (state !== myState) return;
      const o = buildOptions(r.data || {}, meta, videoId, r.instanceUrl);
      state.opts.combined = o.combined; state.opts.video = o.video; state.opts.audio = o.audio;
      if (!state.title || state.title === videoId) state.title = (r.data && r.data.title) || state.title;
    }).catch(() => { if (state === myState) { state.opts.combined = []; state.opts.video = []; state.opts.audio = []; } }).finally(() => { myState.streamsDone = true; myState.loading = false; pickTab(); });

    const thumbsP = Promise.all(thumbCandidates(videoId).map(probeThumb)).then(list => {
      if (state !== myState) return;
      const seen = new Set();
      state.opts.thumb = list.filter(Boolean).filter(t => { const k = t.w + 'x' + t.h; if (seen.has(k)) return false; seen.add(k); return true; })
        .map(t => ({ ...t, kind: 'thumb' }));
    }).finally(pickTab);

    const capsP = (capCache.has(videoId) ? Promise.resolve(capCache.get(videoId))
      : fetch(`/api/captions/${encodeURIComponent(videoId)}`, { signal: AbortSignal.timeout(25000) }).then(r => r.ok ? r.json() : { tracks: [] }).then(d => { capCache.set(videoId, d); return d; }))
      .then(d => {
        if (state !== myState) return;
        const tracks = (d && d.tracks) || [];
        state.opts.caption = tracks.map(t => ({ kind: 'caption', label: t.label, code: t.languageCode, name: langName(t.languageCode, t.label) }))
          .sort((a, b) => (b.code === 'ja') - (a.code === 'ja'));
      }).catch(() => { if (state === myState) state.opts.caption = []; }).finally(pickTab);

  }

  return { open, close };
})();
