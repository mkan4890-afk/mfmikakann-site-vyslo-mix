/* ===== LIBRARY: Subscriptions & History ===== */

const LIB_SUBS_KEY = 'chocotube_subs';
const LIB_HIST_KEY = 'chocotube_history';
const LIB_HIST_MAX = 1000;

const SEARCH_HIST_KEY = 'chocotube_search_history';
const SEARCH_HIST_MAX = 20;

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem(SEARCH_HIST_KEY) || '[]'); } catch { return []; }
}

function addSearchHistory(q) {
  if (!q || !q.trim()) return;
  const term = q.trim();
  let hist = getSearchHistory().filter(h => h !== term);
  hist.unshift(term);
  if (hist.length > SEARCH_HIST_MAX) hist.length = SEARCH_HIST_MAX;
  localStorage.setItem(SEARCH_HIST_KEY, JSON.stringify(hist));
}

function clearSearchHistory() {
  localStorage.removeItem(SEARCH_HIST_KEY);
}

function getSubscriptions() {
  try { return JSON.parse(localStorage.getItem(LIB_SUBS_KEY) || '[]'); } catch { return []; }
}

function isSubscribed(authorId) {
  return getSubscriptions().some(s => s.authorId === authorId);
}

function toggleSubscription(channel) {
  const subs = getSubscriptions();
  const idx = subs.findIndex(s => s.authorId === channel.authorId);
  if (idx >= 0) {
    subs.splice(idx, 1);
    localStorage.setItem(LIB_SUBS_KEY, JSON.stringify(subs));
    return false;
  } else {
    subs.unshift({ ...channel, subscribedAt: Date.now() });
    localStorage.setItem(LIB_SUBS_KEY, JSON.stringify(subs));
    return true;
  }
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem(LIB_HIST_KEY) || '[]'); } catch { return []; }
}

function addHistory(video) {
  const all = getHistory();
  const prev = all.find(h => h.videoId === video.videoId);
  const hist = all.filter(h => h.videoId !== video.videoId);
  const now = Date.now();
  // 何回見たか (同じ動画を 10 分以内に開き直しても 1 回と数える)
  let views = (prev && Array.isArray(prev.views)) ? prev.views.slice(-29) : (prev && prev.watchedAt ? [prev.watchedAt] : []);
  if (!views.length || now - views[views.length - 1] > 10 * 60000) views.push(now);
  hist.unshift({ ...video, watchedAt: now, views, count: Math.max(views.length, (prev && prev.count) || 0, 1) });
  if (hist.length > LIB_HIST_MAX) hist.length = LIB_HIST_MAX;
  localStorage.setItem(LIB_HIST_KEY, JSON.stringify(hist));
}

function removeHistoryItem(videoId) {
  const hist = getHistory().filter(h => h.videoId !== videoId);
  localStorage.setItem(LIB_HIST_KEY, JSON.stringify(hist));
  if (typeof clearSavedPosition === 'function') clearSavedPosition(videoId);
  // この動画を元にした並び替えの学習も消す
  try {
    ['vyslo_search_clicks', 'vyslo_search_impressions'].forEach(k => {
      const m = JSON.parse(localStorage.getItem(k) || '{}');
      if (m && m[videoId]) { delete m[videoId]; localStorage.setItem(k, JSON.stringify(m)); }
    });
  } catch {}
  if (window.VyRank && VyRank.resetProfile) VyRank.resetProfile();
}

function clearHistory() {
  localStorage.removeItem(LIB_HIST_KEY);
}

// 視聴履歴の「すべて削除」: 履歴をもとに作られるもの (おすすめ・関連動画・視聴傾向・再生位置・並び替えの学習) もまとめて初期化
function clearAllWatchData() {
  [
    LIB_HIST_KEY,                 // 視聴履歴
    'chocotube_shorts_history',   // ショートの視聴履歴
    'chocotube_positions',        // 続きから再生の位置
    SEARCH_HIST_KEY,              // 検索履歴 (おすすめの元)
    'vyslo_search_impressions',   // 表示回数
    'vyslo_search_clicks',        // 押した動画 (好みの学習)
    'vyslo_search_qimp',          // 検索ごとの表示済み動画
  ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
  ['vyHomeVideoQueue', 'chHomeShortQueue', 'vyslo_mini_state'].forEach(k => { try { sessionStorage.removeItem(k); } catch {} });
  if (window.VyRank && VyRank.resetProfile) VyRank.resetProfile();
  // 開いている他のタブにも知らせる
  try { localStorage.setItem('vyslo_history_reset', String(Date.now())); } catch {}
}

// "222" / "3m42s" / "1h2m3s" → 秒
function vyParseTimeParam(v) {
  if (!v) return 0;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(Number(s));
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}
// 222 → "3分42秒"
function vyFormatJaTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  if (h) return `${h}時間${m}分${ss}秒`;
  if (m) return `${m}分${ss}秒`;
  return `${ss}秒`;
}
function getAllSavedPositions() {
  try { return JSON.parse(localStorage.getItem('chocotube_positions') || '{}') || {}; } catch { return {}; }
}

