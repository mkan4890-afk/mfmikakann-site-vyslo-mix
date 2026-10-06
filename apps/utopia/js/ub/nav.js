(async () => {
  /*await fetch('/nav.html')
  .then(response => response.text())
  .then(nav => {*/
var maxNotifNumInUse = 13; //not in use anymore
var nav = `<div class="title"><a href="/main.html">
<img src="img/logo.png">&nbsp;Utopia
</a></div>
<div class="pages">
<ul>
    <li><a href="https://discord.gg/hFZC5cgsmq" target="_blank" class="disc" id="pageHover"><span class="material-symbols-outlined disc">hotel_class</span>&nbsp;&nbsp;Get more links!</a></li>
    <li><a href="/gams/" id="pageHover"><span class="material-symbols-outlined">stadia_controller</span>&nbsp;&#71;‍&#97;<sc>&#109;</sc>&#101;&#115;</a></li>
    <li><a href="/a" id="pageHover"><span class="material-symbols-outlined" style="margin-top:-4px;">robot_2</span>&nbsp;&#85;&#116;&#111;‍&#112;<sc>&#105;&#97;‍&#65;</sc>&#73;</a></li>
    <li><a href="/settings.html" id="pageHover"><span class="material-symbols-outlined">settings</span>&nbsp;Settings</a></li>
    <!--<li><a href="/books.html" id="pageHover"><span class="material-symbols-outlined" style="margin-top:-4px;">star</span>&nbsp;&#66;&#111;&#111;&#107;‍<sc>&#109;&#97;‍&#114;</sc>&#107;<sc>&#108;‍&#101;</sc>&#116;‍&#115;</a></li>-->
    <div class="dropdown">
    <li><a href="#" class="quick_links" id="pageHover"><span class="material-symbols-outlined">expand_more</span>Quick Links</a></li>
    <div class="dropdown-links">
        <a href="/settings.html"><span class="material-symbols-outlined" style="font-size:14px;">add_circle</span>&nbsp;Add links in <span style="text-decoration: underline;">Settings</span></a>
    </div>
    </div>
</ul>
<span class="hamburger">
    <span class="material-icons" id="menuBtn">menu</span>
</span>
</div>`;

  document.querySelector('navbar').innerHTML = nav;
  if(location.pathname.startsWith("/gams.html")){
    document.querySelector('navbar ul li:nth-child(1)').remove();
    document.querySelector('navbar ul').innerHTML = 
    `<li><span class="navBtn" onclick="goFullscreen()"><i class="fa-solid fa-expand"></i> ‍ Fullscreen Mode</span></li>`
    + document.querySelector('navbar ul').innerHTML;
  }

  var menuIcon = document.querySelector(".hamburger");
  var menuBtn = document.getElementById("menuBtn");
  var navbar = document.querySelector(".navbar");
  var links = document.querySelector(".pages");
  var linkBtns = document.querySelectorAll("#pageHover");
  var centeredStuff = document.querySelector(".center");
  var dropdown = document.querySelector(".dropdown");
  var dropdownLinks = document.querySelector(".dropdown-links");

  document.body.classList.add('notransition'); //disable on load
  document.body.classList.remove('notransition'); //enable after

  const menuDisplay = menuIcon.style.display;
  menuIcon.style.visibility = "none";
  menuIcon.style.display = "flex";
  menuIcon.style.top = (navbar.clientHeight/2 - menuIcon.clientHeight/2) + "px";
  menuIcon.style.visibility = "";
  menuIcon.style.display = menuDisplay;

  menuIcon.onclick = function(){
    if(menuBtn.innerText != "close"){
      menuBtn.innerText = "close";
    } else {
      menuBtn.innerText = "menu";
    }
    for(var i=0;i<linkBtns.length;i++){
      linkBtns[i].classList.toggle('show');
    }
  }

  dropdown.onmouseover = function() {
    dropdownLinks.style.display = "block";
    dropdownLinks.style.opacity = "1";
    dropdownLinks.style.animation = "0.4s dropdownFadeIn";
  }

  dropdown.onmouseout = function() {
    dropdownLinks.style.opacity = "0";
    dropdownLinks.style.animation = "0.3s dropdownFadeOut";
  }

  dropdownLinks.addEventListener("animationend", function() {
    if(dropdownLinks.style.opacity == "0") {
      dropdownLinks.style.display = "none";
    }
  }, false);


  
  const searchUrl = 'https://www.google.com/search?q=';

  function encodeUrl(str){
    if (!str) return str;
    return encodeURIComponent(str.toString().split('').map((char, ind) => ind % 2 ? String.fromCharCode(char.charCodeAt() ^ 2) : char).join(''));
  }

  function updateLinks() {
    if(localStorage.getItem("quickLinkDetails") != null) {
      this.links = JSON.parse(localStorage.getItem("quickLinkDetails"));
    } else {return;}
    if(this.links.length == 0) {
      document.querySelector(".dropdown-links").innerHTML = '<a href="settings.html"><span class="material-symbols-outlined" style="font-size:14px;">add_circle</span>&nbsp;Add links in <span style="text-decoration: underline;">Settings</span></a>';
      return;
    }
    document.querySelector(".dropdown-links").innerHTML = "";
    for(var i=0;i<this.links.length;i++){
      this.newLink = document.createElement("a");
      this.newLink.href = "#";
      this.newLink.id = this.links[i][0];
      this.newLink.innerText = this.links[i][1];
      document.querySelector(".dropdown-links").appendChild(this.newLink);

      this.newLink.onclick = function () {
        /*this.newFrame = document.createElement("iframe");
        this.newFrame.style.border = "none";
        this.newFrame.style.display = "none";
        this.newFrame.src = "go.html";
        document.body.appendChild(this.newFrame);*/
        window.navigator.serviceWorker.register('/graph.js', {
          scope: __uv$config.prefix
        }).then(() => {
          console.log("Service worker (for Quick Links) registered.");

          try {
            sessionStorage.setItem("tabUrl", this.id);
            if(localStorage.getItem("ab_cloak") != "false" && window.top.location.href != "about:blank") {
              cloak(this.id); // cloak() in all.js
            } else {
              if(localStorage.getItem("tabs") != 'false'){
                window.location.href = '/s/'; // tabs
              } else {
                window.location.href = __uv$config.prefix + encodeUrl(this.id);
              }
            }
          } catch (err) {
            console.log("Quick Links Error", err);
            window.location.href = __uv$config.prefix + encodeUrl(this.id);
          }

        });
      }
    }
  }

  updateLinks();

})();