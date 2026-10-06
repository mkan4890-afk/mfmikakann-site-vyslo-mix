
/* --- 言語固定パッチ --- */
function currentLang(){
  return localStorage.getItem("ui_lang") || (typeof __uv$lang !== 'undefined' ? __uv$lang : 'ja');
}
function applyLang(rawUrl){
  try {
    var lang = currentLang();
    if(!lang) return rawUrl;
    var u = new URL(rawUrl);
    var h = u.hostname.replace(/^www\./, '');
    var isYT = h.endsWith('youtube.com') || h === 'youtu.be' || h.endsWith('youtube-nocookie.com');
    var isG  = h.endsWith('google.com') || /^google\./.test(h) || h.endsWith('google.co.jp');
    if(isYT || isG){
      if(!u.searchParams.has('hl')) u.searchParams.set('hl', lang);
      // YouTube はこのフラグがないと hl を保存せず既定言語に戻る
      if(isYT && !u.searchParams.has('persist_hl')) u.searchParams.set('persist_hl', '1');
      if(isG && !u.searchParams.has('gl')) u.searchParams.set('gl', lang === 'ja' ? 'JP' : 'US');
      return u.toString();
    }
  } catch(e) {}
  return rawUrl;
}
var search = document.getElementById("search");
var loading = document.querySelector("#loading");
//var submitBtn = document.querySelector(".submit");
//var loadingText = '<img src="/img/loading.png" class="loading" style="margin:0" height="16">';

const searchUrl = localStorage.getItem("search_engine") == "ggl" ? 'https://www.google.com/search?q=' : 'https://duckduckgo.com/?q=';

function submitUrl(prx){
  if(/\S/.test(search.value)){
    //submitBtn.innerHTML = loadingText;
    quickGo(search.value, prx);
  }
}

function decodeUrl(str){
  if (!str) return str;
  let [ input, ...search ] = str.split('?');

  return decodeURIComponent(input).split('').map((char, ind) => ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('') + (search.length ? '?' + search.join('?') : '');
}

if(search){
  search.addEventListener('keydown', function onEvent(e) {
    if (e.key === "Enter" && search.value != ""){uv(search.value)}
    if(e.key === "Escape"){search.blur()}   
  });  
};
//submitBtn.onclick = () => {uv(search.value)};

/* ENCODING URL */

function encodeB64(str){
  str = str.toString();
  const b64chs = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=');
  let u32;
  let c0; 
  let c1; 
  let c2; 
  let asc = '';
  let pad = str.length % 3;
  
  for (let i = 0; i < str.length;) {
    if((c0 = str.charCodeAt(i++)) > 255 || (c1 = str.charCodeAt(i++)) > 255 || (c2 = str.charCodeAt(i++)) > 255)throw new TypeError('invalid character found');
    u32 = (c0 << 16) | (c1 << 8) | c2;
    asc += b64chs[u32 >> 18 & 63]
        + b64chs[u32 >> 12 & 63]
        + b64chs[u32 >> 6 & 63]
        + b64chs[u32 & 63];
  }
  
  return encodeURIComponent(pad ? asc.slice(0, pad - 3) + '==='.substr(pad) : asc);
}

function encodeXor(str){
  if (!str) return str;
  return encodeURIComponent(str.toString().split('').map((char, ind) => ind % 2 ? String.fromCharCode(char.charCodeAt() ^ 2) : char).join(''));
}

/* GETTING URL */

function quickGo(url, prx){
  if(prx == "wm"){
    wm(defaultUrl(url));
  }
  else if(prx == "uv"){
    uv(url);
  }/* else {
    cr(defaultUrl(url));
  }*/
}

function defaultUrl(url){
  if( !url.includes('.') && !url.startsWith('https://') && !url.startsWith('http://') ){
    this.url = searchUrl + url;
  }
  else if (url.startsWith('https://')) {
    this.url = url;
  } else if(url.startsWith('http://')) {
    this.url = 'https://' + url.substring(7);
  } else if (url.startsWith('//')) {
    url = 'https:' + url;
  } else {
    this.url = 'https://' + url;
  }
  return this.url;
}

function isUrl(val = ''){ //uv
  if (/^http(s?):\/\//.test(val) || val.includes('.') && val.substr(0, 1) !== ' ') return true;
  return false;
};

var registered = false;

async function register(){
  if(registered){return true}

  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/graph.js", {
      scope: __uv$config.prefix || '/math/'
    }).then(()=>{
      registered = true;
    });
  }

  return registered;
}

window.addEventListener("load", () => {
  register();
  if(!document.querySelector(".adsBox") && localStorage.getItem("ads") != "true") {
    try {
      aclib.runAutoTag({ //adc
        zoneId: 'fvb2wha9mm', // 'hmedfyzru7'
      });
    } catch (e){}
  } else { localStorage.setItem("ads", "true") }
});

