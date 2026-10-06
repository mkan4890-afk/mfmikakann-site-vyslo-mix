;(() => {
  if (!document.body.classList.contains('page-trending')) return;
let currentRegion = 'JP';
let currentCategory = '';

let trendGen = 0;
function showLoading() {
  const grid = document.getElementById('trendingGrid');
  vyHideLoadMore(grid);
  grid.innerHTML = '';
  for (let i = 0; i < 20; i++) grid.appendChild(createSkeletonCard());
}

function showError(msg) {
  const grid = document.getElementById('trendingGrid');
  grid.innerHTML = `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>${msg}</p></div>`;
}

async function loadTrending(region, category) {
  const gen = ++trendGen;
  showLoading();
  try {
    const endpoint = category
      ? `/api/trending/${category}?region=${region}`
      : `/api/trending?region=${region}`;
    const raw = await fetchMain(endpoint);
    const data = Array.isArray(raw) ? raw : (raw.results || []);
    const grid = document.getElementById('trendingGrid');
    grid.innerHTML = '';

    if (!data.length) {
      grid.innerHTML = `<div class="empty-state"><p>このエリアの急上昇動画は見つかりませんでした。</p></div>`;
      return;
    }

    const missingIcons = [];
    data.forEach(video => {
      const card = createVideoCard(video);
      grid.appendChild(card);
      if (!video.authorThumbnails && video.authorId) {
        missingIcons.push({ card, authorId: video.authorId });
      }
    });
    if (missingIcons.length > 0) fillMissingIcons(missingIcons);
    const seen = new Set(data.map(v => v.videoId || v.id));
    let pool = [];
    vyLoadMore(grid, async () => {
      if (pool.length < 12) {
        const more = await vyFetchMoreRelated(grid, seen, 4);
        if (gen !== trendGen) return 0;
        pool.push(...more);
      }
      return vyAppendCards(grid, pool.splice(0, 24));
    });
  } catch (e) {
    showError('急上昇の動画をうまく取れませんでした。しばらく経ってから再試行してください。');
    console.error(e);
  }
}

function populateRegionSelect() {
  const sel = document.getElementById('regionSelect');
  [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'ja')).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = `${c.name} (${c.code})`;
    if (c.code === 'JP') opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    currentRegion = sel.value;
    loadTrending(currentRegion, currentCategory);
  });
}

function initCategoryTabs() {
  const tabs = document.querySelectorAll('.category-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategory = tab.dataset.category;
      loadTrending(currentRegion, currentCategory);
    });
  });
}

function init() {
  populateRegionSelect();
  initCategoryTabs();
  loadTrending(currentRegion, currentCategory);
  initHeaderSearch();
}

init();
})();
