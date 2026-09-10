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
- この拡張機能は incoming HTTP request で TurboWarp の hat thread を起動するため、unsandboxed mode が必要です。

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

インターネットへ出られない会場 LAN では、htdigest file を使って HTTP Digest 認証を有効化できます。

```bash
turbowarp-http-digest init ./users.htdigest --realm turbowarp-lan
turbowarp-http-digest add ./users.htdigest alice --realm turbowarp-lan

turbowarp-http-server \
  --host 0.0.0.0 \
  --port 8787 \
  --auth-digest ./users.htdigest \
  --auth-realm turbowarp-lan
```

Digest 認証は、証明書配布や外部 IdP を使えない trusted LAN 内での簡易的な user 識別を目的とします。既定では無効です。認証済み username は runtime-owned な `x-turbowarp-http-auth-user` request header として TurboWarp handler に渡され、client が同名 header を送っても上書きされます。`/ws` endpoint は localhost peer からの接続だけを受け付けます。

TurboWarp handler では、`current auth type`、`current authenticated user`、`current auth provider`、`current auth profile JSON`、`auth profile field [NAME]` の reporter block で認証 context を参照できます。Digest 認証では username を提供します。OAuth 対応 deployment では provider profile data を request auth context として渡し、handler 側で `email`、`name`、`organization.name` のような field を参照できます。

証明書と秘密鍵をすでに用意できる場合は、server を直接 HTTPS で起動できます。

```bash
turbowarp-http-server \
  --host 0.0.0.0 \
  --port 8787 \
  --tls-cert ./certs/server.crt \
  --tls-key ./certs/server.key
```

証明書の発行、更新、配布、OS/browser の trust 設定はこの package の責務外です。Internet-facing deployment では reverse proxy で TLS termination し、認証が必要な場合は Cloudflare/OAuth の deployment path を使います。

サーバは次の経路を提供します。

| Route | Purpose |
|---|---|
| `GET /health` | ヘルスチェック |
| `GET /ws` | TurboWarp extension が接続する WebSocket endpoint |
| `GET /@assets/<name>` | resource capability が接続されている場合、Asset Manager の named resource を配信 |
| `HEAD /@assets/<name>` | body なしで同じ resource metadata を返却 |
| `PUT /@assets/<name>` | 対応 capability で named resource を作成または atomic replace |
| `DELETE /@assets/<name>` | 対応 capability で named resource を削除 |
| `GET /@assets/` | binary payload を含めず metadata/listing を返却 |
| その他の HTTP route | HTTP forwarding 実装前の一時的な `503 not_connected` 応答 |

Sprite route はこれとは別の TurboWarp-facing layer です。`camera` という名前の Sprite は `/camera` を公開でき、Sprite を「隠す」とその route を無効化できます。Sprite handler は HTML、JSON、redirect、`/camera/image.jpg` のような friendly alias を返せますが、`@assets` を Sprite の子 namespace にするのではなく Asset Manager capability を参照します。

### 学習用コミュニティサーバ

Issue #10 では、Scratch 風の project sharing app を local learning example 向けに追加しています。既定では無効なので、既存の bridge route と `@assets` route の動作は変わりません。

CLI から有効化する例:

```bash
COMMUNITY=1 corepack pnpm start -- --host 127.0.0.1 --port 8787
# または
corepack pnpm start -- --host 127.0.0.1 --port 8787 --community
```

有効化時は次の route を提供します。

| Route | Purpose |
|---|---|
| `GET /` | 作品一覧 HTML と、login user 向け upload form |
| `GET /signup` / `POST /signup` | demo password registration |
| `GET /login` / `POST /login` | demo password login |
| `POST /logout` | session logout |
| `GET /auth/:provider/start` | configured OAuth demo flow の開始 |
| `GET /auth/:provider/callback` | OAuth demo flow の完了 |
| `POST /projects` | SB3 project と optional thumbnail の upload |
| `GET /projects/:id` | project detail HTML |
| `GET /projects/:id.sb3` | SB3 download |
| `POST /projects/:id/remix` | 元 project と関連付いた remix 作成 |
| `POST /projects/:id/update` | owner だけが実行できる metadata edit |
| `POST /projects/:id/replace` | owner だけが実行できる SB3 と thumbnail の replace |
| `POST /projects/:id/delete` | owner だけが実行できる project deletion |

demo password は Node 標準 `crypto.scrypt` で hash 化して保存します。session は HTTP-only `SameSite=Lax` cookie、HTML form の POST には CSRF token を使い、multipart body は form parse 前に上限を適用し、SB3 と thumbnail は file ごとの size limit、MIME type、file signature を検証します。owner 以外による owner-only 変更は拒否します。OAuth provider は次の環境変数が揃った場合だけ有効になります。

