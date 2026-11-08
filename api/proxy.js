// api/proxy.js
import { getTargetDomain, getBrowserHeaders } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-target-domain');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const baseUrl = getTargetDomain(req);
    const rawPath = req.query.path || req.query.url || '/';
    
    // Chuẩn hóa đường dẫn để hỗ trợ cả path tương đối (/f/..., /t/...) và full URL
    let targetUrl;
    if (rawPath.startsWith('http')) {
      const parsed = new URL(rawPath);
      targetUrl = `${baseUrl}${parsed.pathname}${parsed.search}`;
    } else {
      const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      targetUrl = `${baseUrl}${cleanPath}`;
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: getBrowserHeaders(baseUrl),
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Upstream trả về mã lỗi ${response.status}`,
        targetUrl,
      });
    }

    let html = await response.text();

    // Tối ưu dung lượng: loại bỏ script tracking/quảng cáo không cần thiết
    html = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // Cache 25 giây trên CDN của Vercel giúp lướt chuyển box cực nhanh
    res.setHeader('Cache-Control', 'public, s-maxage=25, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
