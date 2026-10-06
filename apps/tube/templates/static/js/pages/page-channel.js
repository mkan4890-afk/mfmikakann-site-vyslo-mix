;(() => {
  if (!document.body.classList.contains('page-channel')) return;
const params = new URLSearchParams(location.search);
const channelId = params.get('id') || '';

let channelInfo = null;
let currentTab = 'videos';
let continuation = null;
let isLoading = false;
let chSearchPage = 1;
let loadGen = 0;

if (!channelId) {
  // チャンネルIDがない場合はタブバーと検索アイコンを非表示
  const _tabsBar = document.getElementById('channelTabsBar');
  if (_tabsBar) _tabsBar.style.display = 'none';
  const _searchFormWrap = document.getElementById('channelSearchForm');
  if (_searchFormWrap) _searchFormWrap.style.display = 'none';
  document.querySelector('main').innerHTML =
    `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>チャンネルIDが指定されていません。</p></div>`;
}

function getBannerUrl(banners) {
  if (!banners || !banners.length) return null;
  const best = banners.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a), banners[0]);
  return wsrv(best.url, 1400);
}

async function loadChannelInfo() {
  try {
    const data = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}`);
    channelInfo = data;
    renderChannelHero(data);
    document.title = `${data.author || 'チャンネル'} — Vyslo Tube`;
  } catch (e) {
    document.getElementById('channelHeroSkeleton').innerHTML =
      `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>チャンネルうまく情報を取れませんでした。</p></div>`;
    console.error(e);
  }
}

function renderChannelHero(data) {
  const hero = document.getElementById('channelHero');
  const skeleton = document.getElementById('channelHeroSkeleton');

  const bannerUrl = getBannerUrl(data.authorBanners);
  const bannerWrap = document.getElementById('channelBannerWrap');
  const bannerImg = document.getElementById('channelBanner');
  if (bannerUrl) {
    bannerImg.src = bannerUrl;
    bannerImg.onload = () => bannerImg.classList.add('loaded');
    bannerImg.onerror = () => bannerWrap.classList.add('no-banner');
  } else {
    bannerWrap.classList.add('no-banner');
  }

  const iconUrl = getChannelIconUrl(data.authorThumbnails, 176);
  const avatarImg = document.getElementById('channelAvatar');
  if (iconUrl) {
    avatarImg.src = iconUrl;
    avatarImg.alt = data.author || '';
    avatarImg.onload = () => avatarImg.classList.add('loaded');
  }

  const nameEl = document.getElementById('channelName');
  nameEl.textContent = data.author || '';
  if (data.authorVerified) {
    const badge = document.createElement('span');
    badge.className = 'channel-verified';
    badge.title = '認証済み';
    badge.textContent = '✓';
    nameEl.appendChild(badge);
  }

  const subMetaEl = document.getElementById('channelSubMeta');
  const parts = [];
  const _subs = formatSubsText(data.subCountText, data.subCount);
  if (_subs) {
    parts.push(`<span>チャンネル登録者数 ${_subs}</span>`);
  }
  if (data.totalViews != null && Number(data.totalViews) > 0) {
    parts.push(`<span>総視聴回数 ${Number(data.totalViews).toLocaleString()}回</span>`);
  }
  if (data.joined) {
    const d = new Date(data.joined * 1000);
    parts.push(`<span>登録日 ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日</span>`);
  }
  subMetaEl.innerHTML = parts.join('');

  const descEl = document.getElementById('channelDesc');
  const desc = data.description || '';
  if (desc) {
    descEl.textContent = desc;
    if (desc.length > 120 || desc.split('\n').length > 3) {
      const toggleBtn = document.getElementById('channelDescToggle');
      toggleBtn.hidden = false;
      toggleBtn.addEventListener('click', () => {
        const expanded = descEl.classList.toggle('expanded');
        toggleBtn.textContent = expanded ? '閉じる' : '続きを読む';
      });
    }
  }

  skeleton.hidden = true;
  hero.hidden = false;

  const subBtn = document.getElementById('channelSubBtn');
  if (subBtn && data.authorId) {
    updateSubBtn(subBtn, data.authorId);
    subBtn.hidden = false;
    subBtn.addEventListener('click', () => {
      const subscribed = toggleSubscription({
        authorId: data.authorId,
        author: data.author || '',
        authorThumbnails: data.authorThumbnails || [],
        subCountText: data.subCountText || null,
        subCount: data.subCount || null
      });
      updateSubBtn(subBtn, data.authorId, subscribed);
    });
  }
}

function updateSubBtn(btn, authorId, subscribedOverride) {
  const subscribed = subscribedOverride !== undefined ? subscribedOverride : isSubscribed(authorId);
  btn.className = subscribed ? 'sub-btn subscribed' : 'sub-btn';
  btn.innerHTML = subscribed
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg> 登録済み`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> 登録`;
}

function getChannelIconUrl(authorThumbnails, size = 68) {
  if (!authorThumbnails || !authorThumbnails.length) return '';
  const sorted = [...authorThumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
  const best = sorted.find(t => (t.width || 0) >= 88) || sorted[0];
  return wsrv(best.url, size);
}

async function loadHomeTab() {
  const homeArea = document.getElementById('homeArea');
  homeArea.innerHTML = '';
  homeArea.hidden = false;

  const skeletonWrap = document.createElement('div');
  skeletonWrap.className = 'ch-home-loading';
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('div');
    s.className = 'ch-home-shelf-skeleton';
    s.innerHTML = `<div class="ch-home-shelf-title-sk"></div>
      <div class="ch-home-shelf-row">${Array.from({length:5}, () =>
        `<div class="skeleton-card" style="width:220px;flex-shrink:0;"><div class="skeleton-thumb"></div><div class="skeleton-info"><div class="skeleton-line skeleton-title"></div><div class="skeleton-line skeleton-title-short"></div></div></div>`
      ).join('')}</div>`;
    skeletonWrap.appendChild(s);
  }
  homeArea.appendChild(skeletonWrap);

  const errIcon = `<div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>`;
  const myGen = (loadHomeTab._gen = (loadHomeTab._gen || 0) + 1);
  // 一時的な失敗 (502 / 通信エラー) と「本当にホームが無い」を分けて扱う
  function showHomeError() {
    homeArea.innerHTML = `<div class="error-state ch-home-error">${errIcon}<p>ホームの情報を一時的に取得できませんでした。</p><button type="button" class="ch-home-retry">再試行</button></div>`;
    homeArea.querySelector('.ch-home-retry').addEventListener('click', () => loadHomeTab());
  }

  try {
    let data = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        const res = await fetch(`/api/channel-home/${encodeURIComponent(channelId)}`, { signal: AbortSignal.timeout(50000) });
        const d = await res.json().catch(() => null);
        if (res.ok && d && !d.error) data = d;
      } catch (_) {}
      if (myGen !== loadHomeTab._gen) return;
      if (!data && attempt === 0) await new Promise(r => setTimeout(r, 1200));
    }
    if (myGen !== loadHomeTab._gen) return;
    homeArea.innerHTML = '';

    if (!data) { showHomeError(); return; }
    if (data.has_home === false) {
      homeArea.innerHTML = `<div class="empty-state"><p>このチャンネルにはホームに表示する内容がありません。</p></div>`;
      return;
    }

    const sections = data?.current_tab?.content?.contents || [];

    for (const section of sections) {
      const items = section.contents || [];
      for (const item of items) {
       try {
        if (item.type === 'ChannelVideoPlayer') {
          const block = createHomeFeaturedVideo(item);
          if (block) homeArea.appendChild(block);
        } else if (item.type === 'Shelf') {
          const shelfItems = item.content?.items || [];
          if (!shelfItems.length) continue;
          const firstType = shelfItems[0]?.type;
          if (firstType === 'RecognitionShelf') continue;
          const block = createHomeShelf(item.title?.text || '', shelfItems);
          if (block) homeArea.appendChild(block);
        } else if (item.type === 'ReelShelf') {
          const block = createHomeReelShelf(item);
          if (block) homeArea.appendChild(block);
        }
       } catch (err) {
        // 1 つの棚の形が想定外でも、ほかの棚は表示する
        console.warn('[channel-home] section', err);
       }
      }
    }
    if (typeof vyFixOrigTitlesIn === 'function') vyFixOrigTitlesIn(homeArea);

    if (!homeArea.children.length) {
      homeArea.innerHTML = `<div class="empty-state"><p>このチャンネルにはホームに表示する内容がありません。</p></div>`;
    }
  } catch (e) {
    // 表示の途中で失敗した (データの形が想定と違う等)
    console.error(e);
    if (!homeArea.querySelector('.ch-home-shelf, .ch-home-featured')) showHomeError();
  }
}

function createHomeFeaturedVideo(item) {
  const videoId = item.id;
  if (!videoId) return null;
  const title = item.title?.text || '';
  const desc = item.description?.text || '';
  const views = jaViewsText(item.view_count?.text || '');
  const published = jaDate(item.published?.text || '');
  const href = `/watch?v=${encodeURIComponent(videoId)}`;

  // サムネイル: 高画質から順に試し、取れなければ次へ (最後は YouTube の画像を直接)
  const yt = (n) => `https://i.ytimg.com/vi/${videoId}/${n}.jpg`;
  const given = (Array.isArray(item.thumbnails) ? item.thumbnails : [])
    .filter(t => t && t.url).sort((x, y) => (y.width || 0) - (x.width || 0))
    .map(t => (t.url.startsWith('//') ? 'https:' + t.url : t.url).split('?')[0]);
  const thumbs = [];
  [yt('maxresdefault'), ...given, yt('sddefault'), yt('hqdefault')].forEach(u => {
    const w = wsrv(u, 960);
    if (w && !thumbs.includes(w)) thumbs.push(w);
  });
  thumbs.push(yt('hqdefault'), yt('mqdefault'));

  const div = document.createElement('div');
  div.className = 'ch-home-featured';
  div.innerHTML = `
    <div class="ch-home-section-title">注目動画</div>
    <a class="ch-featured-video" href="${href}">
      <div class="ch-featured-thumb-wrap">
        <img class="ch-featured-thumb" alt="${escapeHtml(title)}" decoding="async" />
        <div class="ch-featured-play-btn">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="52" height="52"><circle cx="12" cy="12" r="12" fill="rgba(0,0,0,0.55)"/><polygon points="10,8 18,12 10,16" fill="white"/></svg>
        </div>
      </div>
      <div class="ch-featured-info">
        <div class="ch-featured-title-link">
          <div class="ch-featured-title">${escapeHtml(title)}</div>
        </div>
        ${(views || published) ? `<div class="ch-featured-meta">${[views, published].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
        ${desc ? `<div class="ch-featured-desc">${escapeHtml(desc)}</div>` : ''}
      </div>
    </a>
  `;

  const img = div.querySelector('.ch-featured-thumb');
  let i = 0;
  img.onload = () => {
    // 画像が無いときに返る小さな灰色の画像 (120x90) は使わず次を試す
    if (img.naturalWidth && img.naturalWidth <= 120 && i < thumbs.length - 1) { img.src = thumbs[++i]; return; }
    img.classList.add('loaded');
  };
  img.onerror = () => { if (i < thumbs.length - 1) img.src = thumbs[++i]; };
  img.src = thumbs[0];

  return div;
}

// 本家 YouTube が自動で付ける棚の名前 (英語) を日本語に。チャンネルが自分で付けた名前はそのまま
const _JA_SHELF = {
  'Videos': '動画', 'Shorts': 'ショート', 'Short videos': 'ショート', 'Live': 'ライブ', 'Live now': 'ライブ配信中',
  'Past live streams': '過去のライブ配信', 'Recent live streams': '最近のライブ配信', 'Live streams': 'ライブ配信',
  'Upcoming live streams': '今後のライブ配信', 'Upcoming': '今後の配信', 'Popular videos': '人気の動画', 'Popular': '人気',
  'Popular uploads': '人気の動画', 'Popular Shorts': '人気のショート', 'Uploads': 'アップロード動画', 'Recent uploads': '最近のアップロード',
  'Latest': '最新', 'Latest videos': '最新の動画', 'Members-only videos': 'メンバー限定動画', 'Members-only': 'メンバー限定',
  'Members only': 'メンバー限定', 'Featured channels': 'おすすめのチャンネル', 'Channels': 'チャンネル', 'Subscriptions': '登録チャンネル',
  'Created playlists': '作成した再生リスト', 'Saved playlists': '保存した再生リスト', 'Playlists': '再生リスト', 'Multiple playlists': '再生リスト',
  'Posts': '投稿', 'Community': 'コミュニティ', 'For You': 'あなたへのおすすめ', 'For you': 'あなたへのおすすめ', 'Podcasts': 'ポッドキャスト',
  'Releases': 'リリース', 'Albums': 'アルバム', 'Singles': 'シングル', 'Albums & Singles': 'アルバムとシングル', 'Courses': 'コース',
  'Store': 'ストア', 'Liked videos': '高評価した動画', 'Featured video': '注目動画', 'Featured': '注目', 'Trailer': '予告編', 'Home': 'ホーム',
  'Music videos': 'ミュージックビデオ', 'Video': '動画', 'Short': 'ショート', 'Play all': 'すべて再生',
};
function jaShelfTitle(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  if (Object.prototype.hasOwnProperty.call(_JA_SHELF, s)) return _JA_SHELF[s];
  return s;
}

function createHomeShelf(title, items) {
  const div = document.createElement('div');
  div.className = 'ch-home-shelf';

  const header = document.createElement('div');
  header.className = 'ch-home-shelf-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'ch-home-section-title';
  titleEl.textContent = jaShelfTitle(title);
  header.appendChild(titleEl);

  const videoIds = items
    .filter(i => i.type === 'GridVideo' || (i.type === 'LockupView' && i.content_type === 'VIDEO'))
    .map(i => i.video_id || i.content_id)
    .filter(Boolean);
  const shortIds = items
    .filter(i => i.type === 'LockupView' && i.content_type === 'SHORT')
    .map(i => i.content_id)
    .filter(Boolean);
  if (videoIds.length > 0) {
    const playAllBtn = document.createElement('button');
    playAllBtn.className = 'ch-home-play-all-btn';
    playAllBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><polygon points="5,3 19,12 5,21"/></svg> すべて再生`;
    playAllBtn.addEventListener('click', () => {
      if (videoIds.length > 1) {
        try { sessionStorage.setItem('vyHomeVideoQueue', JSON.stringify(videoIds)); } catch (_) {}
      }
      location.href = `/watch?v=${encodeURIComponent(videoIds[0])}`;
    });
    header.appendChild(playAllBtn);
  }
  div.appendChild(header);

  const row = document.createElement('div');
  row.className = 'ch-home-shelf-scroll';

  for (const item of items) {
    if (item.type === 'GridVideo') {
      const card = createHomeVideoCard(item);
      if (card) row.appendChild(card);
    } else if (item.type === 'LockupView' && item.content_type === 'VIDEO') {
      const card = createHomeLockupCard(item);
      if (card) row.appendChild(card);
    } else if (item.type === 'LockupView' && item.content_type === 'SHORT') {
      const card = createHomeLockupCard(item);
      if (card) {
        if (item.content_id) card.dataset.vid = item.content_id;
        row.appendChild(card);
      }
    } else if (item.type === 'LockupView' && item.content_type === 'PLAYLIST') {
      const card = createHomeLockupPlaylistCard(item);
      if (card) row.appendChild(card);
    } else if (item.type === 'GridChannel') {
      const card = createHomeChannelCard(item);
      if (card) row.appendChild(card);
    } else if (item.type === 'Post') {
      const card = createHomePostCard(item);
      if (card) row.appendChild(card);
    }
  }

  if (!row.children.length) return null;
  if (row.querySelector('.home-post-card')) { row.classList.add('ch-home-posts-row'); div.classList.add('ch-home-posts-shelf'); }

  if (shortIds.length > 1) {
    row.addEventListener('click', e => {
      const card = e.target.closest('a[data-vid]');
      if (!card) return;
      try { sessionStorage.setItem('chHomeShortQueue', JSON.stringify(shortIds)); } catch (_) {}
    });
  }

  div.appendChild(row);
  return div;
}

