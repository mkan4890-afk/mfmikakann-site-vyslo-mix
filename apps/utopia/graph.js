importScripts('./classes/science.js');

const sw = new UVServiceWorker();

self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener('fetch', event =>
    event.respondWith(
        sw.fetch(event)
    )
);