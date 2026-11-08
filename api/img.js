const { Readable } = require('stream');
const { UA, assertPublic, authorized } = require('./_lib');

/** GET /api/img?url=...&ref=https://domain/&k=KEY — tải ảnh/video kèm Referer của diễn đàn (qua mặt chống hotlink), có hỗ trợ Range. */
module.exports = async (req, res) => {
  const { url, ref, k } = req.query || {};
  if (!authorized(k)) return res.status(401).end('Sai khóa truy cập');
  try {
    let cur = String(url || '');
    let r;
    for (let hop = 0; hop < 5; hop++) {
      const u = await assertPublic(cur);
      const headers = {
        'user-agent': UA,
        accept: 'image/avif,image/webp,image/*,video/*,*/*;q=0.8',
        referer: String(ref || u.origin + '/'),
      };
      if (req.headers.range) headers.range = req.headers.range;
      r = await fetch(u, { headers, redirect: 'manual', signal: AbortSignal.timeout(25000) });
      const loc = r.headers.get('location');
      if (loc && r.status >= 300 && r.status < 400) { try { await r.body?.cancel(); } catch {} cur = new URL(loc, u).href; r = null; continue; }
      break;
    }
    if (!r) throw new Error('Quá nhiều lần chuyển hướng');

    const ct = r.headers.get('content-type') || '';
    if (!/^(image|video)\//i.test(ct) && !/octet-stream/i.test(ct)) { try { await r.body?.cancel(); } catch {} return res.status(415).end('Không phải ảnh/video'); }

    res.status(r.status);
    const pass = ['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
    if (!r.headers.get('content-encoding')) pass.push('content-length');
    pass.forEach((h) => { const v = r.headers.get(h); if (v) res.setHeader(h, v); });
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox"); // chặn SVG chạy script
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    res.status(502).end(String((e && e.message) || e));
  }
};