function createHomeVideoCard(item) {
  const videoId = item.video_id;
  if (!videoId) return null;
  const title = item.title?.text || '';
  const thumbs = item.thumbnails || [];
  const thumb = thumbs.length ? wsrv(thumbs[thumbs.length - 1].url, 360) : getThumbnailUrl(videoId);
  const durationText = item.duration?.text || (item.duration?.seconds != null ? formatDuration(item.duration.seconds) : (typeof item.duration === 'number' ? formatDuration(item.duration) : ''));
  const views = jaViewsText(item.views?.text || '') || (item.short_view_count?.text ? jaViewsText(item.short_view_count.text) : null);
  const published = jaDate(item.published?.text || '');

  const a = document.createElement('a');
  a.className = 'ch-home-video-card';
  a.href = `/watch?v=${encodeURIComponent(videoId)}`;
  a.innerHTML = `
    <div class="ch-home-card-thumb">
      <img class="ch-home-card-thumb-img" src="${thumb}" alt="${escapeHtml(title)}" loading="lazy" onload="this.classList.add('loaded')" />
      ${durationText ? `<span class="duration-badge">${escapeHtml(durationText)}</span>` : ''}
    </div>
    <div class="ch-home-card-info">
      <div class="ch-home-card-title">${escapeHtml(title)}</div>
      <div class="ch-home-card-meta">${[views, published].filter(Boolean).map(s => `<span>${escapeHtml(s)}</span>`).join('')}</div>
    </div>
  `;
  return a;
}

