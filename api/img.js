const { Readable } = require('stream');
const { UA, assertPublic, authorized } = require('./_lib');

/** GET /api/img?url=...&ref=https://domain/&k=KEY — tải ảnh/video kèm Referer của diễn đàn, hỗ trợ Range. */
module.exports = async (req, res) => {
  const { url, ref, k } = req.query || {};
  if (!authorized(k)) return res.status(401).end('Sai khóa truy cập');

  // 1. Quản lý hủy luồng (AbortController) để tiết kiệm băng thông Vercel
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('Timeout')), 25000);
  
  // NÂNG CẤP: Khi người dùng đóng tab hoặc lướt qua ảnh/video, lập tức ngắt tải từ server gốc
  req.on('close', () => {
    clearTimeout(timeoutId);
    controller.abort(); 
  });

  try {
    let cur = String(url || '');
    let r;
    for (let hop = 0; hop < 5; hop++) {
      const u = await assertPublic(cur);
      const headers = {
        'user-agent': UA,
        'accept': 'image/avif,image/webp,image/apng,image/*,video/*,audio/*,*/*;q=0.8',
        'referer': String(ref || u.origin + '/'),
      };
      // Giữ nguyên Range để Safari/iOS có thể tua video
      if (req.headers.range) headers.range = req.headers.range;

      r = await fetch(u, { 
        headers, 
        redirect: 'manual', 
        signal: controller.signal // Truyền tín hiệu hủy luồng vào đây
      });

      const loc = r.headers.get('location');
      if (loc && r.status >= 300 && r.status < 400) { 
        try { await r.body?.cancel(); } catch {} 
        cur = new URL(loc, u).href; 
        r = null; 
        continue; 
      }
      break;
    }
    
    clearTimeout(timeoutId);
    if (!r) throw new Error('Quá nhiều lần chuyển hướng');

    const ct = r.headers.get('content-type') || '';
    // Mở rộng thêm audio/ đề phòng có voice đính kèm
    if (!/^(image|video|audio)\//i.test(ct) && !/octet-stream/i.test(ct)) { 
      try { await r.body?.cancel(); } catch {} 
      return res.status(415).end('Định dạng không được hỗ trợ'); 
    }

    res.status(r.status);
    // Bổ sung content-disposition để giữ tên file nếu user ấn tải xuống
    const pass = ['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'content-disposition'];
    if (!r.headers.get('content-encoding')) pass.push('content-length');
    
    pass.forEach((h) => { 
      const v = r.headers.get(h); 
      if (v) res.setHeader(h, v); 
    });

    // NÂNG CẤP: Đẩy thời gian cache lên 1 năm (immutable) vì ảnh trên forum gần như không bao giờ đổi nội dung
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox"); // chặn SVG chạy script
    
    if (!r.body) return res.end();
    
    // NÂNG CẤP: Stream an toàn hơn, tránh crash Node.js `ERR_HTTP_HEADERS_SENT` khi lỗi bất ngờ
    const stream = Readable.fromWeb(r.body);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
    
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') return res.end(); // Im lặng kết thúc nếu do user đóng kết nối, tránh tràn log
    if (!res.headersSent) res.status(502).end(String((e && e.message) || e));
  }
};
