// エラーオブジェクトを利用者向けの日本語メッセージに変換する
function vyErrMsg(e) {
  const raw = String((e && (e.message || e)) || '').trim();
  const name = e && e.name;
  if (raw && /[\u3040-\u30FF\u4E00-\u9FFF]/.test(raw)) return raw;
  if (name === 'TimeoutError' || /timeout|timed out/i.test(raw)) return 'タイムアウトしました';
  if (name === 'AbortError') return '中断されました';
  const m = raw.match(/HTTP\s*(\d{3})/i);
  if (m) return `サーバーエラー (${m[1]})`;
  if (name === 'TypeError' || /failed to fetch|network|load failed/i.test(raw)) return '通信に失敗しました';
  if (/no (formats|stream)/i.test(raw)) return '再生できるストリームが見つかりませんでした';
  if (/not found/i.test(raw)) return '見つかりませんでした';
  return '取得に失敗しました';
}

const COUNTRIES = [
  { code: 'DZ', name: 'アルジェリア' },
  { code: 'AR', name: 'アルゼンチン' },
  { code: 'AU', name: 'オーストラリア' },
  { code: 'AT', name: 'オーストリア' },
  { code: 'AZ', name: 'アゼルバイジャン' },
  { code: 'BH', name: 'バーレーン' },
  { code: 'BD', name: 'バングラデシュ' },
  { code: 'BY', name: 'ベラルーシ' },
  { code: 'BE', name: 'ベルギー' },
  { code: 'BO', name: 'ボリビア' },
  { code: 'BA', name: 'ボスニア・ヘルツェゴビナ' },
  { code: 'BR', name: 'ブラジル' },
  { code: 'BG', name: 'ブルガリア' },
  { code: 'CA', name: 'カナダ' },
  { code: 'CL', name: 'チリ' },
  { code: 'CO', name: 'コロンビア' },
  { code: 'CR', name: 'コスタリカ' },
  { code: 'HR', name: 'クロアチア' },
  { code: 'CY', name: 'キプロス' },
  { code: 'CZ', name: 'チェコ' },
  { code: 'DK', name: 'デンマーク' },
  { code: 'DO', name: 'ドミニカ共和国' },
  { code: 'EC', name: 'エクアドル' },
  { code: 'EG', name: 'エジプト' },
  { code: 'SV', name: 'エルサルバドル' },
  { code: 'EE', name: 'エストニア' },
  { code: 'ET', name: 'エチオピア' },
  { code: 'FI', name: 'フィンランド' },
  { code: 'FR', name: 'フランス' },
  { code: 'GE', name: 'ジョージア' },
  { code: 'DE', name: 'ドイツ' },
  { code: 'GH', name: 'ガーナ' },
  { code: 'GR', name: 'ギリシャ' },
  { code: 'GT', name: 'グアテマラ' },
  { code: 'HN', name: 'ホンジュラス' },
  { code: 'HK', name: '香港' },
  { code: 'HU', name: 'ハンガリー' },
  { code: 'IN', name: 'インド' },
  { code: 'ID', name: 'インドネシア' },
  { code: 'IQ', name: 'イラク' },
  { code: 'IE', name: 'アイルランド' },
  { code: 'IL', name: 'イスラエル' },
  { code: 'IT', name: 'イタリア' },
  { code: 'JM', name: 'ジャマイカ' },
  { code: 'JP', name: '日本' },
  { code: 'JO', name: 'ヨルダン' },
  { code: 'KZ', name: 'カザフスタン' },
  { code: 'KE', name: 'ケニア' },
  { code: 'KW', name: 'クウェート' },
  { code: 'LA', name: 'ラオス' },
  { code: 'LV', name: 'ラトビア' },
  { code: 'LB', name: 'レバノン' },
  { code: 'LY', name: 'リビア' },
  { code: 'LT', name: 'リトアニア' },
  { code: 'LU', name: 'ルクセンブルク' },
  { code: 'MY', name: 'マレーシア' },
  { code: 'MT', name: 'マルタ' },
  { code: 'MX', name: 'メキシコ' },
  { code: 'MD', name: 'モルドバ' },
  { code: 'ME', name: 'モンテネグロ' },
  { code: 'MA', name: 'モロッコ' },
  { code: 'MZ', name: 'モザンビーク' },
  { code: 'NP', name: 'ネパール' },
  { code: 'NL', name: 'オランダ' },
  { code: 'NZ', name: 'ニュージーランド' },
  { code: 'NI', name: 'ニカラグア' },
  { code: 'NG', name: 'ナイジェリア' },
  { code: 'MK', name: '北マケドニア' },
  { code: 'NO', name: 'ノルウェー' },
  { code: 'OM', name: 'オマーン' },
  { code: 'PK', name: 'パキスタン' },
  { code: 'PA', name: 'パナマ' },
  { code: 'PG', name: 'パプアニューギニア' },
  { code: 'PY', name: 'パラグアイ' },
  { code: 'PE', name: 'ペルー' },
  { code: 'PH', name: 'フィリピン' },
  { code: 'PL', name: 'ポーランド' },
  { code: 'PT', name: 'ポルトガル' },
  { code: 'PR', name: 'プエルトリコ' },
  { code: 'QA', name: 'カタール' },
  { code: 'RO', name: 'ルーマニア' },
  { code: 'RU', name: 'ロシア' },
  { code: 'SA', name: 'サウジアラビア' },
  { code: 'SN', name: 'セネガル' },
  { code: 'RS', name: 'セルビア' },
  { code: 'SG', name: 'シンガポール' },
  { code: 'SK', name: 'スロバキア' },
  { code: 'SI', name: 'スロベニア' },
  { code: 'ZA', name: '南アフリカ' },
  { code: 'KR', name: '韓国' },
  { code: 'ES', name: 'スペイン' },
  { code: 'LK', name: 'スリランカ' },
  { code: 'SE', name: 'スウェーデン' },
  { code: 'CH', name: 'スイス' },
  { code: 'TW', name: '台湾' },
  { code: 'TZ', name: 'タンザニア' },
  { code: 'TH', name: 'タイ' },
  { code: 'TN', name: 'チュニジア' },
  { code: 'TR', name: 'トルコ' },
  { code: 'UG', name: 'ウガンダ' },
  { code: 'UA', name: 'ウクライナ' },
  { code: 'AE', name: 'アラブ首長国連邦' },
  { code: 'GB', name: 'イギリス' },
  { code: 'US', name: 'アメリカ' },
  { code: 'UY', name: 'ウルグアイ' },
  { code: 'UZ', name: 'ウズベキスタン' },
  { code: 'VE', name: 'ベネズエラ' },
  { code: 'VN', name: 'ベトナム' },
  { code: 'YE', name: 'イエメン' },
  { code: 'ZW', name: 'ジンバブエ' },
];

