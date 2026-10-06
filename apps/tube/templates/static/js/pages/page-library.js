;(() => {
  if (!document.body.classList.contains('page-library')) return;
document.addEventListener('DOMContentLoaded', () => {
  initHeaderSearch();
  renderTabs();
  (function(){ const t = new URLSearchParams(location.search).get('tab'); if (t) { const b = document.querySelector('.lib-tab[data-tab="' + t + '"]'); if (b) b.click(); } })();
  renderPlaylistList();
  renderFavorites();
  initNewPlaylistModal();
});

/* ===== TABS ===== */
function renderTabs() {
  document.querySelectorAll('.lib-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.lib-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('plPanel').hidden = tab !== 'playlists';
      document.getElementById('favPanel').hidden = tab !== 'favorites';
    });
  });
}

/* ===== PLAYLISTS ===== */
let currentPlId = null;

function renderPlaylistList() {
  const pls = getPlaylists();
  const grid = document.getElementById('plGrid');
  const empty = document.getElementById('plEmpty');
  const count = document.getElementById('plCount');

  count.textContent = pls.length > 0 ? pls.length : '';

  document.getElementById('plListView').hidden = false;
  document.getElementById('plDetailView').hidden = true;

  if (!pls.length) {
    empty.hidden = false;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  grid.innerHTML = '';

  pls.forEach(pl => {
    const thumb = pl.videos.length > 0 ? getThumbnailUrl(pl.videos[0].videoId) : null;
    const card = document.createElement('div');
    card.className = 'lib-pl-card';
    card.innerHTML = `
      <div class="lib-pl-card-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />`
          : `<div class="lib-pl-card-thumb-empty"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>`
        }
        <div class="lib-pl-card-count">${pl.videos.length}本</div>
      </div>
      <div class="lib-pl-card-info">
        <div class="lib-pl-card-name">${escapeHtml(pl.name)}</div>
        <div class="lib-pl-card-date">作成日 ${formatLibDate(pl.createdAt)}</div>
      </div>
    `;
    card.addEventListener('click', () => openPlaylistDetail(pl.id));
    grid.appendChild(card);
  });
}

function openPlaylistDetail(id) {
  currentPlId = id;
  const pl = getPlaylist(id);
  if (!pl) return;

  document.getElementById('plListView').hidden = true;
  document.getElementById('plDetailView').hidden = false;
  document.getElementById('plDetailName').textContent = pl.name;
  document.getElementById('plDetailCount').textContent = `${pl.videos.length}本の動画`;

  document.getElementById('plBackBtn').onclick = () => {
    currentPlId = null;
    renderPlaylistList();
  };

  document.getElementById('plRenameBtn').onclick = () => {
    const newName = prompt('新しいリストの名前を入力してください', pl.name);
    if (newName && newName.trim()) {
      renamePlaylist(id, newName.trim());
      document.getElementById('plDetailName').textContent = newName.trim();
      renderPlaylistList();
    }
  };

  document.getElementById('plDeleteBtn').onclick = () => {
    if (confirm(`「${pl.name}」を削除しますか？`)) {
      deletePlaylist(id);
      currentPlId = null;
      renderPlaylistList();
    }
  };

  renderPlaylistDetail(id);
}

function renderPlaylistDetail(id) {
  const pl = getPlaylist(id);
  const listEl = document.getElementById('plDetailList');
  listEl.innerHTML = '';

  if (!pl || !pl.videos.length) {
    listEl.innerHTML = `<div class="lib-empty" style="padding:3rem 0">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      <p>動画がありません</p>
      <p class="lib-empty-hint">動画ページの「＋ プレイリスト」から追加できます</p>
    </div>`;
    document.getElementById('plDetailCount').textContent = '0本の動画';
    return;
  }

  document.getElementById('plDetailCount').textContent = `${pl.videos.length}本の動画`;

  pl.videos.forEach((v, idx) => {
    const thumb = getThumbnailUrl(v.videoId);
    const dur = formatDuration(v.lengthSeconds);
    const item = document.createElement('div');
    item.className = 'lib-pl-item';
    item.innerHTML = `
      <span class="lib-pl-item-num">${idx + 1}</span>
      <a class="lib-pl-item-link" href="/watch?v=${v.videoId}&list=${encodeURIComponent(id)}&index=${idx}">
        <div class="lib-pl-item-thumb-wrap">
          <img class="lib-pl-item-thumb" src="${thumb}" alt="" loading="lazy" onload="this.classList.add('loaded')" />
          ${dur ? `<span class="lib-pl-item-dur">${dur}</span>` : ''}
        </div>
        <div class="lib-pl-item-info">
          <div class="lib-pl-item-title">${escapeHtml(v.title || '')}</div>
          <div class="lib-pl-item-ch">${escapeHtml(v.author || '')}</div>
        </div>
      </a>
      <button class="lib-pl-item-remove" data-vid="${escapeHtml(v.videoId)}" title="プレイリストから削除">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    item.querySelector('.lib-pl-item-remove').addEventListener('click', () => {
      removeVideoFromPlaylist(id, v.videoId);
      renderPlaylistDetail(id);
    });
    listEl.appendChild(item);
  });
}

