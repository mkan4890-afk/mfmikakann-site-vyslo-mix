;// ── Watch page global state (shared across watch-*.js modules) ──
let hqActive = false;
let hqSyncRemovers = [];
let lastStreamSrc = '';
// ── iframe 再生位置トラッキング ──
// YouTube IFrame API の postMessage で実際の currentTime を取得する
let _iframeCurrentTime = 0;   // IFrame API から取得した実際の再生位置
let _iframeStartSec    = 0;   // iframe 起動時の開始秒（フォールバック用）
let _iframeStartWall   = 0;   // iframe 起動時のタイムスタンプ（フォールバック用）
let _iframeEl          = null; // 現在アクティブな iframe 要素
let _iframePolling     = null; // setInterval の ID
let _iframeDuration    = 0;   // iframe 動画の尺（onStateChange duration補完用）
let _iframePlayerState = -1;  // -1=未知, 1=再生中, 2=一時停止, 0=終了
let _iframeVolume      = 100; // iframe 音量 (0-100)
let _iframeMuted       = false; // iframe ミュート状態
let _iframeRate        = 1;   // iframe 再生速度
let _clipStartSec      = -1;  // 再生区間: 開始秒 (-1 = 未設定)
let _clipEndSec        = -1;  // 再生区間: 終了秒 (-1 = 未設定)

let volState = (() => {
  const s = getSettings();
  // ロング動画の保存済み音量を優先的に読み込む
  let savedVol = null;
  try { savedVol = localStorage.getItem('vyslo_vol_long'); } catch {}
  const vol = savedVol !== null
    ? Math.max(0, Math.min(1, parseFloat(savedVol)))
    : Math.max(0, Math.min(1, (s.defaultVolume ?? 100) / 100));
  return { vol, muted: false };
})();
let currentStreamData = null;
let currentVideoMeta = null;
let currentVideoId = '';
let _relatedVideos = [];
let streamOnlyMode = 'normal'; // 'normal' | 'audio' | 'video'
let streamBestAudioUrl = '';
let streamAudioFormats = [];
let streamVideoFormats = [];
let lastNormalStreamSrc = '';
let cachedInvInstance = null;
let playerErrorHandler = null;
let streamSourcePref = getSettings().streamSource || 'auto'; // 'auto' | 'invidious' | 'rapidapi'


// ── URL params ──
const params = new URLSearchParams(location.search);
const videoId = params.get('v');
const listParam = params.get('list');
const indexParam = parseInt(params.get('index') || '-1', 10);

// ── Entry point ──
document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('page-watch')) return;
  initHeaderSearch();
  if (!videoId) {
    showWatchError('動画IDが指定されていません。', true);
  } else {
    initWatch(videoId);
  }
});

// ── Utilities (also used by watch-*.js modules) ──
function getSavedPosition(videoId) {
  try {
    const raw = localStorage.getItem('chocotube_positions');
    if (!raw) return 0;
    const positions = JSON.parse(raw);
    const entry = positions[videoId];
    if (!entry) return 0;
    if (Date.now() - entry.ts > 30 * 24 * 60 * 60 * 1000) return 0;
    return entry.t || 0;
  } catch { return 0; }
}
function savePosition(videoId, time, duration) {
  try {
    const raw = localStorage.getItem('chocotube_positions');
    const positions = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    Object.keys(positions).forEach(k => {
      if (now - (positions[k].ts || 0) > 30 * 24 * 60 * 60 * 1000) delete positions[k];
    });
    if (time > 5) {
      const prev = positions[videoId] || {};
      const d = (duration && isFinite(duration)) ? Math.floor(duration) : (prev.d || 0);
      positions[videoId] = d ? { t: Math.floor(time), d, ts: now } : { t: Math.floor(time), ts: now };
    } else {
      delete positions[videoId];
    }
    localStorage.setItem('chocotube_positions', JSON.stringify(positions));
  } catch {}
}
function clearSavedPosition(videoId) {
  try {
    const raw = localStorage.getItem('chocotube_positions');
    if (!raw) return;
    const positions = JSON.parse(raw);
    delete positions[videoId];
    localStorage.setItem('chocotube_positions', JSON.stringify(positions));
  } catch {}
}

