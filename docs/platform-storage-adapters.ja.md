# IR v2 platform storage adapter

Deploy IR v2のstorageは製品名ではなく、`key-value-store`、`record-store`、`object-storage`、`streaming-body` capabilityで表します。同じIRを`cloudflare-workers`または`firebase-functions`へcompileし、共有Hono coreはplatform SDKを参照しません。

## 現在の変換境界

`@kubohiroya/turbowarp-kvs` 0.1.0のmanifest format 2でserver対応と宣言された`setValue`、`getValue`、`hasKey`、`deleteKey`、`listKeys`だけを`kvs-*` IRへloweringします。lockされたpackage名、version、opcode、引数順、型、effect、immutable属性がcompiler allowlistと完全一致しない場合はcompileを停止します。

`@kubohiroya/turbowarp-asset-cache` 0.1.0はbrowser内のasset registry／cacheとして扱い、`registerAsset`、`isLoaded`、renderer、audio、IndexedDB cache操作をKVSへ推測変換しません。binary storageは[Binary resource semantics](binary-resource-semantics.ja.md)のdirect IRから利用できます。Structured DataのJSON値は[Structured Data lowering](structured-data-lowering.ja.md)を経てroute内で処理します。

## 論理操作と実装

| 論理責務 | Cloudflare Workers | Firebase Functions |
| --- | --- | --- |
| HTTP runtime | Hono Fetch handler | HTTPS `onRequest` + Hono Node listener |
| `key-value-store` | D1 `kvs` table | Firestore KVS collection |
| `record-store` | D1 `records` table | Firestore root collection |
| `object-storage` | R2 bucket | Cloud Storage bucket |
| object revision | R2 upload version + ETag + upload時刻のopaque token | Cloud Storage generation |
| binary integrity | 指定されたSHA-256をR2で検証しmetadataへ保持 | stream中にSHA-256を計算・検証してmetadataへ保持 |
| local boundary | Wrangler local runtime | Firebase Emulator Suite |

KVS text contractはnamespace/key単位のset/get/has/delete/listです。getの未存在は空文字、hasはfalse、deleteは副作用なし、listはkeyの昇順JSON配列を返します。namespaceとkeyはNFC正規化し、namespaceは`^[a-z][a-z0-9.-]{0,63}$`、keyは1〜512文字でNULおよび`.`／`..` path segmentを拒否します。listはブラウザ版と同じ全件契約であり、adapterが黙って件数を切り詰めません。bounded listing／paginationは新しいblockとIR operationで追加します。

現在の`record-store`はcreate/list/get/deleteの単一record CRUDです。複数record transaction、counter、object listing、cursor pagination、cacheはIRに存在せず、adapterが暗黙に追加しません。record listは生成core contractに従い最大100件です。

