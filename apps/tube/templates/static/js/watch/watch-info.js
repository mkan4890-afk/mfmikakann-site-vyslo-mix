function renderVideoInfo(meta, videoId) {
  currentVideoMeta = meta;
  document.title = `${meta.title || '動画'} - Vyslo Tube`;

  document.getElementById('infoSkeleton').hidden = true;
  const infoEl = document.getElementById('videoInfo');
  infoEl.removeAttribute('hidden');

  document.getElementById('watchTitle').textContent = meta.title || '';
  // 英語訳ではなく元の言語のタイトルを表示
  if (videoId && typeof vyGetOrigTitle === 'function') {
    vyGetOrigTitle(videoId).then(o => {
      if (!o || !o.title || currentVideoMeta !== meta) return;
      const t = document.getElementById('watchTitle');
      if (t) t.textContent = o.title;
      document.title = `${o.title} - Vyslo Tube`;
    });
  }

  // 取得元 (Invidious / Piped など) の表示は廃止

  const views = formatViews(meta.viewCount);
  const isLive = !!meta.liveNow;
  const isUpcoming = !!meta.isUpcoming;
  const date = isLive ? 'ライブ配信中' : (isUpcoming ? '配信予定' : jaDate(meta.publishedText || ''));
  const liveViewText = isLive && meta.viewCount ? `${Number(meta.viewCount).toLocaleString()}人が視聴中` : '';
  // 高評価数は「いいね」ボタンの中に表示する (ここには出さない)
  const metaParts = [liveViewText || views, date].filter(Boolean);
  document.getElementById('watchMeta').innerHTML = metaParts.map((p, i) => {
    const inner = `<span>${escapeHtml(p)}</span>`;
    return i < metaParts.length - 1 ? inner + `<span class="meta-sep">·</span>` : inner;
  }).join('');

  const channelId = meta.authorId || '';
  const channelLinkEl = document.getElementById('channelLink');
  if (channelId) {
    channelLinkEl.href = `/channel?id=${encodeURIComponent(channelId)}`;
  }

  document.getElementById('channelName').textContent = meta.author || '';

  const subs = formatSubsText(meta.subCountText, meta.subCount);
  document.getElementById('channelSubs').textContent = subs ? `チャンネル登録者数 ${subs}` : '';

  const thumbs = meta.authorThumbnails;
  const avatarEl = document.getElementById('channelAvatar');
  const placeholderEl = document.getElementById('channelAvatarPlaceholder');

  function showAvatar(iconUrl) {
    avatarEl.src = iconUrl;
    avatarEl.alt = meta.author || '';
    avatarEl.onload = () => {
      avatarEl.classList.add('loaded');
      avatarEl.removeAttribute('hidden');
      placeholderEl.setAttribute('hidden', '');
    };
  }

  if (thumbs && thumbs.length > 0) {
    showAvatar(getChannelIconUrl(thumbs));
  } else if (channelId) {
    fetchChannelAvatar(channelId).then(fetchedThumbs => {
      if (!fetchedThumbs || !avatarEl.isConnected) return;
      showAvatar(getChannelIconUrl(fetchedThumbs));
    });
  }

  // YouTubeで見るボタンは廃止されました

  const watchSubBtn = document.getElementById('watchSubBtn');
  if (watchSubBtn && channelId) {
    updateWatchSubBtn(watchSubBtn, channelId);
    watchSubBtn.hidden = false;
    watchSubBtn.onclick = () => {
      const subscribed = toggleSubscription({
        authorId: channelId,
        author: meta.author || '',
        authorThumbnails: meta.authorThumbnails || [],
        subCountText: meta.subCountText || null,
        subCount: meta.subCount || null
      });
      updateWatchSubBtn(watchSubBtn, channelId, subscribed);
    };
  }

  initWatchPlaylistBtn(videoId, meta);
  initShareBtn(videoId);
  initDownloadBtn(videoId, meta);
  initWatchLikeBtn(videoId, meta);

  addHistory({
    videoId,
    title: meta.title || '',
    author: meta.author || '',
    authorId: channelId,
    lengthSeconds: meta.lengthSeconds || 0,
    videoThumbnails: meta.videoThumbnails || null
  });

  const rawHtml = meta.descriptionHtml || '';
  const rawText = meta.description || '';
  const descEl = document.getElementById('descriptionText');
  const toggleEl = document.getElementById('descToggle');
  const descWrap = document.getElementById('descriptionWrap');
  const formattedDesc = formatDescription(rawHtml, rawText);

  if (!formattedDesc.trim()) {
    descWrap.hidden = true;
  } else {
    descEl.innerHTML = formattedDesc;
    toggleEl.hidden = false;
    toggleEl.textContent = '詳しく';
    toggleEl.onclick = () => {
      const head = document.getElementById('descFloatHead');
      const body = document.getElementById('descFloatBody');
      const title = document.getElementById('watchTitle');
      const metaEl = document.getElementById('watchMeta');
      if (head) head.innerHTML = `<div class="vy-desc-title">${escapeHtml(title ? title.textContent : '')}</div><div class="vy-desc-meta">${escapeHtml([meta.viewCount ? Number(meta.viewCount).toLocaleString('ja-JP') + '回視聴' : '', date, meta.dateText && /\d{4}/.test(meta.dateText) ? meta.dateText.replace(/^(公開日|プレミア公開日|配信日)[:：]?\s*/, '') : ''].filter(Boolean).join(' · ') || (metaEl ? metaEl.textContent : ''))}</div>`;
      if (body) body.innerHTML = formattedDesc;
      VyFloat.open('descFloat');
    };
  }
}