/* ===== NEW PLAYLIST MODAL ===== */
function initNewPlaylistModal() {
  const modal = document.getElementById('newPlModal');
  const input = document.getElementById('newPlInput');
  const okBtn = document.getElementById('newPlOk');
  const cancelBtn = document.getElementById('newPlCancel');

  document.getElementById('newPlBtn').addEventListener('click', () => {
    input.value = '';
    modal.hidden = false;
    setTimeout(() => input.focus(), 50);
  });

  function closeModal() { modal.hidden = true; }

  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  okBtn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    createPlaylist(name);
    closeModal();
    renderPlaylistList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') okBtn.click();
    if (e.key === 'Escape') closeModal();
  });
}

/* ===== FAVORITES ===== */
let currentFavTab = 'all';

function initFavSubtabs() {
  document.querySelectorAll('.lib-fav-subtab').forEach(btn => {
    if (btn.dataset.vyBound) return;
    btn.dataset.vyBound = '1';
    btn.addEventListener('click', () => {
      currentFavTab = btn.dataset.favtab;
      document.querySelectorAll('.lib-fav-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('favAllPanel').hidden = currentFavTab !== 'all';
      document.getElementById('favVideosPanel').hidden = currentFavTab !== 'videos';
      document.getElementById('favPlPanel').hidden = currentFavTab !== 'playlists';
      document.getElementById('favMixPanel').hidden = currentFavTab !== 'mixes';
    });
  });
}

function renderFavorites() {
  initFavSubtabs();
  renderFavVideos();
  renderFavPlaylists();
  renderFavMixes();
  renderFavAll();

  const total = getFavorites().length + getFavoritePlaylists().length + getFavoriteMixes().length;
  document.getElementById('favCount').textContent = total > 0 ? total : '';
}

function renderFavVideos() {
  const favs = getFavorites();
  const grid = document.getElementById('favGrid');
  const empty = document.getElementById('favEmpty');
  const toolbar = document.getElementById('favToolbar');
  const clearBtn = document.getElementById('clearFavBtn');

  if (!favs.length) {
    empty.hidden = false;
    toolbar.hidden = true;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  toolbar.hidden = false;
  grid.innerHTML = '';

  const missingIcons = [];
  favs.forEach(v => {
    const card = createVideoCard(v);
    if (card) {
      const wrap = document.createElement('div');
      wrap.className = 'fav-card-wrap';
      const delBtn = document.createElement('button');
      delBtn.className = 'fav-del-btn';
      delBtn.title = 'お気に入りから削除';
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      delBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeFavorite(v.videoId);
        rerenderFavs();
      });
      wrap.appendChild(card);
      wrap.appendChild(delBtn);
      grid.appendChild(wrap);
      if (!v.authorThumbnails && v.authorId) {
        missingIcons.push({ card, authorId: v.authorId });
      }
    }
  });
  if (missingIcons.length > 0) fillMissingIcons(missingIcons);

  clearBtn.onclick = () => {
    if (confirm('お気に入りの動画をすべて削除しますか？')) {
      localStorage.removeItem('chocotube_favorites');
      rerenderFavs();
    }
  };
}