Cloudflare adapterのbinary上限はcompiler既定と同じ16 MiBです。Firebase 2nd genはHTTP requestを最大32 MBまで受け取れますが、streaming responseは10 MBのため、同じIRを安全に実行できるtarget上限を10,000,000 bytesに固定します。operationの`maxBytes`がtarget上限を超える場合は`TW2_TARGET_BINARY_LIMIT_EXCEEDED`でcompileを停止します。([Cloud Functions quotas](https://firebase.google.com/docs/functions/quotas))

TurboWarp KVSの名前は論理APIを表し、Cloudflare KV製品を指定しません。Cloudflare KVはeventual-consistencyを許容できるalias/cache用途の将来候補ですが、現在のread-after-write KVS／object／record操作には使用しません。CloudflareではKVSをD1へ写像します。eventual consistencyを許容する別contractを追加するときは新しいIR capabilityとして定義し、既存KVS操作から推測しません。

## keyとmetadataの共通規則

objectの物理keyは両targetで次の形式です。

```text
v1/<namespace>/<key>
```

- `namespace`は小文字英字で始まり、小文字英数字・`.`・`-`だけを使う64文字以下のlogical IDです。
- `key`はrelative pathで、absolute path、backslash、空segment、`.`、`..`を拒否します。
- user inputをbucket名、Firestore collection名、binding名へ直接展開しません。
- binaryはbase64化してD1、Firestore、KVへ格納しません。
- `contentType`はCR／LFを拒否し、`integrity`は`sha256:<lowercase-hex-64>`だけを受理します。
- `revision`はadapter固有のopaque tokenで、target間で同じ値になることを保証しません。

metadata envelopeのversionは物理key prefixの`v1`で固定します。Cloudflareは入力にintegrityがある場合だけ`twIntegrity`へ保持し、R2のSHA-256検証を利用します。R2の文書化された`BadDigest (10037)`だけをintegrity不一致へ変換し、その他のSDK例外はstorage failureとして扱います。Firebaseはupload streamを一時objectへ書きながらincremental hashし、size／integrity検証後にだけdestinationへcopyします。計算したintegrityは`twIntegrity`へ保持します。共通coreが依存できるのはlogical descriptorだけで、R2 ETagやCloud Storage SDK objectを外へ公開しません。([R2 error codes](https://developers.cloudflare.com/r2/api/error-codes/))

## target config

target configはsecretを受け取らず、生成コードの識別子だけを設定します。

```json
{
  "recordDatabaseBinding": "DB",
  "objectBucketBinding": "OBJECTS"
}
```

CloudflareではD1／R2 binding名を大文字identifierとして受け取り、同じ名前は拒否します。実database IDやcredentialは`wrangler.jsonc`のplaceholderとdeployment環境で設定します。

```json
{
  "functionName": "api",
  "keyValueCollection": "key_values",
  "objectBucketEnv": "ASSET_BUCKET",
  "recordCollection": "records"
}
```

Firebaseではfunction export名、bucket名を読む環境変数名、KVS用およびrecord用Firestore collection名だけを受け取ります。project ID、service account、credential、bucket名そのものはtarget configへ書きません。未定義の`ASSET_BUCKET`はAdmin SDKのdefault bucketを選びます。

未知field、不正identifier、secretらしい設定は`TW2_TARGET_CONFIG_INVALID`です。adapterが満たせないcapabilityは`TW2_TARGET_CAPABILITY_UNSUPPORTED`とし、target、route、取得できる場合は`sourceRef`、理由、代替案を返します。

## access policyと整合性

KVSのD1実装は`(namespace, key)`複合主キーとupsertを使い、listをkey昇順にします。入力検証失敗は`KVS_NAMESPACE_INVALID`／`KVS_KEY_INVALID`、D1例外は`KVS_STORAGE_FAILURE`へ変換します。

R2のWorkers APIはobjectのhead/get/put/deleteとstreamを提供し、objectとlistingのstrong consistencyを保証します。revisionはuploadごとに一意なR2 `version`、ETag、upload時刻を組み合わせたopaque tokenです。revision付きdeleteは事前に`version`を照合し、R2が原子的条件として提供するETagとupload時刻を使ったPUTでzero-byte tombstoneへ置換します。`version`自体はR2の条件付きPUTへ指定できないため、保証はR2の同一key書き込み制限とETag／upload時刻の識別性に依存します。revisionなしlocator deleteは条件不一致時に再解決して最大8回まで再試行しますが、rate limitなどR2が例外を返した場合はstorage failureです。resolve/getはtombstoneをnot foundとして扱います。D1とR2をまたぐ原子的transactionは提供しません。custom domain cacheを経由する場合の整合性はこのbinding contractの対象外です。([R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/), [R2 limits](https://developers.cloudflare.com/r2/platform/limits/))

Firebase生成handlerはAdmin SDKと実行service accountのIAMでFirestore／Cloud Storageへaccessします。KVS document IDは正規化済みnamespace/keyのSHA-256で、元のnamespace/keyもquery fieldとして保存します。deleteの存在判定と削除はFirestore transaction内で行い、namespace + key昇順list用composite indexを生成します。objectのreadはmetadataで確定したgenerationへstreamを固定し、copy完了時はAPI responseの`resource` metadataから宛先generationを取得します。revision付きdeleteと一時object cleanupにはgeneration preconditionを使用します。生成するFirestore RulesとStorage Rulesはbrowser clientのread/writeを既定で全拒否し、Admin SDKの認可境界とは混同しません。record collection + `createdAt` queryに必要なcomposite indexも生成します。([Admin SDK setup](https://firebase.google.com/docs/admin/setup), [Cloud Storage Admin](https://firebase.google.com/docs/storage/admin/start), [Firestore data](https://firebase.google.com/docs/firestore/manage-data/add-data))

## 検証とsmoke test

通常CIでは同じfixtureを両targetへ決定的に生成し、全生成TypeScriptをtypecheckします。cloud account、課金resource、credentialは使用しません。

外部runtime smoke testは独立jobとして次を確認します。

1. Wrangler local resourceまたはFirebase Emulator Suiteを起動する。
2. KVS set/get/has/delete/listとread-after-writeを実行する。
3. record create/list/get/deleteを実行する。
4. binary put/resolve/get/delete、content type、size、SHA-256、revision不一致を確認する。
5. path traversal、size超過、integrity不一致がstable errorになることを確認する。
6. emulator failureは可視化し、core／target conformance testをskipしない。

## ロールバックとcleanup

targetは明示的な`--target ...`でだけ選択されます。問題のあるtargetへの生成・deployを停止し、browser bridgeへ戻せます。生成はdeployやresource作成・削除を行いません。

deploymentをrollbackまたは停止してから、必要なD1／R2／Firestore／Cloud Storage dataをexportし、binding、IAM、依存functionを確認します。cloud resourceはgenerated READMEの手順に従い手動でcleanupし、generatorから自動削除しません。
