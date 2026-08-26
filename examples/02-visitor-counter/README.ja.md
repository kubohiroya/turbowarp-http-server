# 02-visitor-counter

日付単位でカウントを分け、`あなたは本日100人目の訪問者です` 形式で表示するサンプルです。

## 起動

```bash
corepack pnpm exec tsx examples/02-visitor-counter/server.mjs
```

ブラウザで `http://127.0.0.1:9102/` を開きます。

## HTTP route

| Method | Path | 期待されるレスポンス |
|---|---|---|
| `GET` | `/` | 今日の訪問者番号を 1 増やして HTML で表示 |
| `GET` | `/api/count` | 今日の日付と現在カウントを JSON で返す |

## TurboWarp 側のブロック構成

```text
when HTTP request received
use HTTP request [current request ID]
if <current request path = [/]> then
  今日の日付 key を作る
  その key の変数を 1 増やす
  respond with HTML [あなたは本日 N 人目の訪問者です]
end
```

TurboWarp で日付ごとに変数を分けにくい場合は、JSON 文字列のリストや cloud variable ではなく、まずローカル学習用の通常変数で動きを確認します。

## 動作確認

```bash
curl http://127.0.0.1:9102/
curl http://127.0.0.1:9102/api/count
```
