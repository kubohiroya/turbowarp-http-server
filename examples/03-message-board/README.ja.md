# 03-message-board

`名前：メッセージ` を時系列で積み重ねて表示する簡易掲示板です。

## 起動

```bash
corepack pnpm exec tsx examples/03-message-board/server.mjs
```

ブラウザで `http://127.0.0.1:9103/` を開きます。

## HTTP route

| Method | Path | 期待されるレスポンス |
|---|---|---|
| `GET` | `/` | 投稿フォームとメッセージ一覧 |
| `POST` | `/messages` | 投稿を保存して `/` へ redirect |
| `GET` | `/api/messages` | メッセージ一覧 JSON |

## TurboWarp 側のブロック構成

```text
when HTTP request received
use HTTP request [current request ID]
if <GET /> then
  HTML builder で form と message list を作る
  respond with HTML [render HTML document ...]
end

if <POST /messages> then
  request body から name/message を読む
  list に [name：message] を追加する
  set HTTP status [303]
  set response header [location] to [/]
  send response []
end
```

## 動作確認

```bash
curl -i -X POST http://127.0.0.1:9103/messages \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'name=Alice&message=こんにちは'
curl http://127.0.0.1:9103/api/messages
```
