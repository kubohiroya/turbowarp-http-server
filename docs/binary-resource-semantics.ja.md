# Binary resource semantics

Deploy IR v2はbinary payloadをJSON文字列やbase64として保持せず、永続objectを示す`binary-ref`と、実行時streamを示すaffine `binary-body`を区別します。この層はCloudflare R2、Firebase Cloud Storage、Node filesystem等の製品型を参照しません。

## 値とresource

`binary-ref`はIR JSONへ格納できるlogical descriptorです。

```json
{
  "namespace": "asset",
  "key": "images/hero.png",
  "contentType": "image/png",
  "size": 1234,
  "integrity": "sha256:<lowercase-hex-64>",
  "revision": "opaque-adapter-token"
}
```

`namespace`は64文字以下のlogical ID、`key`は512文字以下です。absolute path、backslash、空segment、`.`／`..` segment、NULを拒否します。`revision`はintegrityや共通ETagではなく、adapterだけが解釈するopaque tokenです。

`binary-body`はIR JSONへ本体を格納しないresource bindingです。producerがbinding IDを宣言し、putまたはbinary responseが最大1回consumeします。clone、tee、base64化、同じbodyの保存とresponseへの併用はMVP対象外です。分岐後に利用するbodyは全continuing branchで同じ所有状態でなければならず、複数回実行し得るloopから外側bodyをconsumeできません。

## IR operation

| statement | producer／consumer | requirement |
| --- | --- | --- |
| `asset-resolve` | locatorから`binary-ref \| null` valueを生成 | `object-storage` |
| `request-body-binary` | request streamから`binary-body`を生成 | `streaming-body` |
| `asset-object-get` | `binary-ref`から`binary-body`を生成 | `object-storage`, `streaming-body` |
| `asset-object-put` | `binary-body`をconsumeし`binary-ref`を生成 | `object-storage` |
| `asset-object-delete` | refまたはlocatorをidempotentに削除しbooleanを生成 | `object-storage` |
| `respond-binary` | `binary-body`をconsumeしてresponseを完了 | `streaming-body` |

producer／consumer集合は閉じており、未知statementがresource bindingを生成・複製・消費できません。`respond-binary`は通常の`respond`と同じterminal responseです。

## Size policy

compiler policyの既定`maxBinaryBytes`は16 MiB（16777216 bytes）です。request、get、putは1以上policy以下のliteral `maxBytes`を必須とします。実行時のeffective limitは次です。

```text
min(operation maxBytes, compiler maxBinaryBytes, target maxBinaryBytes)
```

既知のsizeが上限を超える場合はstream開始前に拒否します。sizeがない、または信用できない場合もchunkごとにcountし、超過時にiteratorをcancelして`BINARY_TOO_LARGE`とします。production adapter contractはstreamingを許し、bufferを要求しません。test用`InMemoryBinaryObjectStore`だけが決定的なfixture比較のためbufferします。

## Metadataとresponse

- `contentType`: CR／LFを含まないmedia type
- `size`: 0以上のsafe integer
- `integrity`: `sha256:<lowercase-hex-64>`
- `revision`: 1〜256文字のopaque token
- attachment filename: metadataとは別のresponse dispositionで指定し、RFC 5987形式へencode

入力metadataのsize／integrityが実データと一致しない場合は保存しません。binary byte列、locator、platform errorはdiagnosticやHTTP error responseへ含めません。

## Runtime errors

| code | HTTP status |
| --- | ---: |
| `BINARY_INVALID_REF` | 422 |
| `BINARY_NOT_FOUND` | 404 |
| `BINARY_TOO_LARGE` | 413 |
| `BINARY_INTEGRITY_MISMATCH` | 502 |
| `BINARY_BODY_CONSUMED` | 500 |
| `BINARY_STORAGE_FAILURE` | 502 |

HTTP JSON envelope化とstream開始後のabort処理はcompiler pipeline／adapter error boundaryの責務です。

## Asset Manager manifest境界

対応syntaxの正本は`@kubohiroya/turbowarp-asset-manager` 0.16.0のmanifest format 1です。このmanifestはopcode／argument構文だけを提供し、server operation hintを持ちません。`registerAsset`はURL、costume、sound、runtime text等をまとめるbrowser registry操作であり、object storage putへ近似しません。`isLoaded`、renderer、audio、IndexedDB cache blockも同様にbrowser-onlyとして`TW2_UNSUPPORTED_OPERATION`になります。

したがって現時点のAsset Manager manifestからbinary IR actionへloweringされるopcodeはありません。将来manifestにcompiler allowlistと一致するserver hint／専用blockが追加された場合だけ対応します。request uploadは対応source opcodeがないためdirect IRからのみ生成できます。この境界により、browser意味論を推測してcloud storageへ誤変換しません。

## Adapter contract

`BinaryObjectStore`は`resolve/get/put/delete`をlogical locatorとstreamで提供します。getの未存在は`null`、deleteの未存在は`false`、storage failureは例外として区別します。targetは`object-storage`、`streaming-body`、最大byte数をcapability planで宣言します。IRやfrontendを変更せず別adapterを追加できます。

Cloudflare R2／D1とFirebase Cloud Storage／Firestoreへの具体的なmapping、key prefix、設定、整合性、smoke test方針は[IR v2 platform storage adapter](platform-storage-adapters.ja.md)を参照してください。

## ロールバック

`compilerIrV2=false`またはIR v1ではbinary resource statementを使用しません。rollbackは生成処理を停止するだけで、既存cloud objectやbrowser側Asset Manager dataを自動削除しません。
