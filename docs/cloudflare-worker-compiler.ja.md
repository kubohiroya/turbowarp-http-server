# TurboWarp → Cloudflare Workers/Hono コンパイラ設計

Issue #13 の MVP として、TurboWarp の HTTP handler を検証可能な中間表現（IR）へ変換し、Cloudflare Workers 上の Hono application を生成する。既存の WebSocket bridge は変更せず、生成は明示的な `compile` subcommand を実行した場合だけ行う。

この文書はIR v1／Cloudflare generatorの仕様を扱う。platform-neutralなIR v2の基礎仕様は[Deploy IR v2 基礎仕様](deploy-ir-v2.ja.md)を参照する。IR v2は実験的な追加moduleで、現時点の`compile` commandは引き続きv1を使用する。

## アーキテクチャ

```text
TurboWarp project.json ── subset parser ──┐
                                          ├─ Deploy IR v1 ─ validator ─ Cloudflare generator
Deploy IR JSON ───────────────────────────┘                         │
                                                                    ├─ Hono routes
                                                                    ├─ auth adapter
                                                                    ├─ storage adapters
                                                                    └─ Wrangler scaffold
```

IR と Cloudflare adapter を分離する。TurboWarp parser は静的に意味を確定できるブロックだけを受理し、それ以外を推測しない。IR JSON は storage/auth を含む高度な生成や、将来の editor exporter からの入力に利用できる。

## CLI

```sh
# TurboWarp editor の project.json を入力する
turbowarp-http-server compile \
  --input ./project.json \
  --output ./generated-worker

# 正規化済み IR を入力する
turbowarp-http-server compile \
  --format ir \
  --input ./examples/compiler/message-app.ir.json \
  --output ./generated-worker
```

出力先が空でない場合は失敗する。生成済みファイルを置き換える場合だけ `--force` を明示する。`.sb3`（ZIP container）の直接入力は MVP 対象外で、TurboWarp から `project.json` を取り出して入力する。

## TurboWarp project.json の受け入れサブセット

この節は後方互換のIR v1 frontendを記述します。`--ir-version 2`のサブセットとliteral bounded repeatは[Server-executable subset](server-executable-subset.ja.md)を正本とします。

### route と method

| TurboWarp 構造 | IR |
|---|---|
| Stage 上の HTTP request hat | path `/` |
| Sprite `Messages` 上の HTTP request hat | path `/messages`（NFKC、lowercase、URL-safe 化） |
| hat 直下の command 列 | method `ALL` |
| hat 直下に唯一置かれた `if <current HTTP method = [GET]> then` | method `GET` |

method guard で受理する値は `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`。method guard の後に別 command が続く構造、`else`、loop、broadcast、clone、並行 script、動的 method 値は対象外とする。同じ method/path の handler が複数ある場合は compile error にする。

### request expression

| block | IR expression | Hono/Fetch |
|---|---|---|
| current HTTP method | `request:method` | `c.req.method` |
| current request path | `request:path` | `new URL(c.req.url).pathname` |
| current request URL | `request:url` | `c.req.url` |
| current request body | `request:body` | `await c.req.text()` |
| current request content type | `request:content-type` | request header |
| current request client address | `request:client-address` | `cf-connecting-ip` header |
| query parameter `[literal]` | `request-value:query` | `c.req.query(name)` |
| path parameter `[literal]` | `request-value:path-param` | `c.req.param(name)` |
| request header `[literal]` | `request-value:header` | `c.req.header(name)` |
| join | `concat` | string concatenation |
| text/number literal | `literal` | escaped TypeScript literal |

lookup 名を reporter で動的生成する形や、変数・list・custom block・JavaScript block は受け入れない。

## サーバ実行用の代替ブロック

Scratch/TurboWarp の通常 block は browser VM の thread、target、project runtime を前提とする。Worker request は短命かつ並行に実行されるため、通常の variable、broadcast、`forever` を意味を変えずに移植しない。

### handler variable（実装対象）

この extension は次を追加提供する。

- `set handler variable [NAME] to [VALUE]`
- `change handler variable [NAME] by [AMOUNT]`
- `handler variable [NAME]`
- `handler variable [NAME] exists?`
- `delete handler variable [NAME]`
- `delete all handler variables`
- `active handler variables`

TurboWarp の Temporary Variables (`lmsTempVars2`) にある thread variable は `util.thread.variables` に保存され、同じ thread 内だけで共有される。このモデルを HTTP handler に対応させ、handler variable は request context ごとに独立した `Map` として生成する。response 完了時に破棄し、別 request、別 isolate、D1/KV へ引き継がない。browser bridge 実行時も request ID ごとの context に保持する。

通常の Scratch variable/list は compiler error とする。request をまたいで残す必要がある値は D1 record action、read-heavy な設定は KV、binary は R2、同時更新される正確な状態は D1 または将来の Durable Objects block を使う。