function getThumbMode() {
  try {
    return (typeof getSettings === 'function' ? getSettings().thumbnailMode : null) || 'proxy';
  } catch { return 'proxy'; }
}

function wsrv(url, w) {
  if (!url) return '';
  const mode = getThumbMode();
  if (mode === 'proxy') {
    const encoded = encodeURIComponent(url);
    return w
      ? `https://wsrv.nl/?url=${encoded}&w=${w}&output=webp`
      : `https://wsrv.nl/?url=${encoded}&output=webp`;
  }
  const encoded = encodeURIComponent(url);
  return w ? `/api/thumb?url=${encoded}&w=${w}` : `/api/thumb?url=${encoded}`;
}

const _b64Cache = new Map();

function _attachBase64Loader(img) {
  if (img._b64done) return;
  const src = img.getAttribute('src') || '';
  if (!src.includes('/api/thumb')) return;
  img._b64done = true;
  const doConvert = () => {
    if (img._b64converted) return;
    img._b64converted = true;
    const apiUrl = img.src.split('#')[0];
    if (_b64Cache.has(apiUrl)) { img.src = _b64Cache.get(apiUrl); return; }
    fetch(apiUrl + '&fmt=b64')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || !d.src) return;
        _b64Cache.set(apiUrl, d.src);
        document.querySelectorAll(`img[data-b64api="${CSS.escape(apiUrl)}"]`).forEach(el => { el.src = d.src; });
        img.src = d.src;
      })
      .catch(() => {});
  };
  img.setAttribute('data-b64api', img.src);
  if (img.complete && img.naturalWidth > 0) doConvert();
  else img.addEventListener('load', doConvert, { once: true });
}

function _processBase64Images(root) {
  root.querySelectorAll('img.thumb-img, img.channel-icon').forEach(_attachBase64Loader);
}

