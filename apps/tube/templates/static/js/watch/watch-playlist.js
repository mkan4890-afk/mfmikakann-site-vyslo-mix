const PLAYLIST_CACHE_TTL = 30 * 60 * 1000;

function getPlaylistCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > PLAYLIST_CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setPlaylistCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

async function initPlaylistPanel(playlistId, globalIndex) {
  const panel = document.getElementById('playlistPanel');
  panel.hidden = false;

  const PLAYLIST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
  const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

  function renderPanelItems(panel, videos, activeIndex, buildHref) {
    const listEl = panel.querySelector('#plPanelList');
    listEl.innerHTML = '';
    const total = videos.length;

    videos.forEach((video, i) => {
      const isActive = i === activeIndex;
      const href = buildHref(video, i);
      const thumb = getThumbnailUrl(video.videoId);
      const dur = formatDuration(video.lengthSeconds);

      const item = document.createElement('a');
      item.className = `pl-panel-item${isActive ? ' active' : ''}`;
      item.href = href;
      item.innerHTML = `
        <span class="pl-panel-num">${isActive ? PLAY_SVG : i + 1}</span>
        <div class="pl-panel-thumb-wrap">
          <img class="pl-panel-thumb" src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />
          ${dur ? `<span class="pl-panel-dur">${dur}</span>` : ''}
        </div>
        <div class="pl-panel-item-info">
          <div class="pl-panel-item-title">${escapeHtml(video.title || '')}</div>
          <div class="pl-panel-item-ch">${escapeHtml(video.author || '')}</div>
        </div>
      `;
      listEl.appendChild(item);
    });

    const activeEl = listEl.querySelector('.pl-panel-item.active');
    if (activeEl) {
      setTimeout(() => activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 100);
    }

    if (activeIndex + 1 < total) {
      const nextVideo = videos[activeIndex + 1];
      const nextUrl = buildHref(nextVideo, activeIndex + 1);
      document.getElementById('videoPlayer').addEventListener('ended', () => {
        if (getSettings().autoplayNext) {
          window.location.href = nextUrl;
        }
      });
    }
  }

  /* ---- ユーザー自作プレイリスト (pl_xxxxx) ---- */
  if (playlistId.startsWith('pl_')) {
    const pl = getPlaylist(playlistId);
    if (!pl) {
      panel.innerHTML = `<div class="pl-panel-error">プレイリストが見つかりません</div>`;
      return;
    }
    const videos = pl.videos;
    const idx = Math.max(globalIndex, 0);
    const total = videos.length;

    panel.innerHTML = `
      <div class="pl-panel">
        <div class="pl-panel-header">
          <div class="pl-panel-label-row">
            ${PLAYLIST_SVG}
            <span>自作リスト</span>
            <a class="pl-panel-all-link" href="/library">ライブラリへ</a>
          </div>
          <div class="pl-panel-title">${escapeHtml(pl.name)}</div>
          <div class="pl-panel-progress">${idx >= 0 ? `${idx + 1} / ${total}` : `${total}本の動画`}</div>
        </div>
        <div class="pl-panel-list" id="plPanelList"></div>
      </div>
    `;

    renderPanelItems(panel, videos, idx, (video, i) =>
      `/watch?v=${video.videoId}&list=${encodeURIComponent(playlistId)}&index=${i}`
    );
    return;
  }

  /* ---- Invidious プレイリスト ---- */
  const page = Math.floor(Math.max(globalIndex, 0) / 100) + 1;
  const indexOnPage = Math.max(globalIndex, 0) % 100;

  panel.innerHTML = `
    <div class="pl-panel">
      <div class="pl-panel-header">
        <div class="pl-panel-label-row">
          ${PLAYLIST_SVG}
          <span>再生リスト</span>
        </div>
        <div class="pl-panel-title sk-line" style="height:14px;width:80%;margin-top:0.4rem;"></div>
        <div class="sk-line" style="height:11px;width:40%;margin-top:0.3rem;"></div>
      </div>
      <div class="pl-panel-list" id="plPanelList">
        ${[...Array(5)].map(() => `
          <div class="pl-panel-item-sk">
            <div class="pl-panel-sk-num sk-line"></div>
            <div class="pl-panel-sk-thumb skeleton-animate"></div>
            <div class="pl-panel-sk-info">
              <div class="sk-line" style="height:12px;width:90%"></div>
              <div class="sk-line" style="height:10px;width:55%;margin-top:0.3rem"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  try {
    const cacheKey = `plCache_${playlistId}_${page}`;
    let data = getPlaylistCache(cacheKey);
    if (!data) {
      data = await withRetry(() => fetchMain(`/api/playlists/${encodeURIComponent(playlistId)}?page=${page}`), 10);
      if (data && data.videos && data.videos.length > 0) setPlaylistCache(cacheKey, data);
    }
    const videos = data.videos || [];
    const totalVideos = data.videoCount || videos.length;
    const pageOffset = (page - 1) * 100;

    const header = panel.querySelector('.pl-panel-header');
    header.innerHTML = `
      <div class="pl-panel-label-row">
        ${PLAYLIST_SVG}
        <span>再生リスト</span>
        <a class="pl-panel-all-link" href="/playlist?list=${encodeURIComponent(playlistId)}">全て見る</a>
      </div>
      <div class="pl-panel-title">${escapeHtml(data.title || '')}</div>
      <div class="pl-panel-progress">${globalIndex >= 0 ? `${globalIndex + 1} / ${totalVideos}` : `${totalVideos}本の動画`}</div>
    `;

    renderPanelItems(panel, videos, indexOnPage, (video, i) =>
      `/watch?v=${video.videoId}&list=${encodeURIComponent(playlistId)}&index=${pageOffset + i}`
    );

  } catch (e) {
    console.error('playlist panel error:', e);
    panel.innerHTML = `<div class="pl-panel-error">再生リストの取得に失敗しました</div>`;
  }
}

