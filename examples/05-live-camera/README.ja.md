# 05-live-camera

10 秒に 1 回カメラからの静止画を更新するライブカメラの形を、stable asset URL の atomic replace として示します。

このサンプルではブラウザや `curl` から `POST /camera/frame` へ画像を送ると、同じ `@assets/live-camera` URL が新しい bytes へ置き換わります。閲覧側の `/camera` は 10 秒ごとに同じ URL を再読込します。

## 起動

```bash
corepack pnpm exec tsx examples/05-live-camera/server.mjs
```

ブラウザで `http://127.0.0.1:9105/camera` を開きます。

## HTTP route

| Method | Path | 期待されるレスポンス |
|---|---|---|
| `GET` | `/camera` | 10 秒ごとに `/@assets/live-camera` を読み直す HTML |
| `POST` | `/camera/frame` | 画像 bytes を `live-camera` として atomic replace |
| `GET` | `/@assets/live-camera` | 現在の静止画 |
| `HEAD` | `/@assets/live-camera` | ETag/Last-Modified などの metadata |

## TurboWarp 側のブロック構成

```text
forever
  capture current camera frame
  replace asset [live-camera] with captured JPEG bytes
  wait [10] seconds
end

when HTTP request received
use HTTP request [current request ID]
if <current request path = [/camera]> then
  respond with HTML [<img src="/@assets/live-camera"> を含む page]
end
```

## 動作確認

```bash
curl -i -X POST http://127.0.0.1:9105/camera/frame \
  -H 'content-type: image/jpeg' \
  --data-binary @./frame.jpg
curl -i http://127.0.0.1:9105/@assets/live-camera
```