function showWatchError(msg, isHome) {
  const main = document.getElementById('watchMain');
  main.innerHTML = `
    <div class="watch-error">
      <div class="watch-error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <h2>${escapeHtml(msg)}</h2>
      ${isHome ? '<p><a href="/">トップページへ戻る</a></p>' : ''}
    </div>
  `;
}

function createRelatedSkeleton() {
  const div = document.createElement('div');
  div.className = 'related-skeleton';
  div.innerHTML = `
    <div class="related-sk-thumb"></div>
    <div class="related-sk-info">
      <div class="related-sk-line rsk-t1"></div>
      <div class="related-sk-line rsk-t2"></div>
      <div class="related-sk-line rsk-ch"></div>
      <div class="related-sk-line rsk-vw"></div>
    </div>
  `;
  return div;
}

function createRelatedCard(video) {
  const a = document.createElement('a');
  a.className = 'related-card';
  a.href = `/watch?v=${video.videoId}`;
  const thumb = getThumbnailUrl(video.videoId);
  const dur = formatDuration(video.lengthSeconds);
  const vc = Number(video.viewCount) || parseCountText(video.viewCountText || video.shortViewCountText || '');
  const views = formatViews(vc);
  const date = jaDate(video.publishedText || '');
  const stats = [views, date].filter(Boolean);
  const channelHref = video.authorId ? `/channel?id=${encodeURIComponent(video.authorId)}` : null;

  // カード全体が動画へのリンクなので、チャンネル部分はリンクの入れ子にせず role="link" で扱う
  a.innerHTML = `
    <div class="related-thumb-wrap">
      <img class="related-thumb" src="${thumb}" alt="${escapeHtml(video.title)}" loading="lazy" onload="this.classList.add('loaded')" />
      ${dur ? `<span class="related-duration">${dur}</span>` : ''}
    </div>
    <div class="related-info">
      <div class="related-title-text">${escapeHtml(video.title)}</div>
      <div class="related-channel-row">
        ${channelHref
          ? `<span class="related-ch-channel-link vy-ch-press" role="link" tabindex="0" data-href="${channelHref}" title="${escapeHtml(video.author || '')}">
               <span class="related-ch-icon-wrap"><span class="related-ch-placeholder"></span></span>
               <span class="related-channel">${escapeHtml(video.author || '')}</span>
             </span>`
          : `<span class="related-ch-icon-wrap"><span class="related-ch-placeholder"></span></span>
             <span class="related-channel">${escapeHtml(video.author || '')}</span>`
        }
      </div>
      ${stats.length ? `<div class="related-views">${stats.map(escapeHtml).join('<span class="related-sep">·</span>')}</div>` : ''}
    </div>
  `;

  if (channelHref) {
    const chLink = a.querySelector('.related-ch-channel-link');
    const go = (e) => { e.preventDefault(); e.stopPropagation(); location.href = channelHref; };
    chLink.addEventListener('click', go);
    chLink.addEventListener('keydown', e => { if (e.key === 'Enter') go(e); });
  }

  return a;
}

