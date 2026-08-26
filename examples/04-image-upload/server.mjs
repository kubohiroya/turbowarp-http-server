import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {secureHeaders} from 'hono/secure-headers';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const assets = new Map();
const app = new Hono();

app.use('*', secureHeaders());

app.get('/', (c) =>
  c.html(page('Image upload', `
    <h1>Image upload</h1>
    <form method="post" action="/upload" enctype="multipart/form-data">
      <label>Resource name <input name="name" value="uploaded-image" pattern="[a-zA-Z0-9._-]{1,64}" required></label>
      <label>Image <input name="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required></label>
      <button type="submit">Upload</button>
    </form>
    <h2>@assets</h2>
    <ul>${Array.from(assets.values()).map(renderAsset).join('')}</ul>
  `))
);

app.post('/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body.image;
  const name = normalizeResourceName(String(body.name ?? 'uploaded-image'));
  if (!(file instanceof File)) return c.text('image file is required', 400);
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return c.text('unsupported image type', 415);
  if (file.size > MAX_IMAGE_BYTES) return c.text('image is too large', 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesImageSignature(bytes, file.type)) return c.text('image signature does not match content type', 415);
  putAsset(name, file.type, bytes);
  return c.redirect(`/@assets/${encodeURIComponent(name)}`, 303);
});

app.get('/@assets/', (c) => c.json({assets: Array.from(assets.values()).map(toMetadata)}));
app.get('/@assets/:name', (c) => serveAsset(c, true));
app.on('HEAD', '/@assets/:name', (c) => serveAsset(c, false));

function putAsset(name, mimeType, bytes) {
  const previous = assets.get(name);
  const version = (previous?.version ?? 0) + 1;
  assets.set(name, {
    name,
    mimeType,
    bytes,
    version,
    etag: `"${name}-${version}-${bytes.byteLength}"`,
    updatedAt: new Date()
  });
}

function serveAsset(c, includeBody) {
  const name = normalizeResourceName(c.req.param('name'));
  const asset = assets.get(name);
  if (!asset) return c.json({error: 'not_found'}, 404);
  const headers = new Headers({
    'content-type': asset.mimeType,
    'content-length': String(asset.bytes.byteLength),
    etag: asset.etag,
    'last-modified': asset.updatedAt.toUTCString(),
    'cache-control': 'no-cache'
  });
  return new Response(includeBody ? asset.bytes : null, {status: 200, headers});
}

function renderAsset(asset) {
  const name = escapeHtml(asset.name);
  const href = `/@assets/${encodeURIComponent(asset.name)}`;
  return `<li><a href="${href}">${name}</a> <small>${asset.mimeType}, ${asset.bytes.byteLength} bytes</small><br><img src="${href}" alt="${name}"></li>`;
}

function toMetadata(asset) {
  return {
    name: asset.name,
    mimeType: asset.mimeType,
    byteLength: asset.bytes.byteLength,
    etag: asset.etag,
    updatedAt: asset.updatedAt.toISOString()
  };
}

function normalizeResourceName(value) {
  const normalized = value.trim().replaceAll(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
  return normalized.length > 0 ? normalized : 'uploaded-image';
}

function matchesImageSignature(bytes, mimeType) {
  if (mimeType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/gif') return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
  if (mimeType === 'image/webp') {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

function page(title, body) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:system-ui,sans-serif;line-height:1.6;max-width:760px;margin:40px auto;padding:0 16px}
    form{display:grid;gap:12px;margin-bottom:24px}
    input,button{font:inherit;padding:8px}
    img{display:block;max-width:320px;max-height:220px;margin-top:8px;border:1px solid #ddd}
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const port = Number.parseInt(process.env.PORT ?? '9104', 10);
serve({fetch: app.fetch, hostname: '127.0.0.1', port});
console.log(`04-image-upload: http://127.0.0.1:${port}/`);