function renderFavPlaylists() {
  const favs = getFavoritePlaylists();
  const grid = document.getElementById('favPlGrid');
  const empty = document.getElementById('favPlEmpty');
  const toolbar = document.getElementById('favPlToolbar');
  const clearBtn = document.getElementById('clearFavPlBtn');

  if (!favs.length) {
    empty.hidden = false;
    toolbar.hidden = true;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  toolbar.hidden = false;
  grid.innerHTML = '';

  favs.forEach(pl => {
    const card = document.createElement('a');
    card.className = 'lib-pl-card fav-pl-card';
    card.href = `/playlist?list=${encodeURIComponent(pl.playlistId)}`;
    const thumb = pl.thumbnail || '';
    card.innerHTML = `
      <div class="lib-pl-card-thumb">
        ${thumb
          ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" onload="this.classList.add('loaded')" />`
          : `<div class="lib-pl-card-thumb-empty"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>`
        }
        ${pl.videoCount != null ? `<div class="lib-pl-card-count">${pl.videoCount}本</div>` : ''}
      </div>
      <div class="lib-pl-card-info">
        <div class="lib-pl-card-name">${escapeHtml(pl.title || '')}</div>
        ${pl.author ? `<div class="lib-pl-card-date">${escapeHtml(pl.author)}</div>` : ''}
        <div class="lib-pl-card-date">追加日 ${formatLibDate(pl.favoritedAt)}</div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.className = 'fav-card-wrap';
    const delBtn = document.createElement('button');
    delBtn.className = 'fav-del-btn';
    delBtn.title = 'お気に入りから削除';
    delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeFavoritePlaylist(pl.playlistId);
      rerenderFavs();
    });
    wrap.appendChild(card);
    wrap.appendChild(delBtn);
    grid.appendChild(wrap);
  });

  clearBtn.onclick = () => {
    if (confirm('お気に入りのプレイリストをすべて削除しますか？')) {
      localStorage.removeItem('chocotube_fav_playlists');
      rerenderFavs();
    }
  };
}

