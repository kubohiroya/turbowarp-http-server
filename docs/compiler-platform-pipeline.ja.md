# IR v2 compiler／platform adapter境界

Deploy IR v2の生成pipelineは、target-neutralな検証とHono core生成を、platform固有の計画・entrypoint・storage・deploy artifact生成から分離します。compilerはIR v2だけを扱い、CLIではtargetを必ず明示します。

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
  --target cloudflare-workers
```

同じIRをFirebase Functionsへ生成する場合は`--target firebase-functions`へ切り替えます。target固有のbinding／環境変数名は`--target-config`で指定し、IRは変更しません。

TurboWarp `project.json`と外部extensionをcompileする場合は、検証済みmanifest lockを明示します。

```sh
turbowarp-http-server compile \
  --input project.json \
  --output generated-worker \
  --format turbowarp-json \
  --target cloudflare-workers \
  --manifest-lock turboWarp-server.lock.json
```

- `--target`を必須とし、targetを推測しません。
- CLI入力はcanonical `--format ir`に加え、built-in HTTP block subsetの`--format turbowarp-json`を受理します。
- `--target-config <file>`はadapter設定です。IRへmergeせず、secret値を受け取りません。
- `--enable-named-response-body`は実験的な`respond-named-body`だけを有効化し、既定OFFです。選択targetに`named-body-provider`がなければ生成しません。
- `--format turbowarp-json`はbuilt-in HTTP block、literal bounded repeat、named responseを直接IR v2へloweringします。`--manifest-lock`指定時はlock済みStructured Data reporter／loopとKVS 0.1.0の5操作も同じfrontendでloweringします。lockにないextension opcodeや旧Asset Manager操作を推測しません。
- Cloudflare adapterはD1／R2 binding名、Firebase adapterはfunction名／bucket環境変数名／Firestore collection名だけを受け取ります。secretやproject IDは受け取りません。詳細は[IR v2 platform storage adapter](platform-storage-adapters.ja.md)を参照してください。

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

共有coreはCloudflare、Firebase、D1、R2等の製品型を参照しません。たとえばclient addressは`CoreServices.clientAddress`、KVSは`CoreServices.keyValues`、record永続化は`CoreServices.records`、binary objectは`CoreServices.objects`を介し、選択adapterがplatform APIへ結び付けます。

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

Structured Dataのstatus mappingは[Structured Data lowering](structured-data-lowering.ja.md)、binaryは[Binary resource semantics](binary-resource-semantics.ja.md)を正本とします。KVSの不正namespace/keyは422、storage failureは502です。未知の例外または未知codeは500 `IR_RUNTIME_ERROR`です。message、stack、request body、binary、locator、secret、platform SDK errorはresponseへ含めません。

## deterministic output manifest

生成fileはpath昇順、UTF-8、LF、末尾newlineありで正規化します。timestamp、random ID、absolute pathは生成物へ埋め込みません。`turbowarp-server.generated.json`は次を記録します。

- manifest format version
- Deploy IR version
- target adapter ID／version
- capability plan
- 生成file一覧

同じIR、target、adapter version、target configからはbyte-for-byte同じ生成物を得ます。

## ロールバック

問題時は対象targetへの生成・deployを停止し、既存のbrowser bridgeを利用します。生成処理はcloud resourceを変更しないため、rollback時にresource削除は行いません。
