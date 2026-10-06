;(() => {
  if (!document.body.classList.contains('page-history')) return;
  document.addEventListener('DOMContentLoaded', () => {
    initHeaderSearch();
    renderHistoryTabs();
    renderHistory();
    renderShortsHistory();
  });

  /* ===== TABS ===== */
  function renderHistoryTabs() {
    document.querySelectorAll('.lib-tab[data-htab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.htab;
        document.querySelectorAll('.lib-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('histPanel').hidden = tab !== 'long';
        document.getElementById('shortsHistPanel').hidden = tab !== 'shorts';
      });
    });
  }

  /* ===== HISTORY ===== */
  let _histQuery = '';
  function _histDayStart(offsetDays) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offsetDays);
    return d.getTime();
  }
  // 再生位置は内部 (続きから再生) でのみ使い、履歴の画面には一切表示しない
  function _histCard(v, positions, missingIcons) {
    const card = createVideoCard(v);
    if (!card) return null;
    card.classList.add('vh-card');
    const info = document.createElement('div');
    info.className = 'vh-info';
    const parts = [];
    const cnt = Number(v.count) || 1;
    if (cnt > 1) parts.push(`<span class="vh-count">${cnt}回視聴</span>`);
    parts.push(`<span class="vh-date">${escapeHtml(formatLibDate(v.watchedAt))}</span>`);
    info.innerHTML = parts.join('<span class="vh-dot" aria-hidden="true">·</span>');
    card.appendChild(info);
    card.appendChild(_delBtn(() => {
      removeHistoryItem(v.videoId);
      renderHistory();
      renderShortsHistory();
    }));
    if (!v.authorThumbnails && v.authorId) missingIcons.push({ card, authorId: v.authorId });
    return card;
  }
  function _delBtn(onDel) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'vh-del';
    del.title = '履歴から削除';
    del.setAttribute('aria-label', '履歴から削除');
    del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
    del.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      onDel();
      if (typeof showCopyToast === 'function') showCopyToast('履歴から削除しました');
    });
    return del;
  }
  // ロング動画の履歴に紛れ込んだショート (isShort / 短い長さ) はショート側で表示する
  function _isShortEntry(v) {
    return !!v && (v.isShort === true || v.type === 'short' || (typeof isShortVideo === 'function' && isShortVideo(v)));
  }
  function getLongHistory() {
    return getHistory().filter(v => v && v.videoId && !_isShortEntry(v));
  }
  function getMergedShortsHistory() {
    const seen = new Set();
    const out = [];
    getShortsHistory().concat(getHistory().filter(_isShortEntry)).forEach(v => {
      if (!v || !v.videoId || seen.has(v.videoId)) return;
      seen.add(v.videoId);
      out.push(v);
    });
    return out.sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
  }
  function _histSection(title, list, positions, missingIcons, opts = {}) {
    if (!list.length) return null;
    const sec = document.createElement('section');
    sec.className = 'vh-sec' + (opts.shelf ? ' vh-shelf' : '');
    sec.innerHTML = `<h3 class="vh-sec-title">${title}<span class="vh-sec-n">${list.length}</span></h3><div class="video-grid vh-grid"></div>`;
    const grid = sec.querySelector('.vh-grid');
    list.forEach(v => { const c = _histCard(v, positions, missingIcons); if (c) grid.appendChild(c); });
    return sec;
  }
  function renderHistory() {
    const hist = getLongHistory();
    const grid = document.getElementById('histGrid');
    const empty = document.getElementById('histEmpty');
    const count = document.getElementById('histCount');
    const toolbar = document.getElementById('histToolbar');
    const clearBtn = document.getElementById('clearHistBtn');
    const searchInput = document.getElementById('histSearchInput');

    count.textContent = hist.length > 0 ? hist.length : '';

    if (searchInput && !searchInput._vyBound) {
      searchInput._vyBound = true;
      let t = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { _histQuery = searchInput.value.trim(); renderHistory(); }, 150);
      });
    }
    if (clearBtn) clearBtn.onclick = () => {
      if (confirm('視聴履歴をすべて削除しますか？\n\n履歴をもとにしたおすすめ・関連動画・視聴傾向・続きから再生の位置・検索履歴もまとめて初期化されます。')) {
        clearAllWatchData();
        _histQuery = '';
        if (searchInput) searchInput.value = '';
        renderHistory();
        if (typeof renderShortsHistory === 'function') renderShortsHistory();
        if (typeof showCopyToast === 'function') showCopyToast('視聴履歴とおすすめの学習データをすべて削除しました');
      }
    };

    if (!hist.length) {
      empty.hidden = false;
      toolbar.hidden = true;
      grid.innerHTML = '';
      return;
    }
    empty.hidden = true;
    toolbar.hidden = false;
    grid.innerHTML = '';

    const positions = {};
    const missingIcons = [];

    if (_histQuery) {
      const words = _histQuery.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = hist.filter(v => {
        const hay = `${v.title || ''} ${v.author || ''}`.toLowerCase();
        return words.every(w => hay.includes(w));
      });
      if (!hits.length) {
        grid.innerHTML = `<div class="vh-none">「${escapeHtml(_histQuery)}」に一致する履歴はありません</div>`;
        return;
      }
      const sec = _histSection(`「${escapeHtml(_histQuery)}」の検索結果`, hits, positions, missingIcons);
      if (sec) grid.appendChild(sec);
      if (missingIcons.length) fillMissingIcons(missingIcons);
      return;
    }

    const today = _histDayStart(0), yesterday = _histDayStart(1);
    const now = Date.now();

    const frequent = hist
      .map(v => ({ v, n: (Array.isArray(v.views) ? v.views : [v.watchedAt]).filter(ts => now - ts < 14 * 86400000).length }))
      .filter(x => x.n >= 2)
      .sort((a, b) => b.n - a.n || (b.v.watchedAt - a.v.watchedAt))
      .slice(0, 8).map(x => x.v);
    const todayList = hist.filter(v => (v.watchedAt || 0) >= today);
    const yList = hist.filter(v => (v.watchedAt || 0) >= yesterday && (v.watchedAt || 0) < today);
    const older = hist.filter(v => (v.watchedAt || 0) < yesterday);

    [
      _histSection('最近よく見ている動画', frequent, positions, missingIcons, { shelf: true }),
      _histSection('今日見た動画', todayList, positions, missingIcons),
      _histSection('昨日見た動画', yList, positions, missingIcons),
      _histSection('それ以前', older.slice(0, 200), positions, missingIcons),
    ].forEach(sec => { if (sec) grid.appendChild(sec); });
    if (missingIcons.length > 0) fillMissingIcons(missingIcons);
  }
  window.addEventListener('storage', (e) => {
    if (e.key === 'vyslo_history_reset' || e.key === 'chocotube_history') { try { renderHistory(); } catch {} }
  });

  /* ===== SHORTS HISTORY ===== */
  function renderShortsHistory() {
    const hist = getMergedShortsHistory();
    const grid = document.getElementById('shortsHistGrid');
    const empty = document.getElementById('shortsHistEmpty');
    const count = document.getElementById('shortsHistCount');
    const toolbar = document.getElementById('shortsHistToolbar');
    const clearBtn = document.getElementById('clearShortsHistBtn');

    count.textContent = hist.length > 0 ? hist.length : '';

    if (clearBtn) clearBtn.onclick = () => {
      if (confirm('ショートの視聴履歴をすべて削除しますか？')) {
        clearShortsHistory();
        // ロング動画の履歴に入っていたショートも消す
        try {
          const rest = getHistory().filter(v => !_isShortEntry(v));
          localStorage.setItem('chocotube_history', JSON.stringify(rest));
        } catch {}
        renderShortsHistory();
        renderHistory();
      }
    };

    if (!hist.length) {
      empty.hidden = false;
      toolbar.hidden = true;
      grid.innerHTML = '';
      return;
    }
    empty.hidden = true;
    toolbar.hidden = false;
    grid.innerHTML = '';

    // 通常のショート一覧と同じカード (9:16 サムネイル / タイトル / チャンネル)
    const frag = document.createDocumentFragment();
    hist.forEach(v => {
      const item = document.createElement('div');
      item.className = 'vh-short';
      const card = createShortsCard(v);
      const meta = document.createElement('div');
      meta.className = 'vh-short-meta';
      meta.innerHTML = `${v.author ? `<span class="vh-short-ch">${escapeHtml(v.author)}</span>` : ''}<span class="vh-short-date">${escapeHtml(formatLibDate(v.watchedAt))}</span>`;
      // 再生回数の行はチャンネル名・視聴日時に置き換える
      const views = card.querySelector('.short-card-views');
      if (views) views.remove();
      card.appendChild(meta);
      item.appendChild(card);
      item.appendChild(_delBtn(() => {
        try {
          localStorage.setItem('chocotube_shorts_history', JSON.stringify(getShortsHistory().filter(h => h.videoId !== v.videoId)));
        } catch {}
        if (_isShortEntry(v)) removeHistoryItem(v.videoId);
        renderShortsHistory();
      }));
      frag.appendChild(item);
    });
    grid.appendChild(frag);
  }

  /* ===== HELPERS ===== */
  function formatLibDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'たった今';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}時間前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}日前`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
})();
