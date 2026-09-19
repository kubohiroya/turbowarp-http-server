# Deploy IR v2 基礎仕様

Deploy IR v2は、TurboWarpのHTTP handlerをplatform-neutralな型付き表現へ変換するための実験的な中間表現です。IR v1とCloudflare generatorは移行期間中も維持し、v2を暗黙に選択しません。

型、strict parser、JSON Schema、canonical serializer、v1 upgraderに加え、明示的なtargetを選択するv2 CLI pipelineを提供します。[Compiler／platform adapter境界](compiler-platform-pipeline.ja.md)を参照してください。

外部extension manifestのlock／offline解決仕様は[Compiler extension manifest registry](compiler-manifest-registry.ja.md)を参照してください。

許可block、binding scope、bounded control flow、response、work budgetの規則は[Server-executable subset](server-executable-subset.ja.md)を参照してください。

Structured Data blockの変換規則は[Structured Data lowering](structured-data-lowering.ja.md)を参照してください。

binary resourceの所有権、上限、storage contractは[Binary resource semantics](binary-resource-semantics.ja.md)を参照してください。

Cloudflare／Firebaseのstorage mappingとtarget設定は[IR v2 platform storage adapter](platform-storage-adapters.ja.md)を参照してください。

layer横断のgolden／trace検証は[IR v2 semantic conformance harness](ir-v2-conformance.ja.md)を参照してください。

## Versionと有効化

- rootの`version`は整数`2`です。
- manifest schema version、extension package version、adapter versionとは独立しています。
- `compilerIrV2`の既定値はfalseです。
- CLIでは`--ir-version 2`と`--target`を明示した場合だけ有効化します。
- `--ir-version`省略時の`compile` commandは引き続きIR v1を処理します。

## 型

IR JSONへ格納できるatomic value typeは次のとおりです。

- `null`
- `boolean`
- `number`
- `string`
- `json-text`
- `json-array`
- `json-object`
- `binary-ref`

`number`は有限IEEE-754 binary64とし、`NaN`と±`Infinity`を拒否します。`-0`は`0`へ正規化します。`json-text`は有効なapplication JSONを表すnominal string境界で、通常の`string`やparse済みJSON値とは暗黙に混同しません。`json-array`と`json-object`は再帰的なJSON値で、resourceを内包できません。

`binary-ref`はbyte列ではなく、`namespace`と`key`、任意の`contentType`、`size`、`sha256:<hex>`形式の`integrity`、opaque `revision`を持つ論理descriptorです。`base64`、`bytes`、data URL等のinline payload fieldは許可しません。

`binary-body`はvalueではありません。stream本体をIR JSONへ格納せず、`resource` bindingのIDとしてだけ表現します。この区別により、後続validatorがclone、二重consume、scope外利用を検出できます。

union typeは次の形式です。

```json
{"kind":"union","members":["null","json-object"]}
```

## Expressionとstatement

すべてのexpressionは`valueType`を持ちます。v2で定義済みのexpressionはliteral、request、request-value、concat、handler-variable、handler-variable-exists、handler-variable-names、bindingに加え、明示的なJSON parse／serialize、path操作、iteration reporterです。

statementはHTTP response操作、handler-variable操作、論理record／object storage操作、binary body producer／consumer、typed `if`、bounded-loop、`json-for-each`、terminal responseを表現します。一般的なScratch control blockを受理するかどうかはschemaではなくfrontend／validatorの責務です。

statementのeffectは入力側が自由に申告するfieldにはせず、statement kindから`IR_V2_STATEMENT_EFFECTS`で決定的に導出します。分類は`response-write`、`handler-state-write`、`record-read`、`record-write`、`control`です。これにより入力がeffectを過少申告してvalidatorを迂回することを防ぎます。

JSON pathは`PathSegmentV2`とschemaの`pathSegment`で、string keyと非負整数indexを別のvariantとして定義します。`json-for-each`はlexical `loopId`を作り、そのbody内だけでiteration key／index／value reporterから参照できます。

`sourceRef`はtarget index/name、block ID、opcode、任意のinput名を保持します。diagnostic用であり、生成コードの意味には影響しません。v1 upgraderでは元情報がないため省略できます。

## Strict parsing

`parseDeployIrV2Json`はJSON textを読み、次を拒否します。

- duplicate object key
- unknown field
- unknown node kind
- 型とliteral値の不一致
- 非有限number
- 不正なbinding ID
- 不正なsourceRef

失敗時は`DeployIrV2ParseError`を送出し、呼び出し側が文面を解析せず扱える安定したcodeを持たせます。

- `TW2_IR_JSON_SYNTAX`: JSON構文エラー
- `TW2_IR_DUPLICATE_KEY`: duplicate object key
- `TW2_IR_VERSION`: 未対応IR version
- `TW2_IR_UNKNOWN_FIELD`: unknown field
- `TW2_IR_UNKNOWN_NODE`: unknown expression／statement等のnode kind
- `TW2_IR_INVALID_VALUE`: その他のschema／値制約違反

既知objectには`additionalProperties: false`を適用します。未知fieldを無視して将来の意味へ誤変換しません。

machine-readable schemaは[`schemas/deploy-ir-v2.schema.json`](../schemas/deploy-ir-v2.schema.json)です。runtime parserはschema validatorの有無に依存せず、同じnode集合を検証します。

## Canonical serialization

IR documentのhashとgolden比較にはRFC 8785（JCS）形式を使用します。object keyはUTF-16 code unit順、array順は保持、whitespaceは挿入しません。lone surrogateを含む不正なUnicode stringはcanonicalizeせず拒否します。

これはStructured Data extensionが扱うapplication JSONの正規化規則とは別です。application JSONをIR document用JCSへ暗黙変換しません。

## Capability

IR coreは製品名ではなく、次のような論理requirementを持ちます。

- `record-store`
- `object-storage`
- `streaming-body`
- `request-metadata: client-address`
- `auth: external-jwt | trusted-access-jwt`

D1、KV、R2、Firestore、Cloud Storage等の選択はIRへ書かず、後続のPlatformAdapterが行います。

capabilityとunion typeのmemberはsetとして扱い、parserが重複を拒否して決定的な順序へ正規化します。routeとstatementの配列順は実行順なので保持します。

## IR v1 upgrader

`upgradeDeployIrV1`は既存v1 route/actionをv2へ変換し、必要なcapabilityを導出します。

- `record-*` → logical `record-store`
- request body → typed `body-text`
- client address → logical request metadata capability
- storage result →型付きbinding
- `external-jwt` → platform-neutral JWT requirement

v1の`cloudflare-access`はplatform固有設定を含むため、`cloudflare-workers` targetを指定した場合だけ、IRの`trusted-access-jwt` requirementとtarget config sidecarへ分離します。他targetでは`TW2_V1_TARGET_CONSTRAINT` diagnosticを返し、類似認証へ置き換えません。

## ファイル

- `src/compiler/ir-v2/types.ts`: TypeScript型
- `src/compiler/ir-v2/parse.ts`: strict object parser
- `src/compiler/ir-v2/strict-json.ts`: duplicate-keyを拒否するJSON text parser
- `src/compiler/ir-v2/canonical.ts`: canonical serializer
- `src/compiler/ir-v2/upgrade-v1.ts`: v1 upgrader
- `schemas/deploy-ir-v2.schema.json`: JSON Schema
- `examples/compiler/message-app.v2.ir.json`: v2 example

## ロールバック

IR v2は追加moduleであり、既存IR v1 parserとCloudflare generatorを置換しません。問題時はv2を選択せず、既存のv1 pipelineを利用します。
