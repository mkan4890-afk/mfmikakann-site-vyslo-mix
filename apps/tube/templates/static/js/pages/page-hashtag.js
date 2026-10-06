;(() => {
  if (!document.body.classList.contains('page-hashtag')) return;
const params = new URLSearchParams(location.search);
const tag = params.get('tag') || '';
let currentPage = parseInt(params.get('page') || '1', 10);
let isLoading = false;

document.addEventListener('DOMContentLoaded', () => {
  initHeaderSearch();
  if (!tag) {
    document.getElementById('resultGrid').innerHTML =
      `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>ハッシュタグが指定されていません。</p></div>`;
    return;
  }
  document.title = `#${tag} — Vyslo Tube`;
  const header = document.getElementById('resultHeader');
  document.getElementById('resultInfo').innerHTML =
    `<strong style="font-size:1.2rem;">#${escapeHtml(tag)}</strong>`;
  header.hidden = false;
  loadHashtag();
  bindPagination();
});

function buildApiUrl() {
  const p = new URLSearchParams({ page: currentPage });
  return `/api/hashtag/${encodeURIComponent(tag)}?${p}`;
}

function pushState() {
  const p = new URLSearchParams({ tag });
  if (currentPage > 1) p.set('page', currentPage);
  history.pushState(null, '', `/hashtag?${p}`);
}

async function loadHashtag() {
  if (isLoading) return;
  isLoading = true;

  const grid = document.getElementById('resultGrid');
  const pagination = document.getElementById('pagination');
  vyHideLoadMore(grid);
  grid.innerHTML = '';
  pagination.hidden = true;
  for (let i = 0; i < 20; i++) grid.appendChild(createSkeletonCard());

  try {
    const data = await fetchMain(buildApiUrl());
    const videos = Array.isArray(data) ? data : (data.videos || data.results || []);
    grid.innerHTML = '';

    if (!videos.length) {
      grid.innerHTML = `<div class="empty-state"><p>#${escapeHtml(tag)} の動画が見つかりませんでした。</p></div>`;
    } else {
      const missingIcons = [];
      videos.forEach(v => {
        const card = createVideoCard(v);
        grid.appendChild(card);
        if (!v.authorThumbnails && v.authorId) {
          missingIcons.push({ card, authorId: v.authorId });
        }
      });
      if (missingIcons.length > 0) fillMissingIcons(missingIcons);
      document.getElementById('pagination').hidden = true;
      const seen = new Set(videos.map(v => v.videoId));
      let page = currentPage;
      vyLoadMore(grid, async () => {
        page++;
        const d = await fetchMain(`/api/hashtag/${encodeURIComponent(tag)}?page=${page}`);
        const more = (Array.isArray(d) ? d : (d.videos || d.results || [])).filter(v => v.videoId && !seen.has(v.videoId));
        more.forEach(v => seen.add(v.videoId));
        return vyAppendCards(grid, more);
      });
    }
  } catch (e) {
    grid.innerHTML = `<div class="error-state"><div class="error-icon"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p>動画の取得に失敗しました。</p></div>`;
    console.error(e);
  }

  isLoading = false;
}

function updatePagination(count) {
  const pagination = document.getElementById('pagination');
  const pageInfo = document.getElementById('pageInfo');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  pageInfo.textContent = `${currentPage} ページ`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = count < 20;
  pagination.hidden = (currentPage <= 1 && count < 20);
}

function bindPagination() {
  document.getElementById('prevBtn').addEventListener('click', () => {
    if (currentPage <= 1) return;
    currentPage--;
    pushState();
    loadHashtag();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('nextBtn').addEventListener('click', () => {
    currentPage++;
    pushState();
    loadHashtag();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
})();
