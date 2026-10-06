// ===== 元の言語のタイトルに置き換える (取得元によって英語訳になることがあるため) =====
const _vyOrigQ = new Map();
let _vyOrigTimer = null;
const _vyOrigCache = new Map();
function vyFixOrigTitle(el, videoId) {
  if (!el || !videoId) return;
  const c = _vyOrigCache.get(videoId);
  if (c) { _vyApplyOrig(el, c); return; }
  if (!_vyOrigQ.has(videoId)) _vyOrigQ.set(videoId, []);
  _vyOrigQ.get(videoId).push(el);
  clearTimeout(_vyOrigTimer);
  _vyOrigTimer = setTimeout(_vyFlushOrig, 150);
}
function _vyApplyOrig(el, d) {
  if (!d || !d.title) return;
  const t = el.querySelector('.card-title, .short-card-title, .ch-home-card-title, .ch-featured-title, .vy-hs-title');
  if (t && t.textContent !== d.title) t.textContent = d.title;
  const img = el.querySelector('.thumb-img, .short-card-thumb img, .ch-home-card-thumb-img');
  if (img) img.alt = d.title;
  if (d.author) {
    const ch = el.querySelector('.card-channel');
    if (ch && ch.textContent.trim() && ch.textContent !== d.author) ch.textContent = d.author;
  }
}
async function _vyFlushOrig() {
  const entries = [..._vyOrigQ.entries()];
  _vyOrigQ.clear();
  for (let i = 0; i < entries.length; i += 50) {
    const chunk = entries.slice(i, i + 50);
    try {
      const r = await fetch('/api/orig-titles?ids=' + chunk.map(e => e[0]).join(','));
      const d = await r.json();
      for (const [vid, els] of chunk) {
        if (!d[vid]) continue;
        _vyOrigCache.set(vid, d[vid]);
        els.forEach(el => _vyApplyOrig(el, d[vid]));
      }
    } catch (_) {}
  }
}
async function vyGetOrigTitle(videoId) {
  if (_vyOrigCache.has(videoId)) return _vyOrigCache.get(videoId);
  try {
    const r = await fetch('/api/orig-titles?ids=' + encodeURIComponent(videoId));
    const d = await r.json();
    if (d[videoId]) { _vyOrigCache.set(videoId, d[videoId]); return d[videoId]; }
  } catch (_) {}
  return null;
}

function createVideoCard(video, { forceShorts = false } = {}) {
  const hasVideoId = !!video.videoId;
  const thumb = hasVideoId ? getThumbnailUrl(video.videoId) : null;
  const duration = formatDuration(video.lengthSeconds);
  const views = formatViews(video.viewCount);
  const channelIcon = getChannelIconUrl(video.authorThumbnails);

  const isShort = forceShorts || isShortVideo(video);

  const el = hasVideoId ? document.createElement('a') : document.createElement('div');
  el.className = 'video-card' + (hasVideoId ? '' : ' video-card--no-id');
  if (hasVideoId) {
    el.href = isShort ? `/shorts/${video.videoId}` : `/watch?v=${video.videoId}`;
  }

  const badges = [];
  const isLive = !!video.liveNow || /^0\s*(seconds? ago|秒前)$/i.test(String(video.publishedText || '').trim());
  if (isLive) badges.push('<span class="badge-live">ライブ</span>');
  if (isShort && !isLive) badges.push('<span class="badge-shorts">ショート</span>');
  if (video.is4k) badges.push('<span class="badge-tag">4K</span>');
  if (video.isVr360) badges.push('<span class="badge-tag">360°</span>');
  if (video.hasCaptions) badges.push('<span class="badge-tag">CC</span>');

  const channelUrl = video.authorId ? `/channel?id=${encodeURIComponent(video.authorId)}` : null;

  el.innerHTML = `
    <div class="thumb-wrap">
      ${thumb
        ? `<img class="thumb-img" src="${thumb}" alt="${escapeHtml(video.title)}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="thumb-img thumb-placeholder"><span class="thumb-placeholder-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/></svg></span></div>`
      }
      ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
      ${badges.length ? `<div class="thumb-badges">${badges.join('')}</div>` : ''}
    </div>
    <div class="card-info">
      <div class="card-title">${escapeHtml(video.title)}</div>
      <div class="card-meta">
        <div class="card-channel-row">
          ${channelIcon
            ? `<img class="channel-icon" src="${channelIcon}" alt="${escapeHtml(video.author)}" loading="lazy" />`
            : `<div class="channel-icon-placeholder"></div>`
          }
          ${channelUrl
            ? `<a class="card-channel card-channel-link" href="${channelUrl}" onclick="event.stopPropagation()">${escapeHtml(video.author || '')}</a>`
            : `<span class="card-channel">${escapeHtml(video.author || '')}</span>`
          }
        </div>
        <div class="card-stats">
          ${views ? `<span>${views}</span>` : ''}
          ${isLive ? '<span>ライブ配信中</span>' : (video.publishedText ? `<span>${escapeHtml(jaDate(video.publishedText))}</span>` : '')}
        </div>
      </div>
    </div>
  `;

  if (channelUrl) {
    const iconEl = el.querySelector('.channel-icon, .channel-icon-placeholder');
    if (iconEl) {
      iconEl.style.cursor = 'pointer';
      iconEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = channelUrl;
      });
    }
  }

  if (hasVideoId) vyFixOrigTitle(el, video.videoId);
  if (hasVideoId && (!channelIcon || !video.author || (!views && !video.liveNow))) vyQueueMeta(el, video.videoId);
  return el;
}