function createHomeLockupCard(item) {
  const videoId = item.content_id;
  if (!videoId) return null;
  const title = item.metadata?.title?.text || '';
  const images = item.content_image?.image || [];
  const thumbUrl = images.length ? wsrv(images[0].url, 360) : getThumbnailUrl(videoId);
  const overlays = item.content_image?.overlays || [];
  const badgeOverlay = overlays.find(o => o.type === 'ThumbnailBottomOverlayView');
  const durationText = badgeOverlay?.badges?.[0]?.text || '';
  const metaRows = item.metadata?.metadata?.metadata_rows || [];
  const parts = metaRows[0]?.metadata_parts || [];
  const views = jaViewsText(parts[0]?.text?.text || '');
  const published = jaDate(parts[1]?.text?.text || '');

  const isShort = item.content_type === 'SHORT';
  const a = document.createElement('a');
  a.className = isShort ? 'ch-home-video-card ch-home-shorts-card' : 'ch-home-video-card';
  a.href = isShort ? `/shorts/${encodeURIComponent(videoId)}` : `/watch?v=${encodeURIComponent(videoId)}`;
  a.innerHTML = `
    <div class="${isShort ? 'ch-home-card-thumb ch-home-card-portrait' : 'ch-home-card-thumb'}">
      <img class="ch-home-card-thumb-img" src="${thumbUrl}" alt="${escapeHtml(title)}" loading="lazy" onload="this.classList.add('loaded')" />
      ${durationText ? `<span class="duration-badge">${escapeHtml(durationText)}</span>` : ''}
    </div>
    <div class="ch-home-card-info">
      <div class="ch-home-card-title">${escapeHtml(title)}</div>
      <div class="ch-home-card-meta">${[views, published].filter(Boolean).map(s => `<span>${escapeHtml(s)}</span>`).join('')}</div>
    </div>
  `;
  return a;
}

