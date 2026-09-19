# デプロイ先と技術スタックの選定メモ

このメモは、TurboWarp/Scratch 風のブロックで表現された HTTP ハンドラを、公開可能なサーバレスアプリへ変換してデプロイするための初期方針をまとめる。

## 結論

MVP の生成ターゲットは **Cloudflare Workers 向け TypeScript + Hono** を第一候補にする。

理由は次の通り。

- このリポジトリの HTTP 実装が Hono と Fetch API の `Request` / `Response` モデルに寄っている。
- Cloudflare Workers は TypeScript を第一級に扱える。
- Hono は Cloudflare Workers、Vercel、Netlify、AWS Lambda、Node.js、Deno など複数 runtime に展開しやすい。
- ブロックで表現される `method`、`path`、`query`、`header`、`body`、`status`、`response body` は Fetch API/Hono の抽象と対応しやすい。
- Cloudflare Workers には D1、R2、KV、Durable Objects というストレージ選択肢があり、ブロック由来の状態を用途別に永続化できる。

MVP では自前の OAuth/OIDC Provider は作らない。Google、Microsoft、GitHub アカウント連携を外部 IdP または Cloudflare Access に任せ、生成アプリ側は認証済みユーザー情報の参照と JWT/Access 検証に絞る。Apple Sign in は初期対象から外す。

## デプロイ先候補

| 優先度 | デプロイ先 | 生成言語/形態 | 相性 | 主な用途 | 注意点 |
|---:|---|---|---:|---|---|
| 1 | Cloudflare Workers | TypeScript + Hono | ◎ | 軽量 HTTP API、HTML/JSON 返却、低レイテンシな公開、D1/R2/KV 連携 | Node.js 専用 API は避ける。長時間処理、大容量処理、ローカルファイル前提の設計は不向き |
| 2 | Vercel Functions | TypeScript/Node.js + Hono | ◎ | フロントエンド同梱、GitHub 連携、Next.js などとの統合 | Edge Runtime と Node.js Runtime の違いを明確にする。永続状態は外部 DB が必要 |
| 3 | Firebase Functions / Cloud Run functions | TypeScript/Node.js | ○ | Firebase Auth、Firestore、Storage を使うアプリ | Firebase 固有 SDK と設定に寄る。Hono を使う場合は entrypoint adapter が必要 |
| 4 | Google Cloud Run | Hono + Node.js server または container | ○ | WebSocket、長時間処理、独自サーバ構成、ブリッジサーバ自体の公開 | コンテナ、IAM、課金設定などの学習コストが上がる |
| 5 | Supabase Edge Functions | TypeScript/Deno + Hono | ○ | Supabase DB/Auth と一体化した軽量 API | Deno/npm 互換差分と Supabase CLI 前提の運用に注意 |
| 6 | AWS Lambda | TypeScript/Node.js + Hono adapter | △〜○ | 本格クラウド、IAM、API Gateway、企業利用 | 強力だが、初期ユーザー向けには設定が重い |
| 7 | Netlify Functions / Edge Functions | TypeScript + Hono | ○ | 静的サイト + 軽い API | 配置規約と runtime 差分に合わせる必要がある |

MVP は Cloudflare Workers に集中し、IR と adapter を分けておく。これにより、後から Vercel/Firebase 向けの entrypoint と storage adapter を追加できる。

## 生成コードの基本形

生成ツールは、ブロックを直接 Cloudflare Workers のコードへ落とすのではなく、一度中間表現に変換する。

```text
TurboWarp blocks
  -> route/action/storage/auth を持つ IR
  -> TypeScript/Hono application
  -> Cloudflare Workers scaffold
```

想定する生成物は次の構成にする。

```text
generated-app/
  src/index.ts
  src/routes.generated.ts
  src/auth.ts
  src/storage.ts
  migrations/0001_init.sql
  wrangler.jsonc
  .dev.vars.example
  README.md
```

Cloudflare Workers 向け entrypoint は `fetch(request, env, ctx)` を受け取り、Hono app が routing と response 生成を担当する。

## ブロックと生成コードの対応