function lazyLoadRelatedIcons(videos, cards) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const wrap = entry.target;
      const authorId = wrap.dataset.authorId;
      if (!authorId) return;
      observer.unobserve(wrap);
      delete wrap.dataset.authorId;

      fetchChannelAvatar(authorId).then(thumbs => {
        if (!thumbs || !wrap.isConnected) return;
        const iconUrl = getChannelIconUrl(thumbs);
        if (!iconUrl) return;
        const placeholder = wrap.querySelector('.related-ch-placeholder');
        if (!placeholder) return;
        const img = document.createElement('img');
        img.className = 'related-ch-icon';
        img.src = iconUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.onload = () => img.classList.add('loaded');
        placeholder.replaceWith(img);
      });
    });
  }, { rootMargin: '120px' });

  cards.forEach((card, i) => {
    const video = videos[i];
    if (!video || !video.authorId) return;
    const wrap = card.querySelector('.related-ch-icon-wrap');
    if (!wrap) return;
    wrap.dataset.authorId = video.authorId;
    observer.observe(wrap);
  });
}

function renderRelated(videos) {
  const list = document.getElementById('relatedList');
  list.innerHTML = '';
  if (!videos || videos.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">関連動画がありません</p>';
    return;
  }

  // 重複排除
  const seen = new Set();
  const deduped = videos.filter(v => {
    const id = v.videoId || v.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // Shorts判定: lengthSecondsが1〜60秒のものをShortsとみなす（0または未定は除外）
  const isShort = v => v.lengthSeconds && v.lengthSeconds > 0 && v.lengthSeconds <= 60;
  const longVideos = deduped.filter(v => !isShort(v));
  const shorts = deduped.filter(v => isShort(v));

  // 一番上: 次に再生されるロング動画
  if (longVideos.length > 0) {
    const upNext = longVideos[0];
    const card = createRelatedCard(upNext);
    card.classList.add('related-card-upnext');
    list.appendChild(card);
  }

  // その下: Shortsを横一列に表示
  if (shorts.length > 0) {
    const shortsSection = document.createElement('div');
    shortsSection.className = 'related-shorts-section';
    const shortsLabel = document.createElement('div');
    shortsLabel.className = 'related-shorts-label';
    shortsLabel.textContent = 'ショート';
    shortsSection.appendChild(shortsLabel);
    const shortsRow = document.createElement('div');
    shortsRow.className = 'related-shorts-row';
    shorts.slice(0, 10).forEach(v => {
      const card = createRelatedCard(v);
      card.classList.add('related-card-short');
      shortsRow.appendChild(card);
    });
    shortsSection.appendChild(shortsRow);
    list.appendChild(shortsSection);
  }

  // その下: 関連するロング動画を縦に並べる
  const restLong = longVideos.slice(1, 20);
  const cards = restLong.map(v => {
    const card = createRelatedCard(v);
    list.appendChild(card);
    return card;
  });

  // アイコンの遅延読み込み
  const allCards = [
    ...(longVideos.length > 0 ? [list.querySelector('.related-card-upnext')] : []),
    ...Array.from(list.querySelectorAll('.related-shorts-row .related-card-short')),
    ...cards
  ].filter(Boolean);
  const allVideos = [
    ...(longVideos.length > 0 ? [longVideos[0]] : []),
    ...shorts.slice(0, 10),
    ...restLong
  ];
  lazyLoadRelatedIcons(allVideos, allCards);
}

function setupQualities(formatStreams) {
  const qualityBtns = document.getElementById('qualityBtns');
  const qualityLoading = document.getElementById('qualityLoading');
  const vcQualOpts = document.getElementById('vcQualOpts');
  const vcQualBtn  = document.getElementById('vcQualBtn');
  const player = document.getElementById('videoPlayer');

  if (qualityLoading) qualityLoading.hidden = true;
  if (vcQualOpts) vcQualOpts.innerHTML = '';

  if (!formatStreams || formatStreams.length === 0) return null;

  // ユーザーが画質を選択していない場合は最も軽い（低解像度）品質を優先
  // ユーザーが画質を選択している場合はその画質を最優先
  const _userQual = (() => {
    try { return sessionStorage.getItem('vyslo_user_quality') || ''; } catch { return ''; }
  })();

  const lightOrder = ['144p', '240p', '360p', '480p', '720p', '720p60', '1080p', '1080p60'];

  const sorted = [...formatStreams].sort((a, b) => {
    if (_userQual) {
      // ユーザー選択画質を最優先、次に近い低解像度、次に高解像度
      const aLabel = a.qualityLabel || '';
      const bLabel = b.qualityLabel || '';
      if (aLabel === _userQual) return -1;
      if (bLabel === _userQual) return 1;
      // ユーザー選択より低い画質を優先（軽量化）
      const userIdx = lightOrder.indexOf(_userQual);
      const ai = lightOrder.indexOf(aLabel);
      const bi = lightOrder.indexOf(bLabel);
      const aDist = ai >= 0 && userIdx >= 0 ? userIdx - ai : -1;
      const bDist = bi >= 0 && userIdx >= 0 ? userIdx - bi : -1;
      // 低い画質（userIdxより前）を優先、同じ距離なら低い方
      if (aDist >= 0 && bDist >= 0) return bDist - aDist;
      if (aDist >= 0) return -1;
      if (bDist >= 0) return -1;
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
    // ユーザー選択なし: 最も軽い画質を優先
    const ai = lightOrder.indexOf(a.qualityLabel);
    const bi = lightOrder.indexOf(b.qualityLabel);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  function setQuality(fmt) {
    const currentTime = player.currentTime;
    const wasPlaying = !player.paused;
    const prevMode = streamOnlyMode;

    if (prevMode === 'audio') {
      // Switching quality while in audio mode → exit audio mode, go normal
      streamOnlyMode = 'normal';
      const _pw = document.getElementById('playerWrap');
      if (_pw) _pw.classList.remove('stream-audio-only');
      const _atb = document.getElementById('audioTrackBar');
      if (_atb) _atb.setAttribute('hidden', '');
      player.muted = volState.muted;
    }
    // If video-only mode: keep mode, keep muted — just change quality
    lastNormalStreamSrc = fmt.url;
    applyVideoSrc(player, fmt.url);
    player.currentTime = currentTime;
    if (prevMode === 'video') player.muted = true;
    if (wasPlaying) player.play().catch(() => {});
    // ユーザーが画質を選択した場合は保存
    sessionStorage.setItem('vyslo_user_quality', fmt.qualityLabel || fmt.quality || '');
    const label = fmt.qualityLabel || fmt.quality || '?';
    if (vcQualOpts) vcQualOpts.querySelectorAll('.vctrls-dd-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.url === fmt.url);
    });
    // In video-only mode keep the "映像だけ" label in the overlay btn and keep track btn active
    if (prevMode === 'video') {
      document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="video"]').forEach(b => b.classList.add('active'));
      document.querySelectorAll('#vcQualOpts .vctrls-dd-opt-track[data-track-mode="video"]').forEach(b => b.classList.add('active'));
      if (vcQualBtn) vcQualBtn.textContent = '映像だけ';
      // Deactivate all videoTrackBtns since quality changed back to muxed stream
      const vtb = document.getElementById('videoTrackBtns');
      if (vtb) vtb.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
    } else {
      if (vcQualBtn) vcQualBtn.textContent = label;
    }
    document.querySelectorAll('.vctrls-dd-wrap.dd-open').forEach(w => w.classList.remove('dd-open'));
  }

  // メニューは VyQuality がまとめて作る (音声付き + 高画質の映像だけの候補、実際に読み込める画質だけ)
  if (window.VyQuality) {
    VyQuality.setMuxed(sorted, sorted[0]);
  } else {
    sorted.forEach(fmt => {
      const label = fmt.qualityLabel || fmt.quality || '?';
      if (vcQualOpts) {
        const opt = document.createElement('button');
        opt.className = 'vctrls-dd-opt';
        opt.textContent = label;
        opt.dataset.url = fmt.url;
        opt.addEventListener('click', () => setQuality(fmt));
        vcQualOpts.appendChild(opt);
      }
    });
  }

  return sorted[0];
}

