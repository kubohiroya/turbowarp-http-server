# IR v2 semantic conformance harness

conformance harnessは、同じTurboWarp programの意味論がfrontend、platform-neutral core、target adapter間でずれないことをversion固定fixtureで検証します。test専用でありproduction runtimeや生成projectには含めません。

## 実行

```sh
pnpm test:conformance
pnpm test:conformance:frontend
pnpm test:conformance:core
pnpm test:conformance:target
pnpm test:conformance:target-runtime
```

通常の`pnpm test`と`pnpm check`には決定的に実行できる全layerが含まれます。target layerは生成Cloudflare／Firebase projectの実typecheckまで実行し、cloud account、Emulator、課金resourceは使用しません。`test:conformance:target-runtime`は独立した明示実行用smoke testで、生成projectをWrangler local runtimeとFirebase Emulator Suiteで起動し、record作成とbinary object保存をHTTP経由で検証します。cloud credentialや課金resourceは使用しませんが、Firebase Emulatorの初回実行ではemulator binaryのdownloadが必要な場合があります。個別実行は末尾に`cloudflare-workers`または`firebase-functions`を指定します。

## fixture version 1

正本schemaは[`schemas/ir-v2-conformance-fixture.schema.json`](../schemas/ir-v2-conformance-fixture.schema.json)です。fixtureは`fixtureVersion: 1`、安定した`id`、`layer`を必須とします。互換性を壊すfield変更はversionを上げ、同じversionで既存goldenの意味を変更しません。

fixtureは`tests/fixtures/conformance`に次の3層で配置します。

1. **Frontend**: `project.json`、manifest lock、期待IR v2 JCS goldenまたは期待diagnostic code
2. **Core runtime**: IR v2、request、generated Hono appの期待HTTP／storage effect trace
3. **Target**: IR v2、target ID、adapter version、期待file一覧、生成project typecheck

IR goldenはDeploy IR v2 canonical serializerで比較します。JSONのpretty-printやobject挿入順には依存しません。外部extension vectorはpackage name、exact version、SHA-256 integrityをmanifest lockとfixtureの両方で固定し、lock解決時にも実bytesを再検証します。

## HTTPとeffect trace

HTTP traceはstatus、lowercase header名と値の順序付きpair、body text、body bytesのSHA-256を比較します。binary bodyそのものをsnapshotへ埋め込みません。将来multi-value headerを追加する場合もpairを複数保持し、単一objectへ潰しません。

storage traceは次だけを記録します。

- logical capability
- operation
- collectionまたは検証済みlogical locator
- byte列を含まないmetadata

record IDはtest adapterが`record-0001`から決定的に採番します。clock、random ID、absolute temp path、platform SDK内部値はgoldenへ含めません。binary fixtureはrepository内の小さなfileとSHA-256で固定し、IR JSONへbase64 payloadを格納しません。

## 現在のvector

- Structured Data: immutable path更新、Unicode code point順serialize、nested iteration、安定422 error
- Binary: file-backed put/get/delete、stream size limit、consume-once/error contract
- Named body: fake Structured Data／Asset Manager provider、JSON／raw response、HEAD metadata
- direct IR／TurboWarp frontend: status／header／bodyのobservable parity
- Target: Cloudflare／Firebase adapterのdeterministic artifact、manifest、TypeScript typecheck、任意のlocal runtime smoke test

新しいadapterをregistryへ登録する変更は、target matrixのentryと期待artifactを同じ変更で追加します。未完成targetをskipして成功扱いにはしません。Wrangler local runtimeとFirebase Emulator Suiteのsmoke testは、core goldenを維持した独立jobまたはrelease前検証として実行します。

## CIと失敗artifact

通常CIでは`pnpm check`をblockingにします。失敗時は次をCI artifactとして保持できるようにします。

- fixture IDとlayer
- actual canonical IRまたはdiagnostic code
- actual HTTP／effect trace
- target generated project（secret、absolute path、cloud credentialなし）

外部emulator jobがflakyな場合は別jobへ隔離できますが、失敗は可視化し、core goldenをskipしません。既定のlocal suiteは外部networkを使わないためretryやnormalizerで失敗を隠しません。

## ロールバック

harnessはproduction出力へ含まれないため、問題時は該当fixture／runner変更をrevertします。意味論差分が見つかった場合はgoldenを先に書き換えず、frontend、core、adapterのどの層が正本とずれたかを修正します。
