/* ==========================================================================
   画質の選択 (144p 〜 4320p)
   - 音声付き (muxed) と 映像だけ (adaptive / Zernio) の候補をまとめる
   - 「表示上の画質名」ではなく、実際に読み込んだ映像の大きさで画質を判定する
     (取得元によってはラベルと中身が違うため)
   - 再生できない形式・読み込めない URL はメニューに出さない
   ========================================================================== */
const VyQuality = (() => {
  const LADDER = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
  const CODEC_PREF = { h264: 0, vp9: 1, av1: 2, other: 3 };

  let videoId = '';
  let muxed = new Map();        // p -> fmt (音声付き)
  let adaptive = new Map();     // p -> { fmt, url, codec, fps } (確認済みの映像だけの候補)
  let pending = [];             // 確認待ちの候補
  let seenUrls = new Set();
  let failedUrls = new Set();
  let audioUrls = [];           // 映像だけの再生に合わせる音声
  let current = null;           // { p, kind: 'muxed' | 'adaptive', url }
  let probing = 0;
  let autoApplied = false;
  let zernioRequested = false;
  let zernioLoading = false;
  let hlsRef = null;            // ライブ (HLS) のときの画質
  let gen = 0;

  const $ = (id) => document.getElementById(id);

  function codecOf(f) {
    const t = `${f.type || ''} ${f.encoding || ''} ${f.codec || ''}`.toLowerCase();
    if (/av01|av1/.test(t)) return 'av1';
    if (/vp0?9|vp9/.test(t)) return 'vp9';
    if (/avc|h\.?264/.test(t)) return 'h264';
    if ((f.container || '') === 'webm') return 'vp9';
    return 'other';
  }

  // 幅・高さ → 本家と同じ「p」の数え方 (横長: 高さ / 縦長: 幅、横に広い映像は幅から換算)
  function pFromSize(w, h) {
    w = Number(w) || 0; h = Number(h) || 0;
    if (!w || !h) return 0;
    const short = Math.min(w, h), long = Math.max(w, h);
    return Math.max(short, Math.round(long * 9 / 16));
  }
  function snap(p) {
    if (!p) return 0;
    let best = 0, bestD = Infinity;
    LADDER.forEach(L => {
      const d = Math.abs(Math.log(p / L));
      if (d < bestD) { bestD = d; best = L; }
    });
    return bestD < 0.25 ? best : 0;
  }
  function claimedP(f) {
    const m = String(f.qualityLabel || f.quality || '').match(/(\d{3,4})p/);
    if (m) return snap(parseInt(m[1], 10));
    const s = String(f.size || f.resolution || '').match(/(\d+)\s*x\s*(\d+)/);
    if (s) return snap(pFromSize(s[1], s[2]));
    if (f.width && f.height) return snap(pFromSize(f.width, f.height));
    if (f.height) return snap(Number(f.height));
    return 0;
  }
  function fpsOf(f) {
    const m = String(f.qualityLabel || '').match(/p(\d{2,3})/);
    return Number(f.fps) || (m ? Number(m[1]) : 0) || 0;
  }
  function label(p, fps) {
    const tag = p >= 4320 ? ' 8K' : p >= 2160 ? ' 4K' : p >= 1440 ? ' QHD' : p >= 720 ? ' HD' : '';
    return `${p}p${fps && fps > 30 ? fps : ''}${tag}`;
  }
  function shortLabel(p, fps) { return `${p}p${fps && fps > 30 ? fps : ''}`; }

  function canPlay(type) {
    if (!type) return true;
    try {
      const v = document.createElement('video');
      if (v.canPlayType(type)) return true;
      if (window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported(type)) return true;
    } catch {}
    return false;
  }

  function reset(vid) {
    gen++;
    videoId = vid || videoId;
    muxed = new Map(); adaptive = new Map(); pending = []; seenUrls = new Set(); failedUrls = new Set();
    audioUrls = []; current = null; probing = 0; autoApplied = false; zernioRequested = false; zernioLoading = false; hlsRef = null;
  }

  /* ── 候補の登録 ── */
  function setMuxed(formats, playing) {
    const vid = (typeof currentVideoId !== 'undefined' && currentVideoId) || videoId;
    if (vid !== videoId) reset(vid);
    hlsRef = null;
    muxed = new Map();
    (formats || []).forEach(f => {
      if (!f || !f.url) return;
      if (f.type && !canPlay(f.type)) return;
      const p = claimedP(f) || 360;
      if (!muxed.has(p)) muxed.set(p, f);
      // 音声付きの映像は、映像だけの候補の音声としても使える
      if (!audioUrls.includes(f.url)) audioUrls.push(f.url);
    });
    if (playing && playing.url) current = { p: claimedP(playing) || 360, kind: 'muxed', url: playing.url, fps: fpsOf(playing) };
    render();
    // 音声付きは 360p だけのことが多いので、前に高い画質を選んでいたら裏で候補を集める
    // (そうでなければ画質メニューを開いたときに集める)
    if (prefP() > (current ? current.p : 0)) requestZernioAll();
    bindMenu();
  }

  function bindMenu() {
    const btn = $('vcQualBtn');
    if (!btn || btn.dataset.vyQBound) return;
    btn.dataset.vyQBound = '1';
    btn.addEventListener('click', () => { if (!hlsRef) { requestZernioAll(); render(); } });
  }

  function addAdaptive(streamData) {
    if (!streamData) return;
    const af = streamData.adaptiveFormats || [];
    const audios = af.filter(f => f && f.url && /^audio\//.test(f.type || '') && canPlay(f.type))
      .sort((a, b) => {
        // ブラウザで扱いやすい AAC → Opus の順、同じなら高ビットレート
        const ca = /mp4a|aac/.test(a.type) ? 0 : 1, cb = /mp4a|aac/.test(b.type) ? 0 : 1;
        return ca - cb || (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0);
      });
    // 専用の音声を前に (音声付き映像より軽い)
    audioUrls = audios.map(f => f.url).concat(audioUrls.filter(u => !audios.some(a => a.url === u)));
    af.filter(f => f && f.url && /^video\//.test(f.type || '')).forEach(f => queue({
      url: f.url, claimed: claimedP(f), codec: codecOf(f), fps: fpsOf(f), type: f.type, src: 'adaptive',
    }));
    pump();
  }

  function addZernio(list) {
    (list || []).forEach(x => {
      if (!x || !x.url || x.error) return;
      if (x.type === 'combined') {
        if (!audioUrls.includes(x.url)) audioUrls.push(x.url);
        return;
      }
      queue({ url: x.url, claimed: snap(parseInt(x.quality, 10)) || 0, codec: codecOf({ codec: x.codec }), fps: 0, type: '', src: 'zernio' });
    });
    pump();
  }

  function requestZernioAll() {
    if (zernioRequested || !videoId) return;
    zernioRequested = true;
    zernioLoading = true;
    const g = gen;
    fetch(`/api/zerniostream/${encodeURIComponent(videoId)}/all`, { signal: AbortSignal.timeout(30000) })
      .then(r => r.ok ? r.json() : [])
      .then(list => { if (g === gen) { zernioLoading = false; addZernio(Array.isArray(list) ? list : []); } })
      .catch(() => { if (g === gen) { zernioLoading = false; render(); } });
  }

  function queue(c) {
    if (!c.url || seenUrls.has(c.url) || failedUrls.has(c.url)) return;
    if (c.type && !canPlay(c.type)) return;
    seenUrls.add(c.url);
    pending.push(c);
  }

  /* ── 実際に読み込んで画質を確かめる (メタデータだけ読むので軽い) ── */
  function probe(url) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata';
      let done = false;
      const fin = (r) => { if (done) return; done = true; try { v.removeAttribute('src'); v.load(); } catch {} resolve(r); };
      v.onloadedmetadata = () => fin({ ok: true, w: v.videoWidth, h: v.videoHeight });
      v.onerror = () => fin({ ok: false });
      setTimeout(() => fin({ ok: false, timeout: true }), 15000);
      v.src = url;
    });
  }

  function needProbe(c) {
    // すでに同じ画質で、より良い (再生しやすい) 形式が確認済みなら確かめない
    const have = adaptive.get(c.claimed);
    if (have && CODEC_PREF[have.codec] <= CODEC_PREF[c.codec]) return false;
    return true;
  }

  function pump() {
    const g = gen;
    pending.sort((a, b) => (b.claimed - a.claimed) || (CODEC_PREF[a.codec] - CODEC_PREF[b.codec]));
    while (probing < 2 && pending.length) {
      const c = pending.shift();
      if (!needProbe(c)) continue;
      probing++;
      render();
      probe(c.url).then(r => {
        if (g !== gen) return;
        probing--;
        if (r.ok && r.w && r.h) {
          const p = snap(pFromSize(r.w, r.h));
          if (p) {
            const have = adaptive.get(p);
            if (!have || CODEC_PREF[c.codec] < CODEC_PREF[have.codec]) {
              adaptive.set(p, { url: c.url, codec: c.codec, fps: c.fps, p, src: c.src });
            }
          }
        } else {
          failedUrls.add(c.url);
        }
        render();
        maybeAutoApply();
        pump();
      });
    }
    render();
  }

  /* ── メニュー ── */
  function options() {
    const out = new Map();
    // 映像だけの候補は音声と組み合わせられるときだけ
    if (audioUrls.length) adaptive.forEach((a, p) => out.set(p, { p, kind: 'adaptive', url: a.url, fps: a.fps }));
    // 同じ画質なら音声付きを優先 (切り替えが軽く確実)
    muxed.forEach((f, p) => out.set(p, { p, kind: 'muxed', url: f.url, fps: fpsOf(f), fmt: f }));
    return Array.from(out.values()).sort((a, b) => b.p - a.p);
  }

  function render() {
    const opts = $('vcQualOpts');
    const btn = $('vcQualBtn');
    if (!opts) return;
    if (hlsRef) return renderHls();
    const list = options();
    opts.innerHTML = '';
    list.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vctrls-dd-opt vy-q-opt';
      b.dataset.p = String(o.p);
      b.dataset.url = o.url;
      b.textContent = label(o.p, o.fps);
      if (current && current.p === o.p) b.classList.add('active');
      b.addEventListener('click', (e) => { e.stopPropagation(); select(o.p, true); });
      opts.appendChild(b);
    });
    if (probing || pending.length || (zernioRequested && zernioLoading)) {
      const s = document.createElement('span');
      s.className = 'vctrls-dd-loading vy-q-checking';
      s.textContent = '他の画質を確認中…';
      opts.appendChild(s);
    }
    if (!list.length && !probing && !pending.length) {
      const s = document.createElement('span');
      s.className = 'vctrls-dd-loading';
      s.textContent = '画質を取得中…';
      opts.appendChild(s);
    }
    if (btn && current) btn.textContent = shortLabel(current.p, current.fps);
  }

  /* ── 切り替え ── */
  function savePref(p) { try { sessionStorage.setItem('vyslo_user_quality', p + 'p'); } catch {} }
  function prefP() {
    try { const v = sessionStorage.getItem('vyslo_user_quality') || ''; return snap(parseInt(v, 10)) || 0; } catch { return 0; }
  }

  function maybeAutoApply() {
    // 前に選んだ画質が後から確認できたら、一度だけその画質に合わせる
    if (autoApplied) return;
    const want = prefP();
    if (!want || !current || current.p >= want) return;
    const o = options().find(x => x.p === want);
    if (!o) return;
    autoApplied = true;
    select(want, false);
  }

  function closeMenus() {
    document.querySelectorAll('.vctrls-dd-wrap.dd-open').forEach(w => w.classList.remove('dd-open'));
  }

  function select(p, byUser) {
    const o = options().find(x => x.p === p);
    if (!o) return;
    if (byUser) { savePref(p); autoApplied = true; }
    closeMenus();
    if (current && current.p === p && current.url === o.url) return;
    if (o.kind === 'muxed') playMuxed(o);
    else playAdaptive(o);
  }

  function restoreVolume(player) {
    if (typeof volState === 'undefined') return;
    player.volume = volState.vol;
    player.muted = volState.muted;
  }

  function playMuxed(o) {
    const player = $('videoPlayer');
    if (!player) return;
    const ct = player.currentTime || 0;
    const wasPlaying = !player.paused;
    if (typeof hqActive !== 'undefined' && hqActive && typeof teardownHQ === 'function') teardownHQ();
    restoreVolume(player);
    if (typeof lastNormalStreamSrc !== 'undefined') lastNormalStreamSrc = o.url;
    applyVideoSrc(player, o.url);
    player.addEventListener('loadedmetadata', () => {
      try { player.currentTime = ct; } catch {}
      if (wasPlaying) player.play().catch(() => {});
    }, { once: true });
    current = { p: o.p, kind: 'muxed', url: o.url, fps: o.fps };
    render();
  }

  function playAdaptive(o) {
    const player = $('videoPlayer');
    const audio = $('hqAudio');
    if (!player || !audio || !audioUrls.length) return;
    const ct = player.currentTime || 0;
    const wasPlaying = !player.paused || player.autoplay;
    const prev = current;
    if (typeof hqSyncRemovers !== 'undefined') { hqSyncRemovers.forEach(fn => fn()); hqSyncRemovers = []; }
    audio.pause();
    player.muted = true;
    applyVideoSrc(player, o.url);
    audio.src = audioUrls[0];
    if (typeof volState !== 'undefined') { audio.volume = volState.vol; audio.muted = volState.muted; }
    audio.playbackRate = player.playbackRate || 1;
    if (typeof hqActive !== 'undefined') hqActive = true;
    if (typeof setupHQSync === 'function') setupHQSync(player, audio);
    player.addEventListener('loadedmetadata', () => {
      try { player.currentTime = ct; audio.currentTime = ct; } catch {}
      if (wasPlaying && typeof tryAutoplay === 'function') tryAutoplay(player, audio);
    }, { once: true });
    current = { p: o.p, kind: 'adaptive', url: o.url, fps: o.fps, prev };
    render();
  }

  // 映像だけの再生で読み込みに失敗したら、その画質を外して元に戻す (true = こちらで処理した)
  function handleError() {
    if (!current || current.kind !== 'adaptive') return false;
    const bad = current;
    failedUrls.add(bad.url);
    adaptive.forEach((a, p) => { if (a.url === bad.url) adaptive.delete(p); });
    const fallback = options().find(x => x.kind === 'muxed') || options()[0];
    current = bad.prev && bad.prev.kind === 'muxed' ? bad.prev : null;
    if (fallback) {
      if (fallback.kind === 'muxed') playMuxed(fallback);
      else playAdaptive(fallback);
    } else {
      render();
    }
    if (typeof showCopyToast === 'function') showCopyToast(`${bad.p}p は再生できなかったため画質を戻しました`);
    return true;
  }

  /* ── ライブ (HLS) の画質 ── */
  function setHls(hls) {
    hlsRef = hls;
    renderHls();
  }
  function renderHls() {
    const opts = $('vcQualOpts');
    const btn = $('vcQualBtn');
    if (!opts || !hlsRef) return;
    const levels = (hlsRef.levels || []).map((l, i) => ({ i, p: snap(pFromSize(l.width, l.height)) || l.height || 0, fps: l.frameRate || 0 }))
      .filter(l => l.p);
    // 同じ画質は 1 つに
    const byP = new Map();
    levels.forEach(l => { if (!byP.has(l.p)) byP.set(l.p, l); });
    const list = Array.from(byP.values()).sort((a, b) => b.p - a.p);
    opts.innerHTML = '';
    const auto = document.createElement('button');
    auto.type = 'button';
    auto.className = 'vctrls-dd-opt vy-q-opt' + (hlsRef.autoLevelEnabled ? ' active' : '');
    const curLv = hlsRef.levels && hlsRef.levels[hlsRef.currentLevel];
    auto.textContent = '自動' + (hlsRef.autoLevelEnabled && curLv ? ` (${snap(pFromSize(curLv.width, curLv.height)) || curLv.height}p)` : '');
    auto.addEventListener('click', (e) => { e.stopPropagation(); hlsRef.currentLevel = -1; closeMenus(); renderHls(); });
    opts.appendChild(auto);
    list.forEach(l => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vctrls-dd-opt vy-q-opt' + (!hlsRef.autoLevelEnabled && hlsRef.currentLevel === l.i ? ' active' : '');
      b.textContent = label(l.p, l.fps);
      b.addEventListener('click', (e) => { e.stopPropagation(); hlsRef.currentLevel = l.i; closeMenus(); renderHls(); });
      opts.appendChild(b);
    });
    if (btn) {
      if (hlsRef.autoLevelEnabled) btn.textContent = curLv ? `自動 ${snap(pFromSize(curLv.width, curLv.height)) || curLv.height}p` : '自動';
      else if (curLv) btn.textContent = shortLabel(snap(pFromSize(curLv.width, curLv.height)) || curLv.height, curLv.frameRate);
    }
  }

  return {
    reset, setMuxed, addAdaptive, addZernio, select, handleError, setHls, renderHls,
    get current() { return current; },
    _debug: () => ({ muxed: Array.from(muxed.keys()), adaptive: Array.from(adaptive.entries()).map(([p, a]) => [p, a.codec, a.src]), audio: audioUrls.length, pending: pending.length, probing }),
    LADDER,
  };
})();
window.VyQuality = VyQuality;