function uv(url) { // Open uv
  try {
    document.querySelectorAll("#autofill")?.forEach(el => {
      el.style.display = "none";
    })
    loading.style.display = "flex";
    loading.querySelectorAll("span")[1].innerText = "loading content";
    window.setTimeout(function(){
      loading.querySelectorAll("span")[1].innerText = "heavy server load may cause slowness";
    }, 2500);
    window.setTimeout(function(){
      loading.querySelectorAll("span")[1].innerHTML = "there might be an error; join our <span style='text-decoration:underline;cursor:pointer;color:rgb(200,200,255);' onclick=\"window.open('https://discord.gg/hFZC5cgsmq', '_blank');\">discord</span> for support, or try going <span style='text-decoration:underline;cursor:pointer;color:rgb(200,200,255);' onclick=\"window.open('"+location.origin+"/s', '_blank');\">here</span>";
    }, 14000);

    this.url = url.trim();
    if (!isUrl(this.url)) this.url = searchUrl + this.url;
    else if (!(this.url.startsWith('https://') || this.url.startsWith('http://'))) this.url = 'http://' + this.url;
    if(url != ""){
      localStorage.setItem("tabUrl", this.url);
      if(localStorage.getItem("ab_cloak") != "false"/* && window.top.location.href != "about:blank"*/) {
        cloak(this.url); // cloak() in all.js
      } else {
        if(localStorage.getItem("tabs") != 'false'){
          window.location.href = '/s/'; // tabs
        } else {
          window.location.href = __uv$config.prefix + encodeXor(applyLang(this.url));
        }
      }
    }
  } catch (e) {
    alert("ERROR: " + e);
  }
  
  /*window.navigator.serviceWorker.register('/graph.js', {
    scope: __uv$config.prefix
  }).then(() => {
    console.log("Service worker registered.");
    this.url = url.trim();
    if (!isUrl(this.url)) this.url = searchUrl + this.url;
    else if (!(this.url.startsWith('https://') || this.url.startsWith('http://'))) this.url = 'http://' + this.url;
    if(url != ""){
      localStorage.setItem("tabUrl", this.url);
      if(localStorage.getItem("ab_cloak") != "false" && window.top.location.href != "about:blank") {
        cloak(this.url); // cloak() in all.js
      } else {
        if(localStorage.getItem("tabs") != 'false'){
          window.location.href = '/s/'; // tabs
        } else {
          window.location.href = __uv$config.prefix + encodeXor(applyLang(this.url));
        }
      }
    }
  });*/

  /*register().then(() => {
    this.url = url.trim();
    if (!isUrl(this.url)) this.url = searchUrl + this.url;
    else if (!(this.url.startsWith('https://') || this.url.startsWith('http://'))) this.url = 'http://' + this.url;
    if(url != ""){
      if(localStorage.getItem("ab_cloak") != "false" && window.top.location.href != "about:blank") {
        cloak(this.url);
      } else {
        window.location.href = (/*__uv$config.prefix || *//*'/math/') + encodeXor(this.url);
      }
    }
  });*/
}

function getUrl(autofill) {
  let googleLink = searchUrl + '%s';
  try {
    return new URL(autofill).toString();
  } catch {}
  try {
    const autofillUrl = new URL(`http://${autofill}`);
    if (autofillUrl.hostname.includes('.')) return autofillUrl.toString();
  } catch {}
  return googleLink.replace('%s', encodeURIComponent(autofill));
}

async function searching(query) {
  /* autofill disabled (needs server-side /search endpoint) */
  return;
  var rawRes = await fetch(
      '/search?q=' + query,
      {
          method: 'POST',
          headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json'
          }
      }
  );
  var jsonResult = await rawRes.json();
  //document.querySelector('#search').style.borderRadius = '.5rem .5rem 0 0';
  if (document.querySelectorAll('#autofill')) {
      var allAutofillElements = document.querySelectorAll('#autofill');
      for (var i = 0; i < allAutofillElements.length; i++) {
          allAutofillElements[i].remove();
      }
  }
  if (query != '') {
      var elHeight = 0;
      var numResults = Math.min(jsonResult.length, 6);
      for (var i = 0; i < numResults; i++) {
          var newEl = document.createElement('div');
          newEl.id = 'autofill';
          newEl.style =
              'background:var(--input-bkg);color:var(--input-txt);padding:calc(1.5rem / 2);cursor:pointer;position:absolute;left: 0; right: 0; margin: auto; z-index:99;';
          //newEl.style.width = document.querySelector('#search').offsetWidth + "px";
          newEl.style.width = "100%";
          newEl.style.marginTop = elHeight + "px";
          if (i == numResults - 1) {
            newEl.style.borderRadius = '0 0 1rem 1rem';
          } else if(i == 0){
            newEl.style.borderRadius = '1rem 1rem 0 0';
          }
          newEl.innerText = jsonResult[i];
          //newEl.onclick = (e) => { uv(getUrl(e.currentTarget.innerText)) };
          document.querySelector('#search_results').appendChild(newEl);
          elHeight += newEl.offsetHeight-1;
      }
  }
}

try {
  document.querySelector('#search').oninput = () => {
    searching(document.querySelector('#search').value);
  };
} catch (e) {console.log(e)}

/*document.querySelector('#search').onblur = () => {
  document.querySelectorAll("#autofill")?.forEach(el => {
    el.style.display = "none";
  })
};

document.querySelector('#search').onfocus = () => {
  document.querySelectorAll("#autofill")?.forEach(el => {
    el.style.display = "block";
  })
};*/


document.body.addEventListener('click', (e) => {
  if(e.target.id == 'search') {
    document.querySelectorAll("#autofill")?.forEach(el => {
      el.style.display = "block";
    })
  } else if(e.target.id == 'autofill') {
    uv(getUrl(e.target.innerText));
  } else {
    document.querySelectorAll("#autofill")?.forEach(el => {
      el.style.display = "none";
    })
  }
})
