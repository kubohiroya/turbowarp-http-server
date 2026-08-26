import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {secureHeaders} from 'hono/secure-headers';

const countsByDate = new Map();
const app = new Hono();

app.use('*', secureHeaders());

app.get('/', (c) => {
  const today = todayKey();
  const count = (countsByDate.get(today) ?? 0) + 1;
  countsByDate.set(today, count);
  return c.html(page('Visitor counter', `
    <h1>あなたは本日${count}人目の訪問者です</h1>
    <p>日付: ${today}</p>
    <p><a href="/api/count">JSON を見る</a></p>
  `));
});

app.get('/api/count', (c) => {
  const today = todayKey();
  return c.json({date: today, count: countsByDate.get(today) ?? 0});
});

function todayKey() {
  return new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Tokyo'});
}

function page(title, body) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;line-height:1.6;max-width:720px;margin:40px auto;padding:0 16px}</style>
</head>
<body>${body}</body>
</html>`;
}

const port = Number.parseInt(process.env.PORT ?? '9102', 10);
serve({fetch: app.fetch, hostname: '127.0.0.1', port});
console.log(`02-visitor-counter: http://127.0.0.1:${port}/`);
