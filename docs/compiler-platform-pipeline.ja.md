# IR v2 compiler／platform adapter境界

Deploy IR v2の生成pipelineは、target-neutralな検証とHono core生成を、platform固有の計画・entrypoint・storage・deploy artifact生成から分離します。`compilerIrV2`は既定OFFであり、CLIで`--ir-version 2`を明示した場合だけこのpipelineを選択します。

```text
Deploy IR v2
  -> target-neutral validator
  -> capability requirement extraction
  -> PlatformAdapter registry / plan
  -> platform-neutral Hono core generator
  -> adapter artifact generator
  -> deterministic generated project + output manifest
```

## CLI contract

v2 direct IRは次のようにcompileします。

```sh
turbowarp-http-server compile \
  --input deploy-ir-v2.json \
  --output generated-worker \
  --format ir \
  --ir-version 2 \
  --target cloudflare-workers
```

同じIRをFirebase Functionsへ生成する場合は`--target firebase-functions`へ切り替えます。target固有のbinding／環境変数名は`--target-config`で指定し、IRは変更しません。

- v2では`--target`を必須とし、targetを推測しません。
- v2 CLI入力はcanonical `--format ir`に加え、既存built-in HTTP block subsetの`--format turbowarp-json`を受理します。
- `--target-config <file>`はadapter設定です。IRへmergeせず、secret値を受け取りません。
- `--enable-named-response-body`は実験的な`respond-named-body`だけを有効化し、既定OFFです。選択targetに`named-body-provider`がなければ生成しません。
- `--format turbowarp-json --ir-version 2`は既存built-in HTTP block subsetをv1互換frontend経由でv2へupgradeし、`respondWithNamedBody`だけをcanonical statementへ差し替えます。extension manifest由来blockのproject-wide loweringは後続です。
- Cloudflare adapterはD1／R2 binding名、Firebase adapterはfunction名／bucket環境変数名／Firestore collection名だけを受け取ります。secretやproject IDは受け取りません。詳細は[IR v2 platform storage adapter](platform-storage-adapters.ja.md)を参照してください。
- v1は引き続き既存Cloudflare generatorを使用し、`--ir-version`省略時の動作もv1のままです。

## module責務

| phase | module | 責務 |
| --- | --- | --- |
| parse | `compiler/ir-v2` | strict JSON／schemaから型付きIRを作る |
| validate | `compiler/validator` | targetに依存しない型、control flow、resource lifetimeを検証する |
| requirements | `compiler/pipeline/requirements` | 宣言capabilityを正規化し、要求元route／`sourceRef`を特定する |
| registry／plan | `compiler/pipeline` | targetを解決し、adapter capabilityと設定を検証する |
| core generator | `compiler/pipeline/core-generator` | Hono routeと抽象service境界を生成する |
| adapter | `compiler/adapters` | platform entrypoint、binding、storage、deploy設定を生成する |

`PlatformAdapter.plan`と`generate`はnetwork、deploy、cloud resource作成を行わないpure filesystem artifact operationです。新しいadapterはregistryへ追加でき、frontendやopcode loweringを変更する必要はありません。

共有coreはCloudflare、Firebase、D1、R2等の製品型を参照しません。たとえばclient addressは`CoreServices.clientAddress`、record永続化は`CoreServices.records`、binary objectは`CoreServices.objects`を介し、選択adapterがplatform APIへ結び付けます。

## diagnostic

- 未登録target: `TW2_UNKNOWN_TARGET`
- target capability不足: `TW2_TARGET_CAPABILITY_UNSUPPORTED`
- adapter設定不正: `TW2_TARGET_CONFIG_INVALID`

capability不足にはtarget ID、要求元route ID、取得可能な場合はTurboWarp blockの`sourceRef`、理由、代替案を含めます。target-neutral validationが失敗した場合はadapter planへ進まず、部分的な生成物も書きません。

## runtime error boundary

terminal response開始前の既知runtime faultは次のenvelopeへ変換します。

```json
{"error":{"code":"STABLE_CODE"}}
```

Structured Dataのstatus mappingは[Structured Data lowering](structured-data-lowering.ja.md)、binaryは[Binary resource semantics](binary-resource-semantics.ja.md)を正本とします。未知の例外または未知codeは500 `IR_RUNTIME_ERROR`です。message、stack、request body、binary、locator、secret、platform SDK errorはresponseへ含めません。

## deterministic output manifest

生成fileはpath昇順、UTF-8、LF、末尾newlineありで正規化します。timestamp、random ID、absolute pathは生成物へ埋め込みません。`turbowarp-server.generated.json`は次を記録します。

- manifest format version
- Deploy IR version
- target adapter ID／version
- capability plan
- 生成file一覧

同じIR、target、adapter version、target configからはbyte-for-byte同じ生成物を得ます。

## ロールバック

問題時は`--ir-version 1`へ戻すか、`compilerIrV2=false`を維持します。生成処理はcloud resourceを変更しないため、rollback時にresource削除は行いません。既存v1 generatorの削除はadapter conformance完了後の別作業です。
