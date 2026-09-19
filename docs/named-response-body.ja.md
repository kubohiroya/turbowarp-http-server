# Named response body provider contract

Named response bodyは、Structured Data、将来のDocument Data、binary／Asset Manager dataを、HTTP Serverから同じsnapshot／stream契約で返すための実験的な内部APIです。各extensionのprivate state、IndexedDB／OPFS layout、platform SDK objectはHTTP Serverへ公開しません。

現時点ではprovider contract、共通Response builder、Deploy IR v2のcanonical terminal statementを提供します。Node側の既存`ResourceCapability`は`createAssetManagerNamedBodyProvider`でAsset Manager providerへ適合できます。TurboWarp block、実Structured Data provider、生成Cloudflare／Firebase targetへのprovider接続は未実装です。`namedResponseBody`は既定falseで、`--enable-named-response-body`を指定したcompiler呼び出しだけが新statementを受理します。

## 参照とscope

```ts
interface NamedDataReference {
  namespace: string;
  name: string;
  kind: 'structured' | 'document' | 'binary' | 'asset';
  scope: 'target' | 'project';
}
```

- `namespace`は小文字英字で始まり、小文字英数字・`.`・`-`だけを使う64文字以下のlogical IDです。データ型ではなく所有領域を表します。
- `name`は1〜256文字で、control characterを含めません。storage pathとして直接使用しません。
- `target` scopeはruntime-localな`targetId`を必須とします。
- `project` scopeへ`targetId`を付ける曖昧な参照は拒否します。
- requested representationは`json`、`yaml`、`html`、`markdown`、`raw`のいずれかです。

不正参照はproviderへ渡す前に`NAMED_DATA_INVALID_REF`で拒否します。canonical registryは`(namespace, kind)`をdispatch keyとし、同じ論理namespaceへ異なるkindのproviderを登録できます。HTTP Server固有のresolverへproviderを直接並べる場合は、`canResolve`でnamespace／kind／scopeを選択し、registry順の最初のproviderを使用します。

## stat、openBody、snapshot

providerはmetadataだけを返す`stat`と、snapshot handleを返す`openBody`を分離します。

```ts
interface NamedBodyHandle {
  metadata: NamedBodyMetadata;
  body: Uint8Array | ReadableStream<Uint8Array>;
  release(reason: 'complete' | 'cancel' | 'abort' | 'error'): void | Promise<void>;
}
```

`HEAD`は`stat`だけを呼び、bodyをopenしません。status errorを含めてbodyは返しません。`GET`相当の処理は`openBody`で得たhandleを1回だけreleaseします。open済みhandleはsnapshotであり、同じ名前のresourceがreplaceされても途中で新しい内容へ切り替わりません。

buffered bodyはresponseへ渡す前にcopyし、宣言`byteLength`と実byte数の不一致を502で拒否します。streamは既知lengthがなくてもchunkごとに上限をcountし、宣言`byteLength`がある場合は完了時の実測値とも照合します。未検証streamへ`Content-Length`は設定しません。Response開始後に判明した上限超過またはlength不一致は別のHTTP statusへ変更できないため、streamをcancelしてstable error codeで終了します。上限超過、consumer cancel、AbortSignal、正常完了をsource cancel／release reasonへ伝えます。release failureはprivate provider messageを返さず`NAMED_DATA_PROVIDER_RELEASED`へ変換します。

## representationとHTTP metadata

| representation | 許可media type |
| --- | --- |
| `json` | `application/json`, `*+json` |
| `yaml` | `application/yaml`, `application/x-yaml`, `text/yaml` |
| `html` | `text/html` |
| `markdown` | `text/markdown`, `text/x-markdown` |
| `raw` | 有効なtype/subtype |

metadataの`mediaType`、`byteLength`、`etag`／`revision`を検証し、Content-Type、Content-Length、ETagへ写像します。CR／LF／NUL、負数、不正length、representation mismatchを拒否します。body bytes、JSON／document内容、provider例外messageをerror responseへ含めません。

## stable error

| code | HTTP status |
| --- | ---: |
| `NAMED_DATA_INVALID_REF` | 400 |
| `NAMED_DATA_PROVIDER_NOT_FOUND` | 501 |
| `NAMED_DATA_NOT_FOUND` | 404 |
| `NAMED_DATA_KIND_MISMATCH` | 400 |
| `NAMED_DATA_SCOPE_MISMATCH` | 400 |
| `NAMED_DATA_REPRESENTATION_UNSUPPORTED` | 415 |
| `NAMED_DATA_INVALID_METADATA` | 502 |
| `NAMED_DATA_BODY_TOO_LARGE` | 413 |
| `NAMED_DATA_ABORTED` | 499 |
| `NAMED_DATA_PROVIDER_RELEASED` | 503 |
| `NAMED_DATA_INVALID_REGISTRY`／`NAMED_DATA_PROVIDER_CONFLICT` | 500 |
HTTP ServerはNamed Data `0.2.x`契約を要求します。`0.1.x`のruntime versioning error codeは受理せず、consumerはNamed DataとHTTP Serverを同時に更新します。

