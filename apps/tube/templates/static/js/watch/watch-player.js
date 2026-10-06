let _hlsInstance = null;
let _currentVideoSrc = '';

function _isHlsUrl(url) {
  return typeof url === 'string' && url.includes('.m3u8');
}

function applyVideoSrc(player, url) {
  if (_hlsInstance) {
    _hlsInstance.destroy();
    _hlsInstance = null;
  }
  _currentVideoSrc = url || '';
  if (!url) {
    player.src = '';
    return;
  }
  if (_isHlsUrl(url) && typeof Hls !== 'undefined' && Hls.isSupported()) {
    _hlsInstance = new Hls({ enableWorker: true });
    _hlsInstance.loadSource(url);
    _hlsInstance.attachMedia(player);
  } else {
    player.src = url;
  }
}

function getVideoSrc() {
  return _currentVideoSrc || '';
}

function setupPlayer(streamData, videoId, instanceUrl) {
  currentStreamData = streamData;
  currentVideoId = videoId;
  const player = document.getElementById('videoPlayer');
  const skeleton = document.getElementById('playerSkeleton');
  const errorEl = document.getElementById('playerError');
  const errorMsg = document.getElementById('playerErrorMsg');
  const reloadBtn = document.getElementById('reloadBtn');

  player.poster = getThumbnailUrl(videoId);

  const formats = streamData.formatStreams || [];

  if (formats.length === 0) {
    skeleton.hidden = true;
    if (isExternalEmbedModeActive()) {
      errorEl.hidden = true;
      reloadBtn.hidden = true;
    } else {
      // 即エラーにせず、別の再生経路を自動的に試す
      doStreamAlt(videoId, 0).then(() => {
        // doStreamAlt成功時は再生開始済み
      }).catch(() => {
        if (isExternalEmbedModeActive()) return;
        const _pErr = document.getElementById('playerError');
        const _pErrMag = document.getElementById('playerErrorMsg');
        const _reloadBtn = document.getElementById('reloadBtn');
        if (_pErr) _pErr.hidden = false;
        if (_pErrMag) _pErrMag.textContent = '動画の取得中にエラーが発生しました。ページを更新してみてください。';
        if (_reloadBtn) _reloadBtn.hidden = false;
      });
    }
    const qualityLoading = document.getElementById('qualityLoading');
    if (qualityLoading) qualityLoading.hidden = true;
  } else {
    const bestFormat = setupQualities(formats);
    if (!bestFormat) return;

    lastNormalStreamSrc = bestFormat.url;
    applyVideoSrc(player, bestFormat.url);
    skeleton.hidden = true;

    // 保存済みの音量を適用
    const _sv = (() => { try { return localStorage.getItem('vyslo_vol_long'); } catch { return null; } })();
    if (_sv !== null) {
      const _v = Math.max(0, Math.min(1, parseFloat(_sv)));
      player.volume = _v;
      player.muted = _v === 0;
      if (typeof volState !== 'undefined') { volState.vol = _v; volState.muted = _v === 0; }
      const _vcVol = document.getElementById('vcVol');
      if (_vcVol) { _vcVol.value = _v; }
    }

    const vcQualBtn = document.getElementById('vcQualBtn');
    if (vcQualBtn && !window.VyQuality) {
      vcQualBtn.textContent = bestFormat.qualityLabel || bestFormat.quality || '画質';
      const firstOpt = document.querySelector('#vcQualOpts .vctrls-dd-opt');
      if (firstOpt) firstOpt.classList.add('active');
    }
    // Mark "標準" as active (no individual quality buttons in panel anymore)
    document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));

    const setOvMode = document.getElementById('vcQualWrap');
    if (setOvMode) setOvMode.removeAttribute('hidden');

    if (!isExternalEmbedModeActive()) {
      player.removeAttribute('hidden');
      if (getSettings().autoplay) {
        tryAutoplay(player, null);
      }
    }

    if (playerErrorHandler) {
      player.removeEventListener('error', playerErrorHandler);
    }
    playerErrorHandler = () => {
      // 高画質 (映像だけ) の読み込み失敗は画質を戻すだけにする
      if (window.VyQuality && VyQuality.handleError()) return;
      // LIVE の再生エラーは VyLive 側で復帰 / 埋め込みへの切り替えを行う
      if (window.VyLive && VyLive.isLive()) return;
      if (!isExternalEmbedModeActive() && !reloadAllInProgress) {
        const savedTime = player.currentTime;
        player.setAttribute('hidden', '');
        doStreamAlt(videoId, savedTime).catch(() => {
          reloadAll(videoId);
        });
      }
    };
    player.addEventListener('error', playerErrorHandler);
  }

  if (instanceUrl === 'zernio') {
    // Zernio は adaptiveFormats を持たない。HQ状態は watch-controls.js の
    // setPendingHQMode() + バックグラウンドフェッチ側で管理するため、ここでは触れない。
  } else {
    initHQMode(streamData);
  }
  setupStreamOnlyBtns();
}

