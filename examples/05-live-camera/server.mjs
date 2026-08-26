import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {secureHeaders} from 'hono/secure-headers';

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const ALLOWED_FRAME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const app = new Hono();
let liveCamera = makeSvgPlaceholder();
let liveCameraVersion = 1;
let liveCameraUpdatedAt = new Date();

app.use('*', secureHeaders());

app.get('/', (c) => c.redirect('/camera', 302));

app.get('/camera', (c) =>
  c.html(page('Live camera', `
    <h1>Live camera</h1>
    <img id="frame" src="/@assets/live-camera" alt="live camera frame">
    <p>stable URL: <code>/@assets/live-camera</code></p>
    <form method="post" action="/camera/frame" enctype="multipart/form-data">
      <label>Manual frame <input name="frame" type="file" accept="image/png,image/jpeg,image/webp" required></label>
      <button type="submit">Replace frame</button>
    </form>
    <script>
      const image = document.getElementById('frame');
      setInterval(() => {
        image.src = '/@assets/live-camera';
      }, 10000);
    </script>
  `))
);

app.post('/camera/frame', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.startsWith('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body.frame;
    if (!(file instanceof File)) return c.text('frame file is required', 400);
    return replaceFrame(c, file.type, new Uint8Array(await file.arrayBuffer()));
  }

  const mimeType = contentType.split(';', 1)[0] || 'application/octet-stream';
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  return replaceFrame(c, mimeType, bytes);
});

app.get('/@assets/', (c) =>
  c.json({
    assets: [
      {
        name: 'live-camera',
        mimeType: liveCamera.mimeType,
        byteLength: liveCamera.bytes.byteLength,
        etag: etag(),
        updatedAt: liveCameraUpdatedAt.toISOString()
      }
    ]
  })
);
app.get('/@assets/live-camera', () => serveFrame(true));
app.on('HEAD', '/@assets/live-camera', () => serveFrame(false));

function replaceFrame(c, mimeType, bytes) {
  if (!ALLOWED_FRAME_TYPES.has(mimeType)) return c.text('unsupported frame type', 415);
  if (bytes.byteLength > MAX_FRAME_BYTES) return c.text('frame is too large', 413);
  if (!matchesImageSignature(bytes, mimeType)) return c.text('frame signature does not match content type', 415);
  liveCamera = {mimeType, bytes};
  liveCameraVersion += 1;
  liveCameraUpdatedAt = new Date();
  return c.redirect('/camera', 303);
}

function serveFrame(includeBody) {
  return new Response(includeBody ? liveCamera.bytes : null, {
    status: 200,
    headers: {
      'content-type': liveCamera.mimeType,
      'content-length': String(liveCamera.bytes.byteLength),
      etag: etag(),
      'last-modified': liveCameraUpdatedAt.toUTCString(),
      'cache-control': 'no-cache'
    }
  });
}

function etag() {
  return `"live-camera-${liveCameraVersion}-${liveCamera.bytes.byteLength}"`;
}

function makeSvgPlaceholder() {
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#f4f4f4"/>
  <text x="320" y="180" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#333">waiting for frame</text>
</svg>`;
  return {mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(text)};
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
  <title>${title}</title>
  <style>
    body{font-family:system-ui,sans-serif;line-height:1.6;max-width:760px;margin:40px auto;padding:0 16px}
    img{display:block;width:min(100%,640px);aspect-ratio:16/9;object-fit:contain;border:1px solid #ddd;background:#f7f7f7}
    form{display:grid;gap:12px;margin-top:24px}
    input,button{font:inherit;padding:8px}
  </style>
</head>
<body>${body}</body>
</html>`;
}

const port = Number.parseInt(process.env.PORT ?? '9105', 10);
serve({fetch: app.fetch, hostname: '127.0.0.1', port});
console.log(`05-live-camera: http://127.0.0.1:${port}/camera`);