```bash
COMMUNITY_OAUTH_DEMO_CLIENT_ID=demo-client
COMMUNITY_OAUTH_DEMO_AUTHORIZATION_URL=https://example.test/oauth/authorize
COMMUNITY_OAUTH_DEMO_REDIRECT_URI=http://127.0.0.1:8787/auth/demo/callback
COMMUNITY_OAUTH_DEMO_SCOPE=profile
```

この community server は local educational implementation であり、公開運用向けではありません。internet に公開する前に、in-memory storage を durable storage に置き換え、rate limit と abuse moderation、HTTPS と secure cookie、完全な OAuth token/userinfo exchange、必要な email または external identity verification、upload scan、audit log、backup、retention、takedown、incident-response 手順を追加してください。

## Asset Manager Resource Serving

HTTP server は camera-agnostic です。`turbowarp-asset-manager` のような外部 capability が提供する generic named resource を配信し、private field を読んだり Asset Manager の storage を複製したりしません。

generic Asset Manager namespace は `/@assets/` を root にします。これは Sprite route の管理下ではなく、background/server-side resource capability が管理します。Sprite route は friendly alias を提供できますが、generic resource route は global に保ちます。

| Resource | HTTP route |
|---|---|
| Resource `live-camera` | `/@assets/live-camera` |
| Resource `logo` | `/@assets/logo` |

resource capability の境界では、logical resource name、MIME type、consistent snapshot としての binary bytes、byte length、ETag に使える replacement identity、任意の last-modified timestamp、namespace publication policy を扱います。

resource response は `Content-Type`、`Content-Length`、可能な場合は `ETag`、提供されている場合は `Last-Modified`、そして `Cache-Control` を返します。ETag または last-modified がある場合の既定 cache policy は `no-cache`、validation metadata がない場合は `no-store` です。`HEAD` は `GET` と同じ metadata を body なしで返します。

`PUT` は request body bytes と `Content-Type` を使い、capability 経由で resource を作成または置換します。server は configurable body-size limit を適用し、capability が拒否する MIME type を `415` にし、置換は後続 request へ atomic に見えるようにします。進行中の `GET` は開始時点の snapshot を受け取ります。

`/_tw-http/` は management namespace として予約し、asset route として扱いません。`/camera/@assets/live-camera` のような path は generic Asset Manager route ではありません。必要なら Scratch/TurboWarp handler で friendly Sprite URL を `/@assets/<name>` へ alias します。authorization hook が設定されている場合は `GET`、`HEAD`、`PUT`、`DELETE`、listing に一貫して適用します。structured log には route、resource name、MIME type、byte count、status などの metadata だけを含め、binary request/response body は含めません。

## Sprite Route Model

TurboWarp-facing route は project object と自然に対応させます。

| TurboWarp object | Public route |
|---|---|
| Stage/background script | `/` |
| Sprite `camera` が表示中 | `/camera` |
| Sprite `camera` が非表示 | route disabled |

これにより Scratch 上の操作が HTTP 公開状態と直感的につながります。Sprite を「表示する」と route が公開され、「隠す」と route が取り下げられます。Asset Manager resource は `/@assets/<name>` に global に置くため、同じ resource を複数の Sprite route から storage duplication なしに再利用できます。

live camera page は次のように扱えます。

```text
Sprite: camera
    visible -> /camera is enabled
    hidden  -> /camera is disabled

GET /camera
    -> Sprite handler が HTML page を返す

GET /camera/image.jpg
    -> /@assets/live-camera を返す friendly handler/alias
```

つまり `/camera/image.jpg` は Sprite route の判断で、`/@assets/live-camera` は generic Asset Manager resource endpoint です。

## デプロイターゲット検討

Sprite route と HTTP handler block を公開可能な serverless application へ変換する構想については、[デプロイ先と技術スタックの選定メモ](docs/deployment-targets.ja.md) にまとめています。MVP では Cloudflare Workers 向け TypeScript + Hono 生成を第一候補にし、D1/R2/KV/Durable Objects の使い分けと外部 IdP 認証連携の方針を整理しています。

## Response Content Builders

HTTP response body を組み立てやすくするため、builder-style の補助ブロックを追加しています。これらはこの package 内の最小実装で、runtime dependency として `turbowarp-html` や `turbowarp-markdown` は追加しません。

Markdown builder は `md:1` のような opaque handle を返します。ブロックをチェインして content を追加し、最後に Markdown text として render します。

```text
new markdown document
markdown [md:1] with heading level [1] [Status]
markdown [md:1] with paragraph [OK]
render markdown [md:1]
```