/* ── 欠けているチャンネル名・アイコン・再生回数をまとめて補う ─────────── */
const _vyMetaQueue = new Map();
const _vyMetaCache = new Map();
let _vyMetaTimer = null;
function vyQueueMeta(el, videoId) {
  if (_vyMetaCache.has(videoId)) { const m = _vyMetaCache.get(videoId); if (m) setTimeout(() => _vyApplyMeta(el, m), 0); return; }
  if (!_vyMetaQueue.has(videoId)) _vyMetaQueue.set(videoId, []);
  _vyMetaQueue.get(videoId).push(el);
  if (!_vyMetaTimer) _vyMetaTimer = setTimeout(_vyFlushMeta, 150);
}
async function _vyFlushMeta() {
  _vyMetaTimer = null;
  const ids = [..._vyMetaQueue.keys()].slice(0, 30);
  const targets = ids.map(id => [id, _vyMetaQueue.get(id)]);
  ids.forEach(id => _vyMetaQueue.delete(id));
  if (_vyMetaQueue.size) _vyMetaTimer = setTimeout(_vyFlushMeta, 150);
  if (!ids.length) return;
  let data = {};
  try {
    const r = await fetch('/api/video-meta?ids=' + ids.join(','), { signal: AbortSignal.timeout(20000) });
    if (r.ok) data = await r.json();
  } catch (_) {}
  targets.forEach(([id, els]) => {
    const m = data[id] || null;
    _vyMetaCache.set(id, m);
    if (m) els.forEach(el => _vyApplyMeta(el, m));
  });
}
function _vyApplyMeta(el, m) {
  if (!el || !m) return;
  const chUrl = m.authorId ? `/channel?id=${encodeURIComponent(m.authorId)}` : null;
  let ch = el.querySelector('.card-channel');
  if (ch && !ch.textContent.trim() && m.author) ch.textContent = m.author;
  if (ch && chUrl && ch.tagName !== 'A') {
    const a = document.createElement('a');
    a.className = 'card-channel card-channel-link';
    a.href = chUrl;
    a.textContent = ch.textContent;
    a.addEventListener('click', e => e.stopPropagation());
    ch.replaceWith(a);
  }
  const ph = el.querySelector('.channel-icon-placeholder');
  const icon = getChannelIconUrl(m.authorThumbnails || []);
  if (ph && icon) {
    const img = document.createElement('img');
    img.className = 'channel-icon';
    img.src = icon;
    img.alt = m.author || '';
    img.loading = 'lazy';
    if (chUrl) {
      img.style.cursor = 'pointer';
      img.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); location.href = chUrl; });
    }
    ph.replaceWith(img);
  }
  const stats = el.querySelector('.card-stats');
  if (stats && m.viewCount && !/回視聴|視聴/.test(stats.textContent)) {
    const sp = document.createElement('span');
    sp.textContent = formatViews(m.viewCount);
    stats.prepend(sp);
  }
  if (stats && m.publishedText && stats.children.length < 2 && !/前|ライブ/.test(stats.textContent)) {
    const sp = document.createElement('span');
    sp.textContent = jaDate(m.publishedText);
    stats.appendChild(sp);
  }
  const t = el.querySelector('.card-title');
  if (t && !t.textContent.trim() && m.title) t.textContent = m.title;
}

