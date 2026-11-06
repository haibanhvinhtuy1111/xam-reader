import { parseDocument } from 'htmlparser2';
import { selectAll, selectOne } from 'css-select';
import { getAttributeValue as attr, textContent } from 'domutils';
import type { Element } from 'domhandler';

export type MediaItem = { id: string; type: 'image' | 'video'; url: string };
export type ThreadItem = { url: string; title: string; snippet?: string };

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|m3u8)(\?|#|$)/i;

export const hostOf = (u: string) => u.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
export const originOf = (u: string) => u.match(/^https?:\/\/[^/]+/i)?.[0] ?? '';

/** Đưa link tương đối về tuyệt đối. `base` là origin (https://domain), không dùng `URL` vì polyfill của RN thiếu. */
function abs(raw: string | null | undefined, base: string): string | null {
  const s = raw?.trim();
  if (!s || s.startsWith('data:') || s.startsWith('javascript:')) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  return base.replace(/\/+$/, '') + (s.startsWith('/') ? s : '/' + s);
}

const ancestor = (el: Element, test: (p: Element) => boolean) => {
  for (let p = el.parent as Element | null; p; p = p.parent as Element | null) if (test(p)) return true;
  return false;
};
const inQuote = (el: Element) => ancestor(el, (p) => p.name === 'blockquote');

/** /threads/ten-bai.123/page-4#post-9 -> /threads/ten-bai.123 */
export const normalizeThreadUrl = (u: string) => {
  const m = u.match(/^(https?:\/\/[^/]+\/threads\/[^/?#]+)/i);
  return m ? m[1] : u.split('#')[0];
};

/**
 * Bóc ảnh/video trong nội dung bài viết XenForo 2.
 * - Ảnh: `.message-body img.bbImage`, ưu tiên data-url (ảnh gốc) rồi data-src, cuối cùng mới src (có thể là proxy.php).
 * - Bỏ avatar / emoji / ảnh nằm trong khối trích dẫn (tránh trùng ảnh bài được quote).
 * - Video: <video>, <source>, iframe nhúng, và link trỏ thẳng tới .mp4/.mov/.m3u8...
 */
export function parseMedia(html: string, base: string): MediaItem[] {
  const doc = parseDocument(html);
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  const add = (type: MediaItem['type'], raw?: string | null) => {
    const url = abs(raw, base);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ id: `${type}:${url}`, type, url });
  };

  for (const body of selectAll('.message-body', doc) as Element[]) {
    for (const img of selectAll('img.bbImage', body) as Element[]) {
      if (/avatar|smilie|emoji/i.test(attr(img, 'class') ?? '') || attr(img, 'data-smilie') || inQuote(img)) continue;
      add('image', attr(img, 'data-url') || attr(img, 'data-src') || attr(img, 'src'));
    }
    for (const v of selectAll('video, video source', body) as Element[]) {
      if (!inQuote(v)) add('video', attr(v, 'src') || attr(v, 'data-src'));
    }
    for (const f of selectAll('iframe', body) as Element[]) {
      if (!inQuote(f)) add('video', attr(f, 'src') || attr(f, 'data-src'));
    }
    for (const a of selectAll('a[href]', body) as Element[]) {
      const href = attr(a, 'href');
      if (href && VIDEO_EXT.test(href) && !inQuote(a)) add('video', href);
    }
  }
  // Ảnh đính kèm (attachment) nằm ngoài .message-body
  for (const a of selectAll('.message-attachments a.js-lbImage', doc) as Element[]) add('image', attr(a, 'href'));
  return out;
}

/** Số trang lớn nhất, lấy từ các link `.../page-N` trong thanh phân trang. */
export function parseLastPage(html: string): number {
  const doc = parseDocument(html);
  let max = 1;
  for (const a of selectAll('.pageNav a[href], .pageNavWrapper a[href]', doc) as Element[]) {
    const n = parseInt(attr(a, 'href')?.match(/page-(\d+)/)?.[1] ?? '', 10);
    if (n > max) max = n;
  }
  return max;
}

export function parseTitle(html: string): string {
  const doc = parseDocument(html);
  const el = selectOne('h1.p-title-value', doc) ?? selectOne('title', doc);
  return el ? textContent(el).replace(/\s+/g, ' ').trim() : '';
}

/** Danh sách chủ đề từ trang "Mới nhất" (.structItem) và trang kết quả tìm kiếm (.contentRow). */
export function parseThreadList(html: string, base: string): ThreadItem[] {
  const doc = parseDocument(html);
  const out: ThreadItem[] = [];
  const seen = new Set<string>();
  for (const a of selectAll('.structItem-title a:not(.labelLink), .contentRow-title a', doc) as Element[]) {
    const href = abs(attr(a, 'href'), base);
    if (!href || !/\/(threads|posts)\//.test(href)) continue;
    const url = normalizeThreadUrl(href);
    const title = textContent(a).replace(/\s+/g, ' ').trim();
    if (!title || seen.has(url)) continue;
    seen.add(url);
    let main: Element | null = null;
    for (let p = a.parent as Element | null; p && !main; p = p.parent as Element | null) {
      if ((attr(p, 'class') ?? '').includes('contentRow-main')) main = p;
    }
    const snip = main ? selectOne('.contentRow-snippet', main) : null;
    out.push({ url, title, snippet: snip ? textContent(snip).replace(/\s+/g, ' ').trim() : undefined });
  }
  return out;
}

/** Thông báo lỗi của XenForo (vd: "Bạn phải đợi 10 giây trước khi tìm tiếp"). */
export function parseBlockMessage(html: string): string | null {
  const el = selectOne('.blockMessage, .block-body--error, .overlay-title', parseDocument(html));
  return el ? textContent(el).replace(/\s+/g, ' ').trim() || null : null;
}
