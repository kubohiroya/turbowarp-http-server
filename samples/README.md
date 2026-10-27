# Respond Hello over HTTP

[Editorで開く](https://turbowarp.org/editor?project_url=https%3A%2F%2Fkubohiroya.github.io%2Fturbowarp-http-server%2Fsamples%2Frespond-hello-http.sb3) · [SB3](https://kubohiroya.github.io/turbowarp-http-server/samples/respond-hello-http.sb3)

## 手順と期待結果

repoをcloneし依存install後 `node dist/cli.js --host 127.0.0.1 --port 8787`。SB3の緑旗→C→Sでtrue。別ターミナルで `curl http://127.0.0.1:8787/hello` とすると `Hello from TurboWarp`。Xで切断しCLIをCtrl+Cで停止。再実行は緑旗から。bridge URLは非表示変数に保存し、公開SB3にはloopbackだけを使用。

## 要件

Node.js 24以上とこのrepoのCLI bridge（依存hono/@hono/node-server/wsをinstall）。別端末へ公開せず127.0.0.1で起動。Pages自体は静的ホスティングでHTTP serverを動かしません。HTTPS Editorからws loopbackへのアクセスはブラウザのローカルネットワーク許可/混在コンテンツ規則に従います。必要ならローカルEditorまたは信頼済みwss bridgeを使用。

## 未検証範囲

外部ホスト・TLS/wss設定・各ブラウザのローカルネットワーク許可・認証・本番公開は未検証。

自動検証は無音（browser `--mute-audio`）で実施し、音声再生・カメラ・外部サービスを自動起動しません。

## 編集と再生成

`respond-hello-http/project.json` とSVGが編集元、`manifest.json` は配信/依存/確認条件です。Node.jsは`.nvmrc`を使用し `node scripts/build-samples.mjs`、`node scripts/build-samples.mjs --check`、`node --test scripts/verify-samples.mjs`、`node scripts/prepare-pages.mjs` で生成・検査します。ZIP日時/エントリー順は固定。SB3のJSは通常の拡張許可画面で非サンドボックス実行を選択します。

## ロールバック

PRをrevertしPagesを再公開します。本体distと既定フラグを変更しません。