function renderFavMixes() {
  const favs = getFavoriteMixes();
  const grid = document.getElementById('favMixGrid');
  const empty = document.getElementById('favMixEmpty');
  const toolbar = document.getElementById('favMixToolbar');
  const clearBtn = document.getElementById('clearFavMixBtn');

  if (!favs.length) {
    empty.hidden = false;
    toolbar.hidden = true;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;
  toolbar.hidden = false;
  grid.innerHTML = '';

  favs.forEach(mix => {
    const card = document.createElement('a');
    card.className = 'lib-pl-card fav-pl-card';
    card.href = `/mix?id=${encodeURIComponent(mix.mixId)}`;
    const thumb = mix.thumbnail || '';
    card.innerHTML = `
      <div class="lib-pl-card-thumb">
        ${thumb
          ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" onload="this.classList.add('loaded')" />`
          : `<div class="lib-pl-card-thumb-empty"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg></div>`
        }
        ${mix.videoCount != null ? `<div class="lib-pl-card-count">${mix.videoCount}本</div>` : ''}
      </div>
      <div class="lib-pl-card-info">
        <div class="lib-pl-card-name">${escapeHtml(mix.title || '')}</div>
        <div class="lib-pl-card-date">追加日 ${formatLibDate(mix.favoritedAt)}</div>
      </div>
    `;
    const wrap = document.createElement('div');
    wrap.className = 'fav-card-wrap';
    const delBtn = document.createElement('button');
    delBtn.className = 'fav-del-btn';
    delBtn.title = 'お気に入りから削除';
    delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    delBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeFavoriteMix(mix.mixId);
      rerenderFavs();
    });
    wrap.appendChild(card);
    wrap.appendChild(delBtn);
    grid.appendChild(wrap);
  });

  clearBtn.onclick = () => {
    if (confirm('お気に入りのミックスをすべて削除しますか？')) {
      localStorage.removeItem('chocotube_fav_mixes');
      rerenderFavs();
    }
  };
}

function updateFavCount() {
  const total = getFavorites().length + getFavoritePlaylists().length + getFavoriteMixes().length;
  document.getElementById('favCount').textContent = total > 0 ? total : '';
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

function rerenderFavs() {
  renderFavVideos();
  renderFavPlaylists();
  renderFavMixes();
  renderFavAll();
  updateFavCount();
}

// 「すべて」: 動画・プレイリスト・ミックスを 1 つのページにまとめて表示する
// (各タブで作ったカードをそのまま使うので、見た目・削除の動きは各タブと同じ)
function renderFavAll() {
  const wrap = document.getElementById('favAllSections');
  const empty = document.getElementById('favAllEmpty');
  if (!wrap || !empty) return;
  wrap.innerHTML = '';
  const groups = [
    { key: 'videos', title: '動画', grid: 'favGrid', n: getFavorites().length, cls: 'video-grid' },
    { key: 'playlists', title: 'プレイリスト', grid: 'favPlGrid', n: getFavoritePlaylists().length, cls: 'lib-pl-grid' },
    { key: 'mixes', title: 'ミックス', grid: 'favMixGrid', n: getFavoriteMixes().length, cls: 'lib-pl-grid' },
  ];
  const total = groups.reduce((a, g) => a + g.n, 0);
  empty.hidden = total > 0;
  if (!total) return;
  groups.forEach(g => {
    if (!g.n) return;
    const src = document.getElementById(g.grid);
    if (!src) return;
    const sec = document.createElement('section');
    sec.className = 'fav-all-sec';
    sec.innerHTML = `<div class="fav-all-head"><h3 class="fav-all-title">${g.title}<span class="fav-all-n">${g.n}</span></h3><button type="button" class="fav-all-more">すべて表示</button></div>`;
    const grid = document.createElement('div');
    grid.className = g.cls + ' fav-all-grid';
    if (g.key === 'videos') {
      // 動画カードは操作 (メニュー等) のため新しく作る
      const missing = [];
      getFavorites().forEach(v => {
        const card = createVideoCard(v);
        if (!card) return;
        const w = document.createElement('div');
        w.className = 'fav-card-wrap';
        const delBtn = document.createElement('button');
        delBtn.className = 'fav-del-btn';
        delBtn.title = 'お気に入りから削除';
        delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        delBtn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          removeFavorite(v.videoId);
          rerenderFavs();
        });
        w.appendChild(card);
        w.appendChild(delBtn);
        grid.appendChild(w);
        if (!v.authorThumbnails && v.authorId) missing.push({ card, authorId: v.authorId });
      });
      if (missing.length && typeof fillMissingIcons === 'function') fillMissingIcons(missing);
    } else
    // プレイリスト・ミックスは各タブの要素を複製し、削除ボタンは元の要素のボタンを押す形でつなぐ
    Array.from(src.children).forEach((item, i) => {
      const c = item.cloneNode(true);
      const del = c.querySelector('.fav-del-btn');
      if (del) del.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const orig = src.children[i] && src.children[i].querySelector('.fav-del-btn');
        if (orig) orig.click();
      });
      grid.appendChild(c);
    });
    sec.appendChild(grid);
    sec.querySelector('.fav-all-more').addEventListener('click', () => {
      const b = document.querySelector(`.lib-fav-subtab[data-favtab="${g.key}"]`);
      if (b) b.click();
    });
    wrap.appendChild(sec);
  });
}

})();
