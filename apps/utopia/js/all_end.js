function waitForElm(searcher, selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });

        // If you get "parameter 1 is not of type 'Node'" error, see https://stackoverflow.com/a/77855838/492336
        observer.observe(document.querySelector(searcher), {
            childList: true,
            subtree: true
        });
    });
}
(async () => {
    await waitForElm('navbar','ul');

    var notifs = document.querySelectorAll(".notif");
    var viewed = "";

    if(localStorage.getItem("notifs") && localStorage.getItem("notifs") != ""){
        viewed = localStorage.getItem("notifs");
        for(var i=0;i<notifs.length;i++){
            if(viewed.includes(notifs[i].className.match(/\d+/) + ",")){
                notifs[i].classList.remove("notif");
            }
        }
    }

    if(notifs != undefined && notifs.length > 0){
        for(var i=0;i<notifs.length;i++){
            var check = notifs[i];

            if(notifs[i].tagName == "LI"){
                check = notifs[i].querySelector("a");
            }
            
            check.addEventListener("click", (el)=>{
                if(el.target.closest(".notif")){
                    var elem = el.target.closest(".notif");
                    elem.classList.remove("notif");
                    viewed += elem.className.match(/\d+/) + ",";
                    localStorage.setItem("notifs", viewed);
                }
            });
        }
    }

})();


if(document.querySelector(".bottomText #yr")){
    document.querySelector(".bottomText #yr").innerText = new Date().getFullYear();
}