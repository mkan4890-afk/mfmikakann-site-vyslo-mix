;(() => {
  if (!document.body.classList.contains('page-subscriptions')) return;
  document.addEventListener('DOMContentLoaded', () => {
    initHeaderSearch();
    renderSubsPage();
  });

  function renderSubsPage() {
    const subs = getSubscriptions();
    const empty = document.getElementById('subsEmpty');
    const rowWrap = document.getElementById('subsChannelsRowWrap');
    const grid = document.getElementById('subsVideoGrid');

    if (!subs.length) {
      empty.hidden = false;
      rowWrap.hidden = true;
      grid.innerHTML = '';
      return;
    }

    empty.hidden = true;
    rowWrap.hidden = false;
    renderChannelRow(subs);
    renderSubsVideos(subs);
  }

  function renderChannelRow(subs) {
    const row = document.getElementById('subsChannelsRow');
    const moreBtn = document.getElementById('subsMoreBtn');
    const listEl = document.getElementById('subsChannelsList');
    row.innerHTML = '';

    const maxRow = 12;
    subs.slice(0, maxRow).forEach(ch => {
      const a = document.createElement('a');
      a.className = 'subs-ch-avatar-item';
      a.href = `/channel?id=${encodeURIComponent(ch.authorId)}`;
      a.title = ch.author || '';
      const iconUrl = ch.authorThumbnails
        ? wsrv((ch.authorThumbnails.find(t => (t.width || 0) >= 88) || ch.authorThumbnails[0])?.url, 88)
        : '';
      a.innerHTML = `
        <div class="subs-ch-avatar-wrap">
          ${iconUrl
            ? `<img class="subs-ch-avatar" src="${iconUrl}" alt="${escapeHtml(ch.author || '')}" loading="lazy" onload="this.classList.add('loaded')" />`
            : `<div class="subs-ch-avatar-ph">${escapeHtml((ch.author || '?')[0])}</div>`
          }
        </div>
        <div class="subs-ch-name">${escapeHtml(ch.author || '')}</div>
      `;
      row.appendChild(a);
    });

    if (subs.length > maxRow) {
      moreBtn.hidden = false;
      moreBtn.onclick = () => {
        listEl.hidden = false;
        moreBtn.hidden = true;
        renderChannelList(subs);
      };
    } else {
      moreBtn.hidden = true;
    }
  }

  function renderChannelList(subs) {
    const listEl = document.getElementById('subsChannelsList');
    listEl.innerHTML = '';
    listEl.hidden = false;

    subs.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'lib-channel-card';
      const iconUrl = ch.authorThumbnails
        ? wsrv((ch.authorThumbnails.find(t => (t.width || 0) >= 88) || ch.authorThumbnails[0])?.url, 88)
        : '';
      const _subs = formatSubsText(ch.subCountText, ch.subCount);
      const subsText = _subs ? `チャンネル登録者数 ${_subs}` : '';

      card.innerHTML = `
        <a class="lib-channel-link" href="/channel?id=${encodeURIComponent(ch.authorId)}">
          ${iconUrl
            ? `<img class="lib-channel-avatar" src="${iconUrl}" alt="${escapeHtml(ch.author || '')}" loading="lazy" onload="this.classList.add('loaded')" />`
            : `<div class="lib-channel-avatar-ph">${escapeHtml((ch.author || '?')[0])}</div>`
          }
          <div class="lib-channel-info">
            <div class="lib-channel-name">${escapeHtml(ch.author || '')}</div>
            ${subsText ? `<div class="lib-channel-subs">${escapeHtml(subsText)}</div>` : ''}
            <div class="lib-channel-date">登録日 ${formatLibDate(ch.subscribedAt)}</div>
          </div>
        </a>
        <button class="lib-unsub-btn" data-id="${escapeHtml(ch.authorId)}">登録解除</button>
      `;
      card.querySelector('.lib-unsub-btn').addEventListener('click', () => {
        toggleSubscription({ authorId: ch.authorId });
        renderSubsPage();
      });
      listEl.appendChild(card);
    });
  }

  async function renderSubsVideos(subs) {
    const grid = document.getElementById('subsVideoGrid');
    grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>動画を取得中…</p></div>';

    // Fetch latest videos from each subscribed channel
    const channelIds = subs.map(s => s.authorId).filter(Boolean).slice(0, 20);
    if (!channelIds.length) {
      grid.innerHTML = '<div class="empty-state"><p>登録しているチャンネルがありません。</p></div>';
      return;
    }

    const results = await Promise.all(channelIds.map(async (id) => {
      try {
        const raw = await fetchMain(`/api/channels/${encodeURIComponent(id)}/latest`);
        const items = Array.isArray(raw) ? raw : (raw.videos || []);
        return items.filter(v => v && v.videoId);
      } catch { return []; }
    }));

    // Merge and sort by published date
    const all = [];
    const seen = new Set();
    results.forEach(items => {
      items.forEach(v => {
        if (v.videoId && !seen.has(v.videoId)) {
          seen.add(v.videoId);
          all.push(v);
        }
      });
    });

    // Sort by published date (newest first)
    all.sort((a, b) => {
      const aPub = Number(a.published) || 0;
      const bPub = Number(b.published) || 0;
      return bPub - aPub;
    });

    if (!all.length) {
      grid.innerHTML = '<div class="empty-state"><p>登録チャンネルの動画を取得できませんでした。</p></div>';
      return;
    }

    // Apply VyRank if available
    let videos = all.slice(0, 60);
    if (window.VyRank) {
      videos = VyRank.rank(videos, { query: '' });
    }

    grid.innerHTML = '';
    const missingIcons = [];
    videos.forEach(v => {
      // Add channel thumbnails from subscription data
      const sub = subs.find(s => s.authorId === v.authorId);
      if (sub && sub.authorThumbnails && !v.authorThumbnails) {
        v.authorThumbnails = sub.authorThumbnails;
      }
      const card = createVideoCard(v);
      grid.appendChild(card);
      if (!v.authorThumbnails && v.authorId) missingIcons.push({ card, authorId: v.authorId });
    });
    if (missingIcons.length > 0) fillMissingIcons(missingIcons);

    // Load more
    if (videos.length >= 20) {
      const morePool = all.slice(60);
      vyLoadMore(grid, async () => {
        if (morePool.length < 12) {
          // Fetch more from channels
          return 0;
        }
        return vyAppendCards(grid, morePool.splice(0, 24));
      });
    }
  }

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