/* ===== フローティングパネル (コメント / 詳しく) ===== */
const VyFloat = (() => {
  let bound = false;
  function el(id) {
    const e = document.getElementById(id);
    if (e && e.parentElement !== document.body) document.body.appendChild(e);
    return e;
  }
  function close(id) {
    const e = document.getElementById(id);
    if (!e || e.hidden) return;
    e.classList.remove('open');
    e.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (!e.classList.contains('open')) e.hidden = true; }, 220);
    if (!document.querySelector('.vy-float.open')) document.documentElement.classList.remove('vy-float-lock');
  }
  function closeAll() { document.querySelectorAll('.vy-float.open').forEach(e => close(e.id)); }
  function open(id) {
    bind();
    closeAll();
    const e = el(id);
    if (!e) return;
    e.hidden = false;
    e.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('vy-float-lock');
    requestAnimationFrame(() => e.classList.add('open'));
  }
  function bind() {
    if (bound) return; bound = true;
    document.addEventListener('click', ev => {
      const c = ev.target.closest('[data-float-close]');
      if (c) { const f = c.closest('.vy-float'); if (f) close(f.id); }
    });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeAll(); });
    // 説明内のタイムスタンプ等リンクを押したら閉じる
    document.addEventListener('click', ev => {
      const a = ev.target.closest('#descFloatBody a, #descFloatBody button, #commentsList .comment-ts-link');
      if (a && /[?&]t=|data-ts|seek/.test(a.outerHTML)) setTimeout(closeAll, 50);
    });
  }
  return { open, close, closeAll };
})();
window.VyFloat = VyFloat;

/* ===== コメントパネル (本家 YouTube のように動画の下に開く。ページ全体はロックしない) ===== */
const VyComments = (() => {
  function panel() { return document.getElementById('commentsPanel'); }
  function isOpen() { const p = panel(); return !!(p && !p.hidden); }
  function setBtn(open) {
    const b = document.getElementById('watchCmtBtn');
    if (!b) return;
    b.classList.toggle('active', open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.title = open ? 'コメントを閉じる' : 'コメントを開く';
  }
  function open() {
    const p = panel();
    if (!p) return;
    p.hidden = false;
    setBtn(true);
    document.documentElement.classList.remove('vy-float-lock');
    requestAnimationFrame(() => {
      p.classList.add('open');
      // パネルの頭が画面外なら見える位置まで (ページのスクロールは自由なまま)
      const r = p.getBoundingClientRect();
      const headH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--yt-head-h')) || 56;
      if (r.top < headH || r.top > window.innerHeight - 120) {
        window.scrollTo({ top: Math.max(0, window.scrollY + r.top - headH - 8), behavior: 'smooth' });
      }
    });
  }
  function close() {
    const p = panel();
    if (!p) return;
    p.classList.remove('open');
    p.hidden = true;
    setBtn(false);
  }
  function toggle() { isOpen() ? close() : open(); }
  return { open, close, toggle, isOpen };
})();
window.VyComments = VyComments;

document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('watchCmtBtn');
  if (b) b.addEventListener('click', () => VyComments.toggle());
  const c = document.getElementById('commentsClose');
  if (c) c.addEventListener('click', () => VyComments.close());
});