function createHomeLockupPlaylistCard(item) {
  const playlistId = item.content_id;
  if (!playlistId) return null;
  const title = item.metadata?.title?.text || '';
  // サムネイルの場所はデータの種類で違う (image / primary_thumbnail.image)
  const ci = item.content_image || {};
  const images = (ci.image && ci.image.length ? ci.image : (ci.primary_thumbnail?.image || ci.thumbnail?.image || []))
    .filter(t => t && t.url).slice().sort((x, y) => (y.width || 0) - (x.width || 0));
  const rawThumb = images.length ? (images[0].url.startsWith('//') ? 'https:' + images[0].url : images[0].url) : '';
  const thumbUrl = rawThumb ? wsrv(rawThumb, 480) : null;
  // 「82 videos」などの本数
  const badgeText = (ci.primary_thumbnail?.overlays || ci.overlays || [])
    .flatMap(o => (o && o.badges) || []).map(bd => bd && bd.text).find(t => t && /\d/.test(t)) || '';
  const countNum = (badgeText.match(/[\d,]+/) || [''])[0].replace(/,/g, '');
  const countLabel = countNum ? `${countNum}本` : '再生リスト';

  const a = document.createElement('a');
  a.className = 'ch-home-video-card';
  a.href = `/playlist?list=${encodeURIComponent(playlistId)}`;
  a.innerHTML = `
    <div class="ch-home-card-thumb" style="background:linear-gradient(135deg,#1a1230,#0d1f35)">
      ${thumbUrl
        ? `<img class="ch-home-card-thumb-img" src="${thumbUrl}" data-raw="${escapeHtml(rawThumb)}" alt="${escapeHtml(title)}" loading="lazy" onload="this.classList.add('loaded')" onerror="if(this.dataset.raw&&this.src!==this.dataset.raw){this.src=this.dataset.raw}else{this.remove()}" />`
        : ''
      }
      <div class="playlist-count-badge"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>${escapeHtml(countLabel)}</div>
    </div>
    <div class="ch-home-card-info">
      <div class="ch-home-card-title">${escapeHtml(title)}</div>
    </div>
  `;
  return a;
}

function createHomeReelShelf(item) {
  const title = item.title?.text || 'ショート';
  const items = item.items || [];
  if (!items.length) return null;

  const div = document.createElement('div');
  div.className = 'ch-home-shelf';

  const header = document.createElement('div');
  header.className = 'ch-home-shelf-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'ch-home-section-title';
  titleEl.textContent = jaShelfTitle(title);
  header.appendChild(titleEl);
  div.appendChild(header);

  const row = document.createElement('div');
  row.className = 'ch-home-shelf-scroll';

  for (const si of items) {
    if (si.type === 'ShortsLockupView') {
      const card = createHomeShortsLockupCard(si);
      if (card) row.appendChild(card);
    }
  }

  if (!row.children.length) return null;

  row.addEventListener('click', e => {
    const card = e.target.closest('a[data-vid]');
    if (!card) return;
    const allIds = Array.from(row.querySelectorAll('a[data-vid]')).map(a => a.dataset.vid);
    if (allIds.length > 1) {
      try { sessionStorage.setItem('chHomeShortQueue', JSON.stringify(allIds)); } catch (_) {}
    }
  });

  div.appendChild(row);
  return div;
}

function createHomeShortsLockupCard(item) {
  const videoId = item.on_tap_endpoint?.payload?.videoId;
  if (!videoId) return null;
  const thumbs = item.on_tap_endpoint?.payload?.thumbnail?.thumbnails || [];
  const thumbUrl = thumbs.length ? wsrv(thumbs[0].url, 200) : getThumbnailUrl(videoId);
  const accText = item.accessibility_text || '';
  const title = accText.replace(/,\s*[\d.,]+[KMB]?\s*(million\s+)?views?\s*[-–]\s*play\s+Short\s*$/i, '').trim() || videoId;

  const a = document.createElement('a');
  a.className = 'ch-home-video-card ch-home-shorts-card';
  a.href = `/shorts/${encodeURIComponent(videoId)}`;
  a.dataset.vid = videoId;
  a.innerHTML = `
    <div class="ch-home-card-thumb ch-home-card-portrait">
      <img class="ch-home-card-thumb-img" src="${thumbUrl}" alt="${escapeHtml(title)}" loading="lazy" onload="this.classList.add('loaded')" />
    </div>
    <div class="ch-home-card-info">
      <div class="ch-home-card-title">${escapeHtml(title)}</div>
    </div>
  `;
  return a;
}