HTML builder は `html:1` のような opaque handle を使います。text と attribute は escape され、`onclick` のような event-handler attribute は無視され、URL attribute は保守的な safe scheme のみを受け付け、未知の tag は `div` に fallback します。

```text
new HTML element [section]
HTML text [Live camera]
HTML [section] with child [text]
render HTML document title [Camera] body [section]
```

server diagnostics 向けに、`HTTP log viewer HTML` は virtual-scroll log viewport を持つ self-contained HTML document を返します。`record HTTP log [ENTRY]` で structured log JSON を追加し、`clear HTTP logs` で消去できます。明示的な JSON array から viewer を作る場合は `HTTP log viewer HTML from [LOGS]` を使います。

## Request Protocol And Blocks

`/@assets` で処理されない通常の HTTP route は、CLI server から connected TurboWarp extension へ WebSocket 経由で forward されます。各 request には一意の request ID が付き、request context は ID ごとに分離されます。

protocol v1 の request message は、query parameter と header の複数値を保持します。

```json
{
  "type": "request",
  "protocol": "turbowarp-http-server",
  "version": 1,
  "id": "req-1",
  "method": "GET",
  "url": "http://127.0.0.1:8787/users/42?tag=a&tag=b",
  "path": "/users/42",
  "route": "/users/:id",
  "pathParams": {"id": "42"},
  "query": {"tag": ["a", "b"]},
  "headers": {"accept": ["text/html"]},
  "body": {"kind": "empty"},
  "clientAddress": ""
}
```

TurboWarp blocks は selected current request を参照できます。

```text
current HTTP method
current request path
current request URL
request header [name]
query parameter [name]
path parameter [name]
current request body
current request content type
current request ID
```

simple query/header reporter は最初の値を返します。wire protocol は全値を保持するため、将来 list-oriented block を追加しても protocol を壊さずに済みます。

response blocks は current request の response builder を変更し、最後に response message として完了します。

```text
set HTTP status [200]
set response header [name] to [value]
remove response header [name]
set response body [body]
send response [body]
respond with text [body]
respond with HTML [body]
respond with JSON [body]
```

response status の既定値は `200` です。`100` から `599` の範囲外の status、不安全な response header、CR/LF を含む header injection value、`Content-Length` のような runtime-owned header は Node.js の HTTP response API に届く前に無視または拒否されます。server boundary では `HEAD`、`204`、`205`、`304` の body を抑止します。

bridge が未接続の場合、通常 route は `503` を返します。connected bridge が timeout までに応答しない場合は `504`、pending request 中に WebSocket が切断された場合は `502` を返します。

## Live-Camera Pattern

低頻度 camera publishing は、次の 3 つを独立して組み合わせます。

```text
TurboWarp Camera Source
    -> 10 秒ごとに current frame を capture
    -> Asset Manager resource "live-camera" を replace
    -> HTTP Server が /@assets/live-camera を配信
    -> browser が stable URL を読み込む
```

HTTP server は `turbowarp-camera-source` や `turbowarp-html` に依存しません。Camera Source は snapshot を作り、Asset Manager が named resource を所有し、HTTP Server は generic resource URL を配信します。

ブロックレベルの例:

```text
forever
  capture current camera frame
  replace asset [live-camera] with captured JPEG bytes
  wait 10 seconds
end
```

外部 consumer は stable URL を使えます。

```text
/@assets/live-camera
```

必要なら Scratch/TurboWarp route handler で次の friendly alias を用意できます。

```text
/camera/image.jpg -> /@assets/live-camera
```

`turbowarp-html` で生成した HTML page が `<img>` を 10 秒ごとに refresh する構成でも、cache correctness は timestamp query string ではなく HTTP validation headers で担保します。Asset Manager から replacement identity が得られる場合、client は stable URL を ETag で revalidate し、古い browser cache に固定されず最新 snapshot を受け取れます。

### TurboWarp extension bundle

1. [`dist/turbowarp-http-server.js`](dist/turbowarp-http-server.js?raw=1) をダウンロードします。
2. TurboWarp の **Extensions** を開きます。
3. **Custom Extension** を選び、ファイルを読み込みます。

レビュー済みの JavaScript build をこのリポジトリへコミットする運用なので、利用者はインストールのために Node.js を用意する必要はありません。

### npm package

レビューした exact version をインストールします。

```bash
pnpm add --save-exact @kubohiroya/turbowarp-http-server@0.1.0
```

standalone bundle は次の場所から読み込めます。

```text
node_modules/@kubohiroya/turbowarp-http-server/dist/turbowarp-http-server.js
```

version 固定の CDN URL は次の形式です。

```text
https://cdn.jsdelivr.net/npm/@kubohiroya/turbowarp-http-server@0.1.0/dist/turbowarp-http-server.js
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
