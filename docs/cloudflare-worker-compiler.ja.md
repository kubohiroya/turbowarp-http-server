# TurboWarp → Cloudflare Workers/Hono コンパイラ設計

Issue #13のMVPとして、TurboWarpのHTTP handlerまたはDeploy IR v2から、Cloudflare Workers上で動作するHono applicationを生成する。compilerはIR v2だけを受理し、targetとして`cloudflare-workers`を明示する。旧IR v1とそのupgraderは提供しない。

既存のWebSocket bridgeは独立した実行経路であり、`compile` subcommandを実行しない限り生成処理は行わない。

## アーキテクチャ

```text
TurboWarp project.json ─ manifest-aware frontend ─┐
                                                  ├─ Deploy IR v2
Deploy IR v2 JSON ─────── strict parser ──────────┘
  -> server-safe validator
  -> capability extraction
  -> platform-neutral Hono core
  -> Cloudflare adapter
  -> deterministic filesystem artifacts
```

IRの型とserializationは[Deploy IR v2 基礎仕様](deploy-ir-v2.ja.md)、許可blockは[Server-executable subset](server-executable-subset.ja.md)、target境界は[Compiler／Platform pipeline](compiler-platform-pipeline.ja.md)を正本とする。

## CLI

```sh
# TurboWarp project.json
turbowarp-http-server compile \
  --input ./project.json \
  --output ./generated-worker \
  --format turbowarp-json \
  --target cloudflare-workers \
  --manifest-lock ./turbowarp-server.lock.json

# Deploy IR v2 JSON
turbowarp-http-server compile \
  --input ./examples/compiler/message-app.v2.ir.json \
  --output ./generated-worker \
  --format ir \
  --target cloudflare-workers
```

`--target`は必須であり、compilerはplatformを推測しない。`.sb3`の直接入力は対象外なので、TurboWarpから`project.json`を取り出して入力する。出力先が空でない場合は失敗し、置換する場合だけ`--force`を明示する。

## 生成物

IRのcapabilityに応じて次のfileを生成する。

```text
generated-worker/
  src/core.generated.ts
  src/index.ts
  src/platform.ts
  migrations/0001_init.sql   # record-storeまたはkey-value-store利用時
  package.json
  tsconfig.json
  wrangler.jsonc
  README.md
  turbowarp-server.generated.json
```

`core.generated.ts`はCloudflare SDKをimportしない。`index.ts`と`platform.ts`がD1／R2 bindingをHono coreのservice interfaceへ接続する。出力manifestにはadapter ID/version、capability plan、binding、生成file一覧を記録する。

## HTTP、state、storage

- request method、path、query、header、bodyは型付きIR expressionへ変換する。
- status/header操作の後、すべてのcontrol-flow pathをちょうど一つのterminal responseで終了する。
- handler variableはrequest-localであり、request終了時に破棄する。
- Scratch variable/list、broadcast、`forever`、暗黙の並行scriptは拒否する。
- `record-store`と`key-value-store`はCloudflare adapterでD1へ写像する。
- `object-storage`とstreaming binary bodyはR2へ写像する。
- 正確なcounterやroom state向けDurable ObjectsはMVP対象外である。

Asset Manager／Asset Cacheのbrowser blockをR2操作へ読み替えない。Asset Cacheはbrowser内の登録・cache・再生を担当し、server compilerではbrowser-only opcodeとして拒否する。portableなnamespace/key操作は`turbowarp-kvs` manifest、binary bodyは独立したIR v2 resource contractを正本とする。

## 認証と安全性

IR v2の認証はplatform-neutralなJWT capabilityとして表現する。Cloudflare adapterが未対応の認証capabilityを宣言した場合は、類似実装へfallbackせずcompile errorにする。OAuth/OIDC provider、login/callback、token発行は生成しない。

生成コードでは次を禁止する。

- Node.js専用の`fs`、`net`、`http`、`process`をWorker処理へ持ち込むこと
- module/global変数を永続stateとして使うこと
- unsafe header、CR/LF injection、runtime所有headerの上書き
- secret、credential、project IDをIR、target config、生成sourceへ直書きすること
- request body、binary payload、logical locator、platform SDK errorをdiagnosticへ出すこと

secretはWrangler secretまたはCloudflare dashboardから設定する。compilerとadapterはnetwork deploy、credential操作、cloud resource作成を行わない。

## ロールバック

問題時は生成物のdeployを停止し、既存のWebSocket bridgeを使用する。既存cloud resourceは自動削除しない。必要なD1/R2 dataをexportし、依存deploymentとbindingを確認した後、generated READMEに従って利用者が明示的にcleanupする。
