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

var redirectSite = "https://www.google.com";

if( window.location.pathname == "/"){
  const params = new Proxy(new URLSearchParams(window.location.search), {
    get: (searchParams, prop) => searchParams.get(prop),
  });
  if(params.url && params.url.includes("/")){
    var frameUrl = "/" + params.url.substring(1);
  } else {
    var frameUrl = "/main.html";
  }
  document.querySelector(".frame").src = window.location.origin + frameUrl;

  if(inFrame() != true && usingFirefox() != true && localStorage.getItem("auto_cloak") == "true"){
    window.onload = function(){
      //var openBlank = confirm("Would you like to hide this from your history? (To disable this popup, turn off 'Automatic Hidden Mode' in Settings)");
      
      //if(openBlank == true) {
        document.querySelector(".hider").style.display = "flex";
        document.onmousedown = () => {cloak()};
        document.onkeydown = () => {cloak()};
        /*document.onclick = () => {cloak()};*/
        //prev openBackup(), now cloak() from all.js
      //}
    }
  }
}


