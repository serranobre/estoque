// Service Worker com os mesmos nomes de arquivos do repo dos pedidos
const CACHE = 'estoque-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // favicons/ícones iguais ao repo de pedidos
  './favicon-96x96.png',
  './favicon.svg',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  // logo padrão
  './Serra-Nobre_3.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.mode === 'navigate'){
    e.respondWith(
      fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put('./', copy)).catch(()=>{});
        return res;
      }).catch(()=>caches.match('./'))
    );
  } else {
    e.respondWith(caches.match(req).then(r=> r || fetch(req)));
  }
});
