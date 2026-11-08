// Thay đổi chuỗi này mỗi khi bạn muốn ép tất cả người dùng xóa cache (Ví dụ: v2, v3...)
const CACHE_VERSION = 'xr-v2-' + Date.now(); 
const CACHE_NAME = 'xam-reader-cache-' + CACHE_VERSION;

const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (e) => {
  // Bỏ qua giai đoạn chờ, kích hoạt ngay lập tức sw mới
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Dùng { cache: "reload" } để đảm bảo không lấy tài nguyên bị trình duyệt cache ngầm
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: "reload" })));
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Xóa tất cả các cache cũ không khớp với CACHE_NAME hiện tại
          if (cacheName !== CACHE_NAME) {
            console.log('Xóa cache cũ:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Tiếp quản các trang đang mở ngay lập tức
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 1. Không bao giờ cache các request gọi API hoặc khác phương thức GET
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // 2. Chặn cache hoàn toàn cho file gốc (index.html) để luôn lấy giao diện mới nhất
  if (url.origin === location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .catch(() => caches.match(e.request)) // Chỉ dùng cache khi mất mạng (offline)
    );
    return;
  }

  // 3. Với các tài nguyên tĩnh khác (ảnh, icon), dùng Network-First như cũ
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Cập nhật lại cache tĩnh nếu fetch thành công
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseClone);
        });
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
