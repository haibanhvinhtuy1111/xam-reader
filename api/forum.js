// api/forum.js - Serverless function hỗ trợ lấy danh sách bài theo từng Forum
import * as cheerio from 'cheerio';

const MIRRORS = ['https://xamvn.work', 'https://xamvn.id', 'https://xamvn.vc'];

async function fetchWithFallback(path) {
  for (const domain of MIRRORS) {
    try {
      const res = await fetch(`${domain}${path}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'vi-VN,vi;q=0.9'
        }
      });
      if (res.ok) {
        const html = await res.text();
        return { html, domain };
      }
    } catch (e) {
      // Thử sang mirror tiếp theo
    }
  }
  throw new Error('Không thể kết nối tới các nguồn diễn đàn');
}

export default async function handler(req, res) {
  const { forumId = 'chuyen-tro-linh-tinh.19', page = 1, order = 'last_post_date', prefix_id = '' } = req.query;

  try {
    let queryParams = `?order=${order}`;
    if (prefix_id) queryParams += `&prefix_id=${prefix_id}`;
    const pageSegment = Number(page) > 1 ? `page-${page}` : '';
    const path = `/r/${forumId}/${pageSegment}${queryParams}`;

    const { html, domain } = await fetchWithFallback(path);
    const $ = cheerio.load(html);

    const threads = [];
    $('.structItem--thread').each((_, el) => {
      const $el = $(el);
      const titleLinks = $el.find('.structItem-title a');
      const prefixEl = $el.find('.structItem-title .label');
      const mainLink = titleLinks.last();

      const rawHref = mainLink.attr('href') || '';
      const threadIdMatch = rawHref.match(/threads\/([^/]+)/);

      threads.push({
        id: threadIdMatch ? threadIdMatch[1] : rawHref,
        title: mainLink.text().trim(),
        prefix: prefixEl.text().trim() || null,
        author: $el.attr('data-author') || $el.find('.structItem-minor .username').first().text().trim(),
        replies: $el.find('.structItem-cell--meta dd').first().text().trim() || '0',
        views: $el.find('.structItem-cell--meta dd').last().text().trim() || '0',
        lastPostTime: $el.find('.structItem-cell--latest time').attr('datetime') || $el.find('.structItem-cell--latest time').text().trim(),
        isSticky: $el.hasClass('is-sticky') || $el.find('.structItem-status--sticky').length > 0,
        hasImage: $el.find('.structItem-status--image, .fa-image').length > 0
      });
    });

    const totalPages = parseInt($('.pageNav-main .pageNav-page').last().text().trim(), 10) || 1;

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.status(200).json({
      source: domain,
      forumId,
      currentPage: Number(page),
      totalPages,
      threads
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