let _b64Observer = null;
function _initBase64ThumbLoader() {
  if (_b64Observer) return;
  _processBase64Images(document);
  _b64Observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (!node || node.nodeType !== 1) return;
        if (node.tagName === 'IMG') _attachBase64Loader(node);
        else _processBase64Images(node);
      });
    }
  });
  _b64Observer.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener('DOMContentLoaded', () => {
  if (getThumbMode() === 'base64') _initBase64ThumbLoader();
});

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// YouTube 日本語版と同じ丸め (切り捨て): 1,234 / 1.2万 / 455万 / 1.8億
function jaCount(n) {
  n = Number(n) || 0;
  const cut = (v) => (v < 10 ? (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.floor(v)));
  if (n >= 100000000) return cut(n / 100000000) + '億';
  if (n >= 10000) return cut(n / 10000) + '万';
  return n.toLocaleString('ja-JP');
}

// 「8.2K」「5.8M」「1.2万」「1,234 回視聴」などの表記を数値に
function parseCountText(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const t = String(s).replace(/[,，\s]/g, '');
  const m = t.match(/([\d.]+)(万|億|千|K|k|M|B)?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  const U = { '万': 1e4, '億': 1e8, '千': 1e3, K: 1e3, k: 1e3, M: 1e6, B: 1e9 };
  if (m[2]) n *= U[m[2]];
  return Math.round(n);
}

function formatViews(n) {
  if (!n) return '';
  return `${jaCount(n)}回視聴`;
}

function formatSubs(n) {
  if (!n) return '';
  return `${jaCount(n)}人`;
}

// チャンネル登録者数を日本語で (「4.55M」などの英語表記も変換)
// 「90,938 views」「1.2M views」のような英語の再生回数表示を日本語にする (日本語ならそのまま)
function jaViewsText(text) {
  const t = text == null ? '' : String(text).trim();
  if (!t) return '';
  if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(t)) return t;
  if (/no views/i.test(t)) return '視聴なし';
  const n = parseCountText(t);
  if (!n) return t;
  if (/watching/i.test(t)) return `${n.toLocaleString()} 人が視聴中`;
  return formatViews(n);
}

function formatSubsText(text, n) {
  let t = (text == null ? '' : String(text)).replace(/チャンネル登録者数|登録者数?|subscribers?/gi, '').trim();
  if (t && /[人万億]/.test(t)) return t.replace(/(\d)\s+(?=[万億人])/g, '$1');
  const c = parseCountText(t) || Number(n) || 0;
  return c ? formatSubs(c) : '';
}

function getThumbnailUrl(videoId) {
  const ytUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return wsrv(ytUrl, 480);
}

function getChannelIconUrl(authorThumbnails) {
  if (!authorThumbnails || authorThumbnails.length === 0) return '';
  const small = authorThumbnails.find(t => t.width <= 48) || authorThumbnails[0];
  return wsrv(small.url, 68);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isShortVideo(video) {
  if (video.isShort) return true;
  // Invidious の 'shortVideo' は「短い形式のデータ」という意味で Shorts とは限らないので長さで判定する
  if (video.type === 'short') return true;
  const len = parseInt(video.lengthSeconds);
  return len > 0 && len <= 90;
}


/* ── 公開日などの英語相対日時を日本語に変換 ── */
function jaDate(str) {
  if (str == null) return '';
  let s = String(str).trim();
  if (!s) return '';
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(s)) return s; // already Japanese
  const UNITS = { second: '秒', sec: '秒', minute: '分', min: '分', hour: '時間', hr: '時間', day: '日', week: '週間', month: 'か月', year: '年' };
  let prefix = '', suffix = '前';
  let m;
  if ((m = s.match(/^(streamed|premiered|edited|updated)\s+(.*)$/i))) {
    const k = m[1].toLowerCase();
    s = m[2];
    if (k === 'streamed') suffix = '前に配信';
    else if (k === 'premiered') suffix = '前にプレミア公開';
    else if (k === 'edited') suffix = '前（編集済み）';
    else suffix = '前に更新';
  }
  if (/^(just now|now)$/i.test(s)) return 'たった今';
  m = s.match(/^(\d+|an?|one)\s+(second|sec|minute|min|hour|hr|day|week|month|year)s?\s+ago$/i);
  if (m) {
    let n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
    const u = UNITS[m[2].toLowerCase()];
    if (u === '秒' && n === 0) return suffix === '前' ? 'たった今' : 'たった今配信';
    return prefix + n + u + suffix;
  }
  if ((m = s.match(/^live$/i))) return 'ライブ配信中';
  if (/^today$/i.test(s)) return '今日';
  if (/^yesterday$/i.test(s)) return '昨日';
  // absolute English dates e.g. "Jan 5, 2024" / "5 Jan 2024"
  const d = new Date(s);
  if (!isNaN(d.getTime()) && /[a-z]/i.test(s) && /\d{4}/.test(s)) {
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  return String(str);
}
window.jaDate = jaDate;
