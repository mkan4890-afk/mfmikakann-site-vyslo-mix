/* ════════════════════════════════════════════════════════════
   VyRank — 検索結果のパーソナライズ並び替え
   本家 YouTube のように
     ・一度見た動画は下に下がって出にくくなる
     ・何度も表示されたのに押されなかった動画も少しずつ下がる
     ・これまでの検索 / 視聴履歴 / 登録チャンネルから好みを推定して上げる
     ・同じチャンネルが連続しすぎないように混ぜる
   データはすべてこの端末の localStorage の中だけで計算する。
   ════════════════════════════════════════════════════════════ */
const VyRank = (() => {
  const IMP_KEY = 'vyslo_search_impressions';
  const CLICK_KEY = 'vyslo_search_clicks';
  const QIMP_KEY = 'vyslo_search_qimp';     // 検索語ごとの「表示した動画」(同じ検索で同じ動画ばかり出さないため)
  const QIMP_HALF_DAYS = 1.5;               // 下げ幅は 1.5 日で半分になり、数日たてば元に戻る
  const IMP_MAX = 3000;
  const DAY = 86400000;

  const safeJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ── 文字列 → 特徴トークン (日本語は2文字ずつ、英数字は単語) ──
  const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'are', 'this', 'that', 'from', 'shorts', 'short', 'video', 'official', 'ショート', 'する', 'した', 'です', 'ます', 'って', 'これ', 'それ', 'こと', 'もの']);
  function tokens(text) {
    if (!text) return [];
    const s = String(text).toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#＃【】\[\]()（）「」『』｜|!！?？.,、。:：;；~〜\-_/\\'"“”‘’・…♪★☆♡❤️]+/g, ' ');
    const out = [];
    const words = s.match(/[a-z0-9]{2,}/g) || [];
    words.forEach(w => { if (!STOP.has(w)) out.push(w); });
    const cjk = s.match(/[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]+/g) || [];
    cjk.forEach(run => {
      if (run.length === 1) return;
      if (run.length <= 4 && !STOP.has(run)) out.push(run);
      for (let i = 0; i < run.length - 1; i++) {
        const bg = run.slice(i, i + 2);
        if (!STOP.has(bg)) out.push(bg);
      }
    });
    return out;
  }

  // ── 好みのプロフィール (重みは時間とともに減衰) ──
  let _profile = null, _profileAt = 0;
  function decay(ts, halfLifeDays) {
    if (!ts) return 0.35;
    const age = Math.max(0, Date.now() - ts) / DAY;
    return Math.pow(0.5, age / halfLifeDays);
  }
  function addTok(map, text, w) {
    if (!w) return;
    const ts = tokens(text);
    if (!ts.length) return;
    const per = w / Math.sqrt(ts.length);
    ts.forEach(t => map.set(t, (map.get(t) || 0) + per));
  }

  function buildProfile() {
    if (_profile && Date.now() - _profileAt < 5000) return _profile;
    const hist = (typeof getHistory === 'function') ? getHistory() : [];
    const shortsHist = (typeof getShortsHistory === 'function') ? getShortsHistory() : [];
    const searches = (typeof getSearchHistory === 'function') ? getSearchHistory() : [];
    const subs = (typeof getSubscriptions === 'function') ? getSubscriptions() : [];
    const favs = (typeof getFavorites === 'function') ? (getFavorites() || []) : [];
    const clicks = safeJSON(CLICK_KEY, {});

    const topic = new Map();
    const channel = new Map();
    const watched = new Map();

    hist.slice(0, 400).forEach(h => {
      const w = decay(h.watchedAt, 21);
      addTok(topic, h.title, 1.0 * w);
      if (h.authorId) channel.set(h.authorId, (channel.get(h.authorId) || 0) + 1.0 * w);
      if (h.videoId) watched.set(h.videoId, h.watchedAt || 1);
    });
    shortsHist.slice(0, 300).forEach(h => {
      const w = decay(h.watchedAt, 14);
      addTok(topic, h.title, 0.45 * w);
      if (h.authorId) channel.set(h.authorId, (channel.get(h.authorId) || 0) + 0.4 * w);
      if (h.videoId && !watched.has(h.videoId)) watched.set(h.videoId, h.watchedAt || 1);
    });
    // 検索履歴は新しいほど強く (配列の先頭が最新)
    searches.slice(0, 20).forEach((q, i) => addTok(topic, q, 1.6 * Math.pow(0.86, i)));
    favs.slice(0, 200).forEach(f => {
      addTok(topic, f.title, 0.8);
      if (f.authorId) channel.set(f.authorId, (channel.get(f.authorId) || 0) + 0.8);
    });
    Object.values(clicks).forEach(c => {
      const w = decay(c.ts, 21);
      addTok(topic, c.title, 0.7 * w);
      if (c.authorId) channel.set(c.authorId, (channel.get(c.authorId) || 0) + 0.6 * w);
    });
    const subSet = new Set(subs.map(s => s.authorId).filter(Boolean));

    let topicMax = 0; topic.forEach(v => { if (v > topicMax) topicMax = v; });
    let chMax = 0; channel.forEach(v => { if (v > chMax) chMax = v; });

    _profile = { topic, topicMax: topicMax || 1, channel, chMax: chMax || 1, subSet, watched, positions: safeJSON('chocotube_positions', {}) };
    _profileAt = Date.now();
    return _profile;
  }

  // ── 表示されたけど押されなかった回数 ──
  function getImpressions() { return safeJSON(IMP_KEY, {}); }
  function recordImpressions(ids) {
    if (!ids || !ids.length) return;
    const imp = getImpressions();
    const now = Date.now();
    ids.forEach(id => {
      const e = imp[id] || { n: 0, ts: 0 };
      // 同じ動画を短時間に何度も数えない (30分に1回)
      if (now - e.ts > 30 * 60000) { e.n++; e.ts = now; }
      imp[id] = e;
    });
    const keys = Object.keys(imp);
    if (keys.length > IMP_MAX) {
      keys.sort((a, b) => imp[a].ts - imp[b].ts).slice(0, keys.length - IMP_MAX).forEach(k => delete imp[k]);
    }
    save(IMP_KEY, imp);
  }
  // ── 同じ検索語で表示した動画 (少しずつ優先度を下げ、時間がたてば元に戻す) ──
  const normQ = (q) => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
  function getQueryImpressions(q) {
    const all = safeJSON(QIMP_KEY, {});
    const e = all[normQ(q)];
    return (e && e.ids) || {};
  }
  function recordQueryImpressions(q, ids) {
    const key = normQ(q);
    if (!key || !ids || !ids.length) return;
    const all = safeJSON(QIMP_KEY, {});
    const now = Date.now();
    const e = all[key] || { ts: 0, ids: {} };
    ids.forEach(id => {
      const r = e.ids[id] || { n: 0, ts: 0 };
      // 同じ検索を短時間に何度もしても数えすぎない (20分に1回)
      // (同じ画面での再描画などで数えすぎないよう 90 秒に 1 回。再検索するたびに少しずつ優先度が下がる)
      if (now - r.ts > 90000) { r.n = Math.min(8, r.n + 1); r.ts = now; }
      e.ids[id] = r;
    });
    // 古いもの (十分に元へ戻ったもの) は消す
    Object.keys(e.ids).forEach(id => { if (now - e.ids[id].ts > 10 * DAY) delete e.ids[id]; });
    const idKeys = Object.keys(e.ids);
    if (idKeys.length > 400) idKeys.sort((a, b) => e.ids[a].ts - e.ids[b].ts).slice(0, idKeys.length - 400).forEach(k => delete e.ids[k]);
    e.ts = now;
    all[key] = e;
    const qs = Object.keys(all);
    if (qs.length > 80) qs.sort((a, b) => all[a].ts - all[b].ts).slice(0, qs.length - 80).forEach(k => delete all[k]);
    save(QIMP_KEY, all);
  }
  // 0 〜 0.3 程度。前回の表示から時間がたつほど 0 に近づく
  function queryPenalty(qimp, id) {
    const r = qimp && qimp[id];
    if (!r || !r.n) return 0;
    return Math.min(0.45, 0.15 * Math.min(6, r.n)) * decay(r.ts, QIMP_HALF_DAYS);
  }

  // ── 直前に表示した一覧 (更新したのにまったく同じ一覧にならないよう、次の更新で優先度を下げる) ──
  const SHOWN_KEY = 'vyslo_last_shown';
  function recordShown(key, ids) {
    if (!key || !ids || !ids.length) return;
    const all = safeJSON(SHOWN_KEY, {});
    const list = Array.isArray(all[key]) ? all[key] : [];
    list.unshift({ ts: Date.now(), ids: ids.slice(0, 40) });
    all[key] = list.slice(0, 3);
    const ks = Object.keys(all);
    if (ks.length > 60) ks.sort((a, b) => ((all[a][0] || {}).ts || 0) - ((all[b][0] || {}).ts || 0)).slice(0, ks.length - 60).forEach(k => delete all[k]);
    save(SHOWN_KEY, all);
  }
  // id → 下げ幅。直前の表示ほど強く (0.30 / 0.18 / 0.10)、半日ほどで元に戻る
  function shownMap(key) {
    const m = new Map();
    if (!key) return m;
    const list = safeJSON(SHOWN_KEY, {})[key];
    if (!Array.isArray(list)) return m;
    const W = [0.30, 0.18, 0.10];
    list.forEach((snap, si) => {
      const w = (W[si] || 0.08) * decay(snap.ts, 0.25);
      (snap.ids || []).forEach((id, pos) => {
        // 上位に出ていたものほど強く下げる (同じ上位が続かないように)
        const pw = w * (pos < 12 ? 1 : 0.6);
        m.set(id, Math.max(m.get(id) || 0, pw));
      });
    });
    return m;
  }

  function recordClick(item) {
    if (!item || !item.videoId) return;
    const clicks = safeJSON(CLICK_KEY, {});
    clicks[item.videoId] = { title: item.title || '', authorId: item.authorId || '', ts: Date.now() };
    const keys = Object.keys(clicks);
    if (keys.length > 500) keys.sort((a, b) => clicks[a].ts - clicks[b].ts).slice(0, keys.length - 500).forEach(k => delete clicks[k]);
    save(CLICK_KEY, clicks);
    const imp = getImpressions();
    if (imp[item.videoId]) { imp[item.videoId].n = 0; save(IMP_KEY, imp); }
    _profile = null;
  }

  function publishedMs(item) {
    if (item.published) {
      const p = Number(item.published);
      return p > 1e12 ? p : p * 1000;
    }
    return 0;
  }

  // ── 1本ずつの点数 ──
  function scoreItem(item, idx, n, ctx) {
    const P = ctx.profile;
    const id = item.videoId;
    const isCh = item.type === 'channel', isPl = item.type === 'playlist';
    // 検索エンジンの関連度 (元の順位) を土台にする
    let s = 1.0 - 0.75 * (idx / Math.max(1, n - 1));
    if (idx < 3) s += 0.12 * (3 - idx);
    if (isCh || isPl) return { s: s + (isCh && P.subSet.has(item.authorId) ? 0.4 : 0), why: '' };

    const titleToks = tokens(item.title);
    const tset = new Set(titleToks);

    // 検索語とタイトルの一致 (完全一致を強く)
    if (ctx.q) {
      const qn = ctx.q.toLowerCase().replace(/\s+/g, '');
      const tn = String(item.title || '').toLowerCase().replace(/\s+/g, '');
      if (qn && tn.includes(qn)) s += 0.22;
      let hit = 0; ctx.qToks.forEach(t => { if (tset.has(t)) hit++; });
      if (ctx.qToks.length) s += 0.18 * (hit / ctx.qToks.length);
    }

    // 好みの話題との一致
    let topic = 0;
    tset.forEach(t => { const v = P.topic.get(t); if (v) topic += v; });
    topic = topic / (P.topicMax * Math.sqrt(Math.max(1, tset.size)));
    s += 0.32 * Math.min(1, topic);

    // よく見るチャンネル / 登録チャンネル
    if (item.authorId) {
      const c = P.channel.get(item.authorId) || 0;
      s += 0.28 * Math.min(1, c / P.chMax);
      if (P.subSet.has(item.authorId)) s += 0.3;
    }

    // 人気 (再生数) と新しさ
    const v = Number(item.viewCount) || 0;
    if (v > 0) s += 0.05 * Math.min(1, Math.log10(v + 1) / 8);
    const pub = publishedMs(item);
    if (pub) {
      const ageDays = (Date.now() - pub) / DAY;
      if (ageDays < 2) s += 0.08; else if (ageDays < 14) s += 0.05; else if (ageDays < 60) s += 0.02;
    }

    // 見た動画は出にくく (最近見たものほど下げる / 途中までのものは少しだけ)
    const watchedAt = P.watched.get(id);
    if (watchedAt) {
      const pos = P.positions[id];
      const len = Number(item.lengthSeconds) || 0;
      const ratio = pos && len ? Math.min(1, pos.t / len) : 1;
      const recent = decay(watchedAt, 30);
      s -= (0.25 + 0.45 * ratio) * (0.55 + 0.45 * recent);
    }
    // 何度も表示されたのに押されなかった動画
    const imp = ctx.imp[id];
    if (imp && imp.n > 1) s -= 0.05 * Math.min(6, imp.n - 1) * decay(imp.ts, 10);
    // 同じ検索語で前にも表示した動画は少しだけ下げる (完全には消さない)
    s -= queryPenalty(ctx.qimp, id);
    // 直前の更新で表示した動画も下げる
    if (ctx.shown) s -= ctx.shown.get(id) || 0;
    // 毎回まったく同じ並びにならないよう、ごく小さな揺らぎを足す
    s += (Math.random() - 0.5) * 0.08;

    return { s, why: '' };
  }

  // ── 並び替え (点数順 → 同じチャンネルが続かないように混ぜる) ──
  function rank(items, opts = {}) {
    if (!Array.isArray(items) || items.length < 2) return items || [];
    const ctx = {
      profile: buildProfile(),
      imp: getImpressions(),
      qimp: getQueryImpressions(opts.impQuery || opts.query || ''),
      q: (opts.query || '').trim(),
      qToks: [...new Set(tokens(opts.query || ''))],
      shown: opts.shownKey ? shownMap(opts.shownKey) : null,
    };
    const n = items.length;
    const jit = Number(opts.jitter) || 0;
    const scored = items.map((it, i) => {
      let s = scoreItem(it, i, n, ctx).s;
      // 一番上 (もっとも関連性が高いもの) は揺らさない
      if (jit && i > 0) s += (Math.random() - 0.5) * 2 * jit;
      return { it, s, i };
    });
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    const out = [];
    const pool = scored.slice();
    while (pool.length) {
      let best = 0, bestVal = -Infinity;
      const look = Math.min(pool.length, 8);
      for (let k = 0; k < look; k++) {
        const c = pool[k];
        let val = c.s;
        const a = c.it.authorId;
        if (a) {
          if (out.length && out[out.length - 1].authorId === a) val -= 0.18;
          if (out.length > 1 && out[out.length - 2].authorId === a) val -= 0.08;
        }
        if (val > bestVal) { bestVal = val; best = k; }
      }
      out.push(pool.splice(best, 1)[0].it);
    }
    return out;
  }

  function isWatched(videoId) {
    const P = buildProfile();
    return P.watched.has(videoId);
  }
  function watchProgress(videoId, lengthSeconds) {
    const P = buildProfile();
    const pos = P.positions[videoId];
    const len = Number(lengthSeconds) || 0;
    if (pos && pos.t && len) return Math.max(0.03, Math.min(1, pos.t / len));
    if (P.watched.has(videoId)) return 1;
    return 0;
  }

  // ── 下の方に控えている「まだ表示も視聴もしていない」動画を数本だけ上位へ繰り上げる ──
  //   list は点数順。from より後ろから最大 count 本を、slots の位置へ差し込む (重複はしない)
  function isFresh(id, shown, qimp) {
    if (!id) return false;
    if (buildProfile().watched.has(id)) return false;
    if (shown && shown.has(id)) return false;
    if (qimp && qimp[id] && qimp[id].n) return false;
    return true;
  }
  function promoteFresh(list, opts = {}) {
    if (!Array.isArray(list) || list.length < 8) return list;
    const from = Math.max(6, Math.min(opts.from || 16, Math.floor(list.length * 0.6)));
    const count = opts.count || 4;
    const slots = opts.slots || [2, 5, 8, 11];
    const shown = opts.shownKey ? shownMap(opts.shownKey) : null;
    const qimp = opts.impQuery ? getQueryImpressions(opts.impQuery) : null;
    const picks = [];
    for (let i = from; i < list.length && picks.length < count; i++) {
      const it = list[i];
      if (!it || (it.type && it.type !== 'video')) continue;
      if (isFresh(it.videoId, shown, qimp)) picks.push(it);
    }
    if (!picks.length) return list;
    const pickSet = new Set(picks);
    const out = list.filter(it => !pickSet.has(it));
    picks.forEach((it, k) => out.splice(Math.min(out.length, slots[k] != null ? slots[k] : slots[slots.length - 1] + 3 * k), 0, it));
    return out;
  }

  function resetProfile() { _profile = null; _profileAt = 0; }
  function penaltyFor(query, id) { return queryPenalty(getQueryImpressions(query), id); }

  return { rank, tokens, recordImpressions, recordQueryImpressions, penaltyFor, recordClick, isWatched, watchProgress, buildProfile, resetProfile, recordShown, promoteFresh };
})();
window.VyRank = VyRank;
