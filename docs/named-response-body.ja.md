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

- `namespace`は英字で始まる64文字以下のlogical IDです。
- `name`は1〜256文字で、control characterを含めません。storage pathとして直接使用しません。
- `target` scopeはruntime-localな`targetId`を必須とします。
- `project` scopeへ`targetId`を付ける曖昧な参照は拒否します。
- requested representationは`json`、`yaml`、`html`、`markdown`、`raw`のいずれかです。

不正参照はproviderへ渡す前に`NAMED_DATA_INVALID_REF`で拒否します。providerは`canResolve`でnamespace／kind／scopeを選択し、複数登録時はregistry順の最初のproviderを使用します。

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

buffered bodyはresponseへ渡す前にcopyし、宣言`byteLength`と実byte数の不一致を502で拒否します。streamは既知lengthがなくてもchunkごとに上限をcountします。上限超過、consumer cancel、AbortSignal、正常完了をsource cancel／release reasonへ伝えます。release failureはprivate provider messageを返さず`NAMED_DATA_PROVIDER_RELEASED`へ変換します。

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
| `NAMED_DATA_BODY_TOO_LARGE` | 413 |
| `NAMED_DATA_ABORTED` | 499 |
| `NAMED_DATA_PROVIDER_RELEASED` | 503 |

feature無効時は`NAMED_RESPONSE_BODY_DISABLED`、provider metadata contract違反は`NAMED_RESPONSE_INVALID_METADATA`です。

## IR統合

`respond-named-body`はdescriptor、representation、最大byte数、target scopeの場合だけ`targetId`を持つ単一terminal statementです。

```json
{
  "kind": "respond-named-body",
  "reference": {
    "namespace": "structured-data",
    "name": "profile",
    "kind": "structured",
    "scope": "project"
  },
  "representation": "json",
  "maxBytes": 1048576
}
```

IRは`named-body-provider` capabilityを明示しなければなりません。生成Hono coreは`CoreServices.namedBodies`だけに依存し、provider SDKや保存形式をimportしません。現在のCloudflare／Firebase adapterは実providerを持たないため、flagを有効にしても`TW2_TARGET_CAPABILITY_UNSUPPORTED`でcompileを停止します。test adapterとfake providerでJSON／raw binary／HEADのsemantic parityを検証します。

requestのaffine `binary-body`はnamed snapshotへ暗黙変換せず、明示import operationが定義されるまで既存`respond-binary`と別型のまま維持します。text／base64 fallbackは行いません。

## Asset Manager ResourceCapability adapter

`createAssetManagerNamedBodyProvider(resources)`は、既存の公開`ResourceCapability`だけを使用し、Asset Manager extensionのprivate fieldやIndexedDB／OPFS layoutを読みません。`asset-manager` namespaceの`asset`／`binary` kindと`raw` representationだけを受理します。project scopeはglobal resource namespace（既定`routeName = ""`）、target scopeはruntimeの`targetId`へ写像します。

`HEAD`は`listResources`が利用可能ならmetadataだけを参照し、`GET`は`getResource`が返したbytesをcopyしてsnapshotを分離します。未公開namespaceはnot foundとして扱い、kind／representation不一致とabortは共通のstable errorへ変換します。このadapterはNode runtime向けであり、生成targetが`named-body-provider` capabilityを宣言する根拠にはしません。

## ロールバック

compiler flagがOFFの場合は`TW2_NAMED_RESPONSE_BODY_DISABLED`で生成前に拒否します。runtimeの`namedResponseBody=false`ではproviderを参照せず501 `NAMED_RESPONSE_BODY_DISABLED`を返します。既存`respond`／`respond-binary`、IR v1、browser runtime、cloud objectは変更・削除しません。問題時は新しい呼び出し経路だけを停止できます。
