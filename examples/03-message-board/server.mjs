import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {secureHeaders} from 'hono/secure-headers';

const messages = [];
const app = new Hono();

app.use('*', secureHeaders());

app.get('/', (c) =>
  c.html(page('Message board', `
    <h1>Message board</h1>
    <form method="post" action="/messages">
      <label>名前 <input name="name" required maxlength="40"></label>
      <label>メッセージ <textarea name="message" required maxlength="240"></textarea></label>
      <button type="submit">投稿</button>
    </form>
    <ol>${messages.map(renderMessage).join('')}</ol>
  `))
);

app.post('/messages', async (c) => {
  const body = await c.req.parseBody();
  const name = clampText(String(body.name ?? 'ゲスト'), 40);
  const message = clampText(String(body.message ?? ''), 240);
  if (message.length > 0) {
    messages.push({name, message, createdAt: new Date().toISOString()});
  }
  return c.redirect('/', 303);
});

app.get('/api/messages', (c) => c.json({messages}));

function renderMessage(entry) {
  return `<li><strong>${escapeHtml(entry.name)}</strong>：${escapeHtml(entry.message)} <time>${entry.createdAt}</time></li>`;
}

function clampText(value, maxLength) {
  return value.trim().slice(0, maxLength);
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
    input,textarea,button{font:inherit;padding:8px}
    textarea{min-height:96px}
    li{margin:8px 0}
    time{color:#666;font-size:.875rem}
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

const port = Number.parseInt(process.env.PORT ?? '9103', 10);
serve({fetch: app.fetch, hostname: '127.0.0.1', port});
console.log(`03-message-board: http://127.0.0.1:${port}/`);
