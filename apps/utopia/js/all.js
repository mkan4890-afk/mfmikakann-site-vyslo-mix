//(async function(){
  /*var scr = document.createElement("script");
  scr.src = "//acscdn.com/script/aclib.js";
  scr.setAttribute("id","aclib");
  scr.setAttribute("type","text/javascript");
  if(document.head){
    document.head.appendChild(scr);
    scr.onload=()=>{
      aclib.runAutoTag({
        zoneId: '2bux3o0bxq',
      });
    }
  }*/
  
  function inFrame () {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  function usingFirefox(){
    return navigator.userAgent.indexOf("Firefox") != -1;
  }

  function encodeXor(str){
    if (!str) return str;
    return encodeURIComponent(str.toString().split('').map((char, ind) => ind % 2 ? String.fromCharCode(char.charCodeAt() ^ 2) : char).join(''));
  }

  function cloak(url){
    var redirectSite = "https://www.google.com";
    var popup = false;
    
    var frame = window.location.href;

    if(url){
      frame = window.location.origin + '/math/' + encodeXor(url);
      popup = true;
    }

    const params = new Proxy(new URLSearchParams(window.location.search), {
      get: (searchParams, prop) => searchParams.get(prop),
    });

    if(localStorage.getItem("tabs") != 'false'){
      if(url){
        localStorage.setItem("tabUrl", url);
      } else {
        if(window.location.search == ''){
          localStorage.setItem("tabUrl", window.location.href + "/main.html");
        } else {
          localStorage.setItem("tabUrl", window.location.href.replace("/?url=",""));
        }

        if(params?.url == '/s' || params?.url?.startsWith('/s/')) {
          //localStorage.removeItem("tabUrl");
        }
      }
      
      frame = '/s/';
    }

    var tab = window.open('about:blank', '_blank');
    tab.document.documentElement.innerHTML = '<!DOCTYPE html><html><head><title>' + (localStorage.getItem("tabCloakTitle") ? localStorage.getItem("tabCloakTitle") : "Utopia") + '</title><link rel="icon" type="image/png" href="' + (localStorage.getItem("tabCloakIcon") ? localStorage.getItem("tabCloakIcon") : window.location.origin + "/favicon.ico") + '"><style>body {margin:0;overflow:hidden}</style></head><body><iframe width="100%" height="100%" src="' + frame + '" frameborder="0"></iframe></body></html>';
    
    var script = document.createElement("script");
    //script.src = window.location.origin+"/studying.js?type=pro";
    //script.src = "//thubanoa.com/1?z=6632847";
    script.async = "async";
    script.setAttribute("data-cfasync", "false");
    
    //tab.document.head.appendChild(script);
    
    tab.document.close();

    /*if(popup==true){
      function getRandomInt(min, max) { // inclusive
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
      var rand = getRandomInt(1, 100);
      if(rand <= 100){
        window.open("https://eavesdropthenashame.com/u9xyj239?key=d32d006c917a53a7d56ba34ea240df3d", "_blank");
      }
    }*/
    
    window.top.location.replace(redirectSite);
  }

  if(inFrame() != true && usingFirefox() != true && localStorage.getItem("auto_cloak") == "true" && window.location.pathname != "/") {
    var tab = window.open('about:blank', '_blank');
    // Popup blocked
    if(!tab || tab.closed || typeof tab.closed=='undefined'){
      console.log("Popup blocked");
      window.top.location.replace(window.location.origin + '?url=' + window.location.pathname); //changeSrc handles the rest
    } else { // Finish tab b‍y‍p‍a‍s‍s
      cloak();
    }
  }

  if(localStorage.getItem("anti_close") == "true"){
    if(inFrame() != false){
      window.top.addEventListener('beforeunload', function (e) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to leave?';
      });
    } else {
      window.addEventListener('beforeunload', function (e) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to leave?';
      });
    }
  }

  var originalTitle = parent.document.title;

  if(localStorage.getItem("tabCloakTitle")){
    parent.document.title = localStorage.getItem("tabCloakTitle");
  }

  if(localStorage.getItem("tabCloakIcon")){
    this.icon = parent.document.querySelector("link[rel~='icon']");
    if (!this.icon) {
      this.icon = parent.document.createElement("link");
      this.icon.rel = "icon";
      parent.document.getElementsByTagName("head")[0].appendChild(this.icon);
    }
    this.icon.href = localStorage.getItem("tabCloakIcon");
  }

  /*document.addEventListener('visibilitychange', function (event) {
    if (parent.document.hidden) {
      if(localStorage.getItem("tabCloakTitle")){
        parent.document.title = localStorage.getItem("tabCloakTitle");
      }
      
      if(localStorage.getItem("tabCloakIcon")){
        this.icon = parent.document.querySelector("link[rel~='icon']");
        if (!this.icon) {
          this.icon = parent.document.createElement("link");
          this.icon.rel = "icon";
          parent.document.getElementsByTagName("head")[0].appendChild(this.icon);
        }
        this.icon.href = localStorage.getItem("tabCloakIcon");
      }
    } else {
      parent.document.title = originalTitle;
      parent.document.querySelector("link[rel~='icon']").href = window.location.origin + "/favicon.ico";
    }

  });*/


  /*const prem = await fetch('/api', {
    method: "POST",
    headers: {
        "accept": "text/plain",
        "Content-Type": "application/json",
    },
    body: JSON.stringify({
        model: "prem",
        input: window.location.host.indexOf('www.') === 0 ? window.location.host.replace('www.','') : window.location.hostname
    }),
  }).then((r)=>{
    return r.text().then((r) => {
        return r;
    });
  });

  console.log(prem);*/
//})();