let streamExcludeList = [];
let reloadAllInProgress = false;
let streamAltBarReady = false;
let _reloadGen = 0;

async function reloadAll(videoId) {
  // 世代カウンタを進めて旧フェッチを無効化（早期リターンしない）
  const myGen = ++_reloadGen;
  reloadAllInProgress = true;

  const reloadAllBtn = document.getElementById('reloadAllBtn');
  if (reloadAllBtn) reloadAllBtn.disabled = true;

  streamExcludeList = [];
  streamAltBarReady = false;
  lastStreamSrc = '';
  lastNormalStreamSrc = '';
  streamOnlyMode = 'normal';
  streamBestAudioUrl = '';
  streamAudioFormats = [];
  streamVideoFormats = [];
  const _resetPw = document.getElementById('playerWrap');
  if (_resetPw) _resetPw.classList.remove('stream-audio-only');
  const _resetAtb = document.getElementById('audioTrackBar');
  if (_resetAtb) _resetAtb.setAttribute('hidden', '');
  const _resetVtb = document.getElementById('videoTrackBar');
  if (_resetVtb) _resetVtb.setAttribute('hidden', '');
  cachedInvInstance = null;
  setInstanceLabel(null);
  document.getElementById('streamAltBtn').setAttribute('hidden', '');

  teardownHQ();

  const player = document.getElementById('videoPlayer');
  const nocookiePlayer = document.getElementById('nocookiePlayer');
  const skeleton = document.getElementById('playerSkeleton');
  const errorEl = document.getElementById('playerError');
  const reloadBtn = document.getElementById('reloadBtn');
  const modeStream = document.getElementById('modeStream');
  const modeNocookie = document.getElementById('modeNocookie');
  const modeHQ = document.getElementById('modeHQ');

  player.pause();
  applyVideoSrc(player, '');
  player.setAttribute('hidden', '');
  nocookiePlayer.src = 'about:blank';
  nocookiePlayer.setAttribute('hidden', '');
  modeStream.classList.add('active');
  modeNocookie.classList.remove('active');
  if (modeHQ) modeHQ.classList.remove('active');
  skeleton.removeAttribute('hidden');
  errorEl.hidden = true;
  reloadBtn.hidden = true;

  const qualityBtns = document.getElementById('qualityBtns');
  qualityBtns.innerHTML = '<span id="qualityLoading" class="quality-loading">取得中…</span>';

  const altStatus = document.getElementById('streamAltStatus');
  if (altStatus) { altStatus.textContent = ''; altStatus.className = 'pc-alt-status'; }
  const altBtn = document.getElementById('streamAltBtn');
  if (altBtn) { altBtn.disabled = false; altBtn.setAttribute('hidden', ''); }

  document.getElementById('infoSkeleton').hidden = false;
  document.getElementById('videoInfo').setAttribute('hidden', '');

  const relatedList = document.getElementById('relatedList');
  relatedList.innerHTML = '';
  for (let i = 0; i < 8; i++) relatedList.appendChild(createRelatedSkeleton());

  currentSortBy = 'top';
  currentContinuation = null;
  commentsLoading = false;
  document.getElementById('commentCount').textContent = '';
  { const cc = document.getElementById('watchCmtCount'); if (cc) cc.textContent = ''; }
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === 'top'));
  document.getElementById('commentsList').innerHTML = '';
  loadComments(videoId, currentSortBy);


  const _genOk = () => myGen === _reloadGen;

  // 動画情報取得：成功 or 最大リトライまで独立して送り続ける（ストリームをブロックしない）
  const _infoPromise = (async () => {
    const maxRetries = 10;
    for (let i = 0; i < maxRetries; i++) {
      if (!_genOk()) return null;
      try {
        const r = await fetch(`/api/videoinfo/${encodeURIComponent(videoId)}?nocache=1`, { signal: AbortSignal.timeout(20000) });
        if (r.ok) return r.json();
      } catch {}
      if (i < maxRetries - 1)
        await new Promise(res => setTimeout(res, Math.min(1500 * Math.pow(1.5, i), 15000)));
    }
    return null;
  })();

  // ストリーム取得：成功したらすぐ再生開始
  try {
    const streamResult = await withRetryOrReload(videoId, () => fetchBestStream(videoId), { maxAutoReloads: 0 });
    if (!_genOk()) return;

    const { data: streamData, instanceUrl } = streamResult;
    const invInstance = instanceUrl || streamData._invidious_instance || null;
    streamExcludeList = invInstance ? [invInstance] : [];
    cachedInvInstance = invInstance;
    streamAltBarReady = true;
    if (isStreamModeActive()) {
      document.getElementById('streamAltBtn').removeAttribute('hidden');
      setInstanceLabel(invInstance);
    }
    setHQInstanceLabel(invInstance);

    setupPlayer(streamData, videoId, instanceUrl);

    // 動画情報が取れたら UI を更新（ストリーム再生とは非同期）
    _infoPromise.then(metaData => {
      if (!_genOk()) return;
      if (metaData) {
        renderVideoInfo(metaData, videoId);
        let _rel = metaData.recommendedVideos || [];
        renderRelated(_rel);

        // 現在の動画のチャンネルの他の動画を追加取得
        if (metaData.authorId && _rel.length < 15) {
          const _recGen = _reloadGen;
          fetchMain(`/api/channels/${metaData.authorId}/videos`).then(chData => {
            if (_recGen !== _reloadGen) return;
            if (!chData || !chData.videos) return;
            const chVideos = chData.videos.filter(v => v.videoId !== videoId);
            const _existing = new Set(_rel.map(v => v.videoId));
            const _newVideos = chVideos.filter(v => !_existing.has(v.videoId)).slice(0, 5);
            if (_newVideos.length > 0) {
              _rel = [..._rel, ..._newVideos];
              renderRelated(_rel);
            }
          }).catch(() => {});
        }

        // Pipedが先に返った場合、バックグラウンドでInvidiousを取得して差し替え
        if (metaData._source === 'piped') {
          const _upgradeGen = _reloadGen;
          fetchMain(`/api/videos/${videoId}`).then(invMeta => {
            if (_upgradeGen !== _reloadGen) return;
            if (!invMeta || invMeta.error) return;
            renderVideoInfo(invMeta, videoId);
            const _invRelated = invMeta.recommendedVideos || [];
            const _existing = new Set(_rel.map(v => v.videoId));
            const _merged = [..._invRelated.filter(v => !_existing.has(v.videoId)), ..._rel.filter(v => !_invRelated.some(r => r.videoId === v.videoId))];
            renderRelated(_merged);
          }).catch(() => {});
        }
      } else {
        document.getElementById('infoSkeleton').hidden = true;
        document.getElementById('videoInfo').removeAttribute('hidden');
        document.getElementById('watchTitle').textContent = '情報を取得できませんでした';
        renderRelated([]);
      }
    });

  } catch (e) {
    if (!_genOk()) return;
    console.error('[reloadAll] ストリーム取得失敗', e);
    // フォールバック: nocookie → edu → 最終エラー表示
    const _fallbackGen2 = _reloadGen;
    const _genOk2 = () => _fallbackGen2 === _reloadGen;
    let _fbOk = false;

    // nocookie
    if (_genOk2()) {
      try {
        const nc = document.getElementById('nocookiePlayer');
        const sk = document.getElementById('playerSkeleton');
        const pl = document.getElementById('videoPlayer');
        if (nc && pl) {
          if (sk) sk.hidden = true;
          pl.setAttribute('hidden', '');
          nc.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
          nc.removeAttribute('hidden');
          const ok = await Promise.race([
            new Promise(r => setTimeout(() => r(true), 3000)),
            new Promise(r => { nc.onload = () => r(true); })
          ]);
          if (_genOk2() && ok) _fbOk = true;
        }
      } catch (_) {}
    }

    // edu
    if (_genOk2() && !_fbOk) {
      try {
        const ep = document.getElementById('eduPlayer');
        const pl = document.getElementById('videoPlayer');
        if (ep && pl) {
          pl.setAttribute('hidden', '');
          ep.src = `https://www.youtubeeducation.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
          ep.removeAttribute('hidden');
          const ok = await Promise.race([
            new Promise(r => setTimeout(() => r(true), 3000)),
            new Promise(r => { ep.onload = () => r(true); })
          ]);
          if (_genOk2() && ok) _fbOk = true;
        }
      } catch (_) {}
    }

    // 最終エラー表示
    if (_genOk2() && !_fbOk) {
      const sk = document.getElementById('playerSkeleton');
      const err = document.getElementById('playerError');
      const errMag = document.getElementById('playerErrorMsg');
      const rlBtn = document.getElementById('reloadBtn');
      if (sk) sk.hidden = true;
      if (err) err.hidden = false;
      if (errMag) errMag.textContent = '動画の取得中にエラーが発生しました。ページを更新してみてください。';
      if (rlBtn) rlBtn.hidden = false;
    }
  }

  if (!_genOk()) return;

  reloadAllInProgress = false;
  if (reloadAllBtn) reloadAllBtn.disabled = false;
}