function createChannelCard(item) {
  const icon = getChannelIconUrl(item.authorThumbnails);
  const subs = formatSubsText(item.subCountText, item.subCount);

  const a = document.createElement('a');
  a.className = 'channel-card';
  a.href = item.authorId ? `/channel?id=${encodeURIComponent(item.authorId)}` : `https://www.youtube.com/channel/${item.authorId}`;

  a.innerHTML = `
    <div class="channel-card-inner">
      ${icon
        ? `<img class="channel-card-icon" src="${icon}" alt="${escapeHtml(item.author)}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="channel-card-icon-placeholder"></div>`
      }
      <div class="channel-card-info">
        <div class="channel-card-name">
          ${escapeHtml(item.author || '')}
          ${item.authorVerified ? '<span class="verified-badge" title="認証済み"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
        </div>
        ${subs ? `<div class="channel-card-subs">チャンネル登録者数 ${subs}</div>` : ''}
        ${item.description ? `<div class="channel-card-desc">${escapeHtml(item.description)}</div>` : ''}
      </div>
    </div>
  `;
  return a;
}

function createPlaylistCard(item) {
  const thumb = item.playlistThumbnail
    ? wsrv(item.playlistThumbnail, 480)
    : (item.videos && item.videos[0]?.videoId ? getThumbnailUrl(item.videos[0].videoId) : '');

  const isMix = item.playlistId && item.playlistId.startsWith('RD');
  const a = document.createElement('a');
  a.className = 'video-card';
  a.href = isMix
    ? `/mix?id=${encodeURIComponent(item.playlistId)}`
    : `/playlist?list=${encodeURIComponent(item.playlistId)}`;

  a.innerHTML = `
    <div class="thumb-wrap playlist-thumb-wrap">
      ${thumb ? `<img class="thumb-img" src="${thumb}" alt="${escapeHtml(item.title)}" loading="lazy" onload="this.classList.add('loaded')" />` : ''}
      <div class="playlist-count-badge">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        ${item.videoCount != null ? item.videoCount + '本' : '再生リスト'}
      </div>
    </div>
    <div class="card-info">
      <div class="card-title">${escapeHtml(item.title)}</div>
      <div class="card-meta">
        <div class="card-channel-row">
          <div class="channel-icon-placeholder"></div>
          <span class="card-channel">${escapeHtml(item.author || '')}</span>
        </div>
      </div>
    </div>
  `;
  return a;
}

function createResultCard(item) {
  switch (item.type) {
    case 'channel': return createChannelCard(item);
    case 'playlist': return createPlaylistCard(item);
    default: {
      if (isShortVideo(item)) return createShortsCard(item);
      return createVideoCard(item);
    }
  }
}

function createShortsCard(video, { channelId = null, searchQuery = null, shortsList = null } = {}) {
  const a = document.createElement('a');
  a.className = 'short-card';
  const base = `/shorts/${video.videoId}`;
  let href = base;
  if (channelId) {
    href = `${base}?channel=${encodeURIComponent(channelId)}`;
  } else if (searchQuery) {
    const p = new URLSearchParams({ q: searchQuery });
    if (shortsList) p.set('list', shortsList);
    href = `${base}?${p}`;
  }
  a.href = href;
  const oarThumb = wsrv(`https://i.ytimg.com/vi/${video.videoId}/oar2.jpg`, 480);
  const hqThumb  = wsrv(`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`, 480);
  const duration = formatDuration(video.lengthSeconds);
  const views = formatViews(video.viewCount);
  a.innerHTML = `
    <div class="short-card-thumb">
      <img src="${oarThumb}" alt="${escapeHtml(video.title || '')}" loading="lazy"
        onload="this.classList.add('loaded')"
        onerror="this.onerror=null;this.src='${hqThumb}'" />
      ${duration ? `<span class="short-card-dur">${duration}</span>` : ''}
    </div>
    <div class="short-card-title">${escapeHtml(video.title || '')}</div>
    ${views ? `<div class="short-card-views">${views}</div>` : ''}
  `;
  if (video.videoId) vyFixOrigTitle(a, video.videoId);
  return a;
}

// 取得元の表示は廃止 (呼ばれても何もしない)
function updateShortsShelfSources() {}

// 棚の左右の矢印 (本家のように、はみ出しているときだけ出す)
function vyUpdateShelfArrows(shelfEl) {
  if (!shelfEl) return;
  const sc = shelfEl.querySelector('.shorts-shelf-scroll');
  const prev = shelfEl.querySelector('.vy-shelf-prev');
  const next = shelfEl.querySelector('.vy-shelf-next');
  if (!sc || !prev || !next) return;
  const max = sc.scrollWidth - sc.clientWidth;
  prev.hidden = sc.scrollLeft <= 4;
  next.hidden = max <= 4 || sc.scrollLeft >= max - 4;
}

