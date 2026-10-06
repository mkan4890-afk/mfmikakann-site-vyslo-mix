;(() => {
  if (!document.body.classList.contains('page-search')) return;

  /* ════════════════════════════════════════════════════════════
     検索ページ (本家 YouTube 風)
     ・上部はチップ1行 (横スクロール) + 右端の ⋯ で詳細フィルタ
     ・通常動画はリスト表示、ショートは数本目のあとに横1列の棚
     ・おすすめ順のときは視聴履歴・検索履歴から並び替え (VyRank)
     ════════════════════════════════════════════════════════════ */

  const params = new URLSearchParams(location.search);

  const CHIP_WORDS = {
    music: '音楽', sports: 'スポーツ', movie: '映画', news: 'ニュース', game: 'ゲーム',
    cooking: '料理', travel: '旅行', tech: 'テクノロジー', learning: '学習', pets: 'ペット',
  };
  const SHELF_AFTER = 4;           // 何本目の動画のあとにショートの棚を入れるか

  const state = {
    q: '',
    chip: '',
    sort_by: 'relevance',
    date: '',
    duration: '',
    region: 'JP',
    page: 1,
    source: 'invidious',
    pipedNext: null,
    seen: new Set(),
    rendered: 0,
    loading: false,
    refreshing: false,
    exhausted: false,
    gen: 0,
    items: new Map(),
    deferred: [],      // 前回も出た動画 (少し後ろに回したもの)
  };

  // ショート関連
  let allShortsFound = [];
  let shortsSeenIds = new Set();
  let shortsShelfEl = null;
  let shortsAutoGen = 0;

  const $ = (id) => document.getElementById(id);
  const settings = () => (typeof getSettings === 'function' ? getSettings() : {});

  function effectiveQuery() {
    const w = CHIP_WORDS[state.chip];
    return w ? `${state.q} ${w}` : state.q;
  }
  const isRelevance = () => !state.sort_by || state.sort_by === 'relevance';

  /* ── URL ───────────────────────────────────────────── */
  function pushState(replace) {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.chip) p.set('chip', state.chip);
    if (!isRelevance()) p.set('sort_by', state.sort_by);
    if (state.date) p.set('date', state.date);
    if (state.duration) p.set('duration', state.duration);
    if (state.region && state.region !== 'JP') p.set('region', state.region);
    const url = `/search?${p.toString()}`;
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    document.title = state.q ? `${state.q} - Vyslo Tube` : '検索 - Vyslo Tube';
  }

  /* ── API ───────────────────────────────────────────── */
  function invidiousPath(page) {
    const p = new URLSearchParams();
    p.set('q', effectiveQuery());
    if (page > 1) p.set('page', page);
    if (!isRelevance()) p.set('sort_by', state.sort_by);
    if (state.date) p.set('date', state.date);
    if (state.duration) p.set('duration', state.duration);
    if (state.region) p.set('region', state.region);
    return `/api/search?${p.toString()}`;
  }

  async function fetchPiped(nextpage) {
    const p = new URLSearchParams({ q: effectiveQuery() });
    if (nextpage) p.set('nextpage', nextpage);
    const resp = await fetch(`/api/piped-search?${p}`, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) throw new Error('search HTTP ' + resp.status);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // 1ページ分を取ってくる (だめなら別の取得先へ自動で切り替え)
  async function fetchPage(page) {
    if (page > 1 && state.source === 'piped') {
      if (!state.pipedNext) return { items: [], more: false };
      const d = await fetchPiped(state.pipedNext);
      state.pipedNext = d.nextpage || null;
      return { items: d.results || [], more: !!state.pipedNext };
    }
    // サーバーは「取得に失敗」を 502 (例外) で、「本当に 0 件」を空のリストで返す
    // 1 ページの件数は取得元によって違うので、続きがあるかは「何か返ってきたか」で判断する
    if (page > 1) {
      const raw = await fetchMain(invidiousPath(page));
      const items = Array.isArray(raw) ? raw : (raw.results || []);
      return { items, more: items.length > 0 };
    }
    const order = settings().searchSourceOrder === 'piped-inv' ? ['piped', 'invidious'] : ['invidious', 'piped'];
    let lastErr;
    let confirmedEmpty = false;
    for (let round = 0; round < 2; round++) {
      for (const src of order) {
        try {
          if (src === 'piped') {
            const d = await fetchPiped(null);
            const items = d.results || [];
            // Piped の空は確実ではないので、ほかで 0 件と確認できていないときは失敗として扱う
            if (!items.length && !confirmedEmpty) throw new Error('piped empty');
            state.source = 'piped';
            state.pipedNext = d.nextpage || null;
            return { items, more: !!state.pipedNext };
          }
          const raw = await fetchMain(invidiousPath(1));
          if (raw && !Array.isArray(raw) && raw.error) throw new Error(raw.error);
          const items = Array.isArray(raw) ? raw : (raw.results || []);
          state.source = 'invidious';
          if (!items.length) { confirmedEmpty = true; continue; }
          return { items, more: true };
        } catch (e) { lastErr = e; }
      }
      if (confirmedEmpty) return { items: [], more: false, empty: true };
      // 一時的な失敗のことが多いので、少し待ってもう一度だけ試す
      await new Promise(r => setTimeout(r, 900));
    }
    throw lastErr || new Error('search failed');
  }

  // 最初の表示用: 1 ページ目に 2 ページ目も合わせて候補を広げる
  // (前回見た動画の優先度を少し下げたとき、代わりに上がってくる新しい候補を用意するため)
  async function fetchFirstPool() {
    const first = await fetchPage(1);
    if (!first.more || state.source !== 'invidious' || !isRelevance()) return { ...first, pages: 1 };
    try {
      const second = await Promise.race([fetchPage(2), new Promise(r => setTimeout(() => r(null), 5000))]);
      if (second && second.items && second.items.length) {
        let items = first.items.concat(second.items), more = second.more, pages = 2;
        // 同じ検索をくり返したとき (再検索・更新) は、もう 1 ページ先まで候補を広げておく
        // (前回表示した動画を下げたときに、まだ見ていない動画を上へ繰り上げられるように)
        const regularN = () => items.filter(it => it && it.videoId && !isShortVideo(it)).length;
        if (more && regularN() < 40 && hasShownBefore()) {
          // ショートばかりのページもあるので、通常の動画が十分集まるまで最大 4 ページ目まで (合計 6 秒まで)
          const deadline = Date.now() + 6000;
          for (let pg = 3; pg <= 4 && more && regularN() < 40; pg++) {
            const left = deadline - Date.now();
            if (left < 800) break;
            const nx = await Promise.race([fetchPage(pg).catch(() => null), new Promise(r => setTimeout(() => r(null), left))]);
            if (!nx || !nx.items || !nx.items.length) break;
            items = items.concat(nx.items); more = nx.more; pages = pg;
          }
        }
        return { items, more, pages };
      }
    } catch (_) {}
    return { ...first, pages: 1 };
  }

  /* ── 表示 (行カード) ──────────────────────────────── */
  const ICON_CHECK = '<svg class="ys-verified" viewBox="0 0 24 24" width="14" height="14" aria-label="確認済み"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.4 14.2-4.2-4.2 1.4-1.4 2.8 2.8 6-6 1.4 1.4-7.4 7.4z"/></svg>';

  function pubMs(item) {
    const p = Number(item.published) || 0;
    return p > 1e12 ? p : p * 1000;
  }
  function plainDesc(item) {
    let d = item.description || '';
    if (!d && item.descriptionHtml) { const t = document.createElement('div'); t.innerHTML = item.descriptionHtml; d = t.textContent || ''; }
    return d.replace(/\s+/g, ' ').trim();
  }
  function goChannel(e, url) {
    e.preventDefault(); e.stopPropagation();
    location.href = url;
  }

  function createVideoRow(item) {
    const a = document.createElement('a');
    a.className = 'ys-row ys-video';
    a.href = `/watch?v=${encodeURIComponent(item.videoId)}`;
    a.dataset.vid = item.videoId;
    const thumb = getThumbnailUrl(item.videoId);
    const isLive = !!item.liveNow || /^0\s*(seconds? ago|秒前)$/i.test(String(item.publishedText || '').trim());
    const dur = isLive ? '' : formatDuration(item.lengthSeconds);
    const prog = (window.VyRank ? VyRank.watchProgress(item.videoId, item.lengthSeconds) : 0);
    const icon = getChannelIconUrl(item.authorThumbnails);
    const chUrl = item.authorId ? `/channel?id=${encodeURIComponent(item.authorId)}` : '';
    const views = isLive ? (item.viewCount ? `${Number(item.viewCount).toLocaleString()} 人が視聴中` : '') : formatViews(item.viewCount);
    const date = isLive ? 'ライブ配信中' : (item.publishedText ? jaDate(item.publishedText) : '');
    const desc = plainDesc(item);
    const tags = [];
    if (isLive) tags.push('<span class="ys-tag ys-tag-live">ライブ</span>');
    const pm = pubMs(item);
    if (!isLive && pm && Date.now() - pm < 7 * 86400000) tags.push('<span class="ys-tag">新着</span>');
    if (item.is4k) tags.push('<span class="ys-tag">4K</span>');
    if (item.hasCaptions) tags.push('<span class="ys-tag">字幕</span>');

    a.innerHTML = `
      <div class="ys-thumb">
        <img class="thumb-img" src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />
        ${dur ? `<span class="ys-dur">${dur}</span>` : ''}
        ${isLive ? '<span class="ys-dur ys-dur-live">ライブ</span>' : ''}
        ${prog > 0 ? `<div class="ys-prog"><i style="width:${Math.round(prog * 100)}%"></i></div>` : ''}
      </div>
      <div class="ys-info">
        <h3 class="ys-title card-title">${escapeHtml(item.title || '')}</h3>
        <div class="ys-meta">${[views, date].filter(Boolean).map(escapeHtml).join('<span class="ys-sep">・</span>')}</div>
        <div class="ys-ch">
          ${icon ? `<img class="channel-icon" src="${icon}" alt="" loading="lazy" />` : '<div class="channel-icon-placeholder"></div>'}
          <span class="ys-chname card-channel">${escapeHtml(item.author || '')}</span>${item.authorVerified ? ICON_CHECK : ''}
        </div>
        ${desc ? `<div class="ys-desc">${escapeHtml(desc.slice(0, 240))}</div>` : ''}
        ${tags.length ? `<div class="ys-tags">${tags.join('')}</div>` : ''}
      </div>`;
    if (chUrl) {
      a.querySelectorAll('.ys-chname, .ys-ch .channel-icon, .ys-ch .channel-icon-placeholder').forEach(el => {
        el.classList.add('ys-link');
        el.addEventListener('click', (e) => goChannel(e, chUrl));
      });
    }
    if (typeof vyFixOrigTitle === 'function') vyFixOrigTitle(a, item.videoId);
    return a;
  }

  function createChannelRow(item) {
    const a = document.createElement('a');
    a.className = 'ys-row ys-channel';
    a.href = `/channel?id=${encodeURIComponent(item.authorId)}`;
    const thumbs = item.authorThumbnails || [];
    const big = thumbs.length ? (thumbs.find(t => t.width >= 176) || thumbs[thumbs.length - 1]) : null;
    const icon = big ? wsrv(big.url.startsWith('//') ? 'https:' + big.url : big.url, 272) : '';
    const subs = formatSubsText(item.subCountText, item.subCount);
    const handle = item.channelHandle || '';
    const desc = (item.description || '').trim();
    const subscribed = typeof isSubscribed === 'function' && isSubscribed(item.authorId);
    a.innerHTML = `
      <div class="ys-thumb ys-ch-thumb">
        ${icon ? `<img class="channel-icon" src="${icon}" alt="" loading="lazy" />` : '<div class="channel-icon-placeholder"></div>'}
      </div>
      <div class="ys-info">
        <h3 class="ys-title">${escapeHtml(item.author || '')}${item.authorVerified ? ICON_CHECK : ''}</h3>
        <div class="ys-meta">${[handle && escapeHtml(handle), subs && `チャンネル登録者数 ${subs}`].filter(Boolean).join('<span class="ys-sep">・</span>')}</div>
        ${desc ? `<div class="ys-desc">${escapeHtml(desc.slice(0, 200))}</div>` : ''}
      </div>
      <button type="button" class="ys-sub-btn${subscribed ? ' on' : ''}">${subscribed ? '登録済み' : '登録'}</button>`;
    const btn = a.querySelector('.ys-sub-btn');
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (typeof toggleSubscription !== 'function') return;
      const on = toggleSubscription({ authorId: item.authorId, author: item.author, authorThumbnails: item.authorThumbnails || [] });
      btn.classList.toggle('on', on);
      btn.textContent = on ? '登録済み' : '登録';
    });
    return a;
  }

  function createPlaylistRow(item) {
    const a = document.createElement('a');
    a.className = 'ys-row ys-playlist';
    const isMix = item.playlistId && item.playlistId.startsWith('RD');
    a.href = isMix ? `/mix?id=${encodeURIComponent(item.playlistId)}` : `/playlist?list=${encodeURIComponent(item.playlistId)}`;
    const thumb = item.playlistThumbnail
      ? wsrv(item.playlistThumbnail, 480)
      : (item.videos && item.videos[0]?.videoId ? getThumbnailUrl(item.videos[0].videoId) : '');
    const count = item.videoCount != null && item.videoCount > 0 ? `${item.videoCount} 本の動画` : '再生リスト';
    a.innerHTML = `
      <div class="ys-thumb ys-pl-thumb">
        ${thumb ? `<img class="thumb-img" src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />` : ''}
        <span class="ys-pl-count"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm13 0v6l5-3z"/></svg>${escapeHtml(count)}</span>
      </div>
      <div class="ys-info">
        <h3 class="ys-title">${escapeHtml(item.title || '')}</h3>
        <div class="ys-meta">${escapeHtml(item.author || '')}${item.author ? '<span class="ys-sep">・</span>' : ''}${isMix ? 'ミックス' : '再生リスト'}</div>
        <div class="ys-pl-all">再生リストの全体を見る</div>
      </div>`;
    return a;
  }

  function createRow(item) {
    if (item.type === 'channel') return createChannelRow(item);
    if (item.type === 'playlist') return createPlaylistRow(item);
    return createVideoRow(item);
  }

  function createSkeletonRow() {
    const d = document.createElement('div');
    d.className = 'ys-row ys-skel';
    d.innerHTML = '<div class="ys-thumb"></div><div class="ys-info"><i></i><i></i><i></i><i></i></div>';
    return d;
  }

  /* ── 並び替え / 絞り込み ───────────────────────────── */
  // 「直前に表示した一覧」を覚えておく単位 (検索語 + 絞り込み)
  function shownKey() { return 'q:' + String(effectiveQuery() || '').toLowerCase().replace(/\s+/g, ' ').trim() + '|' + (state.chip || ''); }
  function hasShownBefore() {
    try { const all = JSON.parse(localStorage.getItem('vyslo_last_shown') || '{}'); return Array.isArray(all[shownKey()]) && all[shownKey()].length > 0; } catch { return false; }
  }
  function rememberShown(list) {
    if (!window.VyRank || !VyRank.recordShown || !isRelevance()) return;
    VyRank.recordShown(shownKey(), list.filter(it => it && it.videoId).slice(0, 30).map(it => it.videoId));
  }

  function prepare(items) {
    const fresh = [];
    items.forEach(item => {
      const id = item.videoId || item.playlistId || item.authorId;
      if (!id || state.seen.has(id)) return;
      if (item.type === 'video' || !item.type) { if (!item.videoId) return; }
      state.seen.add(id);
      fresh.push(item);
    });
    const shorts = [], regular = [];
    fresh.forEach(item => {
      if (item.type !== 'channel' && item.type !== 'playlist' && isShortVideo(item)) shorts.push(item);
      else regular.push(item);
    });
    let list = regular;
    if (state.chip === 'unwatched' && window.VyRank) list = list.filter(it => !it.videoId || !VyRank.isWatched(it.videoId));
    if (state.chip && state.chip !== 'unwatched') list = list.filter(it => it.type !== 'channel');
    if (isRelevance() && window.VyRank) {
      // jitter: 同じ検索でも毎回まったく同じ並びにならないよう、関連性を保ったまま少しだけ揺らす
      list = VyRank.rank(list, { query: state.q, impQuery: effectiveQuery(), shownKey: shownKey(), jitter: state.page === 1 ? 0.06 : 0.04 });
      // 最初のページ: 前回の同じ検索で何度も出た動画は、少し後ろ (次の読み込み分) へ回す
      if (state.page === 1 && VyRank.penaltyFor) {
        // 関連性を保つため、上位 6 件はそのまま・後ろに回すのは全体の 1/3 まで (前回よく見えていたものから)
        const q = effectiveQuery();
        const cand = list.map((it, i) => ({ it, i, pen: it.videoId ? VyRank.penaltyFor(q, it.videoId) : 0 }))
          .filter(x => x.i >= 6 && x.pen >= 0.08)
          .sort((a, b) => b.pen - a.pen)
          .slice(0, Math.floor(list.length / 3));
        if (cand.length) {
          const moved = new Set(cand.map(x => x.it));
          state.deferred.push(...list.filter(it => moved.has(it)));
          list = list.filter(it => !moved.has(it));
        }
        // 最後まで見た動画は、とても関連性が高い上位 3 件以外は後ろ (次の読み込み分) へ回す
        const watchedMove = new Set(list.filter((it, i) => i >= 3 && it.videoId && VyRank.watchProgress(it.videoId, it.lengthSeconds) >= 0.6));
        if (watchedMove.size && list.length - watchedMove.size >= 6) {
          state.deferred.push(...list.filter(it => watchedMove.has(it)));
          list = list.filter(it => !watchedMove.has(it));
        }
        // 2 ページ目以降に控えている、まだ表示も視聴もしていない動画を数本だけ上位へ
        if (VyRank.promoteFresh) list = VyRank.promoteFresh(list, { shownKey: shownKey(), impQuery: q, from: 16, count: 4 });
      }
    }
    return { regular: list, shorts };
  }

  function appendRows(grid, list) {
    const missingIcons = [];
    const shownIds = [];
    list.forEach(item => {
      const row = createRow(item);
      state.items.set(item.videoId || item.playlistId || item.authorId, item);
      if (shortsShelfEl && !shortsShelfEl.isConnected && state.rendered === SHELF_AFTER) grid.appendChild(shortsShelfEl);
      grid.appendChild(row);
      state.rendered++;
      if (item.videoId) shownIds.push(item.videoId);
      if (!item.authorThumbnails || !item.authorThumbnails.length) {
        if (item.authorId) missingIcons.push({ card: row, authorId: item.authorId });
        else if (item.playlistId) missingIcons.push({ card: row, playlistId: item.playlistId });
      }
    });
    if (shortsShelfEl && !shortsShelfEl.isConnected && state.rendered >= SHELF_AFTER) {
      const ref = grid.children[SHELF_AFTER] || null;
      grid.insertBefore(shortsShelfEl, ref);
    }
    if (missingIcons.length && typeof fillMissingIcons === 'function') fillMissingIcons(missingIcons);
    // 「一度表示した動画」は、実際に画面に出たものだけ記録する (次の同じ検索で少し優先度を下げる)
    grid.querySelectorAll('.ys-row[data-vid]:not([data-imp])').forEach(row => { row.dataset.imp = '0'; impObserver().observe(row); });
  }

  let _impIO = null, _impBuf = [], _impTimer = 0;
  function impObserver() {
    if (_impIO) return _impIO;
    _impIO = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const row = en.target;
        _impIO.unobserve(row);
        if (row.dataset.imp === '1') return;
        row.dataset.imp = '1';
        _impBuf.push(row.dataset.vid);
      });
      clearTimeout(_impTimer);
      _impTimer = setTimeout(() => {
        const ids = _impBuf.splice(0);
        if (!ids.length || !window.VyRank) return;
        VyRank.recordImpressions(ids);
        if (VyRank.recordQueryImpressions) VyRank.recordQueryImpressions(effectiveQuery(), ids);
      }, 400);
    }, { threshold: 0.5 });
    return _impIO;
  }

  /* ── ショートの棚 ──────────────────────────────────── */
  function initShortsShelf(q) {
    const shelf = createShortsShelf([], { searchQuery: q });
    shelf.classList.add('ys-shelf');
    const scroll = shelf.querySelector('.shorts-shelf-scroll');
    for (let i = 0; i < 6; i++) {
      const sk = document.createElement('div');
      sk.className = 'short-card ys-short-skel';
      sk.innerHTML = '<div class="short-card-thumb"></div><i></i><i></i>';
      scroll.appendChild(sk);
    }
    shortsShelfEl = shelf;
  }

  function addShortsToShelf(items, gen) {
    if (gen !== shortsAutoGen || !shortsShelfEl) return 0;
    let fresh = items.filter(it => it.videoId && isShortVideo({ ...it, isShort: true }) && !shortsSeenIds.has(it.videoId));
    if (state.chip === 'unwatched' && window.VyRank) fresh = fresh.filter(it => !VyRank.isWatched(it.videoId));
    if (!fresh.length) return 0;
    if (window.VyRank && isRelevance()) fresh = VyRank.rank(fresh, { query: state.q });
    fresh.forEach(it => { shortsSeenIds.add(it.videoId); allShortsFound.push(it); });
    shortsShelfEl.querySelectorAll('.ys-short-skel').forEach(el => el.remove());
    appendShortsToShelf(shortsShelfEl, fresh, allShortsFound, effectiveQuery());
    shortsShelfEl.hidden = false;
    // 棚の中のリンクに、いま棚に並んでいる順のリストを持たせる (ショート画面で上下移動できるように)
    const list = allShortsFound.map(v => v.videoId).join(',');
    shortsShelfEl.querySelectorAll('a.short-card').forEach(a => {
      try {
        const u = new URL(a.href, location.origin);
        u.searchParams.set('list', list);
        a.href = u.pathname + u.search;
      } catch (_) {}
    });
    if (typeof vyUpdateShelfArrows === 'function') vyUpdateShelfArrows(shortsShelfEl);
    return fresh.length;
  }

  function finishShortsShelf(gen) {
    if (gen !== shortsAutoGen || !shortsShelfEl) return;
    shortsShelfEl.querySelectorAll('.ys-short-skel').forEach(el => el.remove());
    if (!allShortsFound.length) { shortsShelfEl.remove(); shortsShelfEl = null; }
  }

  async function startShortsAutoFetch(q, region, gen) {
    const maxPages = 4;

    async function fetchOnePage(searchQ, page) {
      if (gen !== shortsAutoGen) return 0;
      try {
        const pageParam = page > 1 ? `&page=${page}` : '';
        const raw = await fetchMain(`/api/search?q=${encodeURIComponent(searchQ)}&region=${encodeURIComponent(region || 'JP')}${pageParam}`);
        const items = Array.isArray(raw) ? raw : (raw.results || []);
        return addShortsToShelf(items.filter(it => isShortVideo(it)), gen);
      } catch (_) { return 0; }
    }
    const timeout = (ms) => {
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
      const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
    };

    async function runXeroxyt() {
      let added = 0;
      await new Promise((resolve) => {
        let es;
        try { es = new EventSource(`/api/xeroxyt-shorts-search-stream?q=${encodeURIComponent(q)}`); }
        catch (_) { resolve(); return; }
        const done = () => { try { es.close(); } catch (_) {} resolve(); };
        es.onmessage = (ev) => {
          if (gen !== shortsAutoGen) { done(); return; }
          try {
            const d = JSON.parse(ev.data);
            if (d.done) { done(); return; }
            if (Array.isArray(d.items)) added += addShortsToShelf(d.items, gen);
          } catch (_) {}
        };
        es.onerror = done;
        setTimeout(done, 25000);
      });
      return added;
    }
    async function runCse() {
      const before = allShortsFound.length;
      await startCseShortsSearch(q, gen);
      return allShortsFound.length - before;
    }
    async function runInvidious() {
      let total = 0;
      for (const sq of [q + ' ショート', q + ' #shorts']) {
        for (let p = 1; p <= maxPages; p++) {
          if (gen !== shortsAutoGen) return total;
          const c = await fetchOnePage(sq, p);
          total += c;
          if (c < 5) break;
          await new Promise(r => setTimeout(r, 350));
        }
      }
      return total;
    }
    async function runInnertube() {
      let added = 0;
      try {
        const res = await fetch(`/api/innertube-shorts-search?q=${encodeURIComponent(q)}`, { signal: timeout(15000) });
        if (!res.ok) return 0;
        const data = await res.json();
        if (data.error) return 0;
        if (Array.isArray(data.items)) added += addShortsToShelf(data.items, gen);
        let cont = data.contKey || null;
        for (let i = 0; i < 3 && cont && gen === shortsAutoGen; i++) {
          await new Promise(r => setTimeout(r, 300));
          const cr = await fetch(`/api/innertube-shorts-search-cont?contKey=${encodeURIComponent(cont)}`, { signal: timeout(15000) });
          if (!cr.ok) break;
          const cd = await cr.json();
          if (cd.error) break;
          if (Array.isArray(cd.items)) added += addShortsToShelf(cd.items, gen);
          cont = cd.contKey || null;
        }
      } catch (_) {}
      return added;
    }
    async function runChocoApi() {
      let added = 0;
      for (let page = 1; page <= 6; page++) {
        if (gen !== shortsAutoGen) break;
        try {
          const res = await fetch(`/api/choco-shorts-search?q=${encodeURIComponent(q)}&page=${page}`, { signal: timeout(20000) });
          if (!res.ok) break;
          const data = await res.json();
          if (data.error) break;
          const items = data.items || [];
          if (!items.length) break;
          const c = addShortsToShelf(items, gen);
          added += c;
          if (c === 0) break;
          await new Promise(r => setTimeout(r, 300));
        } catch (_) { break; }
      }
      return added;
    }

    const runners = { choco: runChocoApi, xeroxyt: runXeroxyt, cse: runCse, invidious: runInvidious, innertube: runInnertube };
    const DEFAULT_ORDER = ['choco', 'xeroxyt', 'cse', 'invidious', 'innertube'];
    const DEFAULT_ENABLED = { choco: true, xeroxyt: true, cse: true, invidious: true, innertube: true };
    const s = settings();
    const order = Array.isArray(s.shortsSourceOrder) ? s.shortsSourceOrder : DEFAULT_ORDER;
    const enabled = (s.shortsSourceEnabled && typeof s.shortsSourceEnabled === 'object') ? { ...DEFAULT_ENABLED, ...s.shortsSourceEnabled } : DEFAULT_ENABLED;

    const ENOUGH = 8;
    for (const id of order) {
      if (gen !== shortsAutoGen) return;
      if (!enabled[id] || !runners[id]) continue;
      try { await runners[id](); } catch (_) {}
      if (allShortsFound.length >= ENOUGH) break;
    }
    finishShortsShelf(gen);
  }

  /* Google CSE (ショート用の予備) */
  function _waitCseReady(timeout) {
    return new Promise((resolve, reject) => {
      if (window._cseReady) { resolve(); return; }
      const start = Date.now();
      const t = setInterval(() => {
        if (window._cseReady) { clearInterval(t); resolve(); return; }
        if (Date.now() - start > timeout) { clearInterval(t); reject(new Error('CSE timeout')); }
      }, 150);
    });
  }
  function _cseSearchOnce(query) {
    return new Promise((resolve) => {
      window._cseResultCallback = resolve;
      clearTimeout(window._cseCaptchaTimer);
      window._cseCaptchaTimer = setTimeout(() => { if (window._cseResultCallback) window._cseShowCaptchaOverlay(); }, 3000);
      try {
        google.search.cse.element.getElement('chocoCse').execute(query);
      } catch (_) {
        clearTimeout(window._cseCaptchaTimer);
        window._cseResultCallback = null;
        window._cseHideCaptchaOverlay();
        resolve([]);
      }
    });
  }
  async function startCseShortsSearch(q, gen) {
    if (!window._cseCx) return;
    try { await _waitCseReady(9000); } catch (_) { return; }
    for (const sq of [q + ' ショート site:youtube.com', q + ' #shorts site:youtube.com']) {
      if (gen !== shortsAutoGen) return;
      try {
        const results = await _cseSearchOnce(sq);
        if (gen !== shortsAutoGen) return;
        const items = [];
        (results || []).forEach(r => {
          const url = r.unescapedUrl || r.url || '';
          const m = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
          if (!m) return;
          items.push({ videoId: m[1], title: r.titleNoFormatting || r.title || m[1], isShort: true, lengthSeconds: 30, author: '', authorId: '', viewCount: 0 });
        });
        addShortsToShelf(items, gen);
        await new Promise(r => setTimeout(r, 600));
      } catch (_) {}
    }
  }

  /* ── 引っ張って更新 (pull-to-refresh / scroll-up load more) ── */
  /*
     ページ最上部で下に引っ張る (タッチ) か、一番上で上にスクロール
     (マウスホイール) すると、検索結果を最新の1ページ目で差し替える。
     取得中も今の結果はそのまま残し、新しい結果が届いたら置き換える。
  */
  function pullEnabled() {
    // 検索語があり、いま取得中でなければ受け付ける
    return !!state.q && !state.refreshing && !state.loading;
  }
  function bindPullRefresh() {
    if (!window.VyPullRefresh) return;
    VyPullRefresh.attach({ isEnabled: pullEnabled, onRefresh: () => triggerRefresh() });
  }

  // 検索結果を最新の1ページ目で差し替える (今の結果は取得完了まで残す)
  async function triggerRefresh() {
    if (state.refreshing || state.loading) return;
    if (!state.q) return;
    state.refreshing = true;
    state.loading = true;

    const gen = ++state.gen;
    shortsAutoGen++;
    try {
      const { items, more, pages } = await fetchFirstPool();
      if (gen !== state.gen) return;     // 途中で別の検索に切り替わった
      // 新しい結果で状態をリセットして描き直す
      state.page = 1;
      state.seen = new Set();
      state.items = new Map();
      state.deferred = [];
      state.rendered = 0;
      state.exhausted = false;
      state.pipedNext = null;
      allShortsFound = [];
      shortsSeenIds = new Set();
      shortsShelfEl = null;

      const grid = $('resultGrid');
      const { regular, shorts } = prepare(items);
      state.page = pages || 1;
      // 更新したことが分かるよう、差し替える直前に一瞬だけ骨組みを表示 (古い結果と混ざらない)
      await vySkeletonFlash(grid, createSkeletonRow, 8, 320);
      if (gen !== state.gen) return;
      grid.innerHTML = '';
      appendRows(grid, regular);
      vyFreshIn(grid);
      rememberShown(regular);

      const includeShorts = settings().searchIncludeShorts !== false;
      if (includeShorts) {
        initShortsShelf(effectiveQuery());
        if (shortsShelfEl && !shortsShelfEl.isConnected) grid.appendChild(shortsShelfEl);
        if (shorts.length) addShortsToShelf(shorts, shortsAutoGen);
        startShortsAutoFetch(effectiveQuery(), state.region, shortsAutoGen);
      }
      state.exhausted = !more;
      if (state.exhausted && state.deferred.length) appendRows(grid, state.deferred.splice(0));
      $('resultSentinel').hidden = state.exhausted;
      if (!state.exhausted && regular.length < 6) setTimeout(() => loadMore(), 50);
    } catch (e) {
      if (gen !== state.gen) return;
      console.warn('[search] refresh', e);
      // 失敗時は今の結果をそのまま残す
    } finally {
      if (gen === state.gen) {
        state.refreshing = false;
        state.loading = false;
      }
    }
  }

  /* ── 検索の実行 ───────────────────────────────────── */
  function showEmpty(msg) {
    const grid = $('resultGrid');
    grid.innerHTML = `<div class="ys-empty"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg><p>${msg}</p></div>`;
  }

  async function doSearch({ push = true, replace = false } = {}) {
    state.q = ($('searchInput').value || '').trim();
    if (!state.q) { showEmpty('キーワードを入力して検索してください。'); return; }
    const gen = ++state.gen;
    shortsAutoGen++;
    state.page = 1;
    state.seen = new Set();
    state.items = new Map();
    state.deferred = [];
    state.rendered = 0;
    state.exhausted = false;
    state.pipedNext = null;
    state.moreErrPause = false;
    allShortsFound = [];
    shortsSeenIds = new Set();
    shortsShelfEl = null;
    if (push) pushState(replace);
    syncChips();
    syncFilterDialog();

    const grid = $('resultGrid');
    grid.innerHTML = '';
    for (let i = 0; i < 8; i++) grid.appendChild(createSkeletonRow());
    $('resultSentinel').hidden = true;
    window.scrollTo({ top: 0 });

    const includeShorts = settings().searchIncludeShorts !== false;
    if (includeShorts) initShortsShelf(effectiveQuery());

    state.loading = true;
    try {
      const { items, more, pages } = await fetchFirstPool();
      if (gen !== state.gen) return;
      const { regular, shorts } = prepare(items);
      state.page = pages || 1;
      grid.innerHTML = '';
      appendRows(grid, regular);
      vyFreshIn(grid);
      rememberShown(regular);
      if (includeShorts) {
        if (shortsShelfEl && !shortsShelfEl.isConnected) grid.appendChild(shortsShelfEl);
        if (shorts.length) addShortsToShelf(shorts, shortsAutoGen);
        startShortsAutoFetch(effectiveQuery(), state.region, shortsAutoGen);
      }
      state.exhausted = !more;
      if (state.exhausted && state.deferred.length) appendRows(grid, state.deferred.splice(0));
      if (!regular.length && !shorts.length && !more && !state.deferred.length) {
        showEmpty(`「${escapeHtml(state.q)}」に一致する動画は見つかりませんでした。<br><small>別のキーワードやフィルタで試してみてください。</small>`);
        if (includeShorts && shortsShelfEl) grid.appendChild(shortsShelfEl);
      }
      $('resultSentinel').hidden = state.exhausted;
      if (!state.exhausted && regular.length < 6) setTimeout(() => loadMore(), 50);
    } catch (e) {
      if (gen !== state.gen) return;
      console.error(e);
      grid.innerHTML = `<div class="ys-empty ys-error"><p>検索に失敗しました。しばらくしてからもう一度お試しください。</p><button type="button" class="ys-retry">再試行</button></div>`;
      grid.querySelector('.ys-retry').addEventListener('click', () => doSearch({ push: false }));
    } finally {
      if (gen === state.gen) state.loading = false;
    }
  }

  function showMoreError(grid) {
    if (grid.querySelector('.ys-more-err')) return;
    const box = document.createElement('div');
    box.className = 'ys-more-err';
    box.innerHTML = '<span>続きの読み込みに失敗しました</span><button type="button" class="ys-retry">再試行</button>';
    box.querySelector('button').addEventListener('click', () => { box.remove(); state.moreErrPause = false; loadMore(); });
    grid.appendChild(box);
    state.moreErrPause = true;   // 自動の読み込みは止めて、ボタンで再開
  }

  async function loadMore() {
    if (state.loading || state.exhausted || !state.q || state.moreErrPause) return;
    const gen = state.gen;
    state.loading = true;
    if (loadMoreIO) loadMoreIO.disconnect();   // 取得中は監視を止めて二重発火を防ぐ
    const grid = $('resultGrid');
    $('resultSentinel').hidden = false;
    if (window.VyTopLoader) VyTopLoader.show('検索結果');
    try {
      for (let tries = 0; tries < 3; tries++) {
        state.page++;
        const { items, more } = await fetchPage(state.page);
        if (gen !== state.gen) return;
        state.exhausted = !more || !items.length;
        const { regular, shorts } = prepare(items);
        if (shorts.length && shortsShelfEl) addShortsToShelf(shorts, shortsAutoGen);
        // 後ろに回しておいた動画を少しずつ混ぜて戻す (最後まで来たら全部)
        const back = state.exhausted ? state.deferred.splice(0) : state.deferred.splice(0, 4);
        if (regular.length || back.length) {
          const mixed = regular.slice();
          back.forEach((it, i) => mixed.splice(Math.min(mixed.length, 2 + i * 3), 0, it));
          appendRows(grid, mixed);
          break;
        }
        if (state.exhausted) break;
      }
    } catch (e) {
      console.warn('[search] more', e);
      state.page--;
      // 取得に失敗しただけなので「これ以上ない」にはしない。再試行できるようにする
      if (gen === state.gen) showMoreError(grid);
    } finally {
      if (window.VyTopLoader) VyTopLoader.hide();
      if (loadMoreIO) loadMoreIO.observe($('resultSentinel'));   // 取得完了したら監視を再開
      if (gen === state.gen) {
        state.loading = false;
        $('resultSentinel').hidden = state.exhausted;
        if (state.exhausted && state.rendered > 0 && !grid.querySelector('.ys-end')) {
          const end = document.createElement('div');
          end.className = 'ys-end';
          end.textContent = 'これ以上の結果はありません';
          grid.appendChild(end);
        }
      }
    }
  }

  /* ── チップ ───────────────────────────────────────── */
  function syncChips() {
    document.querySelectorAll('#chipScroll .ys-chip').forEach(b => {
      const on = (b.dataset.chip || '') === state.chip;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  function updateChipArrows() {
    const sc = $('chipScroll');
    if (!sc) return;
    const max = sc.scrollWidth - sc.clientWidth;
    $('chipPrev').hidden = sc.scrollLeft <= 4;
    $('chipNext').hidden = sc.scrollLeft >= max - 4;
  }
  function bindChips() {
    const sc = $('chipScroll');
    sc.addEventListener('click', (e) => {
      const b = e.target.closest('.ys-chip');
      if (!b) return;
      const chip = b.dataset.chip || '';
      if (chip === state.chip) return;
      state.chip = chip;
      b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      doSearch();
    });
    sc.addEventListener('scroll', updateChipArrows, { passive: true });
    window.addEventListener('resize', updateChipArrows);
    // マウスホイールの縦回転でも横にスクロール
    sc.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && sc.scrollWidth > sc.clientWidth) {
        sc.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    $('chipPrev').addEventListener('click', () => sc.scrollBy({ left: -sc.clientWidth * 0.7, behavior: 'smooth' }));
    $('chipNext').addEventListener('click', () => sc.scrollBy({ left: sc.clientWidth * 0.7, behavior: 'smooth' }));
    setTimeout(updateChipArrows, 50);
  }

  /* ── 詳細フィルタ (⋯) ─────────────────────────────── */
  function filterIsDefault() {
    return isRelevance() && !state.date && !state.duration && (!state.region || state.region === 'JP');
  }
  function syncFilterDialog() {
    document.querySelectorAll('#filterDialog .ys-fopts').forEach(g => {
      const key = g.dataset.key;
      const cur = state[key] || (key === 'sort_by' ? 'relevance' : '');
      g.querySelectorAll('button').forEach(b => {
        const on = b.dataset.val === cur;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
    const rs = $('regionSelect');
    if (rs) rs.value = state.region || 'JP';
    $('filterDot').hidden = filterIsDefault();
    $('filterOpenBtn').classList.toggle('on', !filterIsDefault());
  }
  function openFilter() {
    syncFilterDialog();
    const d = $('filterDialog');
    d.hidden = false;
    requestAnimationFrame(() => d.classList.add('show'));
    document.documentElement.classList.add('ys-lock');
    setTimeout(() => { const box = d.querySelector('.ys-dialog'); if (box) { box.setAttribute('tabindex', '-1'); box.focus({ preventScroll: true }); } }, 30);
  }
  function closeFilter() {
    const d = $('filterDialog');
    d.classList.remove('show');
    document.documentElement.classList.remove('ys-lock');
    setTimeout(() => { d.hidden = true; }, 180);
  }
  function bindFilter() {
    $('filterOpenBtn').addEventListener('click', openFilter);
    $('filterCloseBtn').addEventListener('click', closeFilter);
    $('filterDoneBtn').addEventListener('click', closeFilter);
    $('filterDialog').addEventListener('click', (e) => { if (e.target.id === 'filterDialog') closeFilter(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('filterDialog').hidden) closeFilter(); });
    document.querySelectorAll('#filterDialog .ys-fopts').forEach(g => {
      g.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = g.dataset.key;
        const val = b.dataset.val;
        const cur = state[key] || (key === 'sort_by' ? 'relevance' : '');
        if (val === cur) return;
        state[key] = val;
        syncFilterDialog();
        doSearch();
      });
    });
    $('regionSelect').addEventListener('change', (e) => {
      state.region = e.target.value || 'JP';
      syncFilterDialog();
      doSearch();
    });
    $('filterResetBtn').addEventListener('click', () => {
      if (filterIsDefault()) return;
      state.sort_by = 'relevance'; state.date = ''; state.duration = ''; state.region = settings().searchRegion || 'JP';
      syncFilterDialog();
      doSearch();
    });
  }

  function populateRegionSelect() {
    const sel = $('regionSelect');
    if (!sel || typeof COUNTRIES === 'undefined') return;
    [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'ja')).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = `${c.name} (${c.code})`;
      sel.appendChild(opt);
    });
  }

  function restoreFromUrl() {
    const p = new URLSearchParams(location.search);
    const saved = settings();
    state.q = p.get('q') || '';
    const c = p.get('chip') || '';
    state.chip = (CHIP_WORDS[c] || c === 'unwatched') ? c : '';
    state.sort_by = p.get('sort_by') || saved.searchSort || 'relevance';
    state.date = p.get('date') || saved.searchDate || '';
    state.duration = p.get('duration') || saved.searchDuration || '';
    state.region = p.get('region') || saved.searchRegion || 'JP';
    $('searchInput').value = state.q;
    if (state.q) document.title = `${state.q} - Vyslo Tube`;
  }

  let loadMoreIO = null;       // loadMore() 中の二重発火を防ぐため一時的に切る
  function bindInfinite() {
    const sentinel = $('resultSentinel');
    if ('IntersectionObserver' in window) {
      loadMoreIO = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) loadMore();
      }, { rootMargin: '900px 0px' });
      loadMoreIO.observe(sentinel);
    } else {
      window.addEventListener('scroll', () => {
        if (window.innerHeight + window.scrollY > document.body.offsetHeight - 1200) loadMore();
      }, { passive: true });
    }
  }

  function bindClicks() {
    // どの動画が押されたかを覚える (次からの並び替えに使う)
    $('resultGrid').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-vid]');
      if (!a || !window.VyRank) return;
      const item = state.items.get(a.dataset.vid);
      if (item) VyRank.recordClick(item);
    }, true);
  }

  function init() {
    populateRegionSelect();
    restoreFromUrl();
    bindChips();
    bindFilter();
    bindInfinite();
    bindPullRefresh();
    bindClicks();
    syncChips();
    syncFilterDialog();
    initHeaderSearch({ onSubmit: () => { state.chip = ''; doSearch(); } });
    window.addEventListener('popstate', () => { restoreFromUrl(); doSearch({ push: false }); });
    if (state.q) doSearch({ push: false });
    else showEmpty('キーワードを入力して検索してください。');
  }

  init();
})();
