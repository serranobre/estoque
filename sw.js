// Service Worker – CONTROLE ESTOQUE V2.1.1
// - Precaching
// - Navegação: network-first (fallback offline)
// - CDNs: stale-while-revalidate
// - Força atualização via {type:'SKIP_WAITING'}

const APP_VERSION = '2.1.1';
const STATIC_CACHE  = `estoque-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `estoque-dyn-${APP_VERSION}`;
const OFFLINE_URL   = './index.html';

// arquivos locais a pré-cachear
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon-96x96.png',
  './favicon.svg',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  // todas as variantes do logo usadas no index (fallbacks)
  './Serra-Nobre_3.png',
  './Serra-Nobre_3.webp',
  './Serra-Nobre_3.jpg',
  './Serra-Nobre_3.jpeg',
];

// helpers
async function putInCache(cacheName, req, res) {
  try {
    const c = await caches.open(cacheName);
    await c.put(req, res);
  } catch (_e) {}
}
async function limitCache(cacheName, max = 180) {
  try {
    const c = await caches.open(cacheName);
    const keys = await c.keys();
    while (keys.length > max) {
      await c.delete(keys.shift());
    }
  } catch (_e) {}
}

// ===== install =====
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
    // pronto para ser ativado já
    self.skipWaiting();
  })());
});

// ===== mensagens (forçar atualização) =====
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===== activate =====
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // habilita navigation preload aqui (worker já ativo)
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch (_e) {}
    }
    // limpa caches antigos desta app
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('estoque-') && k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ===== fetch strategies =====
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // só cacheamos GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navegações (HTML) → network-first com preload + fallback offline
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = 'preloadResponse' in event ? await event.preloadResponse : null;
        if (preload) {
          putInCache(STATIC_CACHE, './', preload.clone());
          return preload;
        }
        const net = await fetch(request);
        putInCache(STATIC_CACHE, './', net.clone()); // use './' para SPA raiz
        return net;
      } catch (_e) {
        return (await caches.match('./')) || (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  // 2) Estáticos de mesma origem pré-cacheados → cache-first
  if (sameOrigin) {
    const isPrecached = ASSETS.some(p => url.pathname.endsWith(p.replace('./', '/')));
    if (isPrecached) {
      event.respondWith((async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const net = await fetch(request);
        putInCache(STATIC_CACHE, request, net.clone());
        return net;
      })());
      return;
    }
  }

  // 3) CDNs / terceiros → stale-while-revalidate no dinâmico
  const isCDN = /(^|\.)(?:gstatic|googleapis|jsdelivr|unpkg|cloudflare|cdnjs)\.com$/.test(url.hostname);
  if (!sameOrigin || isCDN) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const fetchPromise = fetch(request)
        .then(res => {
          putInCache(DYNAMIC_CACHE, request, res.clone());
          limitCache(DYNAMIC_CACHE);
          return res;
        })
        .catch(() => null);
      return cached || (await fetchPromise) || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    })());
    return;
  }

  // 4) Demais requisições de mesma origem → network, fallback cache
  event.respondWith((async () => {
    try {
      const net = await fetch(request);
      putInCache(DYNAMIC_CACHE, request, net.clone());
      limitCache(DYNAMIC_CACHE);
      return net;
    } catch (_e) {
      const cached = await caches.match(request, { ignoreSearch: true });
      return cached || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});
