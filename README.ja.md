# TurboWarp-HTTP-Server

[English](README.md) | [日本語](README.ja.md)

CLI で起動する HTTP ブリッジサーバと、そのサーバへ WebSocket 接続する TurboWarp 機能拡張を同じ package で提供します。

**ユーザーガイド:** [English](https://kubohiroya.github.io/turbowarp-http-server/)

## できること

- コマンドラインからローカル HTTP/WebSocket ブリッジサーバを起動できます。
- TurboWarp の Custom Extension として読み込む bundle を生成します。
- HTTP request/response protocol の確定前でも、TurboWarp とブリッジ間でテキストメッセージを送受信できます。

## 要件と安全性

- カスタム拡張機能を有効化した TurboWarp Desktop、TurboWarp Web、または TurboWarp Packager。
- CLI ブリッジサーバを動かすための Node.js 22 以上。
- 現在の拡張機能は sandbox 互換で、unsandboxed mode は不要です。

## インストール

### CLI ブリッジサーバ

このリポジトリから起動する場合:

```bash
corepack pnpm install
corepack pnpm run build
corepack pnpm start -- --host 127.0.0.1 --port 8787
```

package としてインストールした場合:

```bash
turbowarp-http-server --host 127.0.0.1 --port 8787
```

サーバは次の経路を提供します。

| Route | Purpose |
|---|---|
| `GET /health` | ヘルスチェック |
| `GET /ws` | TurboWarp extension が接続する WebSocket endpoint |
| その他の HTTP route | HTTP forwarding 実装前の一時的な `503 not_connected` 応答 |

### TurboWarp extension bundle

1. [`dist/turbowarp-http-server.js`](dist/turbowarp-http-server.js?raw=1) をダウンロードします。
2. TurboWarp の **Extensions** を開きます。
3. **Custom Extension** を選び、ファイルを読み込みます。

レビュー済みの JavaScript build をこのリポジトリへコミットする運用なので、利用者はインストールのために Node.js を用意する必要はありません。

### npm package

レビューした exact version をインストールします。

```bash
pnpm add --save-exact @kubohiroya/turbowarp-http-server@0.0.0
```

standalone bundle は次の場所から読み込めます。

```text
node_modules/@kubohiroya/turbowarp-http-server/dist/turbowarp-http-server.js
```

version 固定の CDN URL は次の形式です。

```text
https://cdn.jsdelivr.net/npm/@kubohiroya/turbowarp-http-server@0.0.0/dist/turbowarp-http-server.js
```

## 開発

`packageManager` で宣言された pnpm と Node.js 22 以上を使います。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

主なコマンド:

| Command | Purpose |
|---|---|
| `pnpm dev` | TurboWarp extension bundle を watch rebuild |
| `pnpm run dev:server` | CLI ブリッジサーバを watch mode で起動 |
| `pnpm start` | build 済み CLI ブリッジサーバを起動 |
| `pnpm run test` | テスト実行 |
| `pnpm run docs` | ブロックドキュメント再生成 |
| `pnpm run check:dist` | コミット済み build artifact の検証 |
| `pnpm run pack:check` | npm package 内容の確認 |

## ライセンス

[Mozilla Public License 2.0](LICENSE) (SPDX: `MPL-2.0`)。
