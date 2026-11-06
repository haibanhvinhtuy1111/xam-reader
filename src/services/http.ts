import CookieManager from '@react-native-cookies/cookies';
import { getConfig } from './domain';

/** cf_clearance gắn với User-Agent => WebView và fetch PHẢI dùng chung đúng một chuỗi này. */
export const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export const isCloudflare = (e: any) => e?.code === 'CF';
const cfError = () => Object.assign(new Error('Cloudflare yêu cầu xác thực'), { code: 'CF' });
const isChallenge = (html: string) => /<title>\s*Just a moment|cf-chl-|challenge-platform/i.test(html);

/** fetch HTML kèm cookie dùng chung (iOS tự lưu/gửi cookie qua NSHTTPCookieStorage). */
export async function fetchHtml(url: string, init: RequestInit = {}, timeoutMs = 20000) {
  const { domain } = getConfig();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      ...init,
      signal: ctl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        Referer: domain + '/',
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
    const html = await res.text();
    if (isChallenge(html) || (res.status === 403 && /cloudflare/i.test(html))) throw cfError();
    if (!res.ok) throw new Error(`Máy chủ trả về HTTP ${res.status}`);
    return { html, url: res.url || url };
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Hết thời gian chờ kết nối');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Nguồn ảnh cho expo-image: proxy wsrv.nl, hoặc gắn Referer của domain hiện tại (zpic, anh.moe...). */
export function imageSource(url: string, thumb = false): { uri: string; headers?: Record<string, string> } {
  const { domain, useProxy } = getConfig();
  if (useProxy) return { uri: `https://wsrv.nl/?url=${encodeURIComponent(url)}${thumb ? '&w=420&q=70' : ''}` };
  return { uri: url, headers: { Referer: domain + '/', 'User-Agent': UA } };
}

/** Sau khi người dùng tick Captcha trong WebView: chép cookie (kể cả HttpOnly như cf_clearance) sang kho cookie native. */
export async function syncCookiesFromWebView(domain: string) {
  const jar = await CookieManager.get(domain, true);
  for (const c of Object.values(jar)) {
    await CookieManager.set(
      domain,
      { name: c.name, value: c.value, domain: c.domain, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly, expires: c.expires },
      false,
    );
  }
}

export async function hasClearance(domain: string) {
  return !!(await CookieManager.get(domain)).cf_clearance;
}

export async function clearCookies() {
  await CookieManager.clearAll(true);
  await CookieManager.clearAll(false);
}
