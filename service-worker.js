/* Fase 1: cache da estrutura estática. Atualizar CACHE_VERSION quando os recursos mudarem. */
const CACHE_VERSION = "invoice-manager-v44";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./css/responsive.css",
  "./js/app.js?v=0.5.12",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Rede primeiro (sem cache HTTP), para a app abrir sempre com a versão mais recente.
  // A cache serve de alternativa quando não há ligação (funcionamento offline).
  event.respondWith(
    fetch(event.request, { cache: "no-cache" }).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then(cached => {
      if (cached) return cached;
      if (event.request.mode === "navigate") return caches.match("./index.html");
      throw new Error("Recurso indisponível offline");
    }))
  );
});