/* ===== COMMENTS ===== */
let currentSortBy = 'top';
let currentContinuation = null;
let commentsLoading = false;
let _commentsVideoId = null;
let _commentsReqGen = 0;

function formatCommentText(text) {
  if (!text) return '';
  const escaped = escapeHtml(text).replace(/\n/g, '<br>');
  return escaped.replace(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g, (_, ts) =>
    `<button class="comment-ts-link" data-ts="${ts}">${ts}</button>`
  );
}

function tsStringToSeconds(ts) {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function seekPlayerToSeconds(secs) {
  const nc = document.getElementById('modeNocookie');
  const ed = document.getElementById('modeEdu');
  if ((nc && nc.classList.contains('active')) || (ed && ed.classList.contains('active'))) {
    const iframe = (nc && nc.classList.contains('active'))
      ? document.getElementById('nocookiePlayer')
      : document.getElementById('eduPlayer');
    if (iframe) iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'seekTo', args: [secs, true] }), '*'
    );
  } else {
    const player = document.getElementById('videoPlayer');
    if (player) {
      player.currentTime = secs;
      player.play().catch(() => {});
    }
  }
  const playerWrap = document.getElementById('playerWrap');
  if (playerWrap) playerWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function createCommentSkeleton() {
  const div = document.createElement('div');
  div.className = 'comment-skeleton';
  div.innerHTML = `
    <div class="cs-avatar"></div>
    <div class="cs-body">
      <div class="cs-line cs-name"></div>
      <div class="cs-line cs-t1"></div>
      <div class="cs-line cs-t2"></div>
      <div class="cs-line cs-t3"></div>
    </div>
  `;
  return div;
}

function _cmtNum(n) {
  n = Number(n) || 0;
  if (n >= 100000000) return (Math.floor(n / 10000000) / 10) + '億';
  if (n >= 10000) return (Math.floor(n / 1000) / 10).toString().replace(/\.0$/, '') + '万';
  return n.toLocaleString('ja-JP');
}

// API の形 (Invidious / InnerTube 変換) の違いを吸収する
function _cmtNormalize(c) {
  const thumbs = Array.isArray(c.authorThumbnails) ? c.authorThumbnails : [];
  const icon = c.authorThumbnail || (thumbs.length ? (thumbs[thumbs.length - 1].url || thumbs[0].url) : '');
  const rep = c.replies || {};
  return {
    id: c.commentId || '',
    author: c.author || '',
    authorId: c.authorId || ((c.authorUrl || '').match(/\/channel\/([^/?]+)/) || [])[1] || '',
    icon: icon ? (icon.startsWith('//') ? 'https:' + icon : icon) : '',
    verified: !!(c.verified || c.authorVerified),
    owner: !!c.authorIsChannelOwner,
    pinned: !!c.isPinned,
    edited: !!c.isEdited,
    heart: c.creatorHeart || null,
    content: c.content || '',
    date: c.publishedText || '',
    likes: Number(c.likeCount) || 0,
    replyCount: Number(rep.replyCount != null ? rep.replyCount : c.replyCount) || 0,
    replyCont: rep.continuation || c.repliesContinuation || null,
  };
}

const _CMT_IC = {
  like: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.6l-2.3 7.9a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"/></svg>',
  dislike: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(180deg)"><path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.6l-2.3 7.9a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.8a2 2 0 0 1-1.1 1.7l-1.8.9A2 2 0 0 0 5 15.2z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.4 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z"/></svg>',
};