function createShortsShelf(shorts, { searchQuery = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'shorts-shelf';
  const header = document.createElement('div');
  header.className = 'shorts-shelf-header';
  header.innerHTML = `<span class="shorts-shelf-title">ショート</span>`;
  const body = document.createElement('div');
  body.className = 'vy-shelf-body';
  const scroll = document.createElement('div');
  scroll.className = 'shorts-shelf-scroll';
  const shortsList = searchQuery ? shorts.map(v => v.videoId).join(',') : null;
  shorts.forEach(v => scroll.appendChild(createShortsCard(v, { searchQuery, shortsList })));
  const arrow = (dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vy-shelf-arrow vy-shelf-' + dir;
    b.setAttribute('aria-label', dir === 'prev' ? '前へ' : '次へ');
    b.hidden = true;
    b.innerHTML = dir === 'prev'
      ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      scroll.scrollBy({ left: (dir === 'prev' ? -1 : 1) * scroll.clientWidth * 0.85, behavior: 'smooth' });
    });
    return b;
  };
  body.appendChild(arrow('prev'));
  body.appendChild(scroll);
  body.appendChild(arrow('next'));
  scroll.addEventListener('scroll', () => vyUpdateShelfArrows(wrap), { passive: true });
  window.addEventListener('resize', () => vyUpdateShelfArrows(wrap));
  wrap.appendChild(header);
  wrap.appendChild(body);
  setTimeout(() => vyUpdateShelfArrows(wrap), 60);
  return wrap;
}

function appendShortsToShelf(shelfEl, newShorts, allShorts, searchQuery) {
  if (!shelfEl) return;
  const scroll = shelfEl.querySelector('.shorts-shelf-scroll');
  if (!scroll) return;
  const spinner = shelfEl.querySelector('.shorts-shelf-spinner');
  if (spinner) spinner.remove();
  const shortsList = searchQuery ? allShorts.map(v => v.videoId).join(',') : null;
  newShorts.forEach(v => scroll.appendChild(createShortsCard(v, { searchQuery, shortsList })));
  setTimeout(() => vyUpdateShelfArrows(shelfEl), 30);
}

function createSkeletonCard() {
  const div = document.createElement('div');
  div.className = 'skeleton-card';
  div.innerHTML = `
    <div class="skeleton-thumb"></div>
    <div class="skeleton-info">
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-line skeleton-title-short"></div>
      <div class="skeleton-channel-row">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-line skeleton-channel"></div>
      </div>
      <div class="skeleton-line skeleton-views"></div>
    </div>
  `;
  return div;
}

const channelAvatarCache = new Map();
const playlistAuthorCache = new Map();

