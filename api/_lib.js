// api/_lib.js
const DEFAULT_DOMAIN = process.env.TARGET_DOMAIN || 'https://xamvn.com';

export function getTargetDomain(req) {
  const customDomain = req.headers['x-target-domain'] || req.query.domain;
  if (customDomain && /^https?:\/\/[a-zA-Z0-9.-]+$/.test(customDomain.trim())) {
    return customDomain.trim().replace(/\/$/, '');
  }
  return DEFAULT_DOMAIN.replace(/\/$/, '');
}

export function getBrowserHeaders(baseUrl, cookie = '') {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': `${baseUrl}/`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
  };
  if (cookie) headers['Cookie'] = cookie;
  return headers;
}
