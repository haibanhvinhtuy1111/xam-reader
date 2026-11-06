import { fetchHtml, isCloudflare } from './http';
import { getConfig } from './domain';
import {
  MediaItem,
  ThreadItem,
  normalizeThreadUrl,
  originOf,
  parseBlockMessage,
  parseLastPage,
  parseMedia,
  parseThreadList,
  parseTitle,
} from './parser';

/** Link cũ (domain đã đổi) -> thay host bằng domain hiện tại. */
function rebase(u: string) {
  const { domain } = getConfig();
  const o = originOf(u);
  return o && o.toLowerCase() !== domain && /\/(threads|posts|goto)\//.test(u) ? domain + u.slice(o.length) : u;
}

type Hooks = {
  onTitle?: (t: string) => void;
  onProgress: (items: MediaItem[], donePages: number, totalPages: number) => void;
  isCancelled: () => boolean;
};

/**
 * Quét toàn bộ các trang (/page-1, /page-2, ...) của một chủ đề, 3 trang song song.
 * Kết quả được đẩy dần qua onProgress (đúng thứ tự trang) để lưới ảnh hiện ra ngay khi có dữ liệu.
 */
export async function scrapeThread(input: string, hooks: Hooks) {
  const first = await fetchHtml(rebase(input.trim()));
  const origin = originOf(first.url) || getConfig().domain;
  const root = normalizeThreadUrl(first.url).replace(/\/+$/, '');
  const current = parseInt(first.url.match(/page-(\d+)/)?.[1] ?? '1', 10);
  const total = parseLastPage(first.html);
  hooks.onTitle?.(parseTitle(first.html));

  const byPage = new Map<number, MediaItem[]>([[current, parseMedia(first.html, origin)]]);
  let done = 1;
  const emit = () => {
    const seen = new Set<string>();
    const list: MediaItem[] = [];
    [...byPage.keys()]
      .sort((a, b) => a - b)
      .forEach((p) => byPage.get(p)!.forEach((m) => !seen.has(m.url) && (seen.add(m.url), list.push(m))));
    hooks.onProgress(list, done, total);
  };
  emit();

  const queue = Array.from({ length: total }, (_, i) => i + 1).filter((p) => p !== current);
  const worker = async () => {
    while (queue.length && !hooks.isCancelled()) {
      const p = queue.shift()!;
      try {
        byPage.set(p, parseMedia((await fetchHtml(`${root}/page-${p}`)).html, origin));
      } catch (e) {
        if (isCloudflare(e)) throw e; // trang lỗi lẻ tẻ thì bỏ qua, Cloudflare thì dừng để xác thực
      }
      done++;
      emit();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export async function fetchLatest(): Promise<ThreadItem[]> {
  const { domain } = getConfig();
  const r = await fetchHtml(`${domain}/whats-new/posts/`);
  return parseThreadList(r.html, domain);
}

export type SearchOpts = {
  q: string;
  /** thread: tìm trong tiêu đề chủ đề · post: tìm trong nội dung bình luận · author: theo người đăng */
  by: 'thread' | 'post' | 'author';
  exact: boolean;
  order: 'relevance' | 'date' | 'replies';
};

/** XenForo tìm kiếm bằng POST + CSRF: lấy token ở /search/, POST /search/search, fetch tự theo redirect tới trang kết quả. */
export async function searchForum({ q, by, exact, order }: SearchOpts): Promise<ThreadItem[]> {
  const { domain } = getConfig();
  const form = await fetchHtml(`${domain}/search/`);
  const token =
    form.html.match(/data-csrf="([^"]+)"/)?.[1] ?? form.html.match(/name="_xfToken"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new Error('Không lấy được mã CSRF của diễn đàn');

  const kw = q.trim();
  const params: Record<string, string> = { _xfToken: token, order, search_type: 'post' };
  if (by === 'author') params['c[users]'] = kw;
  else params.keywords = exact ? `"${kw}"` : kw;
  if (by === 'thread') params['c[title_only]'] = '1';
  if (by !== 'post') params.grouped = '1'; // gộp kết quả theo chủ đề

  const res = await fetchHtml(`${domain}/search/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: domain },
    body: Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&'),
  });
  const list = parseThreadList(res.html, originOf(res.url) || domain);
  if (!list.length) throw new Error(parseBlockMessage(res.html) ?? 'Không có kết quả phù hợp');
  return list;
}