function createHomeChannelCard(item) {
  const id = item.id || item.author?.id;
  const name = item.author?.name || '';
  const thumbs = item.author?.thumbnails || [];
  const icon = thumbs.length ? wsrv(thumbs[0].url.startsWith('//') ? 'https:' + thumbs[0].url : thumbs[0].url, 88) : '';
  const subsN = item.subscribers?.text ? formatSubsText(item.subscribers.text) : '';
  const subs = subsN ? 'チャンネル登録者数 ' + subsN : '';

  const a = document.createElement('a');
  a.className = 'ch-home-channel-card';
  a.href = id ? `/channel?id=${encodeURIComponent(id)}` : '#';
  a.innerHTML = `
    <div class="ch-home-channel-avatar-wrap">
      ${icon
        ? `<img class="ch-home-channel-avatar" src="${icon}" alt="${escapeHtml(name)}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="ch-home-channel-avatar-placeholder"></div>`
      }
    </div>
    <div class="ch-home-channel-name">${escapeHtml(name)}</div>
    ${subs ? `<div class="ch-home-channel-sub">${escapeHtml(subs)}</div>` : ''}
  `;
  return a;
}

// 「26K」「1.2M」「26674」→「2.6万」など (本家の日本語表示と同じ形)
function _jaCount(v) {
  if (v == null || v === '') return '';
  let n = typeof v === 'number' ? v : NaN;
  if (isNaN(n)) {
    const m = String(v).trim().replace(/,/g, '').match(/^([\d.]+)\s*([KkMmBb万億]?)/);
    if (!m) return String(v);
    n = parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9, '万': 1e4, '億': 1e8 }[m[2].toLowerCase()] || 1);
  }
  if (n >= 1e8) return (Math.round(n / 1e7) / 10).toString().replace(/\.0$/, '') + '億';
  if (n >= 1e4) return (n >= 1e5 ? Math.round(n / 1e4) : Math.round(n / 1e3) / 10).toString().replace(/\.0$/, '') + '万';
  return Math.round(n).toLocaleString();
}

function _homePostImgUrl(list) {
  const arr = (Array.isArray(list) ? list : []).filter(t => t && t.url).slice().sort((x, y) => (y.width || 0) - (x.width || 0));
  if (!arr.length) return '';
  return arr[0].url.startsWith('//') ? 'https:' + arr[0].url : arr[0].url;
}

// チャンネルホームの投稿: 本家 YouTube と同じく、横に並ぶ同じ高さのカード
// (上にチャンネル名と日時、左に本文・右に画像、下に高評価とコメント数)
function createHomePostCard(item) {
  const content = String(item.content?.text || '').replace(/\r/g, '').replace(/[\u2060-\u2064\u200b]/g, '');
  const att = item.attachment || {};
  let rawPub = String(item.published?.text || '');
  const edited = /\(edited\)|（編集済み）/i.test(rawPub);
  rawPub = rawPub.replace(/\s*\(edited\)\s*/i, '').trim();
  const published = rawPub ? jaDate(rawPub) + (edited ? '（編集済み）' : '') : '';
  const likeNum = item.action_buttons?.like_button?.like_count;
  const likes = _jaCount(likeNum != null ? likeNum : (item.vote_count?.text || ''));
  const replyRaw = item.action_buttons?.reply_button?.text;
  const replies = replyRaw && /\d/.test(String(replyRaw)) ? _jaCount(replyRaw) : '';
  const authorThumb = (item.author?.thumbnails || []).slice().sort((x, y) => (y.width || 0) - (x.width || 0))[0];
  const authorIcon = authorThumb ? wsrv(authorThumb.url.startsWith('//') ? 'https:' + authorThumb.url : authorThumb.url, 64) : '';
  const authorName = item.author?.name || '';

  // 添付 (画像 / 複数画像 / 動画 / アンケート)
  let media = '', mediaCount = 0, isVideo = false, pollHtml = '';
  const t = att.type || '';
  if (/Multi/i.test(t)) {
    const imgs = att.images || att.items || [];
    mediaCount = imgs.length;
    const first = imgs[0];
    media = first ? _homePostImgUrl(Array.isArray(first) ? first : (first.image || first.thumbnails || [first])) : '';
  } else if (/Image/i.test(t)) {
    media = _homePostImgUrl(att.image);
  } else if (/Video/i.test(t)) {
    const vid = att.video_id || att.id || att.videoId;
    media = vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : _homePostImgUrl(att.thumbnails);
    isVideo = true;
  } else if (/Poll|Quiz/i.test(t)) {
    const ch = (att.choices || []).slice(0, 2).map(c => escapeHtml(String(c.text?.text || c.text || ''))).filter(Boolean);
    pollHtml = `<div class="hpc-poll">${ch.map(c => `<span class="hpc-poll-opt">${c}</span>`).join('')}${(att.choices || []).length > 2 ? '<span class="hpc-poll-more">…</span>' : ''}</div>`;
  }
  if (!content && !media && !pollHtml) return null;

  const textHtml = escapeHtml(content).replace(/\n/g, '<br>');
  const div = document.createElement('div');
  div.className = 'home-post-card' + (media ? ' has-media' : '');
  div.tabIndex = 0;
  div.setAttribute('role', 'link');
  const thumbSvg = '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>';
  div.innerHTML = `
    <div class="hpc-head">
      ${authorIcon ? `<img class="hpc-avatar" src="${authorIcon}" alt="" loading="lazy" />` : `<div class="hpc-avatar"></div>`}
      <span class="hpc-name">${escapeHtml(authorName)}</span>
      ${published ? `<span class="hpc-date">${escapeHtml(published)}</span>` : ''}
    </div>
    <div class="hpc-body">
      <div class="hpc-main">
        ${textHtml ? `<div class="hpc-text">${textHtml}</div>` : ''}
        ${pollHtml}
      </div>
      ${media ? `<div class="hpc-media${isVideo ? ' is-video' : ''}"><img src="${wsrv(media, 320)}" data-raw="${escapeHtml(media)}" alt="" loading="lazy" onerror="if(this.dataset.raw&&this.src!==this.dataset.raw){this.src=this.dataset.raw}else{this.closest('.hpc-media').remove()}" />${mediaCount > 1 ? `<span class="hpc-media-count">${mediaCount}</span>` : ''}${isVideo ? '<span class="hpc-media-play"></span>' : ''}</div>` : ''}
    </div>
    <div class="hpc-foot">
      <span class="hpc-act" title="高評価"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">${thumbSvg}</svg>${likes ? `<span>${escapeHtml(likes)}</span>` : ''}</span>
      <span class="hpc-act" title="低評価"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18" style="transform:rotate(180deg)">${thumbSvg}</svg></span>
      <span class="hpc-act" title="コメント"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${replies ? `<span>${escapeHtml(replies)}</span>` : ''}</span>
    </div>
  `;
  // 押すと投稿タブで全文を表示
  const open = () => {
    const tabBtn = document.querySelector('.ch-tab[data-tab="community"]');
    if (!tabBtn) return;
    tabBtn.click();
    const bar = document.querySelector('.channel-tabs-bar');
    if (bar) window.scrollTo({ top: Math.max(0, bar.getBoundingClientRect().top + window.scrollY - 60), behavior: 'smooth' });
  };
  div.addEventListener('click', open);
  div.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  return div;
}

async function loadTab(tab, reset = true) {
  const myGen = ++loadGen;
  currentTab = tab;
  isLoading = true;

  if (reset) {
    continuation = null;
    chSearchPage = 1;
  }

  const grid = document.getElementById('contentGrid');
  const communityArea = document.getElementById('communityArea');
  const loadMoreWrap = document.getElementById('loadMoreWrap');

  if (reset) {
    grid.innerHTML = '';
    communityArea.innerHTML = '';
    communityArea.hidden = true;
    grid.style.display = '';
    loadMoreWrap.hidden = true;
    if (tab === 'community') {
      // 投稿は動画カードの形ではないので、文字で「投稿を読み込み中」と出す
      grid.style.display = 'none';
      communityArea.hidden = false;
      communityArea.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>投稿を読み込み中…</p></div>';
    } else {
      const skeletonCount = tab === 'playlists' ? 8 : 12;
      for (let i = 0; i < skeletonCount; i++) grid.appendChild(createSkeletonCard());
    }
  } else {
    document.getElementById('loadMoreBtn').disabled = true;
    document.getElementById('loadMoreBtn').textContent = '取得中…';
  }

  const sortVal = document.getElementById('sortSelect').value;

  try {
    let items = [];
    let newContinuation = null;

    if (tab === 'videos') {
      const p = new URLSearchParams({ sort_by: sortVal });
      if (!reset && continuation) p.set('continuation', continuation);
      const raw = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}/videos?${p}`);
      if (myGen !== loadGen) return;
      items = (raw.videos || []).filter(v => !v.errorMessage);
      newContinuation = raw.continuation || null;

    } else if (tab === 'shorts') {
      const p = new URLSearchParams();
      if (!reset && continuation) p.set('continuation', continuation);
      const raw = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}/shorts?${p}`);
      if (myGen !== loadGen) return;
      items = (raw.videos || []).filter(v => !v.errorMessage);
      newContinuation = raw.continuation || null;

    } else if (tab === 'streams') {
      const p = new URLSearchParams();
      if (!reset && continuation) p.set('continuation', continuation);
      const raw = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}/streams?${p}`);
      if (myGen !== loadGen) return;
      items = (raw.videos || []).filter(v => !v.errorMessage);
      newContinuation = raw.continuation || null;

    } else if (tab === 'latest') {
      const raw = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}/latest`);
      if (myGen !== loadGen) return;
      items = (Array.isArray(raw) ? raw : (raw.videos || [])).filter(v => !v.errorMessage);
      newContinuation = null;

    } else if (tab === 'playlists') {
      const p = new URLSearchParams();
      if (!reset && continuation) p.set('continuation', continuation);
      const raw = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}/playlists?${p}`);
      if (myGen !== loadGen) return;
      items = (raw.playlists || []).filter(pl => pl.playlistId);
      newContinuation = raw.continuation || null;

    } else if (tab === 'community') {
      const p = new URLSearchParams();
      if (!reset && continuation) p.set('continuation', continuation);
      const raw = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}/comments?${p}`);
      if (myGen !== loadGen) return;
      const posts = raw.comments || [];
      newContinuation = raw.continuation || null;

      grid.style.display = 'none';
      communityArea.hidden = false;
      if (reset) communityArea.innerHTML = '';

      if (!posts.length && reset) {
        communityArea.innerHTML = `<div class="empty-state"><p>コミュニティ投稿がありません。</p></div>`;
      } else {
        posts.forEach(post => communityArea.appendChild(createCommunityPost(post)));
      }
      continuation = newContinuation;
      loadMoreWrap.hidden = !newContinuation;
      if (!reset) {
        document.getElementById('loadMoreBtn').disabled = false;
        document.getElementById('loadMoreBtn').textContent = '続きを読む';
      }
      isLoading = false;
      return;
    }

    if (reset) grid.innerHTML = '';

    if (!items.length && reset) {
      grid.innerHTML = `<div class="empty-state"><p>コンテンツが見つかりませんでした。</p></div>`;
    } else {
      if (tab === 'playlists') {
        items.forEach(item => grid.appendChild(createChannelPlaylistCard(item)));
      } else {
        const isShortTab = tab === 'shorts';
        if (isShortTab) {
          grid.classList.add('shorts-mode');
        } else {
          grid.classList.remove('shorts-mode');
        }
        // 追加読み込みで同じ動画が二度並ばないように
        const _have = new Set();
        if (!reset) grid.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]').forEach(a => {
          const m = (a.getAttribute('href') || '').match(/(?:v=|\/shorts\/)([\w-]{11})/);
          if (m) _have.add(m[1]);
        });
        items = items.filter(it => { const id = it && it.videoId; if (!id) return true; if (_have.has(id)) return false; _have.add(id); return true; });
        items.forEach(item => {
          if (!item.authorThumbnails && channelInfo && channelInfo.authorThumbnails) {
            item.authorThumbnails = channelInfo.authorThumbnails;
          }
          grid.appendChild(isShortTab ? createShortsCard(item, { channelId: channelInfo?.authorId }) : createVideoCard(item));
        });
      }
    }

    continuation = newContinuation;
    loadMoreWrap.hidden = !newContinuation;

  } catch (e) {
    if (myGen !== loadGen) return;
    if (reset) {
      if (tab === 'community') { communityArea.innerHTML = ''; communityArea.hidden = true; grid.style.display = ''; }
      grid.innerHTML = `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>コンテンツの取得に失敗しました。</p></div>`;
    }
    loadMoreWrap.hidden = true;
    console.error(e);
  } finally {
    if (myGen === loadGen) {
      isLoading = false;
      if (!reset && document.getElementById('loadMoreBtn')) {
        document.getElementById('loadMoreBtn').disabled = false;
        document.getElementById('loadMoreBtn').textContent = '続きを読む';
      }
    }
  }
}

async function doChannelSearch(reset = true) {
  if (isLoading) return;
  const q = document.getElementById('chSearchInput').value.trim();
  if (!q) return;
  isLoading = true;

  if (reset) chSearchPage = 1;

  const grid = document.getElementById('contentGrid');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const communityArea = document.getElementById('communityArea');
  communityArea.hidden = true;
  grid.style.display = '';

  if (reset) {
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) grid.appendChild(createSkeletonCard());
    loadMoreWrap.hidden = true;
  } else {
    document.getElementById('loadMoreBtn').disabled = true;
    document.getElementById('loadMoreBtn').textContent = '取得中…';
  }

  try {
    const p = new URLSearchParams({ q });
    if (chSearchPage > 1) p.set('page', chSearchPage);
    const raw = await fetchMain(`/api/channels/${encodeURIComponent(channelId)}/search?${p}`);
    const items = Array.isArray(raw) ? raw : (raw.results || []);

    if (reset) grid.innerHTML = '';

    if (!items.length && reset) {
      grid.innerHTML = `<div class="empty-state"><p>「${escapeHtml(q)}」の検索結果が見つかりませんでした。</p></div>`;
    } else {
      items.forEach(item => {
        if (!item.authorThumbnails && channelInfo && channelInfo.authorThumbnails) {
          item.authorThumbnails = channelInfo.authorThumbnails;
        }
        grid.appendChild(createVideoCard(item));
      });
    }

    const hasMore = items.length >= 10;
    loadMoreWrap.hidden = !hasMore;

  } catch (e) {
    if (reset) {
      grid.innerHTML = `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>検索に失敗しました。</p></div>`;
    }
    loadMoreWrap.hidden = true;
    console.error(e);
  } finally {
    isLoading = false;
    if (!reset && document.getElementById('loadMoreBtn')) {
      document.getElementById('loadMoreBtn').disabled = false;
      document.getElementById('loadMoreBtn').textContent = '続きを読む';
    }
  }
}

// ── 投稿の添付 (画像 / 複数画像 / 動画 / アンケート / 再生リスト) ──
function _postBestThumb(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const sorted = list.filter(t => t && t.url).slice().sort((x, y) => (y.width || 0) - (x.width || 0));
  let u = (sorted[0] && sorted[0].url) || '';
  if (u.startsWith('//')) u = 'https:' + u;
  // 小さい切り抜き画像 (=s320-c-fcrop...) しか無いときは、元の大きさの画像を指定する
  u = u.replace(/=s\d+-c-fcrop64=[^?#]*$/, '=s1080-nd-v1');
  return u;
}
function createPostAttachment(att) {
  if (!att || !att.type) return '';
  const img = (u, w) => (typeof wsrv === 'function' ? wsrv(u, w) : u);
  if (att.type === 'image') {
    const u = _postBestThumb(att.imageThumbnails);
    if (!u) return '';
    return `<div class="community-attach community-attach-image"><a href="${escapeHtml(u)}" target="_blank" rel="noopener"><img src="${escapeHtml(img(u, 900))}" alt="" loading="lazy" /></a></div>`;
  }
  if (att.type === 'multiImage') {
    const urls = (att.images || []).map(_postBestThumb).filter(Boolean);
    if (!urls.length) return '';
    return `<div class="community-attach community-attach-multi" data-count="${urls.length}">${urls.map(u =>
      `<a href="${escapeHtml(u)}" target="_blank" rel="noopener"><img src="${escapeHtml(img(u, 600))}" alt="" loading="lazy" /></a>`).join('')}</div>`;
  }
  if (att.type === 'video' && att.videoId) {
    const dur = att.lengthSeconds ? formatDuration(att.lengthSeconds) : '';
    const meta = [att.author, att.viewCountText ? jaViewsText(att.viewCountText) : (att.viewCount != null ? jaViewsText(String(att.viewCount) + ' views') : ''), att.publishedText ? jaDate(att.publishedText) : '']
      .filter(Boolean).map(t => `<span>${escapeHtml(t)}</span>`).join('');
    return `<a class="community-attach community-attach-video" href="/watch?v=${encodeURIComponent(att.videoId)}">
      <div class="community-attach-thumb"><img src="${escapeHtml(getThumbnailUrl(att.videoId))}" alt="" loading="lazy" />${dur ? `<span class="community-attach-dur">${escapeHtml(dur)}</span>` : ''}</div>
      <div class="community-attach-info"><div class="community-attach-title">${escapeHtml(att.title || '')}</div><div class="community-attach-meta">${meta}</div></div>
    </a>`;
  }
  if (att.type === 'playlist' && att.playlistId) {
    const th = _postBestThumb(att.playlistThumbnails || att.thumbnails || []);
    return `<a class="community-attach community-attach-video" href="/playlist?list=${encodeURIComponent(att.playlistId)}">
      <div class="community-attach-thumb">${th ? `<img src="${escapeHtml(img(th, 480))}" alt="" loading="lazy" />` : ''}<span class="community-attach-dur">再生リスト${att.videoCount != null ? ` ・ ${escapeHtml(String(att.videoCount))}本` : ''}</span></div>
      <div class="community-attach-info"><div class="community-attach-title">${escapeHtml(att.title || '')}</div><div class="community-attach-meta">${att.author ? `<span>${escapeHtml(att.author)}</span>` : ''}</div></div>
    </a>`;
  }
  if ((att.type === 'poll' || att.type === 'quiz') && Array.isArray(att.choices) && att.choices.length) {
    const total = att.totalVotes != null ? `<div class="community-poll-total">${escapeHtml(Number(att.totalVotes).toLocaleString())}票</div>` : '';
    return `<div class="community-attach community-poll">${att.choices.map(c => {
      const t = typeof c === 'string' ? c : (c.text || '');
      const im = c && c.image ? _postBestThumb(c.image) : '';
      return `<div class="community-poll-choice">${im ? `<img src="${escapeHtml(img(im, 120))}" alt="" loading="lazy" />` : ''}<span>${escapeHtml(t)}</span></div>`;
    }).join('')}${total}</div>`;
  }
  return '';
}

// 投稿本文: <br> と改行が二重にならないよう整え、見えない制御文字だけの行は消す
function _postContentHtml(post) {
  if (post.contentHtml) {
    return String(post.contentHtml)
      .replace(/\r/g, '')
      .replace(/[\u2060-\u2064\u200b]/g, '')
      .replace(/\n/g, '<br>');
  }
  return post.content ? escapeHtml(String(post.content).replace(/\r/g, '')).replace(/\n/g, '<br>') : '';
}

function createCommunityPost(post) {
  const div = document.createElement('div');
  div.className = 'community-post';

  const authorIcon = post.authorThumbnails ? getChannelIconUrl(post.authorThumbnails, 76) : '';
  const contentHtml = _postContentHtml(post);
  const likes = post.likeCount != null ? Number(post.likeCount).toLocaleString() : null;
  const attachHtml = createPostAttachment(post.attachment);
  const pid = post.commentId || post.id || Math.random().toString(36).slice(2);

  div.innerHTML = `
    <div class="community-post-author">
      ${authorIcon
        ? `<img class="community-post-avatar" src="${authorIcon}" alt="" onload="this.classList.add('loaded')" />`
        : `<div class="community-avatar-placeholder"></div>`
      }
      <div class="community-author-info">
        <div class="community-author-name">${escapeHtml(post.author || '')}</div>
        ${post.publishedText ? `<div class="community-post-date">${escapeHtml(jaDate(post.publishedText))}${post.isEdited ? '（編集済み）' : ''}</div>` : ''}
      </div>
    </div>
    ${contentHtml ? `<div class="community-post-content community-html" id="postContent_${escapeHtml(pid)}">${contentHtml}</div>
    <button class="community-expand-btn" type="button" hidden>続きを読む</button>` : ''}
    ${attachHtml}
    ${likes != null ? `
      <div class="community-likes">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        ${likes}
        ${post.replyCount ? `<span class="community-replies">コメント ${escapeHtml(Number(post.replyCount).toLocaleString())}</span>` : ''}
      </div>
    ` : ''}
  `;

  // 本文が実際に枠からはみ出しているときだけ「続きを読む」を出す (画面に追加されたあとで測る)
  const contentEl = div.querySelector('.community-post-content');
  const expandBtn = div.querySelector('.community-expand-btn');
  if (contentEl && expandBtn) {
    const check = () => {
      if (!div.isConnected) return;
      if (contentEl.classList.contains('expanded')) return;
      expandBtn.hidden = contentEl.scrollHeight <= contentEl.clientHeight + 2;
    };
    requestAnimationFrame(() => requestAnimationFrame(check));
    setTimeout(check, 400);
    expandBtn.addEventListener('click', () => {
      const expanded = contentEl.classList.toggle('expanded');
      expandBtn.textContent = expanded ? '閉じる' : '続きを読む';
    });
  }
  // 画像が読み込めなかったときは枠ごと隠す (空白のまま残さない)
  div.querySelectorAll('.community-attach img').forEach(im => {
    im.addEventListener('error', () => {
      const a = im.closest('a') || im;
      if (im.closest('.community-attach-multi') || im.closest('.community-attach-image')) a.remove();
      else im.remove();
      div.querySelectorAll('.community-attach-multi, .community-attach-image').forEach(w => { if (!w.querySelector('img')) w.remove(); });
    }, { once: true });
  });

  return div;
}

function createChannelPlaylistCard(item) {
  const thumb = item.playlistThumbnail
    ? wsrv(item.playlistThumbnail, 480)
    : (item.videos && item.videos[0]?.videoId ? getThumbnailUrl(item.videos[0].videoId) : '');

  const a = document.createElement('a');
  a.className = 'video-card';
  a.href = `/playlist?list=${encodeURIComponent(item.playlistId)}`;

  a.innerHTML = `
    <div class="thumb-wrap playlist-thumb-wrap">
      ${thumb ? `<img class="thumb-img" src="${thumb}" alt="${escapeHtml(item.title)}" loading="lazy" onload="this.classList.add('loaded')" />` : ''}
      <div class="playlist-count-badge">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        ${item.videoCount != null ? item.videoCount + '本' : '再生リスト'}
      </div>
    </div>
    <div class="card-info">
      <div class="card-title">${escapeHtml(item.title || '')}</div>
      ${item.videoCount != null ? `<div class="card-meta"><span style="font-size:0.8rem;color:var(--muted);">${item.videoCount}本の動画</span></div>` : ''}
    </div>
  `;
  return a;
}

function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll('.ch-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const sortControls = document.getElementById('sortControls');
  const chSearchForm = document.getElementById('channelSearchForm');
  const homeArea = document.getElementById('homeArea');
  const contentGrid = document.getElementById('contentGrid');
  const communityArea = document.getElementById('communityArea');
  const loadMoreWrap = document.getElementById('loadMoreWrap');

  const hasSortTabs = ['videos', 'shorts', 'streams'];
  sortControls.hidden = !hasSortTabs.includes(tab);
  // The search form is only shown when the search icon is clicked, not as a tab
  chSearchForm.hidden = true;

  if (tab === 'home') {
    homeArea.hidden = false;
    contentGrid.style.display = 'none';
    communityArea.hidden = true;
    loadMoreWrap.hidden = true;
    loadHomeTab();
    return;
  }

  homeArea.hidden = true;
  contentGrid.style.display = '';

  loadTab(tab, true);
}

function bindEvents() {
  document.querySelectorAll('.ch-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('sortSelect').addEventListener('change', () => {
    if (['videos', 'shorts', 'streams'].includes(currentTab)) {
      loadTab(currentTab, true);
    }
  });

  const _searchForm = document.getElementById('chSearchForm');
  if (_searchForm) {
    _searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      doChannelSearch(true);
    });
  }

  const _searchIcon = document.getElementById('chSearchIcon');
  if (_searchIcon) {
    _searchIcon.addEventListener('click', () => {
      const _tabsBar = document.getElementById('channelTabsBar');
      const _searchFormWrap = document.getElementById('channelSearchForm');
      const _searchInput = document.getElementById('chSearchInput');
      if (_tabsBar) _tabsBar.style.display = 'none';
      if (_searchFormWrap) _searchFormWrap.hidden = false;
      if (_searchInput) _searchInput.focus();
    });
  }
  const _searchBack = document.getElementById('chSearchBack');
  if (_searchBack) {
    _searchBack.addEventListener('click', () => {
      const _searchFormWrap = document.getElementById('channelSearchForm');
      const _tabsBar = document.getElementById('channelTabsBar');
      if (_searchFormWrap) _searchFormWrap.hidden = true;
      if (_tabsBar) _tabsBar.style.display = '';
    });
  }

  const _moreBtn = document.getElementById('loadMoreBtn');
  const _moreWrap = document.getElementById('loadMoreWrap');
  const _loadMoreNow = () => {
    if (isLoading || _moreBtn.disabled || _moreWrap.hidden) return;   // 二重取得の防止
    let p;
    if (currentTab === 'search') {
      chSearchPage++;
      p = doChannelSearch(false);
    } else {
      p = loadTab(currentTab, false);
    }
    const _labels = { videos: '動画', shorts: 'ショート', streams: 'ライブ', latest: '動画', playlists: '再生リスト', community: '投稿', search: '検索結果' };
    if (window.VyTopLoader) VyTopLoader.show(_labels[currentTab] || 'コンテンツ');
    Promise.resolve(p).finally(() => {
      if (window.VyTopLoader) VyTopLoader.hide();
      // まだ画面の下が空いていれば続けて取る
      setTimeout(() => { if (typeof vyNearBottom === 'function' && vyNearBottom(_moreWrap)) _loadMoreNow(); }, 150);
    });
  };
  _moreBtn.addEventListener('click', _loadMoreNow);
  // 下までスクロールしたら自動で続きを取る
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) _loadMoreNow();
    }, { rootMargin: '0px 0px 900px 0px' }).observe(_moreWrap);
  }
}

async function init() {
  if (!channelId) return;

  initHeaderSearch();
  bindEvents();
  switchTab('home');
  loadChannelInfo();
}

init();
})();