| TurboWarp 側の概念 | IR 上の意味 | TypeScript/Hono での対応 | 注意点 |
|---|---|---|---|
| Stage/background script | root route | `app.get('/')` など | `/` 以下の HTTP handler として扱う |
| Sprite 名 `camera` | sprite route namespace | `app.get('/camera')` | Sprite の表示/非表示による公開状態は、デプロイ後は静的設定または環境変数に変換する |
| `when HTTP request received` | handler entry | route callback | デプロイ先ではイベントではなく通常の HTTP 関数として実行する |
| `current HTTP method` | request method | `c.req.method` | `GET`/`POST`/`PUT`/`DELETE` などの分岐に使う |
| `current request path` | URL path | `new URL(c.req.url).pathname` | route pattern と実 path を区別する |
| `query parameter [NAME]` | query map | `c.req.query(name)` または `URLSearchParams.getAll()` | 複数値 query を将来扱えるようにする |
| `path parameter [NAME]` | path params | `c.req.param(name)` | `/users/:id` のような route pattern から得る |
| `request header [NAME]` | request headers | `c.req.header(name)` | header 名は小文字正規化する |
| `current request body` | text body | `await c.req.text()` | JSON、form、multipart は別 block/IR に分ける |
| `set HTTP status [STATUS]` | response status | `return c.text(body, status)` など | `100..599` の範囲に検証する |
| `set response header` | response headers | `c.header(name, value)` | `Content-Length` など runtime-owned header は禁止する |
| `respond with text` | text response | `return c.text(body)` | charset を統一する |
| `respond with HTML` | HTML response | `return c.html(html)` | HTML builder の escape 規則を生成 runtime にも持たせる |
| `respond with JSON` | JSON response | `return c.json(value)` | 文字列 JSON より構造化 JSON block を将来追加したい |
| Asset Manager resource | object storage | R2 + D1 metadata | binary は R2、検索/権限は D1 に分ける |
| Scratch 変数/リスト | persistent state | D1/KV/Durable Objects | Worker の global 変数は永続状態として扱わない |

## 認証方針

自前の OAuth/OIDC Provider は作らない。Google、Microsoft、GitHub でのログイン連携は外部の認証基盤に任せる。

| レベル | 内容 | MVP での扱い | 用途 |
|---|---|---:|---|
| Level 0 | 認証なし、secret token、Basic auth | ○ | 個人用、Webhook、学習用 |
| Level 1 | Cloudflare Access で Worker 全体または一部 route を保護 | ○ | 管理画面、限定公開、チーム/学校向け |
| Level 2 | 外部 IdP または auth broker の JWT を Worker で検証 | ○ | 一般ユーザー向け API、Google/Microsoft/GitHub login |
| Level 3 | OAuth/OIDC login flow を Worker 内で直接実装 | MVP では対象外 | provider-specific な高度な認証 |

ブロック側には provider 固有の callback 処理を見せず、抽象化された user context だけを公開する。

```ts
type AuthUser = {
  id: string;
  email?: string;
  name?: string;
  provider?: 'google' | 'microsoft' | 'github';
  claims: Record<string, unknown>;
};
```

| ブロック/IR | 生成コードの役割 |
|---|---|
| `require login` | Hono middleware で未ログインなら redirect または `401` |
| `if current user logged in` | auth context の有無で分岐 |
| `current user id` | JWT の `sub` または Cloudflare Access の identity |
| `current user email` | JWT claim または Access header/JWT |
| `current user provider` | `google`、`microsoft`、`github` など |
| `current user claims [name]` | allowlist された claim のみ参照 |
| `logout URL` | 認証 broker または Access の logout endpoint に redirect |

Cloudflare Access を使う場合は、Access が付与する JWT/header を Worker 側で検証または参照する。Cloudflare は `Cf-Access-Jwt-Assertion` header の検証を案内している。

Secrets はコードに埋め込まない。client secret、JWT issuer/audience、cookie secret などは Wrangler secrets または Cloudflare の Variables and Secrets で注入する。ローカル開発用の `.dev.vars` や `.env` は commit 対象にしない。

## 永続ストレージ方針

Cloudflare Workers では、Worker の module/global 変数を永続状態として使わない。cold start、runtime 再利用、複数 isolate、複数 region の影響で、値の保持や共有は保証できない。

標準方針は **D1 を主 DB、R2 をファイル置き場、KV を設定/キャッシュ、Durable Objects を強い一貫性が必要な小さな状態** とする。

| 用途 | 推奨ストレージ | 理由 |
|---|---|---|
| 掲示板、投稿、コメント、履歴、一覧 | D1 | SQLite 互換の SQL DB なので検索、並び替え、絞り込みに向く |
| ユーザー別データ | D1 | `owner_id` で絞り込みや権限判定をしやすい |
| Scratch リスト相当 | D1 | append/list/delete/order の操作に合う |
| Scratch 変数相当 | D1 または KV | ユーザー別/履歴ありなら D1、低頻度更新の設定値なら KV |
| 画像、音声、SB3、アップロードファイル | R2 | binary object storage として扱う |
| asset metadata | D1 | R2 object key、MIME type、size、owner、公開状態を検索可能にする |
| route 公開設定、feature flag | KV | read-heavy で低頻度更新なら扱いやすい |
| HTML fragment cache、JWKS cache | KV | eventual consistency が許容される cache に向く |
| 正確なカウンタ、同時更新される部屋状態 | Durable Objects または D1 | KV の read-modify-write は取りこぼしやすい |

### D1

D1 は MVP の必須ストレージにする。ブロックプログラミングで自然に作られる「リスト」「投稿」「スコア」「ユーザー別データ」は、KV より D1 の方が扱いやすい。

汎用 record store の初期 schema 例:

```sql
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  owner_id TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX records_collection_created_at
ON records (collection, created_at);

CREATE INDEX records_owner_collection_created_at
ON records (owner_id, collection, created_at);
```