/* ===== SHORTS HISTORY ===== */
const LIB_SHORTS_HIST_KEY = 'chocotube_shorts_history';
const LIB_SHORTS_HIST_MAX = 500;

function getShortsHistory() {
  try { return JSON.parse(localStorage.getItem(LIB_SHORTS_HIST_KEY) || '[]'); } catch { return []; }
}

function addShortsHistory(video) {
  const hist = getShortsHistory().filter(h => h.videoId !== video.videoId);
  hist.unshift({ ...video, watchedAt: Date.now() });
  if (hist.length > LIB_SHORTS_HIST_MAX) hist.length = LIB_SHORTS_HIST_MAX;
  localStorage.setItem(LIB_SHORTS_HIST_KEY, JSON.stringify(hist));
}

function clearShortsHistory() {
  localStorage.removeItem(LIB_SHORTS_HIST_KEY);
}

/* ===== FAVORITES ===== */

const LIB_FAV_KEY = 'chocotube_favorites';

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(LIB_FAV_KEY) || '[]'); } catch { return []; }
}

function isFavorite(videoId) {
  return getFavorites().some(v => v.videoId === videoId);
}

function toggleFavorite(video) {
  const favs = getFavorites();
  const idx = favs.findIndex(v => v.videoId === video.videoId);
  if (idx >= 0) {
    favs.splice(idx, 1);
    localStorage.setItem(LIB_FAV_KEY, JSON.stringify(favs));
    return false;
  } else {
    favs.unshift({ ...video, favoritedAt: Date.now() });
    localStorage.setItem(LIB_FAV_KEY, JSON.stringify(favs));
    return true;
  }
}

function removeFavorite(videoId) {
  const favs = getFavorites().filter(v => v.videoId !== videoId);
  localStorage.setItem(LIB_FAV_KEY, JSON.stringify(favs));
}

/* ===== FAVORITES: PLAYLISTS ===== */

const LIB_FAV_PL_KEY = 'chocotube_fav_playlists';

function getFavoritePlaylists() {
  try { return JSON.parse(localStorage.getItem(LIB_FAV_PL_KEY) || '[]'); } catch { return []; }
}

function isFavoritePlaylist(playlistId) {
  return getFavoritePlaylists().some(p => p.playlistId === playlistId);
}

function toggleFavoritePlaylist(pl) {
  const favs = getFavoritePlaylists();
  const idx = favs.findIndex(p => p.playlistId === pl.playlistId);
  if (idx >= 0) {
    favs.splice(idx, 1);
    localStorage.setItem(LIB_FAV_PL_KEY, JSON.stringify(favs));
    return false;
  } else {
    favs.unshift({ ...pl, favoritedAt: Date.now() });
    localStorage.setItem(LIB_FAV_PL_KEY, JSON.stringify(favs));
    return true;
  }
}

function removeFavoritePlaylist(playlistId) {
  const favs = getFavoritePlaylists().filter(p => p.playlistId !== playlistId);
  localStorage.setItem(LIB_FAV_PL_KEY, JSON.stringify(favs));
}

/* ===== FAVORITES: MIXES ===== */

const LIB_FAV_MIX_KEY = 'chocotube_fav_mixes';

function getFavoriteMixes() {
  try { return JSON.parse(localStorage.getItem(LIB_FAV_MIX_KEY) || '[]'); } catch { return []; }
}

function isFavoriteMix(mixId) {
  return getFavoriteMixes().some(m => m.mixId === mixId);
}

function toggleFavoriteMix(mix) {
  const favs = getFavoriteMixes();
  const idx = favs.findIndex(m => m.mixId === mix.mixId);
  if (idx >= 0) {
    favs.splice(idx, 1);
    localStorage.setItem(LIB_FAV_MIX_KEY, JSON.stringify(favs));
    return false;
  } else {
    favs.unshift({ ...mix, favoritedAt: Date.now() });
    localStorage.setItem(LIB_FAV_MIX_KEY, JSON.stringify(favs));
    return true;
  }
}

function removeFavoriteMix(mixId) {
  const favs = getFavoriteMixes().filter(m => m.mixId !== mixId);
  localStorage.setItem(LIB_FAV_MIX_KEY, JSON.stringify(favs));
}

/* ===== SETTINGS ===== */

