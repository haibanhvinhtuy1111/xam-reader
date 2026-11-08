// api/img.js
import { getTargetDomain, getBrowserHeaders } from './_lib.js';

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing image URL');

  try {
    const baseUrl = getTargetDomain(req);
    const fullImgUrl = url.startsWith('http')
      ? url
      : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;

    const response = await fetch(fullImgUrl, {
      headers: {
        ...getBrowserHeaders(baseUrl),
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) return res.status(response.status).end();

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800, immutable');
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).end();
  }
}
