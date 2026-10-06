function instanceHostname(invInstance) {
  if (!invInstance) return '';
  if (invInstance === 'rapidapi') return 'RapidAPI';
  if (invInstance === 'zernio') return 'Zernio';
  if (invInstance === 'sia') return 'Sia';
  if (invInstance === 'piped') return 'Piped';
  try { return new URL(invInstance).hostname; } catch { return invInstance; }
}

async function fetchZernioStreamData(videoId) {
  const res = await fetch(`/api/zerniostream/${encodeURIComponent(videoId)}?formatId=2`, {
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Zernio HTTP ${res.status}`);
  const url = (await res.text()).trim();
  if (!url || !url.startsWith('http')) throw new Error('無効なZernio URL');
  return {
    data: {
      formatStreams: [{ url, quality: '360p', qualityLabel: '360p', container: 'mp4' }],
      adaptiveFormats: []
    },
    instanceUrl: 'zernio'
  };
}

async function fetchBestStream(videoId, excludeParam) {
  const invPath = `/api/stream/${videoId}${excludeParam || ''}`;
  const src = (typeof streamSourcePref !== 'undefined') ? streamSourcePref : 'auto';
  if (src === 'invidious') return fetchStream(invPath);
  if (src === 'rapidapi')  return fetchRapidStream(videoId);
  if (src === 'zernio')    return fetchZernioStreamData(videoId);
  if (src === 'sia')       return fetchSiaStream(videoId);

  // auto: 軽量ルート（Zernio 360p）を優先的に試し、失敗時のみ他ルートへ
  // ただしHQモード等で高画質が必要な場合は並行取得も継続
  try {
    const zernioResult = await Promise.race([
      fetchZernioStreamData(videoId),
      new Promise((_, rej) => setTimeout(() => rej(new Error('zernio_timeout')), 8000))
    ]);
    if (zernioResult && zernioResult.data && zernioResult.data.formatStreams && zernioResult.data.formatStreams.length > 0) {
      // Zernio成功時はバックグラウンドでInv/Rapidを取得（HQ・音声のみ用）
      if (typeof setPendingHQMode === 'function') setPendingHQMode();
      const capturedGen = _reloadGen;
      Promise.any([fetchStream(invPath), fetchRapidStream(videoId)]).then(bgResult => {
        if (capturedGen !== _reloadGen) return;
        if (typeof initHQMode === 'function') initHQMode(bgResult.data);
        setHQInstanceLabel(bgResult.instanceUrl);
        const adaptiveFormats = bgResult.data.adaptiveFormats || [];
        const audioFormats = adaptiveFormats
          .filter(f => f.type?.startsWith('audio/'))
          .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
        const videoFormats = adaptiveFormats.filter(f => f.type?.startsWith('video/'));
        if (audioFormats.length > 0) {
          streamBestAudioUrl = audioFormats[0].url;
          streamAudioFormats = audioFormats;
        }
        if (videoFormats.length > 0) {
          streamVideoFormats = videoFormats;
        }
        if (typeof setupStreamOnlyBtns === 'function') setupStreamOnlyBtns();
      }).catch(() => {
        if (capturedGen !== _reloadGen) return;
        if (typeof setHQModeError === 'function') setHQModeError();
      });
      return zernioResult;
    }
  } catch (_) {}

  // Zernio失敗時: 残りのソースを並行試行
  const invPromise    = fetchStream(invPath);
  const rapidPromise  = fetchRapidStream(videoId);
  const siaPromise    = fetchSiaStream(videoId);

  const winner = await Promise.any([siaPromise, invPromise, rapidPromise])
    .catch(() => fetchStream(invPath));

  return winner;
}

function setInstanceLabel(invInstance) {
  const label = document.getElementById('streamInstanceLabel');
  if (!label) return;
  label.textContent = instanceHostname(invInstance);
}

function setHQInstanceLabel(invInstance) {
  const label = document.getElementById('hqInstanceLabel');
  if (!label) return;
  label.textContent = instanceHostname(invInstance);
}

async function doStreamAlt(videoId, restoreTime = 0) {
  const btn = document.getElementById('streamAltBtn');
  const status = document.getElementById('streamAltStatus');
  const shouldShowStatus = () => isStreamModeActive();

  if (btn) btn.disabled = true;
  if (status && shouldShowStatus()) { status.textContent = '取得中…'; status.className = 'pc-alt-status'; }

  try {
    const excludeParam = streamExcludeList.length
      ? '?exclude=' + encodeURIComponent(streamExcludeList.join(','))
      : '';
    const result = await fetchBestStream(videoId, excludeParam);

    const { data: newStreamData, instanceUrl: newInstanceUrl } = result;

    const newInvInstance = newInstanceUrl || newStreamData._invidious_instance || null;
    if (newInvInstance && !streamExcludeList.includes(newInvInstance)) {
      streamExcludeList.push(newInvInstance);
    }

    if (!isStreamModeActive()) return;

    const player = document.getElementById('videoPlayer');
    const skeleton = document.getElementById('playerSkeleton');
    const errorEl = document.getElementById('playerError');
    const qualityBtns = document.getElementById('qualityBtns');
    if (!player) return;

    skeleton.hidden = true;
    errorEl.hidden = true;

    if (qualityBtns) qualityBtns.innerHTML = '';

    const formats = newStreamData.formatStreams || [];
    if (formats.length === 0) {
      if (isStreamModeActive()) {
        errorEl.hidden = false;
        document.getElementById('playerErrorMsg').textContent = '動画の取得中にエラーが発生しました。ページを更新してみてください。';
        const _reloadBtn = document.getElementById('reloadBtn');
        if (_reloadBtn) _reloadBtn.hidden = false;
        if (status) { status.textContent = 'ストリームURLなし'; status.className = 'pc-alt-status stream-alt-fail'; }
      }
      throw new Error('no formats');
    } else {
      setInstanceLabel(newInvInstance);
      streamOnlyMode = 'normal';
      const _dsPw = document.getElementById('playerWrap');
      if (_dsPw) _dsPw.classList.remove('stream-audio-only');
      const _dsAtb = document.getElementById('audioTrackBar');
      if (_dsAtb) _dsAtb.setAttribute('hidden', '');
      const _dsVtb = document.getElementById('videoTrackBar');
      if (_dsVtb) _dsVtb.setAttribute('hidden', '');
      const bestFormat = setupQualities(formats);
      if (bestFormat) {
        lastNormalStreamSrc = bestFormat.url;
        applyVideoSrc(player, bestFormat.url);
        player.muted = volState.muted;
        const vcQualBtn2 = document.getElementById('vcQualBtn');
        if (!window.VyQuality) {
          if (vcQualBtn2) vcQualBtn2.textContent = bestFormat.qualityLabel || bestFormat.quality || '画質';
          const firstOpt2 = document.querySelector('#vcQualOpts .vctrls-dd-opt');
          if (firstOpt2) firstOpt2.classList.add('active');
        }
        document.querySelectorAll('#qualityBtns .quality-btn-track[data-track-mode="normal"]').forEach(b => b.classList.add('active'));
        if (isStreamModeActive()) {
          player.removeAttribute('hidden');
          if (restoreTime > 0) {
            player.addEventListener('loadedmetadata', () => {
              player.currentTime = restoreTime;
              tryAutoplay(player, null);
            }, { once: true });
          } else {
            tryAutoplay(player, null);
          }
        }
      }
      setupStreamOnlyBtns();
      if (status && isStreamModeActive()) {
        status.textContent = '読み込み完了';
        status.className = 'pc-alt-status stream-alt-ok';
        setTimeout(() => { status.textContent = ''; status.className = 'pc-alt-status'; }, 2500);
      }
    }
  } catch (e) {
    if (status && shouldShowStatus()) { status.textContent = '取得に失敗しました'; status.className = 'pc-alt-status stream-alt-fail'; }
    throw e;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initStreamAltBtn(videoId) {
  const btn = document.getElementById('streamAltBtn');
  if (!btn || btn.dataset.vyBound) return;
  btn.dataset.vyBound = '1';
  btn.addEventListener('click', () => doStreamAlt(videoId));
}

function fmtTime(s) {
  s = Math.floor(s) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function setSliderfill(el) {
  const pct = ((parseFloat(el.value) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min)) * 100).toFixed(2) + '%';
  el.style.setProperty('--pct', pct);
}

function initCustomControls() {
  const player      = document.getElementById('videoPlayer');
  const playerWrap  = document.getElementById('playerWrap');
  const vctrls      = document.getElementById('vctrls');
  const vcPlay      = document.getElementById('vcPlay');
  const vcMute      = document.getElementById('vcMute');
  const vcVol       = document.getElementById('vcVol');
  const vcSeek      = document.getElementById('vcSeek');
  const vcBuf       = document.getElementById('vcBuf');
  const vcTime      = document.getElementById('vcTime');
  const vcFs        = document.getElementById('vcFs');
  const vcVolPct    = document.getElementById('vcVolPct');
  const vcRepeat    = document.getElementById('vcRepeat');
  const vcAutoNext  = document.getElementById('vcAutoNext');
  const vcAutoplay  = document.getElementById('vcAutoplay');
  const vcSettings  = document.getElementById('vcSettings');
  const vcNarrationOff = document.getElementById('vcNarrationOff');
  const vcSkipBack  = document.getElementById('vcSkipBack');
  const vcSkipFwd   = document.getElementById('vcSkipFwd');
  const vcCenterPlay  = document.getElementById('vcCenterPlay');
  const vcCenterIcon  = document.getElementById('vcCenterIcon');
  const vcSpeedWrap   = document.getElementById('vcSpeedWrap');
  const vcSpeedBtn    = document.getElementById('vcSpeedBtn');
  const vcSpeedPanel  = document.getElementById('vcSpeedPanel');
  const vcQualWrap    = document.getElementById('vcQualWrap');
  const vcHQVidWrap   = document.getElementById('vcHQVidWrap');
  const vcHQAudWrap   = document.getElementById('vcHQAudWrap');
  const kbBackdrop    = document.getElementById('kbModalBackdrop');
  const kbClose       = document.getElementById('kbModalClose');

  const IC = {
    play:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="5,3 19,12 5,21"/></svg>`,
    pause:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="3" width="4" height="18"/><rect x="14" y="3" width="4" height="18"/></svg>`,
    play_lg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><polygon points="5,3 19,12 5,21"/></svg>`,
    pause_lg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><rect x="6" y="3" width="4" height="18"/><rect x="14" y="3" width="4" height="18"/></svg>`,
    volOn:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    volLow:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    volOff:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
    fsOn:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
    fsOff:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`,
  };

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

  function audioEl() {
    return (hqActive && document.getElementById('hqAudio')) || player;
  }

  // ── Show / hide controls ──
  let hideTimer;
  let playerHovered = false;

  function isIframeMode() {
    const nc = document.getElementById('modeNocookie');
    const ed = document.getElementById('modeEdu');
    return (nc && nc.classList.contains('active')) || (ed && ed.classList.contains('active'));
  }

  function showCtrls() {
    if (isIframeMode()) return;
    vctrls.classList.add('vctrls-show');
    clearTimeout(hideTimer);
    if (!player.paused) {
      hideTimer = setTimeout(() => {
        if (!player.paused) {
          vctrls.classList.remove('vctrls-show');
          playerWrap.classList.add('ctrls-playing-hidden');
        }
      }, 3000);
    }
  }
  function keepCtrls() {
    if (isIframeMode()) return;
    vctrls.classList.add('vctrls-show');
    playerWrap.classList.remove('ctrls-playing-hidden');
    clearTimeout(hideTimer);
  }

  playerWrap.addEventListener('mousemove', () => { playerHovered = true; showCtrls(); });
  playerWrap.addEventListener('mouseenter', () => { playerHovered = true; showCtrls(); updateCenterShow(); });
  playerWrap.addEventListener('mouseleave', () => {
    playerHovered = false;
    vcCenterPlay.classList.remove('vctrls-center-show');
    if (!player.paused) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        vctrls.classList.remove('vctrls-show');
        playerWrap.classList.add('ctrls-playing-hidden');
      }, 800);
    }
  });
  vctrls.addEventListener('mouseenter', keepCtrls);
  vctrls.addEventListener('mousemove', keepCtrls);

  // ── Center play overlay (hover-only) ──
  function updateCenterIcon() {
    vcCenterIcon.innerHTML = player.paused ? IC.play_lg : IC.pause_lg;
  }
  function updateCenterShow() {
    if (isIframeMode() || !playerHovered || !player.paused) {
      vcCenterPlay.classList.remove('vctrls-center-show');
    } else {
      updateCenterIcon();
      vcCenterPlay.classList.add('vctrls-center-show');
    }
  }
  vcCenterIcon.addEventListener('click', () => {
    if (isIframeMode()) return;
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });

  // ── Skip flash indicator ──
  function makeFlash(side, sec) {
    const el = document.createElement('div');
    el.className = `vctrls-skip-flash flash-${side}`;
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="22" height="22">${side === 'left'
      ? '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.54"/>'
      : '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.54"/>'
    }</svg><span>${sec}秒</span>`;
    playerWrap.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add('flashing');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    });
  }

  // ── Play / Pause ──
  function updatePlayBtn() {
    vcPlay.innerHTML = player.paused ? IC.play : IC.pause;
  }
  player.addEventListener('play', () => {
    updatePlayBtn();
    updateCenterShow();
    showCtrls();
  });
  player.addEventListener('pause', () => {
    updatePlayBtn();
    updateCenterShow();
    keepCtrls();
  });
  vcPlay.addEventListener('click', () => {
    if (player.paused) player.play().catch(() => {});
    else player.pause();
  });
  // ── 左右の端付近をすばやく2回クリック/タップ → 10秒戻し / 10秒送り (本家YouTube風) ──
  //   ・端付近の1回目は少しだけ待ち、2回目が来なければ通常どおり再生/一時停止
  //   ・2回目が来たら再生/一時停止はせずに10秒移動。続けてタップすると +10秒ずつ重ねる
  //   ・中央付近のクリック/ダブルクリック (全画面) は今までどおり
  const DT_ZONE   = 0.33;   // 左右それぞれ幅の 33% を「端付近」とみなす
  const DT_WAIT   = 280;    // 2回目を待つ時間 (ms)
  const DT_SERIES = 700;    // 連続タップとみなす時間 (ms)
  let dtTimer = null, dtSide = null, dtLastAt = 0, dtSeries = false, dtCount = 0, dtSeriesTimer = null;

  function dtZoneOf(e) {
    const r = player.getBoundingClientRect();
    if (!r.width) return null;
    const x = (e.clientX - r.left) / r.width;
    if (x < DT_ZONE) return 'left';
    if (x > 1 - DT_ZONE) return 'right';
    return null;
  }
  function dtCanSeek() {
    return !isIframeMode() && isFinite(player.duration) && player.duration > 0;
  }
  function dtEndSeries() { dtSeries = false; dtCount = 0; dtSide = null; }
  function dtSeek(side) {
    dtCount++;
    seekBy(side === 'left' ? -10 : 10);
    showDtAnim(side, dtCount * 10);
    showCtrls();
    clearTimeout(dtSeriesTimer);
    dtSeriesTimer = setTimeout(dtEndSeries, DT_SERIES);
  }

  // 本家のような半円の波紋 + 矢印 + 「10秒」
  const dtEls = {};
  function showDtAnim(side, sec) {
    let el = dtEls[side];
    if (!el || !el.isConnected) {
      el = document.createElement('div');
      el.className = `vy-dtseek vy-dtseek-${side}`;
      el.setAttribute('aria-hidden', 'true');
      const tri = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="' + (side === 'left' ? '18,4 6,12 18,20' : '6,4 18,12 6,20') + '"/></svg>';
      el.innerHTML = `<div class="vy-dtseek-bg"></div><div class="vy-dtseek-in"><div class="vy-dtseek-arrows">${tri}${tri}${tri}</div><div class="vy-dtseek-txt"></div></div>`;
      playerWrap.appendChild(el);
      dtEls[side] = el;
    }
    el.querySelector('.vy-dtseek-txt').textContent = `${sec}秒`;
    el.classList.remove('show');
    void el.offsetWidth;            // アニメーションを最初からやり直す
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 650);
  }

  player.addEventListener('click', (e) => {
    if (e.target !== player) return;
    const side = dtCanSeek() ? dtZoneOf(e) : null;
    const now = performance.now();

    // 連続タップ中: 同じ側ならそのまま +10秒ずつ
    if (dtSeries && side && side === dtSide && now - dtLastAt < DT_SERIES) {
      dtLastAt = now;
      dtSeek(side);
      return;
    }
    if (dtSeries) { clearTimeout(dtSeriesTimer); dtEndSeries(); }

    // 端付近の2回目 → 10秒移動 (1回目の再生/一時停止は取り消す)
    if (dtTimer && side && side === dtSide && now - dtLastAt < DT_WAIT) {
      clearTimeout(dtTimer); dtTimer = null;
      dtSeries = true; dtCount = 0; dtLastAt = now;
      dtSeek(side);
      return;
    }
    // 待機中の1回目 (別の場所) があれば先に実行
    if (dtTimer) { clearTimeout(dtTimer); dtTimer = null; vcPlay.click(); }

    if (!side) { vcPlay.click(); return; }       // 中央付近: 今までどおりすぐ再生/一時停止

    dtSide = side; dtLastAt = now;
    dtTimer = setTimeout(() => { dtTimer = null; dtSide = null; vcPlay.click(); }, DT_WAIT);
  });
  player.addEventListener('dblclick', (e) => {
    if (e.target !== player) return;
    if (dtCanSeek() && dtZoneOf(e)) return;      // 端付近のダブルクリックは10秒移動に使う (全画面にしない)
    vcFs.click();
  });

  // ── 長押しで2倍速 (本家YouTube風: 押している間だけ2倍、離すと元の速度に戻る) ──
  //   ・再生中に動画の上を 450ms 押し続けたら開始。指/マウスが動いたら (スクロールなど) 取り消す
  //   ・長押しのあとのクリックは再生/一時停止・ダブルタップに使わない
  {
    const LP_DELAY = 450, LP_MOVE = 12;
    let lpTimer = null, lpActive = false, lpPrevRate = 1, lpX = 0, lpY = 0, lpSwallowUntil = 0, lpId = null;
    let lpBadge = null;
    const lpShowBadge = (on) => {
      if (!lpBadge) {
        lpBadge = document.createElement('div');
        lpBadge.className = 'vy-lp-badge';
        lpBadge.setAttribute('aria-hidden', 'true');
        lpBadge.innerHTML = '<span>2倍速</span><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="3,5 12,12 3,19"/><polygon points="12,5 21,12 12,19"/></svg>';
        playerWrap.appendChild(lpBadge);
      }
      lpBadge.classList.toggle('show', on);
    };
    const lpClear = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    const lpStart = () => {
      lpTimer = null;
      if (player.paused || player.ended || isIframeMode()) return;
      // LIVE の先端では先へ進めないので 2 倍速にしない (本家と同じ)
      if (typeof VyLive !== 'undefined' && VyLive.hlsOn && VyLive.hlsOn()) { const r = VyLive.range(); if (!r || r.atLive) return; }
      lpActive = true;
      lpPrevRate = player.playbackRate || 1;
      player.playbackRate = 2;
      const audio = document.getElementById('hqAudio');
      if (hqActive && audio) audio.playbackRate = 2;
      lpShowBadge(true);
    };
    const lpEnd = () => {
      lpClear();
      lpId = null;
      if (!lpActive) return;
      lpActive = false;
      player.playbackRate = lpPrevRate;
      const audio = document.getElementById('hqAudio');
      if (hqActive && audio) audio.playbackRate = lpPrevRate;
      lpShowBadge(false);
      lpSwallowUntil = performance.now() + 400;   // この直後のクリックは無視
    };
    player.addEventListener('pointerdown', (e) => {
      if (e.target !== player || (e.pointerType === 'mouse' && e.button !== 0)) return;
      lpClear();
      lpId = e.pointerId; lpX = e.clientX; lpY = e.clientY;
      lpTimer = setTimeout(lpStart, LP_DELAY);
    });
    player.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lpId || lpActive) return;
      if (Math.abs(e.clientX - lpX) > LP_MOVE || Math.abs(e.clientY - lpY) > LP_MOVE) lpClear();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => player.addEventListener(t, (e) => {
      if (lpId !== null && e.pointerId !== lpId) return;
      lpEnd();
    }));
    window.addEventListener('blur', lpEnd);
    document.addEventListener('visibilitychange', () => { if (document.hidden) lpEnd(); });
    // 長押し中にスマホのメニュー (画像を保存など) が出ないように
    player.addEventListener('contextmenu', (e) => { if (lpActive || lpTimer) e.preventDefault(); });
    // 長押しのあとのクリック/ダブルクリックは、再生/一時停止や10秒移動に使わない
    const swallow = (e) => {
      if (e.target === player && (lpActive || performance.now() < lpSwallowUntil)) {
        e.stopPropagation(); e.preventDefault();
      }
    };
    playerWrap.addEventListener('click', swallow, true);
    playerWrap.addEventListener('dblclick', swallow, true);
  }

  // ── Skip ──
  function seekBy(sec) {
    // LIVE (中継): 先端より先・まだ届いていない位置へは行かせない
    if (_liveHls()) { VyLive.seekBy(sec); return; }
    if (player.duration) {
      player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + sec));
      const audio = document.getElementById('hqAudio');
      if (hqActive && audio) audio.currentTime = player.currentTime;
    }
  }
  function doSkip(sec) {
    seekBy(sec);
    makeFlash(sec < 0 ? 'left' : 'right', Math.abs(sec));
    showCtrls();
  }
  vcSkipBack.addEventListener('click', () => doSkip(-10));
  vcSkipFwd.addEventListener('click',  () => doSkip(10));

  // ── Volume ──
  function updateVolUI() {
    const ae = audioEl();
    const isMuted = ae.muted || ae.volume === 0;
    if (isMuted) vcMute.innerHTML = IC.volOff;
    else if (ae.volume < 0.5) vcMute.innerHTML = IC.volLow;
    else vcMute.innerHTML = IC.volOn;
    const displayVal = isMuted ? 0 : ae.volume;
    vcVol.value = displayVal;
    setSliderfill(vcVol);
    if (vcVolPct) vcVolPct.textContent = Math.round(displayVal * 100) + '%';
  }
  vcMute.addEventListener('click', () => {
    const ae = audioEl();
    ae.muted = !ae.muted;
    if (!hqActive) player.muted = ae.muted;
    volState.muted = ae.muted;
    // 音量設定を保存（ロング動画）: ミュート時は0として保存
    try {
      const _saveVol = ae.muted ? 0 : volState.vol;
      localStorage.setItem('vyslo_vol_long', String(_saveVol));
    } catch {}
    updateVolUI();
  });
  vcVol.addEventListener('input', () => {
    const val = parseFloat(vcVol.value);
    const ae = audioEl();
    ae.volume = val;
    ae.muted = val === 0;
    if (!hqActive) { player.volume = val; player.muted = val === 0; }
    volState.vol = val;
    volState.muted = val === 0;
    // 音量設定を保存（ロング動画）
    try { localStorage.setItem('vyslo_vol_long', String(val)); } catch {}
    setSliderfill(vcVol);
    updateVolUI();
  });
  player.addEventListener('volumechange', () => { if (!hqActive) updateVolUI(); });

  player.addEventListener('autoplay-muted', (e) => {
    const ae = audioEl();
    ae.muted = true;
    if (!hqActive) player.muted = true;
    volState.muted = true;
    updateVolUI();
  });

  // ── Seek ──
  let isSeeking = false;
  // LIVE (サーバー中継) を再生中か。通常動画のシークバーとは別に扱う
  const _liveHls = () => typeof VyLive !== 'undefined' && VyLive.hlsOn && VyLive.hlsOn();
  // LIVE: シークできる範囲 (少し前 〜 ライブの先端) の中での位置をシークバーに出す
  function updateLiveSeek() {
    const r = VyLive.range();
    if (!r) return;
    const span = Math.max(1, r.end - r.start);
    const pct = r.atLive ? 1 : Math.max(0, Math.min(1, (r.cur - r.start) / span));
    const v = Math.round(pct * 1000);
    if (+vcSeek.value !== v) { vcSeek.value = v; setSliderfill(vcSeek); }
    if (vcBuf) {
      const b = r.atLive ? 1 : Math.max(pct, Math.min(1, (r.buf - r.start) / span));
      vcBuf.style.width = (b * 100).toFixed(2) + '%';
    }
  }
  // LIVE 中は毎フレーム更新してなめらかに動かす (timeupdate は 1 秒に数回しか来ない)
  let _liveRaf = 0, _liveBadgeT = 0;
  function _liveLoop(ts) {
    if (!_liveHls()) { _liveRaf = 0; return; }
    if (!isSeeking) updateLiveSeek();
    if (!_liveBadgeT || ts - _liveBadgeT > 500) { _liveBadgeT = ts; VyLive.updateBadge(); }
    _liveRaf = requestAnimationFrame(_liveLoop);
  }
  function _startLiveLoop() { if (!_liveRaf && _liveHls()) _liveRaf = requestAnimationFrame(_liveLoop); }
  window.addEventListener('vy-live-hls', () => setTimeout(_startLiveLoop, 0));
  player.addEventListener('playing', _startLiveLoop);
  player.addEventListener('loadedmetadata', _startLiveLoop);
  function updateSeek() {
    if (_liveHls()) { if (!isSeeking) updateLiveSeek(); _startLiveLoop(); return; }
    if (isSeeking || !player.duration) return;
    const pct = player.currentTime / player.duration;
    vcSeek.value = Math.round(pct * 1000);
    setSliderfill(vcSeek);
    vcTime.textContent = `${fmtTime(player.currentTime)} / ${fmtTime(player.duration)}`;
    if (vcBuf && player.buffered.length) {
      const bufEnd = player.buffered.end(player.buffered.length - 1);
      vcBuf.style.width = ((bufEnd / player.duration) * 100).toFixed(2) + '%';
    }
  }
  player.addEventListener('timeupdate', updateSeek);
  player.addEventListener('progress', updateSeek);
  player.addEventListener('loadedmetadata', () => {
    vcSeek.max = 1000;
    updateSeek();
    if (isIframeMode()) return;
    vctrls.classList.add('vctrls-show');
    showCtrls();
  });
  vcSeek.addEventListener('mousedown', () => { isSeeking = true; });
  vcSeek.addEventListener('input', () => {
    setSliderfill(vcSeek);
    const pct = vcSeek.value / 1000;
    if (_liveHls()) { isSeeking = true; return; } // LIVE は指を離したときに移動する
    if (player.duration) vcTime.textContent = `${fmtTime(pct * player.duration)} / ${fmtTime(player.duration)}`;
  });
  vcSeek.addEventListener('change', () => {
    isSeeking = false;
    const pct = vcSeek.value / 1000;
    if (_liveHls()) { VyLive.seekPct(pct); updateLiveSeek(); return; }
    if (player.duration) {
      player.currentTime = pct * player.duration;
      const audio = document.getElementById('hqAudio');
      if (hqActive && audio) audio.currentTime = player.currentTime;
    }
  });

  // ── Generic dropdown helper ──
  function initDropdown(wrap) {
    const btn = wrap.querySelector('.vctrls-dd-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrap.classList.contains('dd-open');
      closeAllDropdowns();
      if (!isOpen) wrap.classList.add('dd-open');
    });
  }
  function closeAllDropdowns() {
    document.querySelectorAll('.vctrls-dd-wrap.dd-open').forEach(w => w.classList.remove('dd-open'));
  }
  document.addEventListener('click', closeAllDropdowns);
  vctrls.addEventListener('click', (e) => e.stopPropagation());

  initDropdown(vcSpeedWrap);
  if (vcQualWrap) initDropdown(vcQualWrap);


  // ── Speed ──
  let currentSpeed = 1;
  function setSpeed(s) {
    currentSpeed = parseFloat(s);
    player.playbackRate = currentSpeed;
    const audio = document.getElementById('hqAudio');
    if (hqActive && audio) audio.playbackRate = currentSpeed;
    vcSpeedBtn.textContent = currentSpeed === 1 ? '1x' : currentSpeed + 'x';
    vcSpeedPanel.querySelectorAll('.vctrls-dd-opt').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === currentSpeed);
    });
    vcSpeedWrap.classList.remove('dd-open');
  }
  vcSpeedPanel.querySelectorAll('.vctrls-dd-opt').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); setSpeed(btn.dataset.speed); });
  });

  // Apply settings: default speed + loop + volume
  const _initSettings = getSettings();
  if (_initSettings.defaultSpeed !== 1) setSpeed(_initSettings.defaultSpeed);
  player.loop = listParam ? false : !!_initSettings.loop;

  // ── トグルボタン (リピート / 次の動画へ / 自動再生) ──
  {
    const _ps = getSettings();

    function _setToggle(btn, active) {
      if (!btn) return;
      btn.classList.toggle('active', active);
      const st = btn.querySelector('.vc-an-state');
      if (st) {
        // 「次の動画へ」: ON/OFF を文字で表示 (薄くして見分けにくくしない)
        st.textContent = active ? 'ON' : 'OFF';
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
        btn.title = active ? '次の動画へ自動で移る: ON (クリックで OFF)' : '次の動画へ自動で移る: OFF (クリックで ON)';
        btn.style.opacity = '';
        return;
      }
      btn.style.opacity = active ? '1' : '0.5';
    }

    // リピート
    _setToggle(vcRepeat, !listParam && !!_ps.loop);
    if (vcRepeat) vcRepeat.addEventListener('click', () => {
      if (listParam) return;
      const next = !vcRepeat.classList.contains('active');
      _setToggle(vcRepeat, next);
      player.loop = next;
      if (next) {
        _setToggle(vcAutoNext, false);
        saveSettings(Object.assign({}, getSettings(), { loop: true, autoplayNext: false }));
      } else {
        saveSettings(Object.assign({}, getSettings(), { loop: false }));
      }
    });

    // 次の動画へ
    _setToggle(vcAutoNext, !!_ps.autoplayNext);
    if (vcAutoNext) vcAutoNext.addEventListener('click', () => {
      if (listParam) return;
      const next = !vcAutoNext.classList.contains('active');
      _setToggle(vcAutoNext, next);
      if (next) {
        _setToggle(vcRepeat, false);
        player.loop = false;
        saveSettings(Object.assign({}, getSettings(), { autoplayNext: true, loop: false }));
      } else {
        saveSettings(Object.assign({}, getSettings(), { autoplayNext: false }));
      }
    });

    // 自動再生
    // 再生・停止ボタンと見分けやすい ON/OFF スイッチ
    function _setAutoplaySwitch(on) {
      if (!vcAutoplay) return;
      vcAutoplay.classList.toggle('active', on);
      vcAutoplay.setAttribute('aria-checked', on ? 'true' : 'false');
      vcAutoplay.title = on ? '自動再生: ON (クリックで OFF)' : '自動再生: OFF (クリックで ON)';
      const st = vcAutoplay.querySelector('.vc-ap-state');
      if (st) st.textContent = on ? 'ON' : 'OFF';
    }
    _setAutoplaySwitch(_ps.autoplay !== false);
    if (vcAutoplay) vcAutoplay.addEventListener('click', () => {
      const next = !vcAutoplay.classList.contains('active');
      _setAutoplaySwitch(next);
      saveSettings(Object.assign({}, getSettings(), { autoplay: next }));
      if (typeof showCopyToast === 'function') showCopyToast(next ? '自動再生を ON にしました' : '自動再生を OFF にしました');
    });
  }

  // ── 再生区間 (clip range) ──
  {
    const clipStartInput  = document.getElementById('clipStartInput');
    const clipEndInput    = document.getElementById('clipEndInput');
    const clipStartError  = document.getElementById('clipStartError');
    const clipEndError    = document.getElementById('clipEndError');
    const clipApplyBtn    = document.getElementById('clipApplyBtn');
    const clipClearBtn    = document.getElementById('clipClearBtn');
    const clipActiveLabel = document.getElementById('clipActiveLabel');

    function _clipUpdateActive() {
      if (!clipActiveLabel) return;
      if (_clipStartSec >= 0 || _clipEndSec >= 0) {
        const parts = [];
        if (_clipStartSec >= 0) parts.push('開始:' + _clipStartSec + 's');
        if (_clipEndSec >= 0)   parts.push('終了:' + _clipEndSec + 's');
        clipActiveLabel.innerHTML = '<svg class="vy-i" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg> ' + parts.join(' / ').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        clipActiveLabel.removeAttribute('hidden');
        if (clipClearBtn) clipClearBtn.removeAttribute('hidden');
      } else {
        clipActiveLabel.setAttribute('hidden', '');
        if (clipClearBtn) clipClearBtn.setAttribute('hidden', '');
      }
    }

    function _validateClipInputs() {
      let valid = true;
      if (clipStartInput && clipStartError) {
        const v = parseTimeSec(clipStartInput.value);
        const hasErr = clipStartInput.value !== '' && v < 0;
        if (hasErr) { clipStartError.removeAttribute('hidden'); valid = false; }
        else           clipStartError.setAttribute('hidden', '');
      }
      if (clipEndInput && clipEndError) {
        const v = parseTimeSec(clipEndInput.value);
        const hasErr = clipEndInput.value !== '' && v < 0;
        if (hasErr) { clipEndError.removeAttribute('hidden'); valid = false; }
        else           clipEndError.setAttribute('hidden', '');
      }
      return valid;
    }

    if (clipStartInput) clipStartInput.addEventListener('input', _validateClipInputs);
    if (clipEndInput)   clipEndInput.addEventListener('input',   _validateClipInputs);

    if (clipApplyBtn) clipApplyBtn.addEventListener('click', () => {
      if (!_validateClipInputs()) return;
      _clipStartSec = clipStartInput ? parseTimeSec(clipStartInput.value) : -1;
      _clipEndSec   = clipEndInput   ? parseTimeSec(clipEndInput.value)   : -1;
      const seekSec = _clipStartSec >= 0 ? _clipStartSec : 0;

      if (isExternalEmbedModeActive()) {
        // iframe モード: seekTo postMessage
        _sendIframeCmd('seekTo', [seekSec, true]);
      } else if (!player.hidden) {
        // ネイティブプレイヤー
        player.currentTime = seekSec;
        if (getSettings().autoplay) player.play().catch(() => {});
      }
      _clipUpdateActive();
    });

    if (clipClearBtn) clipClearBtn.addEventListener('click', () => {
      _clipStartSec = -1;
      _clipEndSec   = -1;
      if (clipStartInput) clipStartInput.value = '';
      if (clipEndInput)   clipEndInput.value   = '';
      if (clipStartError) clipStartError.setAttribute('hidden', '');
      if (clipEndError)   clipEndError.setAttribute('hidden', '');
      _clipUpdateActive();
    });

    // ネイティブプレイヤー: timeupdate で終了位置チェック
    player.addEventListener('timeupdate', function _clipTimeUpdate() {
      if (_clipEndSec >= 0 && player.currentTime >= _clipEndSec) {
        const _s = getSettings();
        const restartSec = _clipStartSec >= 0 ? _clipStartSec : 0;
        if (_s.loop && !player.loop) {
          // ループ設定ON・HTMLループOFF時はJS制御でループ
          player.currentTime = restartSec;
          player.play().catch(() => {});
        } else if (!_s.loop) {
          player.pause();
          player.currentTime = _clipEndSec;
        }
      }
    });
  }

  {
    // 保存済みのロング動画音量を優先的に読み込む
    let _savedLongVol = null;
    try { _savedLongVol = localStorage.getItem('vyslo_vol_long'); } catch {}
    const initVol = _savedLongVol !== null
      ? Math.max(0, Math.min(1, parseFloat(_savedLongVol)))
      : Math.max(0, Math.min(1, (_initSettings.defaultVolume ?? 100) / 100));
    const ae = audioEl();
    ae.volume = initVol;
    ae.muted = initVol === 0;
    player.volume = initVol;
    player.muted = initVol === 0;
    volState.vol = initVol;
    volState.muted = initVol === 0;
    vcVol.value = initVol;
    setSliderfill(vcVol);
    updateVolUI();
  }

  // ── Fullscreen ──
  function updateFsBtn() {
    vcFs.innerHTML = document.fullscreenElement ? IC.fsOff : IC.fsOn;
  }
  vcFs.addEventListener('click', () => {
    if (!document.fullscreenElement) playerWrap.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    updateFsBtn();
    if (document.fullscreenElement) showCtrls();
  });

  // ── Theater mode ──
  function toggleTheater() {
    document.body.classList.toggle('theater-mode');
  }

  // ── Picture-in-Picture ──
  function togglePiP() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else if (player && !player.hidden) {
      player.requestPictureInPicture().catch(() => {});
    }
  }

  // ── Shortcut help modal ──
  function showKbModal() {
    if (kbBackdrop) kbBackdrop.removeAttribute('hidden');
  }
  function hideKbModal() {
    if (kbBackdrop) kbBackdrop.setAttribute('hidden', '');
  }
  const vcKbBtn = document.getElementById('vcKbBtn');
  // vcKbBtn は削除された可能性がある
  if (vcKbBtn) vcKbBtn.addEventListener('click', showKbModal);
  if (kbClose) kbClose.addEventListener('click', hideKbModal);
  if (kbBackdrop) kbBackdrop.addEventListener('click', (e) => {
    if (e.target === kbBackdrop) hideKbModal();
  });

  // ── Tool panel ──
  function buildPcToolPanel() {
    const panel = document.getElementById('pcToolPanel');
    if (!panel) return;
    panel.innerHTML = '';
    const streamActive = !player.hidden;
    const isIframe = isExternalEmbedModeActive();
    const sections = [
      {
        heading: '再生',
        items: [
          { keys: 'Space / K', label: '再生・停止', stream: false, fn: () => {
            if (isIframe) { if (_iframePlayerState === 1) _sendIframeCmd('pauseVideo', []); else _sendIframeCmd('playVideo', []); }
            else vcPlay.click();
          }},
          { keys: '← / J',     label: '5秒戻る',  stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [Math.max(0, getIframeCurrentTime() - 5), true]);
            else doSkip(-5);
          }},
          { keys: '→ / L',     label: '5秒進む',  stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [getIframeCurrentTime() + 5, true]);
            else doSkip(5);
          }},
          { keys: 'Shift+←/J', label: '10秒戻る', stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [Math.max(0, getIframeCurrentTime() - 10), true]);
            else doSkip(-10);
          }},
          { keys: 'Shift+→/L', label: '10秒進む', stream: false, fn: () => {
            if (isIframe) _sendIframeCmd('seekTo', [getIframeCurrentTime() + 10, true]);
            else doSkip(10);
          }},
        ],
      },
      {
        heading: 'ボリューム',
        items: [
          { keys: '↑', label: '音を大きく', stream: false, fn: () => {
            if (isIframe) { _iframeVolume = Math.min(100, _iframeVolume + 10); _sendIframeCmd('setVolume', [_iframeVolume]); }
            else { vcVol.value = Math.min(1, parseFloat(vcVol.value) + 0.1).toFixed(2); vcVol.dispatchEvent(new Event('input')); showCtrls(); }
          }},
          { keys: '↓', label: '音を小さく', stream: false, fn: () => {
            if (isIframe) { _iframeVolume = Math.max(0, _iframeVolume - 10); _sendIframeCmd('setVolume', [_iframeVolume]); }
            else { vcVol.value = Math.max(0, parseFloat(vcVol.value) - 0.1).toFixed(2); vcVol.dispatchEvent(new Event('input')); showCtrls(); }
          }},
          { keys: 'M', label: '消音', stream: false, fn: () => {
            if (isIframe) { _iframeMuted = !_iframeMuted; _sendIframeCmd(_iframeMuted ? 'mute' : 'unMute', []); }
            else vcMute.click();
          }},
        ],
      },
      {
        heading: '画面',
        items: [
          { keys: 'F', label: '全画面',           stream: true,  fn: () => vcFs.click() },
          { keys: 'T', label: 'ワイド表示',           stream: false, fn: () => toggleTheater() },
          { keys: 'P', label: '小窓で再生', stream: true,  fn: () => togglePiP() },
        ],
      },
      {
        heading: 'フレーム・速度',
        items: [
          { keys: ',', label: 'コマ戻し',   stream: true,  fn: () => { player.pause(); player.currentTime = Math.max(0, player.currentTime - FPS); } },
          { keys: '.', label: 'コマ送り',   stream: true,  fn: () => { player.pause(); player.currentTime = Math.min(player.duration || 0, player.currentTime + FPS); } },
          { keys: '<', label: '遅くする', stream: false, fn: () => {
            if (isIframe) { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii > 0 ? ii - 1 : 0; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
            else { const i2 = SPEEDS.indexOf(currentSpeed); if (i2 > 0) setSpeed(SPEEDS[i2 - 1]); }
          }},
          { keys: '>', label: '速くする', stream: false, fn: () => {
            if (isIframe) { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii < SPEEDS.length - 1 ? ii + 1 : ii; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
            else { const i2 = SPEEDS.indexOf(currentSpeed); if (i2 < SPEEDS.length - 1) setSpeed(SPEEDS[i2 + 1]); }
          }},
        ],
      },
      {
        heading: 'ジャンプ (0〜9)',
        grid: true,
        items: Array.from({ length: 10 }, (_, n) => ({
          keys: String(n),
          label: `${n * 10}%`,
          stream: false,
          fn: () => {
            if (isIframe) { if (_iframeDuration > 0) _sendIframeCmd('seekTo', [_iframeDuration * (n / 10), true]); }
            else if (_liveHls()) { VyLive.seekPct(n / 10); showCtrls(); }
            else { if (player.duration) { player.currentTime = player.duration * (n / 10); showCtrls(); } }
          },
        })),
      },
    ];
    sections.forEach((sec, si) => {
      if (si > 0) { const d = document.createElement('div'); d.className = 'pc-tool-divider'; panel.appendChild(d); }
      const h = document.createElement('div');
      h.className = 'pc-tool-heading';
      h.textContent = sec.heading;
      panel.appendChild(h);
      if (sec.grid) {
        const grid = document.createElement('div');
        grid.className = 'pc-tool-grid';
        sec.items.forEach(item => {
          const avail = !item.stream || streamActive;
          const btn = document.createElement('button');
          btn.className = 'pc-tool-grid-btn';
          btn.disabled = !avail;
          btn.title = item.label;
          const kbd = document.createElement('kbd'); kbd.className = 'pc-tool-key'; kbd.textContent = item.keys;
          const lbl = document.createElement('span'); lbl.textContent = item.label;
          btn.appendChild(kbd); btn.appendChild(lbl);
          if (avail) btn.addEventListener('click', () => { closePcToolPanel(); item.fn(); });
          grid.appendChild(btn);
        });
        panel.appendChild(grid);
      } else {
        sec.items.forEach(item => {
          const avail = !item.stream || streamActive;
          const btn = document.createElement('button');
          btn.className = 'pc-tool-item';
          btn.disabled = !avail;
          const kbd = document.createElement('kbd'); kbd.className = 'pc-tool-key'; kbd.textContent = item.keys;
          const lbl = document.createElement('span'); lbl.textContent = item.label;
          btn.appendChild(kbd); btn.appendChild(lbl);
          if (avail) btn.addEventListener('click', () => { closePcToolPanel(); item.fn(); });
          panel.appendChild(btn);
        });
      }
    });
  }
  function openPcToolPanel() {
    buildPcToolPanel();
    const panel = document.getElementById('pcToolPanel');
    if (panel) panel.hidden = false;
    document.getElementById('pcToolBtn')?.classList.add('active');
  }
  function closePcToolPanel() {
    const panel = document.getElementById('pcToolPanel');
    if (panel) panel.hidden = true;
    document.getElementById('pcToolBtn')?.classList.remove('active');
  }
  const pcToolBtn = document.getElementById('pcToolBtn');
  if (pcToolBtn) {
    pcToolBtn.addEventListener('click', e => {
      e.stopPropagation();
      const panel = document.getElementById('pcToolPanel');
      if (!panel || panel.hidden) openPcToolPanel(); else closePcToolPanel();
    });
    document.addEventListener('click', e => {
      const wrap = document.getElementById('pcToolWrap');
      if (wrap && !wrap.contains(e.target)) closePcToolPanel();
    });
  }

  // ── Keyboard shortcuts ──
  const FPS = 1 / 30;
  document.addEventListener('keydown', (e) => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.target.isContentEditable) return;
    if (kbBackdrop && !kbBackdrop.hidden) {
      if (e.key === 'Escape' || e.key === '?') { hideKbModal(); e.preventDefault(); }
      return;
    }
    if (e.key === 't' || e.key === 'T') { toggleTheater(); return; }

    // ── iframeモード: postMessage 経由で制御 ──
    if (isExternalEmbedModeActive()) {
      switch (e.key) {
        case ' ': case 'k': case 'K':
          e.preventDefault();
          if (_iframePlayerState === 1) _sendIframeCmd('pauseVideo', []); else _sendIframeCmd('playVideo', []);
          break;
        case 'ArrowLeft': case 'j': case 'J':
          e.preventDefault();
          _sendIframeCmd('seekTo', [Math.max(0, getIframeCurrentTime() - (e.shiftKey ? 10 : 5)), true]);
          break;
        case 'ArrowRight': case 'l': case 'L':
          e.preventDefault();
          _sendIframeCmd('seekTo', [getIframeCurrentTime() + (e.shiftKey ? 10 : 5), true]);
          break;
        case 'ArrowUp':
          e.preventDefault();
          _iframeVolume = Math.min(100, _iframeVolume + 10);
          _sendIframeCmd('setVolume', [_iframeVolume]);
          break;
        case 'ArrowDown':
          e.preventDefault();
          _iframeVolume = Math.max(0, _iframeVolume - 10);
          _sendIframeCmd('setVolume', [_iframeVolume]);
          break;
        case 'm': case 'M':
          _iframeMuted = !_iframeMuted;
          _sendIframeCmd(_iframeMuted ? 'mute' : 'unMute', []);
          break;
        case '<':
          e.preventDefault();
          { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii > 0 ? ii - 1 : 0; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
          break;
        case '>':
          e.preventDefault();
          { const ii = SPEEDS.indexOf(_iframeRate); const ni = ii < SPEEDS.length - 1 ? ii + 1 : ii; _iframeRate = SPEEDS[ni]; _sendIframeCmd('setPlaybackRate', [_iframeRate]); }
          break;
        case '?':
          e.preventDefault();
          showKbModal();
          break;
        default:
          if (e.key >= '0' && e.key <= '9' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            const pct = parseInt(e.key) / 10;
            if (_iframeDuration > 0) _sendIframeCmd('seekTo', [_iframeDuration * pct, true]);
          }
      }
      return;
    }

    if (player.hidden) return;

    // ── ストリーム / HQ モード: 直接制御 ──
    switch (e.key) {
      case ' ': case 'k': case 'K':
        e.preventDefault();
        vcPlay.click();
        break;
      case 'ArrowLeft': case 'j': case 'J':
        e.preventDefault();
        doSkip(e.shiftKey ? -10 : -5);
        break;
      case 'ArrowRight': case 'l': case 'L':
        e.preventDefault();
        doSkip(e.shiftKey ? 10 : 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        vcVol.value = Math.min(1, parseFloat(vcVol.value) + 0.1).toFixed(2);
        vcVol.dispatchEvent(new Event('input'));
        showCtrls();
        break;
      case 'ArrowDown':
        e.preventDefault();
        vcVol.value = Math.max(0, parseFloat(vcVol.value) - 0.1).toFixed(2);
        vcVol.dispatchEvent(new Event('input'));
        showCtrls();
        break;
      case 'm': case 'M':
        vcMute.click();
        showCtrls();
        break;
      case 'f': case 'F':
        vcFs.click();
        break;
      case 'p': case 'P':
        togglePiP();
        break;
      case ',':
        e.preventDefault();
        player.pause();
        player.currentTime = Math.max(0, player.currentTime - FPS);
        break;
      case '.':
        e.preventDefault();
        player.pause();
        player.currentTime = Math.min(player.duration || 0, player.currentTime + FPS);
        break;
      case '<':
        e.preventDefault();
        { const idx = SPEEDS.indexOf(currentSpeed); if (idx > 0) setSpeed(SPEEDS[idx - 1]); }
        break;
      case '>':
        e.preventDefault();
        { const idx = SPEEDS.indexOf(currentSpeed); if (idx < SPEEDS.length - 1) setSpeed(SPEEDS[idx + 1]); }
        break;
      case '?':
        e.preventDefault();
        showKbModal();
        break;
      default:
        if (e.key >= '0' && e.key <= '9' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          const pct = parseInt(e.key) / 10;
          if (_liveHls()) VyLive.seekPct(pct);
          else if (player.duration) {
            player.currentTime = player.duration * pct;
            const audio = document.getElementById('hqAudio');
            if (hqActive && audio) audio.currentTime = player.currentTime;
          }
          showCtrls();
        }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape' && kbBackdrop && !kbBackdrop.hidden) hideKbModal();
  });

  // ── ナレーション機能 ──
  let narrationActive = false;
  let narrationUtterance = null;
  function startNarration(text) {
    if (!('speechSynthesis' in window)) return;
    stopNarration();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 1; u.pitch = 1;
    u.onend = () => { stopNarration(); };
    u.onerror = () => { stopNarration(); };
    narrationUtterance = u;
    speechSynthesis.speak(u);
    narrationActive = true;
    if (vcNarrationOff) vcNarrationOff.hidden = false;
  }
  function stopNarration() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    narrationActive = false;
    narrationUtterance = null;
    if (vcNarrationOff) vcNarrationOff.hidden = true;
  }
  if (vcNarrationOff) vcNarrationOff.addEventListener('click', (e) => {
    e.stopPropagation();
    stopNarration();
  });
  window._vyStartNarration = startNarration;
  window._vyStopNarration = stopNarration;
  window._vyIsNarrationActive = () => narrationActive;

  // ── 設定パネル (動画上の設定ボタンから開く) ──
  function buildSettingsPanel() {
    // 設定パネルが未作成なら作る
    let panel = document.getElementById('vcSettingsPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'vcSettingsPanel';
      panel.className = 'vctrls-settings-panel';
      panel.hidden = true;
      playerWrap.appendChild(panel);
    }
    const _s = getSettings();
    panel.innerHTML = '';
    const items = [
      { label: 'ナレーション', desc: '動画のタイトルとチャンネル名を読み上げ', toggle: true, checked: false, id: 'vcSetNarration' },
      { label: '続きから再生', desc: '前回見た位置から再開', toggle: true, checked: !!_s.savePosition, id: 'vcSetSavePos' },
    ];
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'vc-set-row';
      row.innerHTML = `<div class="vc-set-info"><div class="vc-set-label">${escapeHtml(item.label)}</div><div class="vc-set-desc">${escapeHtml(item.desc)}</div></div>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vc-set-toggle' + (item.checked ? ' active' : '');
      btn.id = item.id;
      btn.setAttribute('aria-pressed', item.checked ? 'true' : 'false');
      row.appendChild(btn);
      panel.appendChild(row);
    });
    // ナレーショントグル
    const narrBtn = panel.querySelector('#vcSetNarration');
    if (narrBtn) narrBtn.addEventListener('click', () => {
      if (narrationActive) {
        stopNarration();
        narrBtn.classList.remove('active');
      } else {
        const meta = (typeof currentVideoMeta !== 'undefined') ? currentVideoMeta : null;
        const title = (meta && meta.title) || document.title.replace(/ - Vyslo Tube$/, '');
        const author = (meta && meta.author) || '';
        startNarration(author ? title + '。' + author + 'の動画です。' : title);
        narrBtn.classList.add('active');
      }
    });
    // 続きから再生
    const spBtn = panel.querySelector('#vcSetSavePos');
    if (spBtn) spBtn.addEventListener('click', () => {
      const next = !spBtn.classList.contains('active');
      spBtn.classList.toggle('active', next);
      spBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      saveSettings(Object.assign({}, getSettings(), { savePosition: next }));
    });
  }
  if (vcSettings) vcSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    let panel = document.getElementById('vcSettingsPanel');
    if (!panel || panel.hidden) {
      buildSettingsPanel();
      panel = document.getElementById('vcSettingsPanel');
      if (panel) { panel.hidden = false; }
    } else {
      if (panel) panel.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('vcSettingsPanel');
    if (panel && !panel.hidden && !panel.contains(e.target) && e.target !== vcSettings && !vcSettings.contains(e.target)) {
      panel.hidden = true;
    }
  });

  // ── コントロールの幅合わせ ──
  // 関連動画サイドバーを開いてプレーヤーが狭くなっても、全画面・画質などの必要なボタンが
  // はみ出して消えないよう、優先度の低いものから順に隠す (サイドバーの状態に関係なく動く)
  {
    const bar = vctrls.querySelector('.vctrls-bar');
    const q = (sel) => vctrls.querySelector(sel);
    const order = [
      () => vcVolPct,
      () => q('.vctrls-vol-slider-wrap'),
      () => vcSkipBack,
      () => vcSkipFwd,
      () => vcRepeat,
      () => vcSpeedWrap,
      () => vcAutoNext,
      () => vcTime,
      () => vcAutoplay,
    ];
    let raf = 0;
    function fit() {
      raf = 0;
      if (!bar) return;
      // 画質メニューの高さの上限に使う
      playerWrap.style.setProperty('--vy-player-h', playerWrap.clientHeight + 'px');
      const items = order.map(f => f()).filter(Boolean);
      items.forEach(el => el.classList.remove('vc-ovf-hide'));
      if (!bar.clientWidth) return;
      for (const el of items) {
        if (bar.scrollWidth <= bar.clientWidth + 1) break;
        el.classList.add('vc-ovf-hide');
      }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(fit); };
    if (bar && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(schedule);
      ro.observe(playerWrap);
      ro.observe(bar);
    }
    window.addEventListener('resize', schedule);
    document.addEventListener('fullscreenchange', () => setTimeout(fit, 60));
    // 時間表示・画質ラベルの文字数が変わったときも合わせ直す
    if ('MutationObserver' in window && bar) {
      new MutationObserver(schedule).observe(bar, { subtree: true, childList: true, characterData: true });
    }
    window.VyCtrlFit = fit;
    schedule();
  }

  // ── Init ──
  updatePlayBtn();
  updateVolUI();
  updateFsBtn();
  updateCenterIcon();
  setSliderfill(vcVol);
  setSliderfill(vcSeek);
}