feature無効時は`NAMED_RESPONSE_BODY_DISABLED`、provider metadata contract違反は`NAMED_RESPONSE_INVALID_METADATA`です。

## 共通Named Data registry

`NamedDataRegistryResolver`は`@kubohiroya/turbowarp-named-data`のcanonical registryをHTTP response境界へ接続します。constructorのcontext resolverは、`targetId`を実際のTurboWarp target objectへ解決し、project scopeではruntime固有のproject objectを返します。文字列IDをprovider contextの代用にはしません。

実サーバーでは`startServer({namedBodyResolver: new NamedDataRegistryResolver(...)})`として明示的に注入します。HTTP ServerがTurboWarpとは別processで動作する場合、browser runtimeのregistry objectを直接共有することはできないため、server側providerを登録するか、検証済みのprocess間adapterを用意する必要があります。descriptorだけからbrowser内のWeakMapやasset stateを推測しません。

registryから返された`reference`、`kind`、`scope`、`nativeRepresentation`、出力`representation`、MIME、digest、revision、replayable属性はHTTP境界まで保持されます。HTTP Serverはprovider内部のJSON tree、document AST、binary storage、asset registryを参照しません。

## IR統合

`respond-named-body`はdescriptor、representation、最大byte数、target scopeの場合だけ`targetId`を持つ単一terminal statementです。

```json
{
  "kind": "respond-named-body",
  "reference": {
    "namespace": "structured",
    "name": "profile",
    "kind": "structured",
    "scope": "target"
  },
  "targetId": "Stage:1",
  "representation": "json",
  "maxBytes": 1048576
}
```

IRは`named-body-provider` capabilityを明示しなければなりません。生成Hono coreは`CoreServices.namedBodies`だけに依存し、provider SDKや保存形式をimportしません。現在のCloudflare／Firebase adapterは実providerを持たないため、flagを有効にしても`TW2_TARGET_CAPABILITY_UNSUPPORTED`でcompileを停止します。test adapterとfake providerでJSON／raw binary／HEADのsemantic parityを検証します。

requestのaffine `binary-body`はnamed snapshotへ暗黙変換せず、明示import operationが定義されるまで既存`respond-binary`と別型のまま維持します。text／base64 fallbackは行いません。

## Asset Manager ResourceCapability adapter

`createAssetManagerNamedBodyProvider(resources)`は、既存の公開`ResourceCapability`だけを使用し、Asset Manager extensionのprivate fieldやIndexedDB／OPFS layoutを読みません。canonicalな`asset` namespaceの`asset` kindと`raw` representationだけを受理します。project scopeはglobal resource namespace（既定`routeName = ""`）、target scopeはruntimeの`targetId`へ写像します。

`HEAD`は`listResources`が利用可能ならmetadataだけを参照し、`GET`は`getResource`が返したbytesをcopyしてsnapshotを分離します。`replacementId`または`etag`をcanonical revisionとして必須にし、同名resourceから偽のETagを生成しません。未公開namespaceはnot foundとして扱い、kind／representation不一致とabortは共通のstable errorへ変換します。このadapterはNode runtime向けであり、生成targetが`named-body-provider` capabilityを宣言する根拠にはしません。

## TurboWarp bridge block

`respond with named ...` blockはnamespace、name、kind、scope、任意のtarget ID、representation、最大byte数だけをWebSocket bridgeへ送ります。resource body、base64、data URLはbridge messageへ格納しません。Node serverは`--enable-named-response-body`指定時だけdescriptorを上記Asset Manager providerへ渡し、block側上限とserver側上限の小さい方を適用します。

同じblock messageをGETで受けるとsnapshot bodyを返し、HEADではproviderの`stat`を使用してbodyを返しません。feature flag未指定時はproviderへアクセスせず501 `NAMED_RESPONSE_BODY_DISABLED`です。Structured Dataなど別namespaceは対応providerが登録されるまで`NAMED_DATA_PROVIDER_NOT_FOUND`となります。

server compiler向けの`lowerNamedBodyResponse`は、同じblock引数をcanonical `respond-named-body` statementへ変換します。namespace、name、kind、scope、target ID、representation、最大byte数はcompile-time literalだけを受理します。これによりprovider capability、scope、target上限をcode generation前に検証できます。project scopeではblockの`TARGET_ID`入力をIRへ含めず、target scopeの場合だけ必須にします。IR v2 frontendはTurboWarp project全体を走査し、source位置と`named-body-provider` capabilityを保持してこのloweringへ接続します。

## ロールバック

compiler flagがOFFの場合は`TW2_NAMED_RESPONSE_BODY_DISABLED`で生成前に拒否します。runtimeの`namedResponseBody=false`ではproviderを参照せず501 `NAMED_RESPONSE_BODY_DISABLED`を返します。既存`respond`／`respond-binary`、IR v1、browser runtime、cloud objectは変更・削除しません。問題時は新しい呼び出し経路だけを停止できます。