async function fetchChannelAvatar(channelId) {
  if (channelAvatarCache.has(channelId)) return channelAvatarCache.get(channelId);
  try {
    const data = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}`);
    const thumbs = data.authorThumbnails || null;
    if (thumbs) channelAvatarCache.set(channelId, thumbs);
    return thumbs;
  } catch {
    return null;
  }
}

async function fetchPlaylistAuthorThumbs(playlistId) {
  if (playlistAuthorCache.has(playlistId)) return playlistAuthorCache.get(playlistId);
  try {
    const data = await fetchMain(`/api/playlists/${encodeURIComponent(playlistId)}`);
    const result = { thumbs: data.authorThumbnails || null, authorId: data.authorId || null };
    if (result.thumbs || result.authorId) playlistAuthorCache.set(playlistId, result);
    return result;
  } catch {
    return null;
  }
}

function applyIconToPlaceholder(placeholder, thumbs, authorId) {
  const iconUrl = getChannelIconUrl(thumbs);
  if (!iconUrl || !placeholder.isConnected) return;
  const img = document.createElement('img');
  img.className = 'channel-icon';
  img.src = iconUrl;
  img.alt = '';
  img.loading = 'lazy';
  img.onload = () => img.classList.add('loaded');
  if (authorId) {
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = `/channel?id=${encodeURIComponent(authorId)}`;
    });
  }
  placeholder.replaceWith(img);
}

async function fillMissingIcons(items) {
  const channelItems = items.filter(i => i.authorId);
  const playlistItems = items.filter(i => !i.authorId && i.playlistId);

  // authorId がある場合は並列で即フェッチ（プレイリストページの動画アイコン等）
  if (channelItems.length > 0) {
    const uniqueIds = [...new Set(channelItems.map(i => i.authorId))];
    const results = await Promise.all(uniqueIds.map(id => fetchChannelAvatar(id).then(t => [id, t])));
    const thumbMap = new Map(results);
    channelItems.forEach(({ card, authorId }) => {
      const placeholder = card.querySelector('.channel-icon-placeholder');
      if (placeholder) applyIconToPlaceholder(placeholder, thumbMap.get(authorId), authorId);
    });
  }

  // playlistId しかない場合は IntersectionObserver で表示時にだけフェッチ
  if (playlistItems.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const placeholder = entry.target;
        const playlistId = placeholder.dataset.fillPlaylistId;
        if (!playlistId) return;
        observer.unobserve(placeholder);
        delete placeholder.dataset.fillPlaylistId;
        fetchPlaylistAuthorThumbs(playlistId).then(r => {
          if (r && r.thumbs) applyIconToPlaceholder(placeholder, r.thumbs, r.authorId);
        });
      });
    }, { rootMargin: '100px' });

    playlistItems.forEach(({ card, playlistId }) => {
      const placeholder = card.querySelector('.channel-icon-placeholder');
      if (!placeholder) return;
      placeholder.dataset.fillPlaylistId = playlistId;
      observer.observe(placeholder);
    });
  }
}

async function withRetry(fn, maxRetries = Infinity, baseDelay = 1500, maxDelay = 15000) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (maxRetries !== Infinity && attempt >= maxRetries) throw e;
      const delay = Math.min(baseDelay * Math.pow(1.5, attempt - 1), maxDelay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ストリーム取得が同じ動画で何度も連続失敗する場合（502等でバックエンドが不安定な時）は、
// 一定回数リトライしたところでタブを強制的に再読み込みする。再読み込み後も失敗し続ける
// 無限ループを避けるため、同一動画での自動リロード回数には上限を設ける。
async function withRetryOrReload(videoId, fn, {
  maxAttemptsBeforeReload = 5,
  maxAutoReloads = 3,
  baseDelay = 1500,
  maxDelay = 15000,
} = {}) {
  const reloadKey = 'chocoStreamReloadCount:' + videoId;
  let attempt = 0;
  while (true) {
    try {
      const result = await fn();
      sessionStorage.removeItem(reloadKey);
      return result;
    } catch (e) {
      attempt++;
      if (attempt >= maxAttemptsBeforeReload) {
        const reloadCount = parseInt(sessionStorage.getItem(reloadKey) || '0', 10);
        if (reloadCount < maxAutoReloads) {
          sessionStorage.setItem(reloadKey, String(reloadCount + 1));
          console.error(`[watch] ストリーム取得が${attempt}回連続で失敗したためタブを再読み込みします (${reloadCount + 1}/${maxAutoReloads})`, e);
          location.reload();
          await new Promise(() => {}); // リロードされるまで以降の処理を止める
        }
        throw e; // 自動リロードの上限に達した場合は諦めて呼び出し元にエラーを渡す
      }
      const delay = Math.min(baseDelay * Math.pow(1.5, attempt - 1), maxDelay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── 取得中インジケーター (fetchMain 実行中に画面の隅へ小さく表示) ──
const VyFetch = (() => {
  let pending = 0, timer = null, el = null;
  function pill() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'vyFetchPill';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="vy-fp-spin"></span><span class="vy-fp-txt">取得中…</span>';
    document.body.appendChild(el);
    return el;
  }
  function label() { return '取得中'; }
  return {
    start(path) {
      pending++;
      const p = pill();
      p.querySelector('.vy-fp-txt').textContent = label(path || '');
      if (!timer && !p.classList.contains('show')) timer = setTimeout(() => { timer = null; if (pending > 0) p.classList.add('show'); }, 400);
    },
    end() {
      pending = Math.max(0, pending - 1);
      if (pending === 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        if (el) el.classList.remove('show');
      }
    },
  };
})();

// ── 追加読み込み中の表示 (一覧の上部にくるくる回る印) ──
const VyTopLoader = (() => {
  let el = null, n = 0;
  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'vyTopLoader';
    el.className = 'vy-top-loader';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="vy-top-loader-spin" aria-hidden="true"></span><span class="vy-top-loader-txt">動画を読み込み中…</span>';
    document.body.appendChild(el);
    return el;
  }
  return {
    // label: 読み込んでいる内容 ('動画' / '投稿' / 'ショート' / '再生リスト' など)
    show(label) {
      n++;
      const e = ensure();
      const t = e.querySelector('.vy-top-loader-txt');
      if (t) t.textContent = (label || '動画') + 'を読み込み中…';
      e.classList.add('show');
    },
    hide() { n = Math.max(0, n - 1); if (!n && el) el.classList.remove('show'); },
  };
})();
window.VyTopLoader = VyTopLoader;

// ── 更新したことが分かるよう、差し替える直前に一瞬だけ骨組み (スケルトン) を見せる ──
// 古い一覧はここで完全に消すので、古い動画と新しい動画が混ざらない。高さは保って一覧が崩れないようにする
async function vySkeletonFlash(grid, makeSkel, count = 12, ms = 320) {
  if (!grid || typeof makeSkel !== 'function') return;
  const h = grid.offsetHeight;
  if (h) grid.style.minHeight = Math.min(h, Math.round(window.innerHeight * 1.2)) + 'px';
  grid.classList.remove('vy-fresh-in');
  grid.innerHTML = '';
  for (let i = 0; i < count; i++) grid.appendChild(makeSkel());
  await new Promise(r => setTimeout(r, ms));
  grid.style.minHeight = '';
}
// 新しい一覧をふわっと表示する
function vyFreshIn(grid) {
  if (!grid) return;
  grid.classList.remove('vy-fresh-in');
  void grid.offsetWidth;
  grid.classList.add('vy-fresh-in');
  setTimeout(() => grid.classList.remove('vy-fresh-in'), 500);
}

// ── 下までスクロールしたら自動で追加読み込み ──
// grid の直後に目印 (兼「もっと読み込む」ボタン) を置き、見えたら onMore() を呼ぶ。
// onMore は追加した件数を返す (0 なら「これ以上ありません」, -1 なら失敗)。
// 取得中はもう一度呼ばない (二重取得の防止)。追加は末尾だけなのでスクロール位置は動かない。
function vyLoadMore(grid, onMore, label) {
  if (!grid) return null;
  let wrap = grid._vyMore;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'vy-more-wrap';
    wrap.innerHTML = '<button type="button" class="vy-more-btn"><span class="vy-more-spin"></span><span class="vy-more-txt">もっと読み込む</span></button>';
    grid.insertAdjacentElement('afterend', wrap);
    grid._vyMore = wrap;
  }
  const btn = wrap.querySelector('.vy-more-btn');
  const txt = wrap.querySelector('.vy-more-txt');
  const token = {};               // 一覧が作り直されたら古い読み込みは捨てる
  wrap._vyToken = token;
  wrap._vyBusy = false;
  wrap._vyFails = 0;
  wrap.hidden = false;
  btn.disabled = false;
  btn.classList.remove('loading', 'done');
  txt.textContent = 'もっと読み込む';

  const run = async (auto) => {
    if (wrap._vyBusy || btn.classList.contains('done') || wrap.hidden || wrap._vyToken !== token) return;
    if (auto && wrap._vyFails >= 2) return;     // 失敗が続いたら自動では取りに行かない (ボタンで再試行)
    wrap._vyBusy = true;
    btn.disabled = true;
    btn.classList.add('loading');
    txt.textContent = '読み込み中…';
    VyTopLoader.show(label || '動画');
    let added = 0;
    try { added = await onMore(); } catch (e) { console.warn('[loadMore]', e); added = -1; }
    finally { VyTopLoader.hide(); }
    if (wrap._vyToken !== token) return;
    wrap._vyBusy = false;
    btn.classList.remove('loading');
    if (added > 0) { wrap._vyFails = 0; btn.disabled = false; txt.textContent = 'もっと読み込む'; }
    else if (added === -1) { wrap._vyFails++; btn.disabled = false; txt.textContent = 'うまく取れませんでした。もう一度試す'; }
    else { btn.classList.add('done'); txt.textContent = 'これ以上の' + (label || '動画') + 'はありません'; }
    // 追加しても画面の下がまだ空いているときは続けて取る
    if (added > 0) requestAnimationFrame(() => { if (vyNearBottom(wrap)) run(true); });
  };
  btn.onclick = () => { wrap._vyFails = 0; run(false); };

  if (!wrap._vyIO && 'IntersectionObserver' in window) {
    wrap._vyIO = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting) && wrap._vyRun) wrap._vyRun(true);
    }, { rootMargin: '0px 0px 900px 0px' });
    wrap._vyIO.observe(wrap);
  } else if (!wrap._vyIO) {
    wrap._vyIO = true;
    window.addEventListener('scroll', () => { if (wrap._vyRun && vyNearBottom(wrap)) wrap._vyRun(true); }, { passive: true });
  }
  wrap._vyRun = run;
  return wrap;
}
function vyNearBottom(el) {
  if (!el || !el.isConnected || el.hidden) return false;
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight + 900 && r.bottom > -200;
}
function vyHideLoadMore(grid) { if (grid && grid._vyMore) { grid._vyMore.hidden = true; grid._vyMore._vyToken = null; } }

// 表示済みの動画から関連動画を集めて返す (重複は除く)
async function vyFetchMoreRelated(grid, seen, count = 4) {
  const ids = [...grid.querySelectorAll('a[href*="/watch?v="]')]
    .map(a => { try { return new URL(a.href, location.origin).searchParams.get('v'); } catch { return null; } })
    .filter(Boolean);
  const uniq = [...new Set(ids)];
  for (let i = uniq.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [uniq[i], uniq[j]] = [uniq[j], uniq[i]]; }
  const seeds = uniq.slice(0, count);
  const lists = await Promise.all(seeds.map(id => Promise.race([
    fetchMain(`/api/stream/${id}`).then(r => (r && r.recommendedVideos) || []).catch(() => []),
    new Promise(res => setTimeout(() => res([]), 15000)),
  ])));
  const out = [];
  lists.forEach(l => l.forEach(v => {
    const id = v.videoId || v.id;
    if (!id || seen.has(id) || (v.type && v.type !== 'video')) return;
    seen.add(id); out.push(v);
  }));
  return out;
}

function vyAppendCards(grid, videos) {
  const missing = [];
  // すでに一覧にある動画は足さない (重複表示の防止)
  const have = new Set([...grid.querySelectorAll('a[href*="/watch?v="]')]
    .map(a => { try { return new URL(a.href, location.origin).searchParams.get('v'); } catch { return null; } })
    .filter(Boolean));
  videos = (videos || []).filter(v => {
    const id = v && (v.videoId || v.id);
    if (!id || have.has(id)) return false;
    have.add(id); return true;
  });
  videos.forEach(v => {
    const card = createVideoCard(v);
    grid.appendChild(card);
    if (!v.authorThumbnails && v.authorId) missing.push({ card, authorId: v.authorId });
  });
  if (missing.length && typeof fillMissingIcons === 'function') fillMissingIcons(missing);
  return videos.length;
}

async function fetchMain(apiPath) {
  VyFetch.start(apiPath);
  try { return await _fetchMainRaw(apiPath); } finally { VyFetch.end(); }
}

async function _fetchMainRaw(apiPath) {
  const url = '/proxy/main' + apiPath;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 1 && (e.name === 'TimeoutError' || e.name === 'TypeError')) continue;
      throw e;
    }
  }
  throw lastErr;
}

function createCommentItem(c) {
  const div = document.createElement('div');
  div.className = 'comment-item';

  const authorHref = c.authorId ? `/channel?id=${encodeURIComponent(c.authorId)}` : null;
  const thumbs = c.authorThumbnails;
  const iconUrl = thumbs && thumbs.length
    ? wsrv(thumbs[thumbs.length - 1].url || thumbs[0].url, 72)
    : '';

  const likesHtml = c.likeCount
    ? `<span class="comment-likes">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        ${c.likeCount.toLocaleString()}
       </span>`
    : '';

  const repliesHtml = c.replyCount
    ? `<span class="comment-replies">返信 ${c.replyCount}</span>`
    : '';

  div.innerHTML = `
    <div class="comment-avatar-wrap">
      ${iconUrl
        ? `<img class="comment-avatar" src="${iconUrl}" alt="${escapeHtml(c.author || '')}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="comment-avatar-placeholder"></div>`
      }
    </div>
    <div class="comment-body">
      <div class="comment-header">
        ${authorHref
          ? `<a class="comment-author${c.authorVerified ? ' verified' : ''}" href="${authorHref}">${escapeHtml(c.author || '')}</a>`
          : `<span class="comment-author${c.authorVerified ? ' verified' : ''}">${escapeHtml(c.author || '')}</span>`
        }
        ${c.publishedText ? `<span class="comment-date">${escapeHtml(jaDate(c.publishedText))}</span>` : ''}
        ${c.isPinned ? `<span class="comment-pinned"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.8a2 2 0 0 1-1.1 1.7l-1.8.9A2 2 0 0 0 5 15.2z"/></svg> 固定</span>` : ''}
      </div>
      <div class="comment-text">${escapeHtml(c.content || '')}</div>
      <div class="comment-footer">${likesHtml}${repliesHtml}</div>
    </div>
  `;
  return div;
}

async function fetchStream(apiPath) {
  const url = '/proxy/stream' + apiPath;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const instanceUrl = res.headers.get('X-Instance-Used') || null;
      return { data, instanceUrl };
    } catch (e) {
      lastErr = e;
      if (attempt < 1 && (e.name === 'TimeoutError' || e.name === 'TypeError')) continue;
      throw e;
    }
  }
  throw lastErr;
}

async function fetchRapidStream(videoId) {
  const url = `/api/rapidstream/${encodeURIComponent(videoId)}`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(18000) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.formatStreams && !data.adaptiveFormats) throw new Error('no stream data');
      return { data, instanceUrl: 'rapidapi' };
    } catch (e) {
      lastErr = e;
      if (attempt < 1 && (e.name === 'TimeoutError' || e.name === 'TypeError')) continue;
      throw e;
    }
  }
  throw lastErr;
}

async function fetchSiaStream(videoId) {
  const url = `/api/siastream/${encodeURIComponent(videoId)}`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(18000) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.formatStreams && !data.adaptiveFormats) throw new Error('no stream data');
      return { data, instanceUrl: 'sia' };
    } catch (e) {
      lastErr = e;
      if (attempt < 1 && (e.name === 'TimeoutError' || e.name === 'TypeError')) continue;
      throw e;
    }
  }
  throw lastErr;
}

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
}

function buildEmbedCode(videoId, title) {
  const t = String(title || 'YouTube video player').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" title="${t}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

// 共有パネル: 「このページのURL」「埋め込みコード」「YouTubeのリンク」の3つだけ
function setupSharePanel(btnEl, panelEl, getInfo) {
  if (!btnEl || !panelEl) return;
  const bind = (action, fn) => {
    const el = panelEl.querySelector(`[data-action="${action}"]`);
    if (el) el.onclick = () => { fn(); panelEl.hidden = true; };
  };

  btnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !panelEl.hidden;
    document.querySelectorAll('.share-panel').forEach(p => { p.hidden = true; });
    if (isOpen) return;
    const info = getInfo();
    bind('copy-app', () => { copyText(info.appUrl || location.href); showCopyToast('このページのURLをコピーしました'); });
    bind('copy-embed', () => { copyText(buildEmbedCode(info.videoId, info.title)); showCopyToast('埋め込みコードをコピーしました'); });
    bind('copy-yt', () => { copyText(info.ytUrl); showCopyToast('YouTubeのリンクをコピーしました'); });
    panelEl.hidden = false;
  });

  document.addEventListener('click', (e) => {
    if (!btnEl.contains(e.target) && !panelEl.contains(e.target)) {
      panelEl.hidden = true;
    }
  });
}

function showCopyToast(msg = 'URLをコピーしました') {
  let toast = document.getElementById('_copyToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_copyToast';
    toast.className = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('copy-toast-show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('copy-toast-show'), 2000);
}

function buildSearchUrl(params) {
  const url = new URL('/search', location.origin);
  if (typeof getSettings === 'function') {
    const s = getSettings();
    if (s.searchSort && s.searchSort !== 'relevance') url.searchParams.set('sort_by', s.searchSort);
    if (s.searchDate)                                  url.searchParams.set('date', s.searchDate);
    if (s.searchDuration)                              url.searchParams.set('duration', s.searchDuration);
    if (s.searchType && s.searchType !== 'all')        url.searchParams.set('type', s.searchType);
    if (s.searchFeatures)                              url.searchParams.set('features', s.searchFeatures);
    if (s.searchRegion && s.searchRegion !== 'JP')     url.searchParams.set('region', s.searchRegion);
  }
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  return url.toString();
}


// まとめて元タイトルに直す (チャンネルのホームなど)
function vyFixOrigTitlesIn(root) {
  if (!root) return;
  root.querySelectorAll('a[href*="watch?v="], a[href^="/shorts/"]').forEach(a => {
    const m = a.getAttribute('href').match(/(?:v=|\/shorts\/)([\w-]{11})/);
    if (m) vyFixOrigTitle(a, m[1]);
  });
}
