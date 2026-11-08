const { UA, assertPublic, authorized } = require('./_lib');

const parseCk = (s) =>
  Object.fromEntries(
    String(s || '').split(';').map((x) => x.trim()).filter(Boolean)
      .map((x) => { const i = x.indexOf('='); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i + 1)]; }),
  );
const serCk = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('; ');

/**
 * POST /api/proxy  { url, method?, body?, contentType?, cookie?, ua? }
 * -> { status, url (sau redirect), html, cookies (cookie mới server set) }
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận POST' });
  if (!authorized(req.headers['x-key'])) return res.status(401).json({ error: 'Sai hoặc thiếu khóa truy cập (ACCESS_KEY)' });

  // NÂNG CẤP 1: Quản lý luồng bằng AbortController để chống rò rỉ tài nguyên (Memory Leak)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('Timeout')), 20000);
  req.on('close', () => {
    clearTimeout(timeoutId);
    controller.abort();
  });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    let method = String(b.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw new Error('Method không hợp lệ');
    let body = method === 'POST' ? String(b.body ?? '') : undefined;
    const jar = parseCk(b.cookie);
    const fresh = {};
    let cur = String(b.url || '');

    for (let hop = 0; hop < 6; hop++) {
      const u = await assertPublic(cur);
      const headers = {
        'user-agent': String(b.ua || UA),
        // NÂNG CẤP 2: Bổ sung bộ sec-fetch-* giúp lừa Cloudflare đây là người dùng thật
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'referer': u.origin + '/',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin'
      };
      if (Object.keys(jar).length) headers.cookie = serCk(jar);
      if (body !== undefined) {
        headers['content-type'] = String(b.contentType || 'application/x-www-form-urlencoded');
        headers['origin'] = u.origin;
      }

      const r = await fetch(u, { 
        method, 
        headers, 
        body, 
        redirect: 'manual', 
        signal: controller.signal 
      });

      // NÂNG CẤP 3: Lấy cookie an toàn tương thích mọi phiên bản Node.js/Edge của Vercel
      const setCookies = typeof r.headers.getSetCookie === 'function' 
        ? r.headers.getSetCookie() 
        : (r.headers.get('set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_-]+\s*=)/); // Fallback Regex cắt mảng cookie chuẩn
        
      for (const sc of setCookies) {
        if (!sc) continue;
        const pair = sc.split(';')[0];
        const i = pair.indexOf('=');
        if (i > 0) { 
          const n = pair.slice(0, i).trim(); 
          const v = pair.slice(i + 1).trim(); 
          jar[n] = v; 
          fresh[n] = v; 
        }
      }

      const loc = r.headers.get('location');
      if (loc && r.status >= 300 && r.status < 400) {
        try { await r.body?.cancel(); } catch {}
        cur = new URL(loc, u).href;
        if (r.status !== 307 && r.status !== 308) { method = 'GET'; body = undefined; }
        continue;
      }

      clearTimeout(timeoutId);
      const html = await r.text();
      
      // NÂNG CẤP 4: Tính bằng Byte thật, bảo vệ proxy khỏi lỗi 500 Payload Too Large
      if (Buffer.byteLength(html, 'utf8') > 4_200_000) {
        throw new Error('Trang diễn đàn quá nặng (>4MB), nền tảng Vercel từ chối trả kết quả');
      }
      
      return res.status(200).json({ status: r.status, url: u.href, html, cookies: fresh });
    }
    
    clearTimeout(timeoutId);
    throw new Error('Quá nhiều lần chuyển hướng');
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') return res.end(); 
    
    // Xử lý báo lỗi tường minh hơn khi bị Cloudflare ngâm kết nối
    const msg = e.message === 'Timeout' ? 'Vượt quá thời gian chờ (20s) - diễn đàn hoặc Cloudflare phản hồi quá chậm' : String((e && e.message) || e);
    return res.status(502).json({ error: msg });
  }
};