function createWatchCommentItem(raw, { isReply = false, videoId = null } = {}) {
  const c = _cmtNormalize(raw);
  // 返信の取得に使う動画ID（ショートのコメント欄など、_commentsVideoId 以外の動画でも使えるように）
  const _vid = videoId || _commentsVideoId;
  const div = document.createElement('div');
  div.className = 'comment-item' + (isReply ? ' comment-reply' : '');
  if (c.id) div.dataset.cid = c.id;

  const authorHref = c.authorId ? `/channel?id=${encodeURIComponent(c.authorId)}` : null;
  const iconUrl = c.icon ? wsrv(c.icon, 88) : '';
  const initial = escapeHtml((c.author.replace(/^@/, '') || '?').slice(0, 1).toUpperCase());
  const avTag = authorHref ? 'a' : 'div';
  const avAttr = authorHref ? ` href="${authorHref}" title="${escapeHtml(c.author)}" aria-label="${escapeHtml(c.author + ' のチャンネル')}"` : '';

  div.innerHTML = `
    <${avTag} class="comment-avatar-wrap vy-ch-press"${avAttr}>
      <span class="comment-avatar-ph" aria-hidden="true">${initial}</span>
      ${iconUrl ? `<img class="comment-avatar" src="${iconUrl}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('loaded')" onerror="this.remove()" />` : ''}
    </${avTag}>
    <div class="comment-body">
      ${c.pinned ? `<div class="comment-pinned">${_CMT_IC.pin}<span>固定されたコメント</span></div>` : ''}
      <div class="comment-header">
        ${authorHref
          ? `<a class="comment-author${c.owner ? ' owner' : ''}" href="${authorHref}">${escapeHtml(c.author)}</a>`
          : `<span class="comment-author${c.owner ? ' owner' : ''}">${escapeHtml(c.author)}</span>`}
        ${c.verified ? `<span class="comment-verified" title="確認済み">${_CMT_IC.check}</span>` : ''}
        ${c.date ? `<span class="comment-date">${escapeHtml(jaDate(c.date))}${c.edited ? '（編集済み）' : ''}</span>` : ''}
      </div>
      <div class="comment-text">${formatCommentText(c.content)}</div>
      <div class="comment-text-more" hidden><button type="button" class="comment-more-btn">もっと見る</button></div>
      <div class="comment-footer">
        <span class="comment-act comment-likes" title="高評価">${_CMT_IC.like}<span>${c.likes ? _cmtNum(c.likes) : ''}</span></span>
        <span class="comment-act comment-dislike" title="低評価">${_CMT_IC.dislike}</span>
        ${c.heart ? `<span class="comment-heart" title="${escapeHtml((c.heart.creatorName || '投稿者') + ' がハートを付けました')}">${c.heart.creatorThumbnail ? `<img src="${wsrv(c.heart.creatorThumbnail, 32)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" />` : ''}<i>&#10084;</i></span>` : ''}
      </div>
      ${!isReply && c.replyCount && c.replyCont ? `
        <button type="button" class="comment-replies-toggle" aria-expanded="false">${_CMT_IC.chevron}<span>${_cmtNum(c.replyCount)}件の返信</span></button>
        <div class="comment-replies-list" hidden></div>
        <button type="button" class="comment-replies-more" hidden>${_CMT_IC.chevron}<span>他の返信を表示</span></button>` : ''}
    </div>
  `;

  if (!isReply && c.replyCount && c.replyCont) {
    const tgl = div.querySelector('.comment-replies-toggle');
    const lst = div.querySelector('.comment-replies-list');
    const more = div.querySelector('.comment-replies-more');
    let next = c.replyCont, loaded = false, busy = false;
    async function loadReplies() {
      if (busy || !next) return;
      busy = true;
      more.hidden = true;
      const sk = document.createElement('div');
      sk.className = 'comment-replies-loading';
      sk.innerHTML = '<span class="vy-cmt-spin"></span>';
      lst.appendChild(sk);
      try {
        const d = await withRetry(() => fetchMain(`/api/comments/${_vid}?continuation=${encodeURIComponent(next)}`), 3);
        sk.remove();
        (d.comments || []).forEach(r => lst.appendChild(createWatchCommentItem(r, { isReply: true })));
        next = d.continuation || null;
        loaded = true;
      } catch (e) {
        sk.remove();
        const er = document.createElement('div');
        er.className = 'comment-replies-error';
        er.textContent = '返信を読み込めませんでした。もう一度お試しください。';
        lst.appendChild(er);
        setTimeout(() => er.remove(), 4000);
      }
      more.hidden = !next;
      busy = false;
    }
    tgl.addEventListener('click', () => {
      const open = tgl.getAttribute('aria-expanded') !== 'true';
      tgl.setAttribute('aria-expanded', open ? 'true' : 'false');
      tgl.classList.toggle('open', open);
      lst.hidden = !open;
      more.hidden = !open || !next || !loaded;
      if (open && !loaded) loadReplies();
    });
    more.addEventListener('click', loadReplies);
  }

  // 長いコメントは本家のように折りたたんで「もっと見る」
  requestAnimationFrame(() => {
    const t = div.querySelector('.comment-text');
    const m = div.querySelector('.comment-text-more');
    if (!t || !m) return;
    t.classList.add('clamp');
    if (t.scrollHeight > t.clientHeight + 2) {
      m.hidden = false;
      m.querySelector('button').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const ex = t.classList.toggle('clamp');
        btn.textContent = ex ? 'もっと見る' : '一部を表示';
      });
    } else {
      t.classList.remove('clamp');
    }
  });
  return div;
}

// ショートのコメント欄はこちら (従来どおり) を使う
function createCommentItem(c) {
  const div = document.createElement('div');
  div.className = 'comment-item';

  const authorHref = c.authorId ? `/channel?id=${encodeURIComponent(c.authorId)}` : null;
  const thumbs = c.authorThumbnails;
  const iconUrl = thumbs && thumbs.length
    ? wsrv(thumbs[thumbs.length - 1].url || thumbs[0].url, 72)
    : '';

  const likesHtml = c.likeCount
    ? `<span class="comment-likes">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        ${c.likeCount.toLocaleString()}
       </span>`
    : '';

  const repliesHtml = c.replyCount
    ? `<span class="comment-replies">返信 ${c.replyCount}</span>`
    : '';

  div.innerHTML = `
    ${authorHref ? `<a class="comment-avatar-wrap vy-ch-press" href="${authorHref}" title="${escapeHtml(c.author || '')}" aria-label="${escapeHtml((c.author || '') + ' のチャンネル')}">` : '<div class="comment-avatar-wrap">'}
      ${iconUrl
        ? `<img class="comment-avatar" src="${iconUrl}" alt="${escapeHtml(c.author || '')}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="comment-avatar-placeholder"></div>`
      }
    ${authorHref ? '</a>' : '</div>'}
    <div class="comment-body">
      <div class="comment-header">
        ${authorHref
          ? `<a class="comment-author${c.authorVerified ? ' verified' : ''}" href="${authorHref}">${escapeHtml(c.author || '')}</a>`
          : `<span class="comment-author${c.authorVerified ? ' verified' : ''}">${escapeHtml(c.author || '')}</span>`
        }
        ${c.publishedText ? `<span class="comment-date">${escapeHtml(jaDate(c.publishedText))}</span>` : ''}
        ${c.isPinned ? `<span class="comment-pinned"><svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.8a2 2 0 0 1-1.1 1.7l-1.8.9A2 2 0 0 0 5 15.2z"/></svg> 固定</span>` : ''}
      </div>
      <div class="comment-text">${formatCommentText(c.content || '')}</div>
      <div class="comment-footer">${likesHtml}${repliesHtml}</div>
    </div>
  `;
  return div;
}

function showCommentSkeletons(count = 6) {
  const list = document.getElementById('commentsList');
  for (let i = 0; i < count; i++) list.appendChild(createCommentSkeleton());
}

function removeCommentSkeletons() {
  document.querySelectorAll('.comment-skeleton').forEach(el => el.remove());
}

async function loadComments(videoId, sortBy, continuation = null, append = false) {
  if (commentsLoading && append) return;
  const gen = ++_commentsReqGen;
  commentsLoading = true;
  _commentsVideoId = videoId;

  const list = document.getElementById('commentsList');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  loadMoreBtn.disabled = true;

  if (!append) {
    list.innerHTML = '';
    showCommentSkeletons(6);
  } else {
    showCommentSkeletons(3);
  }

  try {
    let url = `/api/comments/${videoId}?sort_by=${sortBy}`;
    if (continuation) url += `&continuation=${encodeURIComponent(continuation)}`;

    const data = await withRetry(() => fetchMain(url), append ? 4 : 10);
    if (gen !== _commentsReqGen) return;   // 並べ替えを切り替えた後に届いた古い結果は捨てる
    removeCommentSkeletons();

    if (!append && data.commentCount) {
      const countEl = document.getElementById('commentCount');
      countEl.textContent = `${Number(data.commentCount).toLocaleString('ja-JP')} 件`;
      const btnCount = document.getElementById('watchCmtCount');
      if (btnCount) btnCount.textContent = _cmtNum(data.commentCount);
    }

    const comments = data.comments || [];
    if (comments.length === 0 && !append) {
      list.innerHTML = '<p class="comments-empty">コメントはありません。</p>';
    } else {
      const frag = document.createDocumentFragment();
      comments.forEach(c => frag.appendChild(createWatchCommentItem(c)));
      list.appendChild(frag);
    }

    currentContinuation = data.continuation || null;
    if (currentContinuation) {
      loadMoreWrap.hidden = false;
      loadMoreBtn.disabled = false;
    } else {
      loadMoreWrap.hidden = true;
    }
  } catch (e) {
    if (gen !== _commentsReqGen) return;
    removeCommentSkeletons();
    if (!append) {
      list.innerHTML = '<p class="comments-empty">コメントを読み込めませんでした。<button type="button" class="comments-retry">再読み込み</button></p>';
      const rb = list.querySelector('.comments-retry');
      if (rb) rb.addEventListener('click', () => loadComments(videoId, sortBy));
      loadMoreWrap.hidden = true;
    } else {
      // 続きの取得だけ失敗した場合は、もう一度押せるようにしておく
      loadMoreWrap.hidden = !currentContinuation;
      loadMoreBtn.disabled = false;
    }
    console.error('comments error:', e);
  } finally {
    if (gen === _commentsReqGen) commentsLoading = false;
  }
}

function initComments(videoId) {
  _commentsVideoId = videoId;
  const sortBtns = document.querySelectorAll('#commentsPanel .sort-btn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const commentsList = document.getElementById('commentsList');

  if (commentsList && !commentsList.dataset.tsBound) {
    commentsList.dataset.tsBound = '1';
    commentsList.addEventListener('click', e => {
      const btn = e.target.closest('.comment-ts-link');
      if (!btn) return;
      e.preventDefault();
      seekPlayerToSeconds(tsStringToSeconds(btn.dataset.ts));
    });
  }

  sortBtns.forEach(btn => {
    if (btn.dataset.vyBound) return;
    btn.dataset.vyBound = '1';
    btn.addEventListener('click', () => {
      if (btn.dataset.sort === currentSortBy) return;
      sortBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      currentSortBy = btn.dataset.sort;
      currentContinuation = null;
      loadComments(_commentsVideoId, currentSortBy);
    });
  });

  if (!loadMoreBtn.dataset.vyBound) {
    loadMoreBtn.dataset.vyBound = '1';
    loadMoreBtn.addEventListener('click', () => {
      loadComments(_commentsVideoId, currentSortBy, currentContinuation, true);
    });
    // 本家のように、下までスクロールしたら続きを自動で読み込む
    if ('IntersectionObserver' in window) {
      const wrap = document.getElementById('loadMoreWrap');
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (en.isIntersecting && VyComments.isOpen() && currentContinuation && !commentsLoading && !loadMoreBtn.disabled) {
            loadComments(_commentsVideoId, currentSortBy, currentContinuation, true);
          }
        });
      }, { rootMargin: '300px 0px' });
      io.observe(wrap);
    }
  }

  loadComments(videoId, currentSortBy);
}
