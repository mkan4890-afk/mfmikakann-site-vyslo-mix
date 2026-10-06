/*function parseDate(dateString, compareDate) {
    let now = moment(compareDate);
    let date = moment(dateString);

    let display = date.format('MMM Do[,] YYYY');
    let total = now.diff(date, 'days')

    var years = now.diff(date, 'year');
    date.add(years, 'years');

    let months = 0;
    if (date.daysInMonth() > now.daysInMonth()) {
        months = date.diff(now, "months");
        now.add(months, "months");
    } else {
        months = now.diff(date, 'months');
        date.add(months, 'months');
    }

    var days = now.diff(date, 'days');

    return {
        display: display,
        years: Math.abs(years),
        months: Math.abs(months),
        days: Math.abs(days),
        total: Math.abs(total),
    }
}

var warn = document.querySelector(".warning");
var daysLeft = document.querySelector("#days");

fetch("https://www.whatsmydns.net/api/domain?q="+window.location.host.replace('www.',''))
    .then(response => response.json())
    .then(json => {
        if (json.data && typeof json.data.expires === "string") {
            const date = parseDate(json.data.expires);

            //console.log("Expires on " + date.display);
            //console.log(date.years);
            //console.log(date.months);
            //console.log(date.days);
            //console.log(date.total+" days left");

            if(date.total <= 7) {
                warn.style.display = "block";
                daysLeft.closest("strong").innerText = date.total == 1 ? "1 day" : date.total+" days";
            }
        } else if (json.data && json.data.expires === null) {
            //console.log("Null expiration date.");
        } else if (json.message) {
            //console.log("JSON Message:" + json.message);
        } else {
            //console.log("Invalid domain name.");
        }
    })
    .catch(error => {
        console.log("Error: " + error);
    });

*/

var warn = document.querySelector(".warning");
var daysLeft = document.querySelector("#days");

/*if(location.origin.includes('thebrain.sbs') || location.origin.includes('algebrahelp.xyz')) {
    warn.style.display = "block";
    daysLeft.closest("strong").innerText = "under " + "24 hours";
}*/

/*
make sure to uncomment this script tag in the file too for this to work
*/
