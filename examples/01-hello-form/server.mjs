import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {secureHeaders} from 'hono/secure-headers';

const app = new Hono();

app.use('*', secureHeaders());

app.get('/', (c) =>
  c.html(page('Hello form', `
    <h1>Hello form</h1>
    <form method="post" action="/hello">
      <label>名前 <input name="name" autocomplete="name" required maxlength="40"></label>
      <button type="submit">送信</button>
    </form>
  `))
);

app.post('/hello', async (c) => {
  const body = await c.req.parseBody();
  const name = sanitizeName(String(body.name ?? ''));
  return c.html(page('Hello', `
    <h1>こんにちは、${escapeHtml(name)}!</h1>
    <p><a href="/">戻る</a></p>
  `));
});

function sanitizeName(value) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 40) : 'ゲスト';
}

function page(title, body) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:system-ui,sans-serif;line-height:1.6;max-width:720px;margin:40px auto;padding:0 16px}
    input,button{font:inherit;padding:8px}
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

const port = Number.parseInt(process.env.PORT ?? '9101', 10);
serve({fetch: app.fetch, hostname: '127.0.0.1', port});
console.log(`01-hello-form: http://127.0.0.1:${port}/`);