function initNarrowSidebar() {
  const fab = document.getElementById('sidebarFab');
  if (!fab || fab.dataset.vyBound) return;
  fab.dataset.vyBound = '1';
  const STORAGE_KEY = 'vyslo_sidebar_narrow';

  function updateState(hidden) {
    if (hidden) {
      document.body.classList.add('sidebar-narrow-hidden');
      fab.title = '関連動画を表示';
      fab.setAttribute('aria-label', '関連動画を表示');
      fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="11 9 8 12 11 15"/></svg>';
    } else {
      document.body.classList.remove('sidebar-narrow-hidden');
      fab.title = '関連動画を隠す';
      fab.setAttribute('aria-label', '関連動画を隠す');
      fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="8 9 11 12 8 15"/></svg>';
    }
    try { localStorage.setItem(STORAGE_KEY, hidden ? 'hidden' : 'shown'); } catch {}
  }

  let saved = '';
  try { saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('chocotube_sidebar_narrow') || ''; } catch {}
  updateState(saved === 'hidden');

  fab.addEventListener('click', () => {
    updateState(!document.body.classList.contains('sidebar-narrow-hidden'));
  });
}

async function initWatch(videoId) {
  const relatedList = document.getElementById('relatedList');
  for (let i = 0; i < 8; i++) relatedList.appendChild(createRelatedSkeleton());

  const player = document.getElementById('videoPlayer');
  player.poster = getThumbnailUrl(videoId);

  initModeBar(videoId);
  initCustomControls();
  initNarrowSidebar();
  initPlaybackSettingsPanel();
  initComments(videoId);
  if (listParam) initPlaylistPanel(listParam, indexParam);

  let _homeVideoQueue = null;
  let _homeVideoQueueIdx = -1;
  if (!listParam) {
    try {
      const raw = sessionStorage.getItem('vyHomeVideoQueue');
      if (raw) {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids) && ids.length > 1) {
          const idx = ids.indexOf(videoId);
          if (idx >= 0) {
            _homeVideoQueue = ids;
            _homeVideoQueueIdx = idx;
          } else {
            sessionStorage.removeItem('vyHomeVideoQueue');
          }
        }
      }
    } catch (_) {}
  }

  const _reloadBtn = document.getElementById('reloadAllBtn');
  if (_reloadBtn) _reloadBtn.addEventListener('click', () => reloadAll(videoId));

  // 初期ロードの世代を記録（ソース切替で無効化される）
  const _initLoadGen = ++_reloadGen;
  const _genOk = () => _initLoadGen === _reloadGen;

  // 動画情報取得：成功 or 最大リトライまで独立して送り続ける（ストリームをブロックしない）
  const _infoPromise = (async () => {
    const maxRetries = 10;
    for (let i = 0; i < maxRetries; i++) {
      if (!_genOk()) return null;
      try {
        const r = await fetch(`/api/videoinfo/${encodeURIComponent(videoId)}`, { signal: AbortSignal.timeout(20000) });
        if (r.ok) return r.json();
      } catch {}
      if (i < maxRetries - 1)
        await new Promise(res => setTimeout(res, Math.min(1500 * Math.pow(1.5, i), 15000)));
    }
    return null;
  })();

  // ── LIVE (生放送) の判定 ──
  // 通常動画のストリーム取得とは別に、動画情報で「配信中」と分かったら LIVE 専用の経路で再生する
  // 配信中と分かった時点で LIVE 専用の経路に任せる (通常動画の再生・埋め込みで上書きしない)
  const _liveStarted = () => (typeof VyLive !== 'undefined') && VyLive.isLive(videoId);
  if (typeof VyLive !== 'undefined') VyLive.check(videoId, _infoPromise, _genOk);

  // ストリーム取得：成功したらすぐ再生開始
  try {
    const streamResult = await withRetryOrReload(videoId, () => fetchBestStream(videoId), { maxAutoReloads: 0 });
    if (!_genOk()) return;

    const { data: streamData, instanceUrl } = streamResult;

    const invInstance = instanceUrl || streamData._invidious_instance || null;
    streamExcludeList = invInstance ? [invInstance] : [];
    cachedInvInstance = invInstance;
    streamAltBarReady = true;
    initStreamAltBtn(videoId);

    // Only show stream-specific UI if stream mode is currently active
    const _modeStreamEl = document.getElementById('modeStream');
    const isStreamModeActive = _modeStreamEl && _modeStreamEl.classList.contains('active');
    if (isStreamModeActive) {
      const _sab = document.getElementById('streamAltBtn');
      if (_sab) _sab.removeAttribute('hidden');
      setInstanceLabel(invInstance);
    }
    setHQInstanceLabel(invInstance);

    // LIVE の再生がすでに始まっていれば、通常動画の再生で上書きしない
    if (!_liveStarted()) setupPlayer(streamData, videoId, instanceUrl);

    // ── 再生位置の復元と保存 (動画ごと / 途中で閉じても次回は続きから) ──
    {
      const _posPlayer = document.getElementById('videoPlayer');
      // URL の t= (秒 / 1m30s) があればそれを優先、なければ保存した位置
      const _urlT = (typeof vyParseTimeParam === 'function') ? vyParseTimeParam(new URLSearchParams(location.search).get('t')) : 0;
      const _savedPos = getSavedPosition(videoId);
      const _startAt = _urlT > 0 ? _urlT : (getSettings().savePosition && _savedPos > 5 ? _savedPos : 0);
      // 前の読み込みで付けた処理は外す (イベントの重複防止)
      if (_posPlayer._vyPos) {
        const o = _posPlayer._vyPos;
        _posPlayer.removeEventListener('canplay', o.onCanPlay);
        _posPlayer.removeEventListener('timeupdate', o.onTime);
        _posPlayer.removeEventListener('pause', o.onPause);
        _posPlayer.removeEventListener('ended', o.onEnded);
        window.removeEventListener('pagehide', o.onHide);
        document.removeEventListener('visibilitychange', o.onVis);
      }
      let _lastPosSave = 0;
      const _saveNow = () => {
        if (!getSettings().savePosition) return;
        if (typeof VyLive !== 'undefined' && VyLive.isLive(videoId)) return;
        const t = _posPlayer.currentTime;
        const dur = _posPlayer.duration;
        if (!(t > 5)) return;
        const durKnown = dur && isFinite(dur);
        if (!durKnown || t < dur - 5) savePosition(videoId, t, durKnown ? dur : 0);
        else clearSavedPosition(videoId);
      };
      const o = {
        onCanPlay: () => {
          if (typeof VyLive !== 'undefined' && VyLive.isLive(videoId)) return; // 配信中は先端から
          if (_startAt > 5 && _posPlayer.currentTime < 1) _posPlayer.currentTime = _startAt;
        },
        onTime: () => {
          const now = Date.now();
          if (now - _lastPosSave < 5000) return;
          _lastPosSave = now;
          _saveNow();
        },
        onPause: () => _saveNow(),
        onEnded: () => clearSavedPosition(videoId),
        onHide: () => _saveNow(),
        onVis: () => { if (document.visibilityState === 'hidden') _saveNow(); },
      };
      _posPlayer._vyPos = o;
      if (_startAt > 5) _posPlayer.addEventListener('canplay', o.onCanPlay, { once: true });
      _posPlayer.addEventListener('timeupdate', o.onTime);
      _posPlayer.addEventListener('pause', o.onPause);
      _posPlayer.addEventListener('ended', o.onEnded, { once: true });
      window.addEventListener('pagehide', o.onHide);
      document.addEventListener('visibilitychange', o.onVis);
    }

    updatePbsetPanel();
  } catch (e) {
    console.error('[watch] ストリーム取得失敗、フォールバックを試行', e);
    // 自動フォールバック: 別の再生経路を順番に試す
    const _fallbackGen = _reloadGen;
    const _genOkFallback = () => _fallbackGen === _reloadGen;
    let _fallbackSuccess = _liveStarted(); // LIVE を再生中なら埋め込みに切り替えない

    // 1. nocookie 埋め込み
    if (_genOkFallback() && !_fallbackSuccess) {
      try {
        const nocookiePlayer = document.getElementById('nocookiePlayer');
        const skeleton = document.getElementById('playerSkeleton');
        const player = document.getElementById('videoPlayer');
        if (nocookiePlayer && player) {
          if (skeleton) skeleton.hidden = true;
          player.setAttribute('hidden', '');
          nocookiePlayer.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
          nocookiePlayer.removeAttribute('hidden');
          const vctrls = document.getElementById('vctrls');
          if (vctrls) vctrls.classList.remove('vctrls-show');
          // nocookieが読み込めたか確認
          const nocookieOk = await Promise.race([
            new Promise(r => setTimeout(() => r(true), 3000)),
            new Promise(r => { nocookiePlayer.onload = () => r(true); })
          ]);
          if (_genOkFallback() && nocookieOk) { _fallbackSuccess = true; }
        }
      } catch (_) {}
    }

    // 2. edu 埋め込み
    if (_genOkFallback() && !_fallbackSuccess) {
      try {
        const eduPlayer = document.getElementById('eduPlayer');
        const player = document.getElementById('videoPlayer');
        if (eduPlayer && player) {
          player.setAttribute('hidden', '');
          eduPlayer.src = `https://www.youtubeeducation.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
          eduPlayer.removeAttribute('hidden');
          const eduOk = await Promise.race([
            new Promise(r => setTimeout(() => r(true), 3000)),
            new Promise(r => { eduPlayer.onload = () => r(true); })
          ]);
          if (_genOkFallback() && eduOk) { _fallbackSuccess = true; }
        }
      } catch (_) {}
    }

    // すべての再生経路が失敗した場合: playerErrorに表示（showWatchErrorは使わない）
    if (_genOkFallback() && !_fallbackSuccess) {
      const skeleton = document.getElementById('playerSkeleton');
      const errorEl = document.getElementById('playerError');
      const errorMsg = document.getElementById('playerErrorMsg');
      const reloadBtn = document.getElementById('reloadBtn');
      if (skeleton) skeleton.hidden = true;
      if (errorEl) errorEl.hidden = false;
      if (errorMsg) errorMsg.textContent = '動画の取得中にエラーが発生しました。ページを更新してみてください。';
      if (reloadBtn) reloadBtn.hidden = false;
    }
  }

  // ── メタデータ・関連動画レンダリング (ストリーム成功・フォールバック成功どちらでも実行) ──
  let _related = [];

  // ユーザーの視聴傾向を分析: 海外動画の割合を判定
  function _isOverseasVideo(meta) {
    if (!meta) return false;
    const text = (meta.title || '') + ' ' + (meta.author || '');
    if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text)) return false;
    return true;
  }

  // 視聴履歴から海外動画の視聴傾向を判定
  function _overseasTendency() {
    try {
      const hist = getHistory().slice(0, 50);
      if (hist.length === 0) return 0;
      let overseas = 0;
      for (const h of hist) {
        if (_isOverseasVideo(h)) overseas++;
      }
      return overseas / hist.length;
    } catch { return 0; }
  }

  // 検索履歴から海外傾向を判定
  function _searchOverseasTendency() {
    try {
      const searches = getSearchHistory().slice(0, 20);
      if (searches.length === 0) return 0;
      let overseas = 0;
      for (const s of searches) {
        if (!/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(s)) overseas++;
      }
      return overseas / searches.length;
    } catch { return 0; }
  }

  // 追加の推奨動画を検索から取得
  async function _fetchSearchRecommendations(metaData) {
    const overseasRatio = Math.max(_overseasTendency(), _searchOverseasTendency());
    const preferOverseas = overseasRatio > 0.3;

    // 現在の動画タイトルからキーワードを抽出
    const title = (metaData.title || '').trim();
    const author = (metaData.author || '').trim();
    const searchTerms = [];

    // チャンネル名で検索（関連動画の補完）
    if (author) searchTerms.push(author);

    // 検索履歴から最近の検索語を追加
    try {
      const recentSearches = getSearchHistory().slice(0, 3);
      searchTerms.push(...recentSearches);
    } catch {}

    // 海外傾向が高い場合は英語キーワードも追加
    if (preferOverseas && title) {
      // タイトルから日本語以外の単語を抽出
      const engWords = title.split(/[\s\u3000]+/).filter(w => /^[A-Za-z0-9]/.test(w) && w.length > 2);
      if (engWords.length > 0) searchTerms.push(engWords.slice(0, 2).join(' '));
    }

    if (searchTerms.length === 0) return [];

    // 重複排除用
    const existing = new Set(_related.map(v => v.videoId));
    existing.add(videoId);
    const results = [];

    for (const term of searchTerms.slice(0, 3)) {
      try {
        const _srGen = _reloadGen;
        const data = await Promise.race([
          fetchMain(`/api/search?q=${encodeURIComponent(term)}`),
          new Promise(res => setTimeout(() => res(null), 10000))
        ]);
        if (_srGen !== _reloadGen || !data || !data.results) continue;
        for (const v of data.results) {
          if (v.type !== 'video') continue;
          const vid = v.videoId || v.id;
          if (!vid || existing.has(vid)) continue;
          existing.add(vid);
          results.push({
            videoId: vid,
            title: v.title || '',
            author: v.author || '',
            authorId: v.authorId || '',
            lengthSeconds: v.lengthSeconds || 0,
            viewCount: v.viewCount || 0,
            publishedText: v.publishedText || '',
            videoThumbnails: v.videoThumbnails || [],
          });
          if (results.length >= 8) break;
        }
        if (results.length >= 8) break;
      } catch {}
    }
    return results;
  }

  _infoPromise.then(async metaData => {
    if (!_genOk()) return;
    if (metaData) {
      renderVideoInfo(metaData, videoId);
      _related = metaData.recommendedVideos || [];
      _relatedVideos = _related;
      renderRelated(_related);

      // 追加の推奨動画を検索から取得（視聴傾向を反映）
      if (_related.length < 15) {
        const searchResults = await _fetchSearchRecommendations(metaData);
        if (!_genOk()) return;
        if (searchResults.length > 0) {
          _related = [..._related, ...searchResults];
          _relatedVideos = _related;
          renderRelated(_related);
        }
      }

      // 現在の動画のチャンネルの他の動画を追加取得
      if (metaData.authorId && _related.length < 15) {
        const _recGen = _reloadGen;
        fetchMain(`/api/channels/${metaData.authorId}/videos`).then(chData => {
          if (_recGen !== _reloadGen) return;
          if (!chData || !chData.videos) return;
          const chVideos = chData.videos.filter(v => v.videoId !== videoId);
          const _existing = new Set(_related.map(v => v.videoId));
          const _newVideos = chVideos.filter(v => !_existing.has(v.videoId)).slice(0, 5);
          if (_newVideos.length > 0) {
            const _merged = [..._related, ..._newVideos];
            _related = _merged;
            _relatedVideos = _merged;
            renderRelated(_merged);
          }
        }).catch(() => {});
      }

      if (metaData._source === 'piped') {
        const _upgradeGen = _reloadGen;
        fetchMain(`/api/videos/${videoId}`).then(invMeta => {
          if (_upgradeGen !== _reloadGen) return;
          if (!invMeta || invMeta.error) return;
          renderVideoInfo(invMeta, videoId);
          const _invRelated = invMeta.recommendedVideos || [];
          const _existing = new Set(_related.map(v => v.videoId));
          const _merged = [..._invRelated.filter(v => !_existing.has(v.videoId)), ..._related.filter(v => !_invRelated.some(r => r.videoId === v.videoId))];
          _relatedVideos = _merged;
          renderRelated(_merged);
        }).catch(() => {});
      }
    } else {
      const sk = document.getElementById('infoSkeleton');
      const vi = document.getElementById('videoInfo');
      const wt = document.getElementById('watchTitle');
      if (sk) sk.hidden = true;
      if (vi) vi.removeAttribute('hidden');
      if (wt) wt.textContent = '情報を取得できませんでした';
      renderRelated([]);
    }
  });

  // Autoplay next (settings)
  if (!listParam) {
    const _player = document.getElementById('videoPlayer');
    if (_player) _player.addEventListener('ended', () => {
      const _currentSettings = getSettings();
      if (_player.loop) return;
      if (!_currentSettings.autoplayNext) return;
      if (_homeVideoQueue && _homeVideoQueueIdx >= 0 && _homeVideoQueueIdx < _homeVideoQueue.length - 1) {
        window.location.href = `/watch?v=${encodeURIComponent(_homeVideoQueue[_homeVideoQueueIdx + 1])}`;
      } else if (_related.length > 0) {
        sessionStorage.removeItem('vyHomeVideoQueue');
        window.location.href = `/watch?v=${_related[0].videoId}`;
      }
    });
  }

}

// bind the related-videos toggle as soon as the DOM is ready (independent of video loading)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { try { initNarrowSidebar(); } catch {} });
} else {
  try { initNarrowSidebar(); } catch {}
}
