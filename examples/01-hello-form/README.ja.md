# 01-hello-form

フォームに名前を入れると `こんにちは、名前!` と返す最小の HTTP server サンプルです。

## 起動

```bash
corepack pnpm exec tsx examples/01-hello-form/server.mjs
```

ブラウザで `http://127.0.0.1:9101/` を開きます。

## HTTP route

| Method | Path | 期待されるレスポンス |
|---|---|---|
| `GET` | `/` | 名前入力フォームの HTML |
| `POST` | `/hello` | `こんにちは、名前!` を含む HTML |

## TurboWarp 側のブロック構成

```text
when HTTP request received
use HTTP request [current request ID]
if <current HTTP method = [GET] and current request path = [/]> then
  new HTML element [form]
  HTML [form] set attribute [method] to [post]
  HTML [form] set attribute [action] to [/hello]
  ... input/button を追加 ...
  respond with HTML [render HTML document title [Hello] body [form]]
end

if <current HTTP method = [POST] and current request path = [/hello]> then
  name = form body から取り出した値
  respond with HTML [こんにちは、name!]
end
```

## 動作確認

```bash
curl -i http://127.0.0.1:9101/
curl -i -X POST http://127.0.0.1:9101/hello \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'name=太郎'
```