### message/broadcast の代替方針

`broadcast` と `broadcast and wait` は、複数 target の hat を動的に起動する browser VM scheduler に依存するため MVP では禁止する。同期的な再利用は、次段階で追加する `call server procedure [NAME] with [VALUE]` と戻り値 block に置き換える。非同期通知は request 内 message ではなく、Cloudflare Queues 等の明示的な durable event adapter として別 IR/action にする。MVP はどちらも未実装で、compiler は対応したふりをしない。

### forever の代替方針

`forever`、無期限 wait、request 完了後も残る loop は Worker request の CPU/time lifecycle と両立しないため禁止する。

- request 内の有限処理: 上限を静的または実行時に検査できる bounded repeat（将来の compiler subset）
- 定期処理: Cloudflare Cron Trigger 用の scheduled handler（将来 adapter）
- queue 消費: Cloudflare Queues consumer（将来 adapter）
- realtime room: Durable Objects（将来 adapter）

MVP では loop block を受理しない。これにより `forever` を誤って request callback 内の無限 loop に変換することを防ぐ。

### response action

`set HTTP status`、`set response header`、`remove response header`、`respond with text/html/json`、`send response` を受理する。status は compile time に `100..599` の整数として確定できなければならない。response は各 handler の最後にちょうど一つ必要である。

次の header は生成しない。

- `connection`
- `content-length`
- `transfer-encoding`
- `upgrade`
- token として不正な名前、または CR/LF を含み得る名前

header 値は実行時に `Headers` API へ渡す。JSON response は JSON として parse できることを実行時に検査し、不正なら `500 invalid_generated_json` を返す。

## Deploy IR v1

IR root は `version`、`name`、`auth`、`routes` を持つ。各 route は `id`、`method`、`path`、`auth`、`actions` を持つ。

表現できる action:

- response: status、header の set/remove、text/html/json response
- D1 record store: create、list、get、delete
- 結果 binding: storage result を後続 action の `result` expression から参照

表現できる auth guard:

- `public`
- `required`

project auth mode:

| mode | 生成 runtime の責務 |
|---|---|
| `none` | auth 処理なし。`required` route との組み合わせは禁止 |
| `cloudflare-access` | `Cf-Access-Jwt-Assertion` を Access team domain の JWKS、issuer、audience で検証 |
| `external-jwt` | Bearer JWT を設定済み issuer、audience、JWKS URL で検証 |

Google/Microsoft/GitHub の login/callback、token 発行、refresh、logout は生成しない。external auth broker または Cloudflare Access の責務とする。secret は `.dev.vars.example` に値を書かず、Wrangler secret または Cloudflare dashboard から注入する。

## 生成物

```text
generated-worker/
  src/index.ts
  src/routes.generated.ts
  src/auth.ts
  src/storage.ts
  migrations/0001_init.sql
  package.json
  tsconfig.json
  wrangler.jsonc
  .dev.vars.example
  .gitignore
  README.md
```

`routes.generated.ts` だけが route/action に依存し、`auth.ts` と `storage.ts` は adapter 実装として分離する。

## storage adapter 境界

| interface | Cloudflare MVP | 用途 |
|---|---|---|
| `RecordStore` | D1 | 投稿、list、user data、履歴 |
| `AssetStore` | R2 | binary/object。metadata と認可は D1 側 |
| `ConfigStore` | KV | feature flag、設定、cache。正確な更新には使わない |
| `CounterStore` | 将来の Durable Objects または D1 | 正確な counter、room state |

D1 binding `DB` は scaffold に含める。R2 `ASSETS` と KV `CONFIG` は型と commented binding だけを生成し、利用する IR action が追加されるまで必須にしない。Durable Objects は境界だけを定義し、MVP では class/binding を生成しない。

Worker module/global 変数、local filesystem、`fs`、`net`、Node.js `http`、`process`、長寿命 connection を永続状態や request 処理に使うコードは生成禁止とする。`/@assets` と `/_tw-http/` は既存 server の予約 namespace のため user route に使えない。

## 診断と失敗の原則

- unsupported block、欠落 block、循環、重複 route、response 欠落は error。
- 一部だけ意味を変えて出力せず、一つでも error があれば filesystem へ生成しない。
- 出力先の既存内容は `--force` なしで変更しない。
- TypeScript 文字列は JSON escaping を通し、project 内の文字列を source code として連結しない。

## ロールバック

コンパイラは明示 subcommand で既定 OFF であり、既存 HTTP bridge と extension runtime に変更を加えない。問題時は生成物の deploy を停止し、従来の bridge command を使用する。Cloudflare resource を削除する場合は必要な D1/R2 data を export してから、generated README の `wrangler delete`、D1/R2/KV delete 手順を実施する。
