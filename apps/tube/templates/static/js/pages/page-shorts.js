;(() => {
  if (!document.body.classList.contains('page-shorts')) return;

  document.addEventListener('DOMContentLoaded', () => {
    initHeaderSearch();
    initShortsPage();
  });

  const EDU_KEYS = [
    { label: 'choco-1', url: 'https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key1.json' },
    { label: 'choco-2', url: 'https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key2.json' },
    { label: 'choco-3', url: 'https://raw.githubusercontent.com/choco-1515/About-youtube/refs/heads/main/edu/key3.json' },
  ];

  let eduParams = [];
  let queue = [];
  let queueIdx = 0;
  let isFetchingMore = false;
  let channelMode = false;
  let channelId = null;
  let channelContinuation = null;
  let searchMode = false;
  let searchQueryStr = null;
  let searchContinuation = null;
  let searchShortPage1 = 1;
  let searchShortPage2 = 0;
  let searchExhausted = false;
  let searchEmptyStreak = 0;

  // ===== EDU PARAMS =====
  function getParamIdx() {
    const sel = document.getElementById('sfParamSelect');
    return sel ? parseInt(sel.value, 10) : 0;
  }

  function getEduSrc(videoId) {
    const idx = getParamIdx();
    let param = (eduParams[idx] && eduParams[idx].value) ? eduParams[idx].value : '?autoplay=1';
    const sep = param.includes('?') ? '&' : '?';
    if (!param.includes('loop=')) {
      param += `${sep}loop=1&playlist=${videoId}`;
    }
    return `https://www.youtubeeducation.com/embed/${videoId}${param}`;
  }

  function applyEduParams(data) {
    if (!Array.isArray(data) || !data.length) return false;
    eduParams = data;
    const sel = document.getElementById('sfParamSelect');
    if (sel) {
      sel.innerHTML = '<option value="normal">通常</option>';
      eduParams.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = p.label;
        sel.appendChild(opt);
      });
      sel.value = sfMode === 'normal' ? 'normal' : '0';
    }
    return true;
  }

  async function fetchEduParams() {
    // バックエンドがテンプレートに埋め込んだキャッシュデータを優先使用
    if (window._EDU_PARAMS && applyEduParams(window._EDU_PARAMS)) return;
    // キャッシュ未取得（初回起動直後等）はAPIから取得
    try {
      const res = await fetch('/api/edu-params');
      const data = await res.json();
      applyEduParams(data);
    } catch (_) {}
  }

  // ===== PLAYER =====
  // ===== 通常再生 (視聴ページの「通常」ボタンと同じ 360p 映像+音声ストリーム) =====
  let sfMode = 'normal';     // 'normal' | 'edu'
  let sfLoadToken = 0;

  function ensureSfVideo() {
    let v = document.getElementById('sfVideo');
    if (v) return v;
    const box = document.getElementById('sfPlayerBox');
    v = document.createElement('video');
    v.id = 'sfVideo';
    v.className = 'sf-video';
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.loop = true;
    v.preload = 'auto';
    box.appendChild(v);

    const ui = document.createElement('div');
    ui.className = 'sf-vui';
    ui.innerHTML = `
      <div class="sf-vui-center" id="sfVuiCenter" hidden>
        <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><polygon points="7 4 20 12 7 20 7 4"/></svg>
      </div>
      <button type="button" class="sf-vui-unmute" id="sfUnmute" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
        タップで音を出す
      </button>
      <div class="sf-vui-vol" id="sfVolWrap">
        <button type="button" class="sf-vui-mute" id="sfVolMute" title="ミュート">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>
        <input type="range" class="sf-vui-vol-slider" id="sfVolSlider" min="0" max="1" step="0.02" value="1" aria-label="音量">
      </div>
      <div class="sf-vui-bar">
        <span class="sf-vui-time" id="sfVuiTime">0:00 / 0:00</span>
        <div class="sf-vui-track"><div class="sf-vui-buf" id="sfVuiBuf"></div>
          <input type="range" class="sf-vui-seek" id="sfVuiSeek" min="0" max="1000" step="1" value="0" aria-label="再生位置">
        </div>
      </div>`;
    box.appendChild(ui);

    const seek = ui.querySelector('#sfVuiSeek');
    const buf = ui.querySelector('#sfVuiBuf');
    const time = ui.querySelector('#sfVuiTime');
    const center = ui.querySelector('#sfVuiCenter');
    const unmute = ui.querySelector('#sfUnmute');
    const fmt = t => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
    let dragging = false;
    const paint = () => {
      const d = v.duration || 0;
      const pct = d ? (v.currentTime / d) * 100 : 0;
      if (!dragging) seek.value = Math.round(pct * 10);
      seek.style.setProperty('--pct', pct.toFixed(2) + '%');
      time.textContent = `${fmt(v.currentTime)} / ${fmt(d)}`;
      try { if (d && v.buffered.length) buf.style.width = (v.buffered.end(v.buffered.length - 1) / d * 100).toFixed(1) + '%'; } catch (_) {}
    };
    v.addEventListener('timeupdate', paint);
    v.addEventListener('progress', paint);
    v.addEventListener('loadedmetadata', paint);
    v.addEventListener('play', () => { center.hidden = true; });
    v.addEventListener('pause', () => { center.hidden = false; });
    seek.addEventListener('input', () => {
      dragging = true;
      const pct = seek.value / 10;
      seek.style.setProperty('--pct', pct + '%');
      if (v.duration) v.currentTime = v.duration * pct / 100;
    });
    seek.addEventListener('change', () => { dragging = false; });
    v.addEventListener('click', () => { if (v.paused) v.play().catch(() => {}); else v.pause(); });
    center.addEventListener('click', () => v.play().catch(() => {}));
    unmute.addEventListener('click', e => { e.stopPropagation(); v.muted = false; unmute.hidden = true; });

    // 音量コントロール（ホバーで表示）
    const volMute = ui.querySelector('#sfVolMute');
    const volSlider = ui.querySelector('#sfVolSlider');

    // Shorts音量を保存から読み込み
    let _sfSavedVol = 1;
    try {
      const sv = localStorage.getItem('vyslo_vol_shorts');
      if (sv !== null) _sfSavedVol = Math.max(0, Math.min(1, parseFloat(sv)));
    } catch {}
    v.volume = _sfSavedVol;
    v.muted = _sfSavedVol === 0;
    volSlider.value = _sfSavedVol;
    volSlider.style.setProperty('--pct', (_sfSavedVol * 100).toFixed(2) + '%');

    if (volMute) volMute.addEventListener('click', e => {
      e.stopPropagation();
      v.muted = !v.muted;
      if (!v.muted && v.volume === 0) { v.volume = 0.5; volSlider.value = 0.5; }
      volSlider.style.setProperty('--pct', (v.muted ? 0 : v.volume * 100).toFixed(2) + '%');
    });
    if (volSlider) volSlider.addEventListener('input', e => {
      e.stopPropagation();
      const val = parseFloat(volSlider.value);
      v.volume = val;
      v.muted = val === 0;
      unmute.hidden = val > 0;
      volSlider.style.setProperty('--pct', (val * 100).toFixed(2) + '%');
      // Shorts音量を保存
      try { localStorage.setItem('vyslo_vol_shorts', String(val)); } catch {}
    });
    if (volSlider) volSlider.addEventListener('click', e => e.stopPropagation());
    if (volMute) volMute.addEventListener('click', e => e.stopPropagation());

    // 音量変更時にミュートアイコンを更新
    v.addEventListener('volumechange', () => {
      if (volSlider) volSlider.style.setProperty('--pct', (v.muted ? 0 : v.volume * 100).toFixed(2) + '%');
    });

    document.addEventListener('keydown', e => {
      if (sfMode !== 'normal' || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause(); }
      if (e.key === 'm') { v.muted = !v.muted; unmute.hidden = !v.muted; }
    });
    return v;
  }

  async function fetchNormalUrl(videoId) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`/api/zerniostream/${encodeURIComponent(videoId)}?formatId=2`, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const url = (await res.text()).trim();
      if (!url.startsWith('http')) throw new Error('bad url');
      return url;
    } finally { clearTimeout(t); }
  }

  function showEdu(videoId) {
    const iframe = document.getElementById('sfIframe');
    const skeleton = document.getElementById('sfSkeleton');
    const box = document.getElementById('sfPlayerBox');
    if (box) box.classList.remove('sf-mode-normal');
    const v = document.getElementById('sfVideo');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    if (!iframe) return;
    iframe.hidden = false;
    iframe.src = getEduSrc(videoId);
    iframe.onload = () => { if (skeleton) skeleton.style.display = 'none'; setTimeout(hidePoster, 600); };
  }

  // 視聴ページの「ストリーム → 通常」と同じく、複数の取得元を並列で試し
  // 実際に再生できた 360p (映像+音声) を使う
  function pickCombined(r) {
    const fs = (r && r.data && r.data.formatStreams) || [];
    const f = fs.find(x => String(x.itag) === '18') || fs.find(x => /360/.test(x.qualityLabel || x.quality || '')) || fs[0];
    return f && f.url;
  }
  function tryUrl(v, url, token) {
    return new Promise(ok => {
      let done = false;
      const fin = r => { if (done) return; done = true; clearTimeout(t); v.onloadeddata = null; v.onerror = null; ok(r); };
      const t = setTimeout(() => fin(false), 9000);
      v.onloadeddata = () => fin(true);
      v.onerror = () => fin(false);
      if (token !== sfLoadToken) return fin(false);
      v.src = url;
      v.load();
    });
  }
  async function playNormal(v, videoId, token) {
    const sources = [
      () => fetchNormalUrl(videoId).then(u => ({ data: { formatStreams: [{ url: u, itag: 18 }] } })),
      () => (typeof fetchSiaStream === 'function' ? fetchSiaStream(videoId) : Promise.reject()),
      () => (typeof fetchStream === 'function' ? fetchStream(`/api/stream/${videoId}`) : Promise.reject()),
      () => (typeof fetchRapidStream === 'function' ? fetchRapidStream(videoId) : Promise.reject()),
    ];
    const found = [];
    let pending = sources.length, wake = null;
    sources.forEach(f => {
      let pr; try { pr = f(); } catch (_) { pr = Promise.reject(); }
      Promise.resolve(pr).then(r => { const u = pickCombined(r); if (u) found.push(u); })
        .catch(() => {})
        .finally(() => { pending--; if (wake) wake(); });
    });
    const tried = new Set();
    while (true) {
      if (token !== sfLoadToken) return true;
      const u = found.find(x => !tried.has(x));
      if (!u) {
        if (pending === 0) return false;
        await new Promise(r => { wake = r; setTimeout(r, 400); });
        continue;
      }
      tried.add(u);
      if (await tryUrl(v, u, token)) return true;
    }
  }

  async function showNormal(videoId) {
    const token = ++sfLoadToken;
    const iframe = document.getElementById('sfIframe');
    const skeleton = document.getElementById('sfSkeleton');
    const box = document.getElementById('sfPlayerBox');
    const v = ensureSfVideo();
    if (iframe) { iframe.src = 'about:blank'; iframe.hidden = true; }
    if (box) box.classList.add('sf-mode-normal');
    v.pause();
    v.removeAttribute('src');   // 前の動画の映像を消してサムネイルを見せる
    try { v.load(); } catch (_) {}
    const ok = await playNormal(v, videoId, token);
    if (token !== sfLoadToken) return;
    if (!ok) { console.warn('[shorts] 通常再生できず → edu 埋め込み'); showEdu(videoId); return; }
    if (skeleton) skeleton.style.display = 'none';
    hidePoster();
    v.muted = false;
    const unmute = document.getElementById('sfUnmute');
    try { await v.play(); if (unmute) unmute.hidden = true; }
    catch (_) {
      // 自動再生がブロックされたら消音で再生して「音を出す」ボタンを出す
      v.muted = true;
      if (unmute) unmute.hidden = false;
      v.play().catch(() => {});
    }
  }

  // ===== サムネイル (読み込み前でもすぐ表示) =====
  function thumbFor(videoId) { return `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`; }
  function thumbFallback(videoId) { return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`; }
  function setThumbImg(img, videoId) {
    img.onerror = () => { img.onerror = null; img.src = thumbFallback(videoId); };
    img.src = thumbFor(videoId);
  }
  function setPoster(videoId) {
    const box = document.getElementById('sfPlayerBox');
    if (!box) return;
    let p = document.getElementById('sfPoster');
    if (!p) {
      p = document.createElement('div');
      p.id = 'sfPoster';
      p.className = 'sf-poster';
      p.innerHTML = '<img alt="" /><span class="sf-poster-spin"></span>';
      box.insertBefore(p, box.firstChild);
    }
    setThumbImg(p.querySelector('img'), videoId);
    p.classList.remove('hide');
    if (!document.getElementById('sfSwipeLayer')) {
      const l = document.createElement('div');
      l.id = 'sfSwipeLayer';
      l.className = 'sf-swipe-layer';
      box.appendChild(l);
    }
  }
  function hidePoster() { const p = document.getElementById('sfPoster'); if (p) p.classList.add('hide'); }

  function loadPlayer(videoId) {
    const skeleton = document.getElementById('sfSkeleton');
    if (skeleton) skeleton.style.display = 'none';
    setPoster(videoId);
    if (sfMode === 'edu') { sfLoadToken++; showEdu(videoId); }
    else showNormal(videoId);
    const watchBtn = document.getElementById('sfWatchBtn');
    const ytBtn = document.getElementById('sfYtBtn');
    if (watchBtn) watchBtn.href = `/watch?v=${videoId}`;
    if (ytBtn) ytBtn.href = `https://www.youtube.com/shorts/${videoId}`;
    const shareBtn = document.getElementById('sfShareBtn');
    const sharePanel = document.getElementById('sfSharePanel');
    if (shareBtn && sharePanel) {
      shareBtn.dataset.sfCurrentVideoId = videoId;
      if (!shareBtn.dataset.shareInit) {
        shareBtn.dataset.shareInit = '1';
        setupSharePanel(shareBtn, sharePanel, () => {
          const vid = shareBtn.dataset.sfCurrentVideoId || videoId;
          return {
            videoId: vid,
            ytUrl: `https://www.youtube.com/shorts/${vid}`,
            appUrl: `${location.origin}/shorts/${vid}`,
            title: document.title,
          };
        });
      }
    }
  }

  // ===== 説明パネル =====
  let sfCurrentDesc = { title: '', stats: '', likes: 0, text: '' };
  let sfCurrentVid = '';
  const _sfLikesCache = new Map();
  const _sfLikesInflight = new Map();
  function fetchShortLikes(videoId) {
    return (typeof vyFetchLikeCount === 'function') ? vyFetchLikeCount(videoId) : Promise.resolve(null);
  }
  function formatLikeCount(n) {
    if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '億';
    if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '万';
    return n.toLocaleString();
  }
  function linkifyDesc(text) {
    return escapeHtml(text)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|\s)#([^\s#<]+)/g, (m, sp, tag) => `${sp}<a href="/hashtag?tag=${encodeURIComponent(tag)}">#${tag}</a>`);
  }
  function fillDescSheet() {
    const d = sfCurrentDesc;
    const t = document.getElementById('sfDescTitle');
    const st = document.getElementById('sfDescStats');
    const tx = document.getElementById('sfDescText');
    if (t) t.textContent = d.title;
    if (st) st.textContent = [d.stats, d.likes ? '高評価 ' + d.likes.toLocaleString() : ''].filter(Boolean).join(' · ');
    if (tx) tx.innerHTML = d.text ? linkifyDesc(d.text) : '<span class="sf-desc-empty">説明はありません。</span>';
  }
  function openDescSheet() {
    const sheet = document.getElementById('sfDescSheet');
    if (!sheet) return;
    if (typeof closeSfComments === 'function') closeSfComments();
    fillDescSheet();
    sheet.hidden = false;
  }
  function closeDescSheet() { const sheet = document.getElementById('sfDescSheet'); if (sheet) sheet.hidden = true; }

  function sfSetupSaveAndDownload(videoId, data) {
    const plBtn = document.getElementById('sfPlBtn');
    const plPopup = document.getElementById('sfPlPopup');
    const plWrap = document.getElementById('sfPlWrap');
    const dlBtn = document.getElementById('sfDlBtn');
    const videoData = () => ({
      videoId,
      title: data.title || '',
      author: data.author || '',
      authorId: data.authorId || '',
      lengthSeconds: data.lengthSeconds || 0
    });
    const syncPl = () => {
      if (!plBtn) return;
      const saved = typeof getPlaylistsContaining === 'function' && getPlaylistsContaining(videoId).length > 0;
      plBtn.classList.toggle('active', saved);
      plBtn.title = saved ? '保存済み (押して変更)' : 'プレイリストに保存';
      const lbl = plBtn.querySelector('span');
      if (lbl) lbl.textContent = saved ? '保存済み' : '保存';
    };
    if (plBtn && plPopup) {
      syncPl();
      if (!plPopup.hidden) vyRenderPlaylistPopup(plPopup, videoData(), syncPl);
      plBtn.onclick = (e) => {
        e.stopPropagation();
        const open = plPopup.hidden;
        plPopup.hidden = !open;
        plBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) vyRenderPlaylistPopup(plPopup, videoData(), syncPl);
      };
      if (!document._sfPlDocBound) {
        document._sfPlDocBound = true;
        document.addEventListener('click', (e) => {
          const w = document.getElementById('sfPlWrap');
          const p = document.getElementById('sfPlPopup');
          if (w && p && !p.hidden && !w.contains(e.target)) { p.hidden = true; document.getElementById('sfPlBtn')?.setAttribute('aria-expanded', 'false'); }
        }, true);
      }
    }
    if (dlBtn) {
      dlBtn.onclick = (e) => {
        e.stopPropagation();
        if (plPopup) plPopup.hidden = true;
        VyDownload.open({ videoId, meta: data });
      };
    }
  }

  function renderOverlay(data, videoId) {
    const titleEl = document.getElementById('sfOverlayTitle');
    const metaEl = document.getElementById('sfOverlayMeta');
    const chLink = document.getElementById('sfChLink');
    const chAvatar = document.getElementById('sfChAvatar');
    const chName = document.getElementById('sfChName');
    if (titleEl) titleEl.textContent = data.title || '';
    document.title = (data.title ? data.title + ' - ' : '') + 'ショート - Vyslo Tube';
    const parts = [];
    if (data.viewCount) parts.push(formatViews(data.viewCount));
    if (data.publishedText) parts.push(jaDate(data.publishedText));
    if (metaEl) metaEl.textContent = parts.join(' · ');
    if (chLink && data.authorId) chLink.href = `/channel?id=${encodeURIComponent(data.authorId)}`;
    if (chName) chName.textContent = data.author || '';
    const thumb = getChannelIconUrl(data.authorThumbnails || []);
    if (chAvatar) {
      if (thumb) { chAvatar.src = thumb; chAvatar.style.display = ''; }
      else { chAvatar.removeAttribute('src'); chAvatar.style.display = 'none'; }
    }
    // いいね (動画ページと同じ仕様: 数はボタンの中・押しても数は変えない)
    const likeBtn = document.getElementById('sfLike');
    if (likeBtn && typeof vySetupLikeButton === 'function') {
      vySetupLikeButton(likeBtn, videoId, () => data, {
        onCount: (n) => {
          if (n == null) return;
          if (sfCurrentDesc && sfCurrentVid === videoId) { sfCurrentDesc.likes = n; const sh = document.getElementById('sfDescSheet'); if (sh && !sh.hidden) fillDescSheet(); }
        }
      });
    }
    // プレイリスト・ダウンロード
    sfSetupSaveAndDownload(videoId, data);
    sfCurrentVid = videoId;
    // フォローボタン
    const followBtn = document.getElementById('sfFollowBtn');
    const followLabel = document.getElementById('sfFollowLabel');
    if (followBtn && data.authorId) {
      followBtn.hidden = false;
      const subs = (typeof getSubscriptions === 'function') ? getSubscriptions() : [];
      const isSubbed = subs.some(s => s.authorId === data.authorId);
      if (followLabel) followLabel.textContent = isSubbed ? 'フォロー中' : 'フォロー';
      followBtn.classList.toggle('following', isSubbed);
      followBtn.onclick = () => {
        if (typeof toggleSubscription !== 'function') return;
        const result = toggleSubscription({
          authorId: data.authorId,
          author: data.author || '',
          authorThumbnails: data.authorThumbnails || [],
          subCountText: null,
          subCount: null
        });
        if (followLabel) followLabel.textContent = result ? 'フォロー中' : 'フォロー';
        followBtn.classList.toggle('following', result);
      };
    } else if (followBtn) {
      followBtn.hidden = true;
    }
    // 説明
    sfCurrentDesc = { title: data.title || '', stats: parts.join(' · '), likes: Number(data.likeCount) || 0, text: (data.description || '').trim() };
    const descEl = document.getElementById('sfInfoDesc');
    const moreBtn = document.getElementById('sfDescMore');
    if (descEl) descEl.textContent = sfCurrentDesc.text;
    if (moreBtn) moreBtn.hidden = !sfCurrentDesc.text;
    const sheet = document.getElementById('sfDescSheet');
    if (sheet && !sheet.hidden) fillDescSheet();
    const watchBtn = document.getElementById('sfWatchBtn');
    const ytBtn = document.getElementById('sfYtBtn');
    if (watchBtn) watchBtn.href = `/watch?v=${videoId}`;
    if (ytBtn) ytBtn.href = `https://www.youtube.com/shorts/${videoId}`;
    // ショート視聴履歴に保存
    if (typeof addShortsHistory === 'function') {
      addShortsHistory({
        videoId,
        title: data.title || '',
        author: data.author || '',
        authorId: data.authorId || '',
        authorThumbnails: data.authorThumbnails || [],
        videoThumbnails: data.videoThumbnails || [],
      });
    }
  }

  function updateNavBtns() {
    const prevBtn = document.getElementById('sfPrevBtn');
    const nextBtn = document.getElementById('sfNextBtn');
    if (prevBtn) prevBtn.disabled = queueIdx <= 0;
    const hasMoreFetchable = (channelMode && channelContinuation) ||
                             (searchMode && searchContinuation) ||
                             (searchMode && searchQueryStr && !searchExhausted) ||
                             (fbMode && !fbExhausted) || feedMode;
    if (nextBtn) nextBtn.disabled = queueIdx >= queue.length - 1 && !hasMoreFetchable;
  }

  // ===== QUEUE / CHANNEL CONTEXT =====
  async function fetchChannelShortsPage(chId, continuation) {
    let url = `/api/channels/${encodeURIComponent(chId)}/shorts`;
    if (continuation) url += `?continuation=${encodeURIComponent(continuation)}`;
    return fetchMain(url);
  }

  async function buildChannelQueue(chId, startId) {
    try {
      const existing = new Set([startId]);
      let cont = null;
      let page = 0;
      const MAX_PAGES = 4;
      let foundStart = false;

      do {
        const data = await fetchChannelShortsPage(chId, cont);
        const vids = data.videos || data.shorts || [];
        cont = data.continuation || null;
        page++;

        const newItems = vids.filter(v => {
          if (!v.videoId || existing.has(v.videoId)) return false;
          existing.add(v.videoId);
          return true;
        }).map(v => ({ videoId: v.videoId, meta: v }));

        if (newItems.length) {
          queue.push(...newItems);
          updateNavBtns();
        }

        if (!foundStart && vids.some(v => v.videoId === startId)) {
          foundStart = true;
          break;
        }
      } while (cont && page < MAX_PAGES);

      channelContinuation = cont;
      return queue.length > 1;
    } catch (_) {
      return false;
    }
  }

  async function fetchAndQueueMeta(idx) {
    const item = queue[idx];
    if (!item || item.meta) return;
    try {
      const data = await withRetry(() => fetchMain(`/api/videos/${item.videoId}`));
      queue[idx] = { ...item, meta: data, full: true };
      if (idx === queueIdx) renderOverlay(data, item.videoId);
    } catch (_) {}
  }

  async function prefetchMoreRecs(videoId, data) {
    if (isFetchingMore) return;
    isFetchingMore = true;
    try {
      const src = data || await fetchMain(`/api/videos/${videoId}`);
      const recs = (src.recommendedVideos || []).filter(v => isShortVideo(v));
      const existing = new Set(queue.map(q => q.videoId));
      const newItems = recs.filter(v => !existing.has(v.videoId)).slice(0, 12)
        .map(v => ({ videoId: v.videoId, meta: v }));
      if (newItems.length) { queue.push(...newItems); updateNavBtns(); }
    } catch (_) {}
    isFetchingMore = false;
  }

  async function prefetchMoreChannel() {
    if (!channelMode || !channelId || !channelContinuation || isFetchingMore) return;
    isFetchingMore = true;
    try {
      const data = await fetchChannelShortsPage(channelId, channelContinuation);
      const vids = data.videos || data.shorts || [];
      channelContinuation = data.continuation || null;
      const existing = new Set(queue.map(q => q.videoId));
      const newItems = vids.filter(v => v.videoId && !existing.has(v.videoId))
        .map(v => ({ videoId: v.videoId, meta: v }));
      if (newItems.length) { queue.push(...newItems); updateNavBtns(); }
    } catch (_) {}
    isFetchingMore = false;
  }

  async function fetchSearchShortsPage(q, continuation) {
    let url = `/api/search?q=${encodeURIComponent(q)}&type=video`;
    if (continuation) url += `&continuation=${encodeURIComponent(continuation)}`;
    return fetchMain(url);
  }

  async function fetchShortPage(searchQ, page) {
    try {
      const pageParam = page > 1 ? `&page=${page}` : '';
      const url = `/api/search?q=${encodeURIComponent(searchQ)}${pageParam}`;
      const raw = await fetchMain(url);
      const items = Array.isArray(raw) ? raw : (raw.results || []);
      return items.filter(v => v.type !== 'channel' && v.type !== 'playlist' && isShortVideo(v));
    } catch (_) {
      return [];
    }
  }

  async function buildSearchQueue(q, startId, preList) {
    try {
      searchQueryStr = q;
      searchShortPage1 = 1;
      searchShortPage2 = 0;
      if (preList && preList.length) {
        const existing = new Set();
        const items = preList.filter(id => {
          if (!id || existing.has(id)) return false;
          existing.add(id);
          return true;
        }).map(id => ({ videoId: id, meta: null }));
        const startIdx = items.findIndex(v => v.videoId === startId);
        if (startIdx >= 0) {
          queue = items;
          queueIdx = startIdx;
          updateNavBtns();
          return true;
        }
      }
      const data = await fetchSearchShortsPage(q, null);
      const results = data.results || [];
      const vids = results.filter(v => v.type !== 'channel' && v.type !== 'playlist' && isShortVideo(v));
      searchContinuation = data.continuation || null;
      const existing = new Set();
      const items = vids.filter(v => {
        if (!v.videoId || existing.has(v.videoId)) return false;
        existing.add(v.videoId);
        return true;
      }).map(v => ({ videoId: v.videoId, meta: v }));
      if (!items.length) return false;
      const startIdx = items.findIndex(v => v.videoId === startId);
      if (startIdx >= 0) {
        queue = items;
        queueIdx = startIdx;
      } else {
        queue = [{ videoId: startId, meta: null }, ...items];
        queueIdx = 0;
      }
      updateNavBtns();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function prefetchMoreSearch() {
    if (!searchMode || !searchQueryStr || isFetchingMore) return;
    isFetchingMore = true;
    try {
      const existing = new Set(queue.map(item => item.videoId));
      const tasks = [];

      searchShortPage1++;
      tasks.push(fetchShortPage(searchQueryStr + ' ショート', searchShortPage1));

      if (searchShortPage1 >= 3 || searchShortPage2 > 0) {
        searchShortPage2++;
        tasks.push(fetchShortPage(searchQueryStr + ' #shorts', searchShortPage2));
      }

      let anyNew = false;
      await Promise.all(tasks.map(p =>
        p.then(vids => {
          const newItems = vids.filter(v => v.videoId && !existing.has(v.videoId))
            .map(v => { existing.add(v.videoId); return { videoId: v.videoId, meta: v }; });
          if (newItems.length) {
            anyNew = true;
            searchEmptyStreak = 0;
            queue.push(...newItems);
            updateNavBtns();
          }
        }).catch(() => {})
      ));

      if (!anyNew) {
        searchEmptyStreak++;
        if (searchEmptyStreak >= 2) searchExhausted = true;
        updateNavBtns();
      }
    } catch (_) {}
    isFetchingMore = false;
  }

  // ===== おすすめフィード (本家YouTubeのショート連続再生と同じ仕組み) =====
  let feedMode = false, feedConts = [], feedBusy = false, feedEmpty = 0, feedRound = 0;
  const feedSeenBacklog = [];
  function sfSeenIds() {
    const s = new Set();
    try { (typeof getShortsHistory === 'function' ? getShortsHistory() : []).forEach(h => h && h.videoId && s.add(h.videoId)); } catch (_) {}
    return s;
  }
  function sfPickSeeds(currentId) {
    const pick = (arr, n) => {
      const a = arr.slice(); const out = [];
      while (a.length && out.length < n) {
        // 新しいものほど選ばれやすく
        const i = Math.floor(Math.pow(Math.random(), 1.8) * a.length);
        out.push(a.splice(i, 1)[0]);
      }
      return out;
    };
    const seeds = [];
    if (currentId) seeds.push(currentId);
    let sh = [], wh = [];
    try { sh = (typeof getShortsHistory === 'function' ? getShortsHistory() : []).slice(0, 30); } catch (_) {}
    try { wh = (typeof getHistory === 'function' ? getHistory() : []).slice(0, 30); } catch (_) {}
    pick(sh, 2).forEach(v => v && v.videoId && seeds.push(v.videoId));
    pick(wh, 2).forEach(v => v && v.videoId && seeds.push(v.videoId));
    return [...new Set(seeds)].slice(0, 5);
  }
  async function sfPopularSeeds(n) {
    try {
      const raw = await Promise.race([fetchMain('/api/trending?region=JP'), new Promise(r => setTimeout(() => r(null), 8000))]);
      const arr = Array.isArray(raw) ? raw : ((raw && (raw.videos || raw.results)) || []);
      const ids = arr.map(v => v && v.videoId).filter(Boolean);
      const out = [];
      while (ids.length && out.length < n) out.push(ids.splice(Math.floor(Math.random() * Math.min(ids.length, 15)), 1)[0]);
      return out;
    } catch (_) { return []; }
  }
  async function sfFetchFeed(params) {
    try {
      const r = await fetch('/api/shorts-feed?' + new URLSearchParams(params), { signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      return { items: (d.items || []).filter(v => v && v.videoId), conts: d.conts || [] };
    } catch (_) { return { items: [], conts: [] }; }
  }
  // 見たことのある動画は後回し (出にくく)
  function sfPushFeed(items) {
    const seen = sfSeenIds();
    const inQ = new Set(queue.map(q => q.videoId));
    const fresh = [];
    for (const v of items) {
      if (inQ.has(v.videoId)) continue;
      inQ.add(v.videoId);
      if (seen.has(v.videoId)) { if (!feedSeenBacklog.some(b => b.videoId === v.videoId)) feedSeenBacklog.push(v); continue; }
      fresh.push({ videoId: v.videoId, meta: v.title ? v : null, orig: !!v.title });
    }
    // 日本語の動画を先に (その他は間に混ぜる)
    const isJa = v => /[\u3040-\u30ff]/.test(((v.meta && v.meta.title) || '') + ((v.meta && v.meta.author) || ''));
    const ja = fresh.filter(isJa), other = fresh.filter(v => !isJa(v));
    const ordered = [];
    while (ja.length || other.length) {
      ordered.push(...ja.splice(0, 3));
      if (other.length) ordered.push(other.shift());
    }
    if (ordered.length) { queue.push(...ordered); updateNavBtns(); }
    return ordered.length;
  }
  async function buildFeedQueue(startId) {
    feedMode = true;
    let seeds = sfPickSeeds(startId);
    if (seeds.length < 3) seeds = [...new Set([...seeds, ...(await sfPopularSeeds(3 - seeds.length))])];
    const { items, conts } = await sfFetchFeed({ seeds: seeds.join(',') });
    feedConts = conts;
    return sfPushFeed(items);
  }
  async function prefetchMoreFeed() {
    if (!feedMode || feedBusy) return;
    feedBusy = true;
    try {
      feedRound++;
      let added = 0;
      // 1) 続き  2) 今見ている動画を起点に (見ている内容に合わせておすすめが変わる)
      const cur = queue[queueIdx] && queue[queueIdx].videoId;
      const params = {};
      if (feedConts.length) params.cont = feedConts.slice(0, 3).join(',');
      if (cur && (feedRound % 2 === 0 || !feedConts.length)) params.seeds = sfPickSeeds(cur).slice(0, 2).join(',');
      const { items, conts } = await sfFetchFeed(params);
      feedConts = conts.length ? conts : feedConts.slice(3);
      added = sfPushFeed(items);
      if (!added) {
        feedEmpty++;
        if (feedEmpty >= 2 && feedSeenBacklog.length) {
          // 新しいものが無いときだけ、見たことのある動画を少し混ぜる
          const back = feedSeenBacklog.splice(0, 5).map(v => ({ videoId: v.videoId, meta: v.title ? v : null, orig: !!v.title }));
          queue.push(...back);
          added = back.length;
        } else if (feedEmpty >= 3) {
          await buildFallbackQueue(queue[queueIdx] && queue[queueIdx].meta, null);
        }
      } else feedEmpty = 0;
    } catch (_) {}
    feedBusy = false;
    updateNavBtns();
  }

  // ===== 予備のショート一覧 (検索や関連からショートが見つからないとき) =====
  let fbMode = false, fbQuery = '', fbPage = 1, fbExhausted = false;
  async function fetchFallbackShorts(q, page) {
    try {
      const r = await fetch(`/api/choco-shorts-search?q=${encodeURIComponent(q)}&page=${page}`, { signal: AbortSignal.timeout(16000) });
      const d = await r.json();
      return (d.items || []).filter(v => v && v.videoId);
    } catch (_) { return []; }
  }
  function pushNew(list) {
    const existing = new Set(queue.map(q => q.videoId));
    const items = list.filter(v => v.videoId && !existing.has(v.videoId) && existing.add(v.videoId))
      .map(v => ({ videoId: v.videoId, meta: (v.title ? v : null) }));
    if (items.length) { queue.push(...items); updateNavBtns(); }
    return items.length;
  }
  async function buildFallbackQueue(meta, q) {
    const cands = [];
    if (q) cands.push(q);
    if (meta && meta.title) cands.push(meta.title.replace(/#\S+/g, '').trim().slice(0, 40));
    if (meta && meta.author) cands.push(meta.author);
    cands.push('ショート 人気', 'shorts');
    // チャンネルのショート
    if (meta && meta.authorId) {
      try {
        const d = await fetchChannelShortsPage(meta.authorId, null);
        if (pushNew(d.videos || d.shorts || []) >= 3) { fbMode = true; fbQuery = cands[0]; fbPage = 1; }
      } catch (_) {}
    }
    for (const c of cands) {
      if (!c) continue;
      const list = await fetchFallbackShorts(c, 1);
      if (pushNew(list) > 0) { fbMode = true; fbQuery = c; fbPage = 1; break; }
    }
    updateNavBtns();
  }
  async function prefetchMoreFallback() {
    if (!fbMode || fbExhausted || isFetchingMore) return;
    isFetchingMore = true;
    try {
      fbPage++;
      let added = fbPage <= 10 ? pushNew(await fetchFallbackShorts(fbQuery, fbPage)) : 0;
      if (!added) {
        const alt = ['ショート 人気', 'おもしろ ショート', 'shorts'].find(x => x !== fbQuery);
        fbQuery = alt; fbPage = 1;
        added = pushNew(await fetchFallbackShorts(fbQuery, 1));
        if (!added) fbExhausted = true;
      }
    } catch (_) {}
    isFetchingMore = false;
    updateNavBtns();
  }

  function navigateTo(idx) {
    if (idx < 0 || idx >= queue.length) return;
    queueIdx = idx;
    const item = queue[queueIdx];
    let url;
    if (channelMode && channelId) {
      url = `/shorts/${item.videoId}?channel=${encodeURIComponent(channelId)}`;
    } else if (searchMode && searchQueryStr) {
      url = `/shorts/${item.videoId}?q=${encodeURIComponent(searchQueryStr)}`;
    } else {
      url = `/shorts/${item.videoId}`;
    }
    history.replaceState(null, '', url);
    loadPlayer(item.videoId);
    // 次のショートの高評価数を先に取っておく
    if (queue[queueIdx + 1]) fetchShortLikes(queue[queueIdx + 1].videoId);
    if (item.meta) {
      renderOverlay(item.meta, item.videoId);
      // 一覧から来た情報は英語訳のことがあるので、元の言語のタイトルで上書き
      if (typeof vyGetOrigTitle === 'function') {
        const vid0 = item.videoId, i0 = queueIdx;
        vyGetOrigTitle(vid0).then(o => {
          if (!o || !queue[i0] || queue[i0].videoId !== vid0) return;
          queue[i0] = { ...queue[i0], meta: { ...queue[i0].meta, title: o.title, author: o.author || queue[i0].meta.author }, orig: true };
          if (queueIdx === i0) renderOverlay(queue[i0].meta, vid0);
        });
      }
      if (!item.full) {
        const vid = item.videoId, i = queueIdx;
        fetchMain(`/api/videos/${vid}`).then(d => {
          if (!d || !d.title || !queue[i] || queue[i].videoId !== vid) return;
          const keep = queue[i].orig ? { title: queue[i].meta.title, author: queue[i].meta.author } : {};
          queue[i] = { ...queue[i], meta: { ...queue[i].meta, ...d, ...keep }, full: true };
          if (queueIdx === i) renderOverlay(queue[i].meta, vid);
        }).catch(() => {});
      }
    } else {
      const chName = document.getElementById('sfChName');
      if (chName) chName.textContent = '取得中…';
      const titleEl = document.getElementById('sfOverlayTitle');
      if (titleEl) titleEl.textContent = '';
      const lk = document.getElementById('sfLikeCount'); if (lk) lk.textContent = '…';
      fetchShortLikes(item.videoId);
      const de = document.getElementById('sfInfoDesc'); if (de) de.textContent = '';
      const dm = document.getElementById('sfDescMore'); if (dm) dm.hidden = true;
      fetchAndQueueMeta(queueIdx);
    }
    updateNavBtns();
    if (queueIdx >= queue.length - 3) {
      if (feedMode) prefetchMoreFeed();
      else if (fbMode) prefetchMoreFallback();
      else if (channelMode) prefetchMoreChannel();
      else if (searchMode) prefetchMoreSearch();
      else prefetchMoreRecs(item.videoId, item.meta);
    }
    closeSfComments();
  }

  // ===== SCROLL / SWIPE NAVIGATION (本家のように上下にスライド) =====
  let sliding = false;
  const SLIDE_EASE = 'transform .42s cubic-bezier(.22,.8,.24,1)';

  function makeCardEl(videoId, meta, rect, withFrame) {
    const g = document.createElement('div');
    g.className = 'sf-ghost';
    Object.assign(g.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    const img = document.createElement('img');
    img.alt = '';
    setThumbImg(img, videoId);
    g.appendChild(img);
    // 再生中の映像の最後のフレームを写す (取れない場合はサムネイルのまま)
    if (withFrame) {
      const v = document.getElementById('sfVideo');
      const box = document.getElementById('sfPlayerBox');
      if (v && box && box.classList.contains('sf-mode-normal') && v.readyState >= 2 && v.videoWidth) {
        try {
          const c = document.createElement('canvas');
          c.width = rect.width * devicePixelRatio; c.height = rect.height * devicePixelRatio;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
          const sc = Math.min(c.width / v.videoWidth, c.height / v.videoHeight);
          const w = v.videoWidth * sc, h = v.videoHeight * sc;
          ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
          g.appendChild(c);
        } catch (_) {}
      }
    }
    if (meta) {
      const o = document.createElement('div');
      o.className = 'sf-ghost-info';
      o.innerHTML = `<div class="sf-ghost-ch">${escapeHtml(meta.author || '')}</div><div class="sf-ghost-title">${escapeHtml(meta.title || '')}</div>`;
      g.appendChild(o);
    }
    document.body.appendChild(g);
    return g;
  }

  let peekEl = null, peekIdx = -1;
  function removePeek() { if (peekEl) { peekEl.remove(); peekEl = null; peekIdx = -1; } }
  function ensurePeek(idx, baseRect) {
    if (peekIdx === idx && peekEl) return peekEl;
    removePeek();
    if (idx < 0 || idx >= queue.length) return null;
    peekEl = makeCardEl(queue[idx].videoId, queue[idx].meta, baseRect, false);
    peekEl.classList.add('sf-peek');
    peekIdx = idx;
    return peekEl;
  }

  function slideTo(idx, dragDy = 0) {
    const box = document.getElementById('sfPlayerBox');
    if (sliding || !box) return;
    if (idx < 0 || idx >= queue.length) {
      if (idx >= queue.length) {
        // まだ次が無いときは追加取得してから
        if (feedMode) prefetchMoreFeed(); else if (fbMode) prefetchMoreFallback(); else if (channelMode) prefetchMoreChannel(); else if (searchMode) prefetchMoreSearch();
        else if (queue.length <= 1) buildFallbackQueue(queue[0] && queue[0].meta, null);
      }
      snapBack();
      return;
    }
    sliding = true;
    const dir = idx > queueIdx ? 1 : -1;
    const rect = box.getBoundingClientRect();      // 指で動かしている位置を含む
    const H = box.offsetHeight + 16;
    const cur = queue[queueIdx];
    const ghost = makeCardEl(cur.videoId, cur.meta, rect, true);
    removePeek();
    box.style.transition = 'none';
    box.style.transform = `translateY(${dir * H + dragDy}px)`;
    navigateTo(idx);                               // すぐ切り替え (読み込み前でもサムネイル表示)
    void box.offsetHeight;
    box.style.transition = SLIDE_EASE;
    box.style.transform = 'translateY(0)';
    ghost.style.transition = SLIDE_EASE;
    requestAnimationFrame(() => { ghost.style.transform = `translateY(${-dir * H}px)`; });
    setTimeout(() => {
      ghost.remove();
      box.style.transition = '';
      box.style.transform = '';
      sliding = false;
    }, 440);
  }

  function snapBack() {
    const box = document.getElementById('sfPlayerBox');
    if (!box) return;
    box.style.transition = 'transform .28s cubic-bezier(.22,.8,.24,1)';
    box.style.transform = 'translateY(0)';
    if (peekEl) {
      const p = peekEl, dir = peekIdx > queueIdx ? 1 : -1, H = box.offsetHeight + 16;
      p.style.transition = 'transform .28s cubic-bezier(.22,.8,.24,1)';
      p.style.transform = `translateY(${dir * H}px)`;
      peekEl = null; peekIdx = -1;
      setTimeout(() => p.remove(), 300);
    }
    setTimeout(() => { box.style.transition = ''; box.style.transform = ''; }, 300);
  }

  function initScrollNav() {
    const root = document.getElementById('sfRoot');
    if (!root) return;
    const ignore = t => t.closest('.sf-comments-panel, .sf-desc-sheet, .sf-top, .sf-vui-bar, .sf-side, .sf-navcol, .share-panel, input, select, textarea');

    // マウスホイール / トラックパッド
    let wheelLock = 0, wheelAcc = 0, wheelTimer = null;
    root.addEventListener('wheel', e => {
      if (e.target.closest('.sf-comments-panel, .sf-cp-list, .sf-desc-sheet, .share-panel, select')) return;
      e.preventDefault();
      const now = Date.now();
      if (sliding || now < wheelLock) return;
      wheelAcc += e.deltaY;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { wheelAcc = 0; }, 160);
      if (Math.abs(wheelAcc) < 40) return;
      const d = wheelAcc;
      wheelAcc = 0;
      wheelLock = now + 650;
      slideTo(d > 0 ? queueIdx + 1 : queueIdx - 1);
    }, { passive: false });

    // タッチ: 指に合わせて動き、離すと次/前へ
    let sy = null, sx = 0, st = 0, dy = 0, dragging = false, baseRect = null;
    root.addEventListener('touchstart', e => {
      if (sliding || ignore(e.target) || e.touches.length > 1) { sy = null; return; }
      sy = e.touches[0].clientY; sx = e.touches[0].clientX; st = Date.now(); dy = 0; dragging = false;
      const box = document.getElementById('sfPlayerBox');
      baseRect = box ? box.getBoundingClientRect() : null;
    }, { passive: true });
    root.addEventListener('touchmove', e => {
      if (sy === null || !baseRect) return;
      const y = e.touches[0].clientY, x = e.touches[0].clientX;
      dy = y - sy;
      if (!dragging) {
        if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(x - sx)) return;
        dragging = true;
      }
      e.preventDefault();
      const box = document.getElementById('sfPlayerBox');
      const nIdx = dy < 0 ? queueIdx + 1 : queueIdx - 1;
      const has = nIdx >= 0 && nIdx < queue.length;
      const eff = has ? dy : dy * 0.25;           // 端ではゴムのように少しだけ
      box.style.transition = 'none';
      box.style.transform = `translateY(${eff}px)`;
      const H = box.offsetHeight + 16;
      const p = has ? ensurePeek(nIdx, baseRect) : (removePeek(), null);
      if (p) { p.style.transition = 'none'; p.style.transform = `translateY(${(dy < 0 ? H : -H) + eff}px)`; }
    }, { passive: false });
    const end = () => {
      if (sy === null) return;
      const box = document.getElementById('sfPlayerBox');
      const H = box ? box.offsetHeight : 600;
      const v = dy / Math.max(1, Date.now() - st);
      const wasDrag = dragging;
      sy = null; dragging = false;
      if (!wasDrag) return;
      const nIdx = dy < 0 ? queueIdx + 1 : queueIdx - 1;
      if ((Math.abs(dy) > H * 0.18 || Math.abs(v) > 0.45) && nIdx >= 0 && nIdx < queue.length) slideTo(nIdx, dy);
      else snapBack();
    };
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', end, { passive: true });
  }

  // ===== 全画面表示用の上部バー (戻る / 検索 / テーマ) =====
  function initTopBar() {
    const root = document.getElementById('sfRoot');
    if (!root || document.getElementById('sfTop')) return;
    const bar = document.createElement('div');
    bar.className = 'sf-top';
    bar.id = 'sfTop';
    bar.innerHTML = `
      <button type="button" class="sf-top-btn sf-back" id="sfBack" title="前の画面に戻る" aria-label="戻る">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="sf-top-right">
        <form class="sf-search" id="sfSearch" role="search">
          <button type="button" class="sf-search-toggle" id="sfSearchToggle" aria-label="検索を開く">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="19" height="19"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <input type="search" id="sfSearchInput" placeholder="キーワードで動画をさがす" autocomplete="off" enterkeyhint="search" />
          <button type="submit" class="sf-search-go" aria-label="検索">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="17" height="17"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
        </form>
        <button type="button" class="sf-top-btn sf-theme" id="sfTheme" title="テーマ切り替え" aria-label="テーマ切り替え">
          <svg class="sf-ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="19" height="19"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
          <svg class="sf-ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="19" height="19"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>
      </div>`;
    root.appendChild(bar);

    document.getElementById('sfBack').addEventListener('click', () => {
      let sameOrigin = false;
      try { sameOrigin = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (_) {}
      if (sameOrigin && history.length > 1) history.back();
      else location.href = '/';
    });
    const form = document.getElementById('sfSearch');
    const input = document.getElementById('sfSearchInput');
    document.getElementById('sfSearchToggle').addEventListener('click', () => {
      form.classList.add('open');
      setTimeout(() => input.focus(), 30);
    });
    input.addEventListener('blur', () => { setTimeout(() => { if (!input.value.trim()) form.classList.remove('open'); }, 150); });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      location.href = `/search?q=${encodeURIComponent(q)}`;
    });
    document.getElementById('sfTheme').addEventListener('click', () => {
      const hb = document.getElementById('vyThemeBtn');
      if (hb) { hb.click(); return; }
      const r = document.documentElement;
      const next = r.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      r.setAttribute('data-theme', next);
      try { localStorage.setItem('vy-theme', next); } catch (_) {}
    });
  }

  // ===== COMMENTS =====
  let sfCommentsContinuation = null;
  let sfCommentsLoading = false;
  let sfCommentsSortBy = 'top';
  let sfCommentsVideoId = null;

  function openSfComments(videoId) {
    const panel = document.getElementById('sfCommentsPanel');
    if (!panel) return;
    closeDescSheet();
    const btn = document.getElementById('sfCommentBtn');
    if (btn) btn.classList.add('active');
    panel.hidden = false;
    document.getElementById('sfRoot')?.classList.add('sf-cp-open');
    if (sfCommentsVideoId !== videoId) {
      sfCommentsVideoId = videoId;
      sfCommentsContinuation = null;
      loadSfComments(false);
    }
  }

  function closeSfComments() {
    const panel = document.getElementById('sfCommentsPanel');
    if (!panel) return;
    panel.hidden = true;
    document.getElementById('sfRoot')?.classList.remove('sf-cp-open');
    const btn = document.getElementById('sfCommentBtn');
    if (btn) btn.classList.remove('active');
  }

  function toggleSfComments() {
    const panel = document.getElementById('sfCommentsPanel');
    if (!panel) return;
    if (panel.hidden) {
      const vid = queue[queueIdx]?.videoId;
      if (vid) openSfComments(vid);
    } else {
      closeSfComments();
    }
  }

  async function loadSfComments(append = false) {
    if (sfCommentsLoading) return;
    sfCommentsLoading = true;
    const list = document.getElementById('sfCpList');
    const moreWrap = document.getElementById('sfCpMore');
    const moreBtn = document.getElementById('sfCpMoreBtn');
    if (moreBtn) moreBtn.disabled = true;

    if (!append && list) {
      list.innerHTML = '<p class="sf-cp-msg">取得中…</p>';
    }

    try {
      let url = `/api/comments/${sfCommentsVideoId}?sort_by=${sfCommentsSortBy}`;
      if (append && sfCommentsContinuation) url += `&continuation=${encodeURIComponent(sfCommentsContinuation)}`;
      const data = await withRetry(() => fetchMain(url), 3);

      if (!append && list) list.innerHTML = '';

      const comments = Array.isArray(data.comments) ? data.comments : [];
      if (!append && !comments.length) {
        if (list) list.innerHTML = '<p class="sf-cp-msg">コメントはありません。</p>';
      } else {
        if (list) {
          comments.forEach((c, idx) => {
            try {
              // 返信スレッドも見れるように watch と同じ描画を使う
              list.appendChild(createWatchCommentItem(c, { videoId: sfCommentsVideoId }));
            } catch (itemErr) {
              console.error('createWatchCommentItem[' + idx + '] error:', itemErr, c);
            }
          });
        }
      }
      sfCommentsContinuation = data.continuation || null;
      if (moreWrap) moreWrap.hidden = !sfCommentsContinuation;
      if (moreBtn) moreBtn.disabled = false;
    } catch (e) {
      console.error('sf comments error:', e);
      const msg = vyErrMsg(e);
      if (!append && list) list.innerHTML = '<p class="sf-cp-msg sf-cp-err">エラー: ' + escapeHtml(msg) + '</p>';
    }
    sfCommentsLoading = false;
  }

  function initSfComments() {
    document.getElementById('sfCommentBtn')?.addEventListener('click', toggleSfComments);
    document.getElementById('sfCpClose')?.addEventListener('click', closeSfComments);
    document.getElementById('sfCpMoreBtn')?.addEventListener('click', () => loadSfComments(true));

    document.querySelectorAll('.sf-cp-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sf-cp-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sfCommentsSortBy = btn.dataset.sort || 'top';
        sfCommentsContinuation = null;
        loadSfComments(false);
      });
    });
  }

  // ===== INIT =====
  async function initShortsPage() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    let startId = pathParts[0] === 'shorts' ? (pathParts[1] || '') : '';
    let preFeed = null;
    if (!startId) {
      // サイドバーの「Shorts」: 視聴履歴や人気動画をもとに、おすすめの1本目を選ぶ
      let seeds = sfPickSeeds(null);
      if (seeds.length < 2) seeds = [...new Set([...seeds, ...(await sfPopularSeeds(3))])];
      const f = await sfFetchFeed({ seeds: seeds.join(',') });
      const seen = sfSeenIds();
      const first = f.items.find(v => !seen.has(v.videoId)) || f.items[0];
      if (!first) { location.replace('/search?q=%23shorts'); return; }
      startId = first.videoId;
      preFeed = { items: f.items.filter(v => v.videoId !== startId), conts: f.conts, first };
      history.replaceState(history.state, '', '/shorts/' + startId);
    }

    const urlParams = new URLSearchParams(window.location.search);
    channelId = urlParams.get('channel') || null;
    channelMode = !!channelId;
    const sqParam = urlParams.get('q') || null;
    const listParam = urlParams.get('list') || null;
    // 検索結果の一覧から来たときだけ検索の並び。それ以外は本家と同じおすすめフィード
    searchMode = !!sqParam && !!listParam;
    feedMode = !channelMode && !searchMode;

    queue = [{ videoId: startId, meta: preFeed && preFeed.first.title ? preFeed.first : null, orig: !!(preFeed && preFeed.first.title) }];
    queueIdx = 0;
    if (preFeed) { feedConts = preFeed.conts; sfPushFeed(preFeed.items); }

    try {
      const homeQueueRaw = sessionStorage.getItem('chHomeShortQueue');
      if (homeQueueRaw) {
        sessionStorage.removeItem('chHomeShortQueue');
        const homeIds = JSON.parse(homeQueueRaw);
        if (Array.isArray(homeIds) && homeIds.length > 1) {
          const items = homeIds.map(id => ({ videoId: id, meta: null }));
          const startIdx = items.findIndex(v => v.videoId === startId);
          if (startIdx >= 0) {
            queue = items;
            queueIdx = startIdx;
            channelMode = false;
            searchMode = false;
            feedMode = true;
          }
        }
      }
    } catch (_) {}

    document.getElementById('sfParamSelect')?.addEventListener('change', () => {
      const sv = document.getElementById('sfParamSelect').value;
      sfMode = sv === 'normal' ? 'normal' : 'edu';   // 「通常」以外を選んだら edu 埋め込み
      if (queue[queueIdx]) loadPlayer(queue[queueIdx].videoId);
    });
    document.getElementById('sfPrevBtn')?.addEventListener('click', () => slideTo(queueIdx - 1));
    // 上下ボタンは右端に独立配置。横幅が狭くて操作ボタンに近づきすぎるときだけ少し寄せる/隠す
    (() => {
      const col = document.getElementById('sfNavCol');
      const side = document.getElementById('sfSide');
      const wrap = document.getElementById('sfWrap');
      if (!col || !side || !wrap) return;
      const place = () => {
        col.style.right = ''; col.classList.remove('sf-navcol-off');
        if (getComputedStyle(col).display === 'none') return;
        const w = wrap.getBoundingClientRect(), s2 = side.getBoundingClientRect(), c = col.getBoundingClientRect();
        if (!s2.width || !c.width) return;
        const minLeft = s2.right + 20;                 // 操作ボタンとの最低限のすき間
        if (c.left >= minLeft) return;
        const right = w.right - minLeft - c.width;
        if (right < 4) col.classList.add('sf-navcol-off');
        else col.style.right = right + 'px';
      };
      window.addEventListener('resize', place);
      if ('ResizeObserver' in window) new ResizeObserver(place).observe(wrap);
      new MutationObserver(place).observe(document.getElementById('sfRoot'), { attributes: true, attributeFilter: ['class'] });
      requestAnimationFrame(place);
    })();
    document.getElementById('sfNextBtn')?.addEventListener('click', () => slideTo(queueIdx + 1));
    document.addEventListener('keydown', e => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === 'ArrowUp')   { e.preventDefault(); slideTo(queueIdx - 1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); slideTo(queueIdx + 1); }
    });
    initTopBar();
    document.getElementById('sfDescMore')?.addEventListener('click', openDescSheet);
    document.getElementById('sfOverlayTitle')?.addEventListener('click', openDescSheet);
    document.getElementById('sfDescClose')?.addEventListener('click', closeDescSheet);

    initSfComments();
    initScrollNav();

    // テンプレート埋め込みのeduParamsを同期で即適用してからプレイヤー起動
    if (window._EDU_PARAMS) applyEduParams(window._EDU_PARAMS);
    loadPlayer(startId);
    updateNavBtns();

    (async () => {
      // eduParamsが未適用ならAPIから取得してリロード
      fetchEduParams().then(() => {
        if (sfMode === 'edu' && !window._EDU_PARAMS && eduParams.length && queue[queueIdx]?.videoId === startId) {
          loadPlayer(startId);
        }
      });

      // 元の言語のタイトル/チャンネル名を先に表示 (詳細情報の取得が遅い・失敗するとき用)
      let origInfo = null;
      const origP = (typeof vyGetOrigTitle === 'function' ? vyGetOrigTitle(startId) : Promise.resolve(null)).then(o => {
        origInfo = o;
        if (o && queue[0] && queue[0].videoId === startId && !queue[0].full) {
          queue[0].meta = { ...(queue[0].meta || {}), title: o.title, author: o.author };
          queue[0].orig = true;
          if (queueIdx === 0) renderOverlay(queue[0].meta, startId);
        }
        return o;
      });
      // しばらく次のショートが用意できなければ、予備の一覧を並行して作る
      let fbStarted = false;
      const startFb = (meta) => {
        if (fbStarted || queue.length > 1) return Promise.resolve();
        fbStarted = true;
        return buildFallbackQueue(meta || origInfo, sqParam);
      };
      // おすすめフィードはすぐに取りに行く
      const feedP = (feedMode && !preFeed) ? buildFeedQueue(startId) : Promise.resolve(0);
      const fbTimer = setTimeout(() => { if (!listParam) startFb(null); }, feedMode ? 12000 : 3500);

      let metaResult = null;
      try {
        metaResult = await withRetry(() => fetchMain(`/api/videos/${startId}`));
      } catch (_) {}
      if (!metaResult) {
        await origP;
        if (origInfo) metaResult = null;
      }

      if (metaResult) {
        if (queue[0].orig && queue[0].meta) metaResult = { ...metaResult, title: queue[0].meta.title, author: queue[0].meta.author };
        queue[0].meta = metaResult;
        queue[0].full = true;
        renderOverlay(metaResult, startId);
        if (typeof vyGetOrigTitle === 'function') vyGetOrigTitle(startId).then(o => {
          if (!o || !queue[0] || queue[0].videoId !== startId) return;
          queue[0].meta = { ...queue[0].meta, title: o.title, author: o.author || queue[0].meta.author };
          queue[0].orig = true;
          if (queueIdx === 0) renderOverlay(queue[0].meta, startId);
        });
      }

      if (channelMode && channelId) {
        const ok = await buildChannelQueue(channelId, startId);
        if (!ok) {
          channelMode = false;
          if (metaResult) prefetchMoreRecs(startId, metaResult);
        }
      } else if (searchMode && sqParam) {
        const preList = listParam ? listParam.split(',').filter(Boolean) : null;
        const ok = await buildSearchQueue(sqParam, startId, preList);
        if (!ok) {
          searchMode = false;
          if (metaResult) prefetchMoreRecs(startId, metaResult);
        } else if (queueIdx >= queue.length - 3) {
          prefetchMoreSearch();
        }
      } else if (feedMode) {
        await feedP;
        if (queueIdx >= queue.length - 3) prefetchMoreFeed();
      } else if (metaResult) {
        // リストも検索クエリもない場合 → タイトルで検索してショートリストを構築
        const titleQ = (metaResult.title || '').trim();
        if (titleQ) {
          searchMode = true;
          const ok = await buildSearchQueue(titleQ, startId, null);
          if (!ok) {
            searchMode = false;
            searchQueryStr = null;
            prefetchMoreRecs(startId, metaResult);
          } else if (queueIdx >= queue.length - 3) {
            prefetchMoreSearch();
          }
        } else {
          prefetchMoreRecs(startId, metaResult);
        }
      }

      // ショートが1本しか無い (スクロールできない) ときは予備の一覧を作る
      clearTimeout(fbTimer);
      if (queue.length <= 1) await startFb(metaResult);
      updateNavBtns();
    })();
  }
})();
