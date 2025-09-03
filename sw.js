// Service Worker para CONTROLE ESTOQUE V2.0
// - Pré-cache de estáticos do app
// - Navegação: network-first com fallback offline
// - CDNs (Firebase/jsPDF/XLSX): stale-while-revalidate em cache dinâmico
// - Força atualização via mensagem {type:'SKIP_WAITING'} (já usada no index)

const APP_VERSION = '2.0.0';
const STATIC_CACHE = `estoque-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `estoque-dyn-${APP_VERSION}`;
const OFFLINE_URL = './index.html';

// Mesmos nomes de arquivos do app de pedidos (ajuste conforme seu repo)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // favicons/ícones
  './favicon-96x96.png',
  './favicon.svg',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  // logo padrão
  './Serra-Nobre_3.png',
];

// Auxiliares
async function putInCache(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (_) {}
}
async function limitCache(cacheName, maxEntries = 120) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      await cache.delete(keys[0]);
      await limitCache(cacheName, maxEntries);
    }
  } catch (_) {}
}

// ===== Install =====
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      // Pré-carrega navegação quando possível
      if ('navigationPreload' in self.registration) {
        await self.registration.navigationPreload.enable();
      }
      const cache = await caches.open(STATIC_CACHE);
      // Usa {cache:'reload'} para pegar a versão mais nova dos arquivos
      await cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
    } finally {
      // Deixa pronto para assumir imediatamente se solicitado
      self.skipWaiting();
    }
  })());
});

// ===== Mensagens (forçar atualização) =====
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===== Activate =====
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      // Limpa caches antigos desta app
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k.startsWith('estoque-') && k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => caches.delete(k))
      );
    } finally {
      await self.clients.claim();
    }
  })());
});

// ===== Estratégias de busca =====
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Apenas GET é cacheável
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navegações (HTML): Network-first com fallback ao cache e offline
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Usa preload se disponível (mais rápido no primeiro load)
        const preload = await event.preloadResponse;
        if (preload) {
          // Atualiza cache da raiz para navegação offline
          putInCache(STATIC_CACHE, './', preload.clone());
          return preload;
        }
        const net = await fetch(request);
        // Atualiza cache da raiz/HTML
        putInCache(STATIC_CACHE, './', net.clone());
        return net;
      } catch (_) {
        // Cache da raiz (SPA) ou index offline
        return (await caches.match('./')) || (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  // 2) Mesma origem e estático pré-cacheado: Cache-first
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

  // 3) CDNs / terceiros (Firebase, jsDelivr, gstatic, unpkg, etc):
  //    Stale-While-Revalidate no cache dinâmico
  const isCDN = /(^|\.)(?:gstatic|googleapis|jsdelivr|unpkg|cloudflare|cdnjs)\.com$/.test(url.hostname);
  if (!sameOrigin || isCDN) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const fetchPromise = fetch(request)
        .then((response) => {
          // Guarda resposta (até mesmo opaque) e limita tamanho do cache
          putInCache(DYNAMIC_CACHE, request, response.clone());
          limitCache(DYNAMIC_CACHE, 180);
          return response;
        })
        .catch(() => null);

      // serve rápido se houver cache; depois atualiza em background
      return cached || (await fetchPromise) || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    })());
    return;
  }

  // 4) Demais requisições (mesma origem não-precached): Network falling back to cache
  event.respondWith((async () => {
    try {
      const net = await fetch(request);
      putInCache(DYNAMIC_CACHE, request, net.clone());
      limitCache(DYNAMIC_CACHE, 180);
      return net;
    } catch (_) {
      const cached = await caches.match(request, { ignoreSearch: true });
      return cached || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});