const LIB_SETTINGS_KEY = 'chocotube_settings';

function getSettings() {
  const defaults = {
    defaultSpeed: 1, loop: false, autoplayNext: true, defaultVolume: 100, autoplay: true, savePosition: true,
    searchRegion: 'JP', searchSort: 'relevance', searchDate: '', searchDuration: '',
    searchType: 'all', searchFeatures: '',
    searchIncludeShorts: true, searchSuggestions: true,
    thumbnailMode: 'proxy',
  };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(LIB_SETTINGS_KEY) || '{}') }; }
  catch { return defaults; }
}

function saveSettings(s) {
  localStorage.setItem(LIB_SETTINGS_KEY, JSON.stringify(s));
}

/* ===== PLAYBACK POSITION ===== */

const LIB_POSITIONS_KEY = 'chocotube_positions';
const POSITIONS_TTL = 30 * 24 * 60 * 60 * 1000;

function getSavedPosition(videoId) {
  try {
    const raw = localStorage.getItem(LIB_POSITIONS_KEY);
    if (!raw) return 0;
    const positions = JSON.parse(raw);
    const entry = positions[videoId];
    if (!entry) return 0;
    if (Date.now() - entry.ts > POSITIONS_TTL) return 0;
    return entry.t || 0;
  } catch { return 0; }
}

function savePosition(videoId, time, duration) {
  try {
    const raw = localStorage.getItem(LIB_POSITIONS_KEY);
    const positions = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    Object.keys(positions).forEach(k => {
      if (now - (positions[k].ts || 0) > POSITIONS_TTL) delete positions[k];
    });
    if (time > 5) {
      const prev = positions[videoId] || {};
      const d = (duration && isFinite(duration)) ? Math.floor(duration) : (prev.d || 0);
      positions[videoId] = d ? { t: Math.floor(time), d, ts: now } : { t: Math.floor(time), ts: now };
    } else {
      delete positions[videoId];
    }
    localStorage.setItem(LIB_POSITIONS_KEY, JSON.stringify(positions));
  } catch {}
}

function clearSavedPosition(videoId) {
  try {
    const raw = localStorage.getItem(LIB_POSITIONS_KEY);
    if (!raw) return;
    const positions = JSON.parse(raw);
    delete positions[videoId];
    localStorage.setItem(LIB_POSITIONS_KEY, JSON.stringify(positions));
  } catch {}
}

/* ===== PLAYLISTS ===== */

const LIB_PL_KEY = 'chocotube_playlists';

function getPlaylists() {
  try { return JSON.parse(localStorage.getItem(LIB_PL_KEY) || '[]'); } catch { return []; }
}

function getPlaylist(id) {
  return getPlaylists().find(p => p.id === id) || null;
}

function savePlaylists(pls) {
  localStorage.setItem(LIB_PL_KEY, JSON.stringify(pls));
}

function createPlaylist(name) {
  const pl = { id: 'pl_' + Date.now(), name: name.trim(), createdAt: Date.now(), videos: [] };
  const pls = getPlaylists();
  pls.unshift(pl);
  savePlaylists(pls);
  return pl;
}

function deletePlaylist(id) {
  savePlaylists(getPlaylists().filter(p => p.id !== id));
}

function renamePlaylist(id, name) {
  const pls = getPlaylists();
  const pl = pls.find(p => p.id === id);
  if (pl) { pl.name = name.trim(); savePlaylists(pls); }
}

function addVideoToPlaylist(id, video) {
  const pls = getPlaylists();
  const pl = pls.find(p => p.id === id);
  if (!pl) return;
  if (pl.videos.some(v => v.videoId === video.videoId)) return;
  pl.videos.push({ ...video, addedAt: Date.now() });
  savePlaylists(pls);
}

function removeVideoFromPlaylist(playlistId, videoId) {
  const pls = getPlaylists();
  const pl = pls.find(p => p.id === playlistId);
  if (!pl) return;
  pl.videos = pl.videos.filter(v => v.videoId !== videoId);
  savePlaylists(pls);
}

function isVideoInPlaylist(playlistId, videoId) {
  const pl = getPlaylist(playlistId);
  return pl ? pl.videos.some(v => v.videoId === videoId) : false;
}

function getPlaylistsContaining(videoId) {
  return getPlaylists().filter(p => p.videos.some(v => v.videoId === videoId)).map(p => p.id);
}

/**
 * header-search.js
 * 全ページ共通のヘッダー検索ボックス（サジェスト付き）を初期化する。
 *
 * 使い方:
 *   initHeaderSearch();                          // 選択時に /search?q=... へ遷移
 *   initHeaderSearch({ onSubmit: (q) => ... });  // コールバックでカスタム動作
 */
