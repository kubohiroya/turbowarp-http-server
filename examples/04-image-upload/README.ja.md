# 04-image-upload

画像を upload し、upload 後に `@assets` named resource として参照する流れを示します。

## 起動

```bash
corepack pnpm exec tsx examples/04-image-upload/server.mjs
```

ブラウザで `http://127.0.0.1:9104/` を開きます。

## HTTP route

| Method | Path | 期待されるレスポンス |
|---|---|---|
| `GET` | `/` | upload form と asset 一覧 |
| `POST` | `/upload` | 画像を検証して named resource として保存 |
| `GET` | `/@assets/` | asset metadata JSON |
| `GET` | `/@assets/<name>` | 画像 bytes |
| `HEAD` | `/@assets/<name>` | metadata headers |

upload は `image/png`、`image/jpeg`、`image/gif`、`image/webp` のみ許可し、2 MiB を上限にしています。

## TurboWarp 側のブロック構成

```text
when green flag clicked
set [asset name v] to [uploaded-image]
upload した画像 bytes を Asset Manager へ保存する
replace asset [asset name] with [画像 bytes]

when HTTP request received
use HTTP request [current request ID]
if <GET /> then
  HTML builder で <img src="/@assets/uploaded-image"> を含む page を返す
end
```

## 動作確認

```bash
curl -i -F 'name=sample' -F 'image=@./some-image.png;type=image/png' \
  http://127.0.0.1:9104/upload
curl -i http://127.0.0.1:9104/@assets/sample
```