// 説明文の「#ハッシュタグ」 (日本語も含む) をハッシュタグのページへのリンクにする
const VY_HASHTAG_RE = /(^|[\s\u3000>（(「『【、。,])#([^\s\u3000#<>"'、。，,.!?！？()（）\[\]【】「」『』]+)/g;
function vyLinkifyHashtags(escapedText) {
  return escapedText.replace(VY_HASHTAG_RE, (m, pre, tag) => `${pre}<a class="vy-hashtag" href="/hashtag?tag=${encodeURIComponent(tag)}">#${tag}</a>`);
}

function formatDescription(rawHtml, rawText) {
  let html = (rawHtml || '').trim();
  // タグを含まない (ただの文章の) 説明は文章として扱う
  if (html && !/<[a-z][^>]*>/i.test(html)) {
    rawText = rawText && rawText.trim() ? rawText : html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    html = '';
  }

  if (!html) {
    if (!(rawText || '').trim()) return '';
    html = escapeHtml(rawText)
      .replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1">$1</a>');
    html = vyLinkifyHashtags(html).replace(/\n/g, '<br>');
    // 動画・チャンネルへのリンクはサイト内へ
    const tmp = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    rawHtml = tmp.querySelector('div').innerHTML;
    html = rawHtml;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString('<div>' + html + '</div>', 'text/html');

  // リンクになっていない「#ハッシュタグ」もリンクにする
  const walker = doc.createTreeWalker(doc.querySelector('div'), NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.nodeValue.includes('#') && !n.parentElement.closest('a')) textNodes.push(n);
  }
  textNodes.forEach(n => {
    const linked = vyLinkifyHashtags(escapeHtml(n.nodeValue));
    if (linked === escapeHtml(n.nodeValue)) return;
    const span = doc.createElement('span');
    span.innerHTML = linked;
    n.replaceWith(...span.childNodes);
  });

  doc.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim();

    const isHashtag = text.startsWith('#') ||
      /youtube\.com\/hashtag\//i.test(href) ||
      /\/hashtag\//i.test(href);

    if (isHashtag) {
      const tag = text.startsWith('#')
        ? text.slice(1)
        : (href.match(/\/hashtag\/([^/?&]+)/) || [])[1] || text.replace(/^#/, '');
      a.href = `/hashtag?tag=${encodeURIComponent(tag)}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    const ytVideoMatch = href.match(/(?:youtube\.com\/watch[^"]*[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (ytVideoMatch) {
      a.href = `/watch?v=${ytVideoMatch[1]}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    // Channel ID: /channel/UCxxxx or youtube.com/channel/UCxxxx
    const channelIdMatch = href.match(/(?:youtube\.com)?\/channel\/([A-Za-z0-9_-]+)/);
    if (channelIdMatch) {
      a.href = `/channel?id=${channelIdMatch[1]}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    // Handle: /@handle or youtube.com/@handle[?...]
    const handleMatch = href.match(/(?:youtube\.com)?\/(@[^/?&\s]+)/);
    if (handleMatch) {
      a.href = `/channel?id=${encodeURIComponent(handleMatch[1])}`;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      return;
    }

    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  return doc.querySelector('div').innerHTML;
}

function updateWatchSubBtn(btn, authorId, subscribedOverride) {
  const subscribed = subscribedOverride !== undefined ? subscribedOverride : isSubscribed(authorId);
  btn.className = subscribed ? 'sub-btn subscribed' : 'sub-btn';
  btn.innerHTML = subscribed
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg> 登録済み`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> 登録`;
}

function initWatchPlaylistBtn(videoId, meta) {
  const wrap = document.getElementById('watchPlWrap');
  const btn = document.getElementById('watchPlBtn');
  const popup = document.getElementById('watchPlPopup');
  if (!wrap || !btn || !popup) return;

  wrap.hidden = false;

  // データセットガードで重複初期化を防止
  if (btn.dataset.plInit) {
    // 既に初期化済み: videoDataのみ更新
    btn._plVideoData = {
      videoId,
      title: meta.title || '',
      author: meta.author || '',
      authorId: meta.authorId || '',
      lengthSeconds: meta.lengthSeconds || 0
    };
    btn._plUpdateBtn();
    return;
  }
  btn.dataset.plInit = '1';

  const videoData = {
    videoId,
    title: meta.title || '',
    author: meta.author || '',
    authorId: meta.authorId || '',
    lengthSeconds: meta.lengthSeconds || 0
  };
  btn._plVideoData = videoData;

  function updateBtn() {
    const inAny = getPlaylistsContaining(videoId).length > 0;
    btn.innerHTML = inAny ? VY_PL_ICON_ADDED : VY_PL_ICON_ADD;
    btn.title = inAny ? '保存済み (押して変更)' : 'プレイリストに保存';
    btn.classList.toggle('watch-pl-btn--saved', inAny);
  }
  btn._plUpdateBtn = updateBtn;

  updateBtn();

  function renderPopup() {
    vyRenderPlaylistPopup(popup, btn._plVideoData || videoData, () => { btn._plUpdateBtn(); setTimeout(placePopup, 0); });
  }

  let popupOpen = false;

  // 画面からはみ出さない位置に出す (関連動画を閉じてボタンが右端に寄ったときなど)
  function placePopup() {
    if (popup.hidden) return;
    popup.style.left = ''; popup.style.right = ''; popup.style.top = ''; popup.style.bottom = ''; popup.style.maxHeight = '';
    const M = 8;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const wr = wrap.getBoundingClientRect();
    let r = popup.getBoundingClientRect();
    // 横: 右にはみ出すならボタンの右端にそろえ、それでもはみ出すなら画面内に収める
    if (r.right > vw - M) {
      popup.style.left = 'auto'; popup.style.right = '0';
      r = popup.getBoundingClientRect();
      if (r.left < M) { popup.style.right = 'auto'; popup.style.left = (M - wr.left) + 'px'; }
    } else if (r.left < M) {
      popup.style.left = (M - wr.left) + 'px';
    }
    // 縦: 下に入りきらず、上の方が広いときは上向きに開く。どちらでも入らなければ中をスクロール
    r = popup.getBoundingClientRect();
    const below = vh - wr.bottom - 6 - M, above = wr.top - 6 - M;
    if (r.height > below && above > below) {
      popup.style.top = 'auto'; popup.style.bottom = 'calc(100% + 6px)';
      if (r.height > above) popup.style.maxHeight = Math.max(160, above) + 'px';
    } else if (r.height > below) {
      popup.style.maxHeight = Math.max(160, below) + 'px';
    }
  }
  btn._plPlace = placePopup;

  btn.onclick = (e) => {
    e.stopPropagation();
    popupOpen = !popupOpen;
    popup.hidden = !popupOpen;
    if (popupOpen) { renderPopup(); placePopup(); }
  };
  window.addEventListener('resize', () => { if (!popup.hidden) placePopup(); });

  if (!document._plDocClickBound) {
    document._plDocClickBound = true;
    document.addEventListener('click', (e) => {
      const _w = document.getElementById('watchPlWrap');
      const _p = document.getElementById('watchPlPopup');
      if (_w && _p && !_p.hidden && !_w.contains(e.target)) {
        _p.hidden = true;
      }
    }, true);
  }
}

function getStreamExt(fmt) {
  if (fmt.container) return fmt.container.replace(/^m4a$/, 'mp4');
  if (fmt.type) {
    const m = fmt.type.match(/^(video|audio)\/(\w+)/);
    if (m) return m[2] === 'webm' ? 'webm' : 'mp4';
  }
  return 'mp4';
}

function getStreamCodecLabel(fmt) {
  const enc = (fmt.encoding || '').toLowerCase();
  if (enc.startsWith('av01') || enc.startsWith('av1')) return 'AV1';
  if (enc === 'vp9') return 'VP9';
  if (enc === 'h264' || enc === 'avc1') return 'H.264';
  if (enc === 'aac' || enc === 'mp4a') return 'AAC';
  if (enc === 'opus') return 'Opus';
  if (fmt.type) {
    const t = fmt.type.toLowerCase();
    if (t.includes('vp9')) return 'VP9';
    if (t.includes('av01') || t.includes('av1')) return 'AV1';
    if (t.includes('avc') || t.includes('h264')) return 'H.264';
    if (t.includes('opus')) return 'Opus';
    if (t.includes('aac') || t.includes('mp4a')) return 'AAC';
  }
  if (fmt.container === 'webm') return 'VP9';
  if (fmt.container === 'm4a' || fmt.container === 'mp4') return 'AAC';
  return enc || fmt.container || '';
}

function buildDownloadUrl(streamUrl, filename) {
  return `/download?url=${encodeURIComponent(streamUrl)}&filename=${encodeURIComponent(filename)}`;
}

function initWatchLikeBtn(videoId, meta) {
  const btn = document.getElementById('watchFavBtn');
  if (!btn) return;
  // ショートと同じ仕様: 数はボタンの中、押しても数は変えず「押した状態」だけ切り替える
  vySetupLikeButton(btn, videoId, () => (currentVideoMeta && (currentVideoMeta.videoId || videoId) === videoId ? currentVideoMeta : meta));
  btn.hidden = false;
}

function initShareBtn(videoId) {
  const btn = document.getElementById('watchShareBtn');
  const panel = document.getElementById('watchSharePanel');
  if (!btn || !panel) return;
  btn.removeAttribute('hidden');
  if (btn.dataset.shareInit) return;
  btn.dataset.shareInit = '1';
  setupSharePanel(btn, panel, () => {
    const vid = (new URLSearchParams(location.search)).get('v') || videoId;
    return {
      videoId: vid,
      ytUrl: `https://www.youtube.com/watch?v=${vid}`,
      appUrl: location.href,
      title: document.title,
    };
  });
}

function initDownloadBtn(videoId, meta) {
  const btn = document.getElementById('watchDlBtn');
  if (!btn) return;
  btn.removeAttribute('hidden');
  if (btn.dataset.dlInit) return;
  btn.dataset.dlInit = '1';
  btn.addEventListener('click', () => {
    const vid = (new URLSearchParams(location.search)).get('v') || videoId;
    const m = currentVideoMeta || meta || {};
    VyDownload.open({
      videoId: vid,
      meta: m,
      streamData: currentStreamData ? { data: currentStreamData, instanceUrl: (typeof currentInstanceUrl !== 'undefined' ? currentInstanceUrl : null) } : null,
    });
  });
}
