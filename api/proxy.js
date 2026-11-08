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
 * Tự theo redirect thủ công (kiểm tra SSRF ở từng bước) và giữ cookie giữa các bước,
 * để luồng tìm kiếm XenForo (GET /search/ -> POST -> 303) chạy đúng.
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ nhận POST' });
  if (!authorized(req.headers['x-key'])) return res.status(401).json({ error: 'Sai hoặc thiếu khóa truy cập (ACCESS_KEY)' });

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
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
        referer: u.origin + '/',
      };
      if (Object.keys(jar).length) headers.cookie = serCk(jar);
      if (body !== undefined) {
        headers['content-type'] = String(b.contentType || 'application/x-www-form-urlencoded');
        headers.origin = u.origin;
      }

      const r = await fetch(u, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20000) });

      for (const sc of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
        const pair = sc.split(';')[0];
        const i = pair.indexOf('=');
        if (i > 0) { const n = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim(); jar[n] = v; fresh[n] = v; }
      }

      const loc = r.headers.get('location');
      if (loc && r.status >= 300 && r.status < 400) {
        try { await r.body?.cancel(); } catch {}
        cur = new URL(loc, u).href;
        if (r.status !== 307 && r.status !== 308) { method = 'GET'; body = undefined; }
        continue;
      }

      const html = await r.text();
      if (html.length > 4_000_000) throw new Error('Trang quá lớn (>4MB), Vercel không trả về được');
      return res.status(200).json({ status: r.status, url: u.href, html, cookies: fresh });
    }
    throw new Error('Quá nhiều lần chuyển hướng');
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