| ブロック/IR 操作 | D1 実装 |
|---|---|
| `add record to [messages]` | `INSERT INTO records ...` |
| `list records from [messages]` | `SELECT ... WHERE collection = ? ORDER BY created_at` |
| `get record [id]` | `SELECT ... WHERE id = ?` |
| `delete record [id]` | `DELETE ... WHERE id = ?` |
| `set user value [key]` | user value table への `UPSERT` |
| `list current user's records` | `owner_id = currentUser.id` で絞る |

### R2

R2 は Asset Manager の binary 保存先にする。D1 には metadata のみを置く。

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`/@assets/<id>` への request は、D1 で metadata と権限を確認し、R2 object を返す。Sprite route から `/camera/image.jpg` のような friendly alias を作る場合も、最終的な binary は同じ R2 object を参照する。

### KV

KV は主 DB にしない。KV は高頻度 read と低頻度 write の設定、cache、feature flag には向くが、eventual consistency のため、投稿直後の一覧反映、正確なカウンタ、在庫、残高、投票数のような用途には向かない。

| KV に向く | KV に向かない |
|---|---|
| route 公開設定 | 掲示板投稿 |
| feature flag | 正確なカウンタ |
| HTML fragment cache | 投稿直後の強い反映 |
| OIDC/JWKS cache | 在庫、残高、投票数 |
| 軽い session 補助 | 同時更新が多いデータ |

### Durable Objects

Durable Objects は MVP では必須にしない。ただし、次のような機能を生成対象に入れる場合は導入候補にする。

- 正確な訪問者カウンタ
- 同時更新されるゲーム部屋/チャット部屋
- per-room の短いリアルタイム状態
- WebSocket を使う interactive route

Scratch 的な「変数を 1 増やす」を KV の `get -> +1 -> put` で生成すると同時アクセスで取りこぼす。正確性が必要な場合は D1 の atomic update または Durable Objects に寄せる。

## 生成ツールの adapter 境界

生成 runtime は storage を直接 Cloudflare API に固定せず、adapter 境界を置く。

```ts
type StorageAdapter = {
  records: RecordStore;
  assets?: AssetStore;
  counters?: CounterStore;
  config?: ConfigStore;
};
```

Cloudflare Workers MVP の adapter 対応:

| Adapter | Cloudflare 実装 | MVP |
|---|---|---:|
| `RecordStore` | D1 | 必須 |
| `AssetStore` | R2 + D1 metadata | 任意だが早めに追加 |
| `CounterStore` | D1、上級設定で Durable Objects | D1 から開始 |
| `ConfigStore` | KV | 任意 |
| `SessionStore` | cookie/JWT 中心、必要に応じて KV/D1 | 認証方式に依存 |

この境界を保つことで、同じ IR から Vercel + 外部 DB、Firebase + Firestore/Storage、Supabase + Postgres/Storage へ後から展開しやすくなる。

## MVP に含める範囲

| 機能 | MVP | 理由 |
|---|---:|---|
| TypeScript/Hono 生成 | ○ | 既存実装と相性がよい |
| Cloudflare Workers scaffold | ○ | `wrangler.jsonc`、binding、README まで出す |
| GET/POST route | ○ | ブロック HTTP handler の中心 |
| query/header/path/body 参照 | ○ | 既存 request block と対応する |
| text/html/json response | ○ | 既存 response block と対応する |
| D1 record store | ○ | 永続化の標準 |
| R2 asset store | △ | Asset Manager 連携を早めに試す価値がある |
| KV config/cache | △ | route 設定や feature flag 向け |
| Cloudflare Access mode | △ | 限定公開用途に便利 |
| 外部 JWT 検証 mode | △ | Google/Microsoft/GitHub login の broker 連携に必要 |
| OAuth/OIDC callback flow の自動生成 | × | MVP には重い。外部 auth broker に任せる |
| Durable Objects | × | 正確なカウンタやリアルタイム状態が必要になってから追加 |

## 注意点

- 生成コードは Node.js server ではなく Fetch API を前提にする。
- `fs`、`net`、`http`、長寿命 process、local disk 依存は生成しない。
- HTML builder の escape、unsafe attribute 除外、safe URL scheme のルールは生成 runtime にも移植する。
- response header は CR/LF injection と runtime-owned header を拒否する。
- D1 migration は生成物に含め、schema をコード生成と同じ source of truth から作る。
- R2 object は public bucket に直置きせず、Worker 経由で認可と metadata 確認を行う。
- 認証 claim は allowlist 方式でブロックへ公開する。
- Secrets は `wrangler secret` または Cloudflare dashboard の secret として扱い、生成コードや git に含めない。

## 参考

- [Cloudflare Workers Languages](https://developers.cloudflare.com/workers/languages/)
- [Cloudflare Workers + Hono](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Workers KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Vercel Functions runtimes](https://vercel.com/docs/functions/runtimes)
- [Firebase Cloud Functions](https://firebase.google.com/docs/functions)
- [Hono deployment targets](https://hono.dev/docs/)
