;(() => {
  if (!document.body.classList.contains('page-home')) return;

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickRandom(arr, n) {
    return shuffle([...arr]).slice(0, n);
  }

  function weightedPickRandom(arr, n) {
    if (!arr.length) return [];
    const pool = arr.map((v, i) => ({ v, w: arr.length - i }));
    const result = [];
    for (let pick = 0; pick < Math.min(n, arr.length); pick++) {
      const total = pool.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * total;
      for (let j = 0; j < pool.length; j++) {
        r -= pool[j].w;
        if (r <= 0) {
          result.push(pool[j].v);
          pool.splice(j, 1);
          break;
        }
      }
    }
    return result;
  }

  async function fetchSearchVideos(term) {
    try {
      const raw = await fetchMain(`/api/search?q=${encodeURIComponent(term)}`);
      const items = Array.isArray(raw) ? raw : (raw.results || []);
      return items.filter(v => v.type === 'video' && v.videoId);
    } catch { return []; }
  }

  async function fetchRelated(videoId) {
    try {
      const data = await fetchMain(`/api/stream/${videoId}`);
      return data.recommendedVideos || [];
    } catch { return []; }
  }

  let loadGen = 0;

  function withTimeout(p, ms, fallback) {
    return Promise.race([p, new Promise(res => setTimeout(() => res(fallback), ms))]);
  }

  // ホームで直前に表示した一覧 (次の更新で優先度を下げ、同じ一覧にならないようにする)
  const HOME_SHOWN = 'home';
  function rememberHomeShown(list) {
    if (!window.VyRank || !VyRank.recordShown) return;
    VyRank.recordShown(HOME_SHOWN, (list || []).slice(0, 30).map(v => v.videoId || v.id).filter(Boolean));
  }

  let morePool = [], moreSeen = new Set();
  // セッション内で連続する読み込み間で同じ動画が繰り返し表示されるのを防ぐ
  const _sessionSeen = new Set();
  // 既存のグリッドの先頭に新しいカードを追加 (置き換えない)
  function _prependCards(grid, list) {
    if (!grid || !list || !list.length) return;
    const missingIcons = [];
    // 既存の動画IDを収集 (重複防止)
    const have = new Set([...grid.querySelectorAll('a[href*="/watch?v="]')]
      .map(a => { try { return new URL(a.href, location.origin).searchParams.get('v'); } catch { return null; } })
      .filter(Boolean));
    // ショート棚を一時的に退避
    detachShelf();
    const firstCard = grid.querySelector('a[href*="/watch?v="], .video-card');
    list.forEach(video => {
      const id = video.videoId || video.id;
      if (!id || have.has(id)) return;
      have.add(id);
      const card = createVideoCard(video);
      if (firstCard) grid.insertBefore(card, firstCard); else grid.appendChild(card);
      if (!video.authorThumbnails && video.authorId) missingIcons.push({ card, authorId: video.authorId });
    });
    if (missingIcons.length > 0) fillMissingIcons(missingIcons);
    placeShelf();
  }

  function renderCards(grid, list, extra) {
    detachShelf();
    grid.innerHTML = '';
    const missingIcons = [];
    list.forEach(video => {
      const card = createVideoCard(video);
      grid.appendChild(card);
      if (!video.authorThumbnails && video.authorId) missingIcons.push({ card, authorId: video.authorId });
    });
    if (missingIcons.length > 0) fillMissingIcons(missingIcons);
    placeShelf();
    // 「もっと読み込む」
    moreSeen = new Set(list.map(v => v.videoId || v.id));
    morePool = (extra || []).filter(v => { const id = v.videoId || v.id; if (!id || moreSeen.has(id)) return false; moreSeen.add(id); return true; });
    const g = loadGen;
    vyLoadMore(grid, async () => {
      if (morePool.length < 12) {
        const more = await vyFetchMoreRelated(grid, moreSeen, 4);
        if (g !== loadGen) return 0;
        morePool.push(...shuffle(more));
      }
      return vyAppendCards(grid, morePool.splice(0, 24));
    });
  }

  async function loadRecommended(opts = {}) {
    const unwatchedOnly = !!opts.unwatched;
    const prepend = !!opts.prepend;
    const refresh = !!opts.refresh;   // 今の一覧を残したまま取り直す
    const gen = ++loadGen;
    const grid = document.getElementById('recommendGrid');
    if (!grid) return;
    if (!prepend && !refresh) {
      vyHideLoadMore(grid);
      detachShelf();
      grid.innerHTML = '';
      for (let i = 0; i < 20; i++) grid.appendChild(createSkeletonCard());
    }

    const history = getSearchHistory();
    const watchHist = (typeof getHistory === 'function') ? getHistory() : [];

    // 履歴がまったく無いときは人気動画を表示
    if (!history.length && !watchHist.length) {
      await loadPopularFallback(grid, gen, unwatchedOnly, refresh);
      return;
    }

    // 検索キーワード: 検索履歴 + 視聴履歴のタイトルからなるより大きなプールを使用
    const allTerms = [...history];
    watchHist.forEach(v => { if (v.title) allTerms.push(v.title.slice(0, 40)); });
    // 呼び出しごとに異なるランダムシードで選択する
    const termCount = Math.min(3 + Math.floor(Math.random() * 3), allTerms.length || 0); // 3〜5件
    const terms = weightedPickRandom(allTerms, Math.max(1, termCount));
    // 補充: プールが足りない場合は視聴履歴のタイトルから追加
    if (terms.length < 3 && watchHist.length) {
      weightedPickRandom(watchHist, 3 - terms.length).forEach(v => { if (v.title && !terms.includes(v.title.slice(0, 40))) terms.push(v.title.slice(0, 40)); });
    }
    const watchSeeds = weightedPickRandom(watchHist, Math.min(4, watchHist.length)).map(v => v.videoId).filter(Boolean);

    const searchResults = await Promise.all(terms.map(t => withTimeout(fetchSearchVideos(t), 15000, [])));
    if (gen !== loadGen) return;

    const searchSeeds = [];
    searchResults.forEach(results => { pickRandom(results, 1).forEach(v => searchSeeds.push(v.videoId)); });
    const seedIds = [...watchSeeds, ...searchSeeds];

    // 関連動画（取得できない場合があるので時間制限付き）
    const relatedArrays = await Promise.all(seedIds.map(id => withTimeout(fetchRelated(id), 12000, [])));
    if (gen !== loadGen) return;

    const watched = new Set(watchHist.map(v => v.videoId));
    const wset = watchedSet();
    const seen = new Set();
    const related = [], fromSearch = [];
    const push = (arr, v) => {
      const id = v.videoId || v.id;
      if (!id || seen.has(id)) return;
      // セッション内で前回の読み込みで表示済みの動画はスキップ
      if (_sessionSeen.has(id) && (related.length + fromSearch.length) >= 12) return;
      if (unwatchedOnly && isWatched(id, wset)) return;
      seen.add(id); arr.push(v);
    };
    // 各起点の関連動画を上位から順に交互に並べる (関連性の高いものが前に来るように)
    const maxLen = Math.max(0, ...relatedArrays.map(a => a.length));
    for (let i = 0; i < maxLen; i++) relatedArrays.forEach(arr => { if (arr[i]) push(related, arr[i]); });
    searchResults.forEach(arr => arr.filter(v => !watched.has(v.videoId)).forEach(v => push(fromSearch, v)));

    // 関連動画を優先し、検索結果で補う
    let allPicked = [...related, ...fromSearch];
    if (window.VyRank) {
      // おすすめ度で並べる: 視聴済み・直前の更新で表示した動画は大きく下げ、数%の小さな揺らぎを加える
      allPicked = VyRank.rank(allPicked, { query: '', impQuery: '__home__', shownKey: HOME_SHOWN, jitter: 0.04 });
      // 見終わった動画は、ほかに十分な候補があれば後ろ (もっと読み込む側) へ
      const fresh = allPicked.filter(v => !isWatched(v.videoId || v.id, wset));
      if (fresh.length >= 24) allPicked = [...fresh, ...allPicked.filter(v => isWatched(v.videoId || v.id, wset))];
      // 下の方に控えている、まだ表示も視聴もしていない動画を数本だけ上位へ繰り上げる
      allPicked = VyRank.promoteFresh(allPicked, { shownKey: HOME_SHOWN, from: 24, count: 4, slots: [1, 4, 7, 10] });
      // ショートが上の方に固まらないよう、これまで (ランダムに混ぜていた頃) と同じく全体に均等に散らす
      const sh = allPicked.filter(v => isShortVideo(v)), rg = allPicked.filter(v => !isShortVideo(v));
      if (sh.length && rg.length) {
        const ratio = sh.length / allPicked.length, mixedOut = [];
        let si = 0, ri = 0;
        while (si < sh.length || ri < rg.length) {
          const want = (mixedOut.length + 1) * ratio;
          if (si < sh.length && (si + 1 <= want || ri >= rg.length)) mixedOut.push(sh[si++]);
          else mixedOut.push(rg[ri++]);
        }
        allPicked = mixedOut;
      }
    } else {
      allPicked = [...shuffle(related), ...shuffle(fromSearch)];
    }
    const final = allPicked.slice(0, 48);
    const leftover = allPicked.slice(48);
    const mixed = window.VyRank ? final : shuffle(final);

    if (!mixed.length) {
      // 更新で取れなかったときは今の一覧をそのまま残す
      if (refresh && grid.querySelector('.video-card, a[href*="/watch?v="]')) return;
      await loadPopularFallback(grid, gen, unwatchedOnly);
      return;
    }
    // セッション表示済みセットを更新 (今回表示した動画を記録)
    mixed.forEach(v => { const id = v.videoId || v.id; if (id) _sessionSeen.add(id); });
    if (prepend) {
      _prependCards(grid, mixed);
    } else {
      if (refresh) {
        // 更新したことが分かるよう、差し替える直前に一瞬だけ骨組みを表示
        vyHideLoadMore(grid);
        detachShelf();
        await vySkeletonFlash(grid, createSkeletonCard, 12, 320);
        if (gen !== loadGen) return;
      }
      renderCards(grid, mixed, leftover);
      vyFreshIn(grid);
    }
    rememberHomeShown(mixed);
  }

  async function loadPopularFallback(grid, gen, unwatchedOnly, keepOnFail) {
    const wset = watchedSet();
    // 日本の動画を優先: 先に日本の急上昇、取れないときだけ全体の人気動画
    const sources = ['/api/trending?region=JP', '/api/popular'];
    for (const src of sources) {
      try {
        const raw = await withTimeout(fetchMain(src), 15000, null);
        if (gen !== undefined && gen !== loadGen) return;
        const data = raw ? (Array.isArray(raw) ? raw : (raw.results || raw.videos || [])) : [];
        let vids = data.filter(v => v && (v.videoId || v.id) && !(unwatchedOnly && isWatched(v.videoId || v.id, wset)));
        if (vids.length) {
          if (window.VyRank) {
            vids = VyRank.rank(vids, { query: '', impQuery: '__home__', shownKey: HOME_SHOWN + ':pop', jitter: 0.04 });
            vids = VyRank.promoteFresh(vids, { shownKey: HOME_SHOWN + ':pop', from: 16, count: 3, slots: [1, 4, 7] });
          } else if (keepOnFail) vids = shuffle(vids);
          if (keepOnFail && grid.querySelector('.video-card, a[href*="/watch?v="]')) {
            vyHideLoadMore(grid);
            detachShelf();
            await vySkeletonFlash(grid, createSkeletonCard, 12, 320);
            if (gen !== undefined && gen !== loadGen) return;
          }
          renderCards(grid, vids);
          vyFreshIn(grid);
          if (window.VyRank && VyRank.recordShown) VyRank.recordShown(HOME_SHOWN + ':pop', vids.slice(0, 30).map(v => v.videoId || v.id).filter(Boolean));
          return;
        }
      } catch {}
    }
    if (gen !== undefined && gen !== loadGen) return;
    if (keepOnFail && grid.querySelector('.video-card, a[href*="/watch?v="]')) return;
    grid.innerHTML = `<div class="empty-state"><p>おすすめ動画を取得できませんでした。時間をおいて「更新」を押してください。</p></div>`;
  }

  function initHeroSearch() {
    const form = document.getElementById('heroSearchForm');
    const input = document.getElementById('heroSearchInput');
    const suggList = document.getElementById('heroSuggestions');
    if (!form || !input) return;

    let timer = null;

    async function fetchSugg(q) {
      // 本家 YouTube の候補 (日本語) をサーバー経由で取得
    try {
      const r = await fetchMain(`/api/search/suggestions?q=${encodeURIComponent(q)}`);
      const list = (r && (r.suggestions || (Array.isArray(r) ? r : []))) || [];
      return [...new Set(list.filter(s => typeof s === 'string'))];
    } catch { return []; }
    }

    function decodeHtml(s) {
      const el = document.createElement('textarea'); el.innerHTML = s; return el.value;
    }

    const IC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    const IH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-3.5"/><polyline points="3 4 3 11 10 11"/></svg>`;

    function showSugg(items, q) {
      if (!suggList) return;
      if (!items.length) { suggList.hidden = true; return; }
      suggList.innerHTML = '';
      items.slice(0, 8).forEach(raw => {
        const text = decodeHtml(raw);
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        li.innerHTML = `${q ? IC : IH}<span class="suggest-text"></span>`;
        li.querySelector('.suggest-text').textContent = text;
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value = text;
          if (suggList) suggList.hidden = true;
          addSearchHistory(text);
          window.location.href = buildSearchUrl({ q: text });
        });
        suggList.appendChild(li);
      });
      suggList.hidden = false;
    }

    function showHistSugg() {
      if (!suggList) return;
      const hist = getSearchHistory();
      if (!hist.length) { suggList.hidden = true; return; }
      suggList.innerHTML = '';
      const hdr = document.createElement('li');
      hdr.className = 'suggest-history-header';
      hdr.innerHTML = `<span>最近の検索</span><button class="suggest-clear-btn" type="button">まとめて削除</button>`;
      hdr.querySelector('.suggest-clear-btn').addEventListener('mousedown', e => {
        e.preventDefault(); clearSearchHistory(); if (suggList) suggList.hidden = true;
      });
      suggList.appendChild(hdr);
      hist.slice(0, 8).forEach(term => {
        const li = document.createElement('li');
        li.className = 'suggestion-item';
        li.innerHTML = `${IH}<span class="suggest-text"></span>`;
        li.querySelector('.suggest-text').textContent = term;
        li.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value = term;
          if (suggList) suggList.hidden = true;
          addSearchHistory(term);
          window.location.href = buildSearchUrl({ q: term });
        });
        suggList.appendChild(li);
      });
      suggList.hidden = false;
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (suggList) suggList.hidden = true;
      const q = input.value.trim();
      if (!q) return;
      addSearchHistory(q);
      window.location.href = buildSearchUrl({ q });
    });

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { showHistSugg(); return; }
      timer = setTimeout(async () => {
        const items = await fetchSugg(q);
        showSugg(items, input.value.trim());
      }, 280);
    });

    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (q) {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const items = await fetchSugg(q);
          showSugg(items, input.value.trim());
        }, 100);
      } else {
        showHistSugg();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { if (suggList) suggList.hidden = true; }, 150);
    });

    input.addEventListener('keydown', e => {
      if (!suggList) return;
      const items = suggList.querySelectorAll('.suggestion-item');
      const active = suggList.querySelector('.suggestion-item.active');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = active ? active.nextElementSibling : items[0];
        if (active) active.classList.remove('active');
        if (next) { next.classList.add('active'); input.value = next.querySelector('.suggest-text').textContent; }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = active ? active.previousElementSibling : items[items.length - 1];
        if (active) active.classList.remove('active');
        if (prev) { prev.classList.add('active'); input.value = prev.querySelector('.suggest-text').textContent; }
      } else if (e.key === 'Escape') {
        if (suggList) suggList.hidden = true;
      }
    });
  }

  async function loadTrending() {
    const gen = ++loadGen;
    const grid = document.getElementById('recommendGrid');
    if (!grid) return;
    vyHideLoadMore(grid);
    detachShelf();
    grid.innerHTML = '';
    for (let i = 0; i < 20; i++) grid.appendChild(createSkeletonCard());
    try {
      const raw = await fetchMain('/api/trending?region=JP');
      const data = Array.isArray(raw) ? raw : (raw.results || raw.videos || []);
      if (gen !== loadGen) return;
      grid.innerHTML = '';
      if (!data.length) {
        grid.innerHTML = `<div class="empty-state"><p>急上昇の動画が見つかりませんでした。</p></div>`;
        return;
      }
      renderCards(grid, data);
    } catch {
      if (gen !== loadGen) return;
      grid.innerHTML = `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>急上昇の動画をうまく取れませんでした。</p></div>`;
    }
  }

  /* ── カテゴリ (チップ) ─────────────────────────────── */
  let currentChip = '';

  function watchedSet() {
    const set = new Set();
    try { ((typeof getHistory === 'function') ? getHistory() : []).forEach(v => v && v.videoId && set.add(v.videoId)); } catch (_) {}
    return set;
  }
  function isWatched(id, set) {
    if (set.has(id)) return true;
    try { return !!(window.VyRank && VyRank.isWatched(id)); } catch (_) { return false; }
  }

  const _shelfEl = document.getElementById('homeShortsShelf');
  const _shelfRow = document.getElementById('homeShortsRow');
  function renderShortsShelf(shorts) {
    const shelf = _shelfEl;
    const row = _shelfRow;
    if (!shelf || !row) return;
    const list = (shorts || []).filter(v => v && v.videoId).slice(0, 12);
    if (list.length < 3) { shelf.hidden = true; row.innerHTML = ''; return; }
    row.innerHTML = '';
    const ids = list.map(v => v.videoId).join(',');
    list.forEach(v => {
      const a = document.createElement('a');
      a.className = 'vy-hs-card';
      a.href = `/shorts/${v.videoId}?list=${encodeURIComponent(ids)}`;
      const views = formatViews(v.viewCount) || (v.viewCountText || '');
      a.innerHTML = `
        <div class="vy-hs-thumb"><img src="${wsrv('https://i.ytimg.com/vi/' + v.videoId + '/oardefault.jpg', 360)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${wsrv('https://i.ytimg.com/vi/' + v.videoId + '/hqdefault.jpg', 360)}'" /></div>
        <div class="vy-hs-title"></div>
        <div class="vy-hs-views"></div>`;
      a.querySelector('.vy-hs-title').textContent = v.title || '';
      a.querySelector('.vy-hs-views').textContent = views;
      row.appendChild(a);
    });
    shelf.hidden = false;
    placeShelf();
  }
  // ショートの棚は 2 段目のあと (本家と同じ位置) に差し込む
  function placeShelf() {
    const shelf = _shelfEl, grid = document.getElementById('recommendGrid');
    if (!shelf || shelf.hidden || !grid) return;
    const cards = [...grid.children].filter(c => c !== shelf && !c.classList.contains('vy-home-shorts'));
    // グリッドにまだスケルトン (読み込み中) がある間は棚を配置しない
    if (!cards.length || cards[0].classList.contains('skeleton-card') || cards[0].querySelector('.skeleton')) {
      return;
    }
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    const at = Math.min(cards.length, cols * 2);
    const ref = cards[at] || null;
    if (ref) grid.insertBefore(shelf, ref); else grid.appendChild(shelf);
  }
  window.addEventListener('resize', () => { clearTimeout(window._vyShelfT); window._vyShelfT = setTimeout(placeShelf, 200); });
  function hideShortsShelf() { renderShortsShelf([]); }
  function detachShelf() {
    const grid = document.getElementById('recommendGrid');
    if (_shelfEl && grid && _shelfEl.parentNode === grid) grid.parentNode.insertBefore(_shelfEl, grid);
  }

  async function loadCategory(cat) {
    const gen = ++loadGen;
    const grid = document.getElementById('recommendGrid');
    if (!grid) return;
    vyHideLoadMore(grid);
    hideShortsShelf();
    grid.innerHTML = '';
    for (let i = 0; i < 20; i++) grid.appendChild(createSkeletonCard());
    const get = async (cont) => {
      const u = `/api/category-feed?cat=${encodeURIComponent(cat)}` + (cont ? `&cont=${encodeURIComponent(cont)}` : '');
      const r = await fetch(u, { signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    };
    let data;
    try { data = await get(''); } catch (e) { data = null; }
    if (gen !== loadGen) return;
    const items = (data && data.items) || [];
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><p>動画をうまく取れませんでした。もう一度カテゴリを押してください。</p></div>`;
      return;
    }
    grid.innerHTML = '';
    const seen = new Set();
    const add = list => vyAppendCards(grid, list.filter(v => { if (!v.videoId || seen.has(v.videoId)) return false; seen.add(v.videoId); return true; }));
    add(items);
    renderShortsShelf(data.shorts);
    placeShelf();
    let cont = data.cont || '';
    vyLoadMore(grid, async () => {
      if (!cont) return 0;
      let d;
      try { d = await get(cont); } catch { return -1; }
      if (gen !== loadGen) return 0;
      cont = d.cont || '';
      const n = add(d.items || []);
      return n || (cont ? 1 : 0);
    });
  }

  async function loadHomeShorts() {
    const g = loadGen + 1;
    let terms = [];
    try { terms = (getSearchHistory() || []).slice(0, 5); } catch (_) {}
    const base = ['おもしろ', '猫', 'ゲーム', '料理', 'ダンス', '音楽'];
    const q = (terms.length ? terms[Math.floor(Math.random() * terms.length)] : base[Math.floor(Math.random() * base.length)]);
    try {
      const r = await fetch(`/api/innertube-shorts-search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(15000) });
      const d = r.ok ? await r.json() : null;
      if (currentChip !== '' || loadGen > g) return;
      // メイングリッドに本物の動画カードがある (スケルトンでない) 場合のみショート棚を表示
      const grid = document.getElementById('recommendGrid');
      if (grid) {
        const firstCard = grid.querySelector('a[href*="/watch?v="], .video-card');
        if (!firstCard || grid.querySelector('.skeleton-card, .skeleton')) return;
      }
      renderShortsShelf((d && d.items) || []);
    } catch (_) {}
  }

  async function loadUnwatched() {
    // おすすめから視聴済みの動画を除いて表示
    await loadRecommended({ unwatched: true });
  }

  function loadChip(chip) {
    currentChip = chip;
    try {
      const u = new URL(location.href);
      if (chip) u.searchParams.set('chip', chip); else u.searchParams.delete('chip');
      history.replaceState(null, '', u.pathname + u.search);
    } catch (_) {}
    if (chip !== '' && chip !== 'unwatched') hideShortsShelf();
    if (chip === '') { return loadRecommended().then(() => loadHomeShorts()); }
    if (chip === 'unwatched') { hideShortsShelf(); return loadUnwatched(); }
    if (chip === 'trending') { hideShortsShelf(); return loadTrending(); }
    return loadCategory(chip);
  }

  function initChips() {
    const sc = document.getElementById('homeChips');
    if (!sc) return;
    const prev = document.getElementById('homeChipPrev');
    const next = document.getElementById('homeChipNext');
    const upd = () => {
      const max = sc.scrollWidth - sc.clientWidth;
      if (prev) prev.hidden = sc.scrollLeft <= 4;
      if (next) next.hidden = sc.scrollLeft >= max - 4;
    };
    sc.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    if (prev) prev.addEventListener('click', () => sc.scrollBy({ left: -sc.clientWidth * 0.7, behavior: 'smooth' }));
    if (next) next.addEventListener('click', () => sc.scrollBy({ left: sc.clientWidth * 0.7, behavior: 'smooth' }));
    sc.addEventListener('click', e => {
      const b = e.target.closest('.ys-chip');
      if (!b) return;
      const chip = b.dataset.chip || '';
      if (chip === currentChip && chip !== '') return;
      sc.querySelectorAll('.ys-chip').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
      b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      loadChip(chip);
    });
    // URL の ?chip= を復元
    const init = new URLSearchParams(location.search).get('chip') || '';
    const btn = [...sc.querySelectorAll('.ys-chip')].find(x => (x.dataset.chip || '') === init);
    if (btn && init) {
      sc.querySelectorAll('.ys-chip').forEach(x => x.classList.toggle('active', x === btn));
      setTimeout(() => btn.scrollIntoView({ block: 'nearest', inline: 'center' }), 0);
    }
    setTimeout(upd, 50);
    return btn ? init : '';
  }

  /* ── 引っ張って更新 ────────────────────────────── */
  // 確定して指を離したときだけ、今の一覧を残したまま裏で取り直し、届いたら一度に差し替える
  // (先頭に足したり骨組みに戻したりしないので、更新中に並びが崩れない)
  if (window.VyPullRefresh) {
    VyPullRefresh.attach({
      isEnabled: () => !document.querySelector('.vy-modal.open, dialog[open]'),
      onRefresh: () => (currentChip === '' ? loadRecommended({ refresh: true }) : loadChip(currentChip)),
    });
  }

  initHeroSearch();
  initHeaderSearch();
  const firstChip = initChips() || '';
  loadChip(firstChip);
})();
