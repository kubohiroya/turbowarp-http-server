# IR v2 platform storage adapter

Deploy IR v2のstorageは製品名ではなく、`record-store`、`object-storage`、`streaming-body` capabilityで表します。同じIRを`cloudflare-workers`または`firebase-functions`へcompileし、共有Hono coreはplatform SDKを参照しません。

## 現在の変換境界

`@kubohiroya/turbowarp-asset-manager` 0.16.0のblock API manifest format 1にはserver operation hintがありません。`registerAsset`、runtime text、IndexedDB cache、renderer、audio等のbrowser操作をstorage CRUDへ推測変換すると元の意味を変えるため、現時点では`TW2_UNSUPPORTED_OPERATION`にします。

binary storageは[Binary resource semantics](binary-resource-semantics.ja.md)のdirect IRから利用できます。Structured DataのJSON値は[Structured Data lowering](structured-data-lowering.ja.md)を経てroute内で処理し、永続化が必要な場合は`record-store` statementを使用します。旧#19案の`asset-get-text`／`asset-put-text`／`asset-list`は現行IRのoperationではなく、Asset Manager manifestへ明示的なserver hintが追加されるまで実装しません。

## 論理操作と実装

| 論理責務 | Cloudflare Workers | Firebase Functions |
| --- | --- | --- |
| HTTP runtime | Hono Fetch handler | HTTPS `onRequest` + Hono Node listener |
| `record-store` | D1 `records` table | Firestore root collection |
| `object-storage` | R2 bucket | Cloud Storage bucket |
| object revision | R2 ETag | Cloud Storage generation |
| binary integrity | 指定されたSHA-256をR2で検証しmetadataへ保持 | stream中にSHA-256を計算・検証してmetadataへ保持 |
| local boundary | Wrangler local runtime | Firebase Emulator Suite |

現在の`record-store`はcreate/list/get/deleteの単一record CRUDです。複数record transaction、counter、object listing、cursor pagination、cacheはIRに存在せず、adapterが暗黙に追加しません。listは生成core contractに従い最大100件です。

Cloudflare adapterのbinary上限はcompiler既定と同じ16 MiBです。Firebase 2nd genはHTTP requestを最大32 MBまで受け取れますが、streaming responseは10 MBのため、同じIRを安全に実行できるtarget上限を10,000,000 bytesに固定します。operationの`maxBytes`がtarget上限を超える場合は`TW2_TARGET_BINARY_LIMIT_EXCEEDED`でcompileを停止します。([Cloud Functions quotas](https://firebase.google.com/docs/functions/quotas))

Cloudflare KVはeventual-consistencyを許容できるalias/cache用途の将来候補ですが、現在のread-after-write object／record操作には使用しません。このためCloudflare生成物はD1とR2だけを要求します。KVを追加するときは`metadata-key-value`やconsistency policyを新しいIR capabilityとして定義し、D1/R2操作から推測しないものとします。

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
  "objectBucketEnv": "ASSET_BUCKET",
  "recordCollection": "records"
}
```

Firebaseではfunction export名、bucket名を読む環境変数名、Firestore root collection名だけを受け取ります。project ID、service account、credential、bucket名そのものはtarget configへ書きません。未定義の`ASSET_BUCKET`はAdmin SDKのdefault bucketを選びます。

未知field、不正identifier、secretらしい設定は`TW2_TARGET_CONFIG_INVALID`です。adapterが満たせないcapabilityは`TW2_TARGET_CAPABILITY_UNSUPPORTED`とし、target、route、取得できる場合は`sourceRef`、理由、代替案を返します。

## access policyと整合性

R2のWorkers APIはobjectのhead/get/put/deleteとstreamを提供し、objectとlistingのstrong consistencyを保証します。revisionはuploadごとに一意なR2 `version`、ETag、upload時刻を組み合わせたopaque tokenです。deleteはETagとupload時刻の条件付きPUTでzero-byte tombstoneへ置換し、事前に一意な`version`も照合することで、同じETagを持つ後続uploadを古いrevisionで削除しません。revisionなしlocator deleteはheadで得た条件へのPUTを行い、同時writeが先行した場合は再解決して最大8回まで再試行します。resolve/getはtombstoneをnot foundとして扱います。D1とR2をまたぐ原子的transactionは提供しません。custom domain cacheを経由する場合の整合性はこのbinding contractの対象外です。([R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/))

Firebase生成handlerはAdmin SDKと実行service accountのIAMでFirestore／Cloud Storageへaccessします。objectのreadはmetadataで確定したgenerationへstreamを固定し、copy完了時はAPI responseの`resource` metadataから宛先generationを取得します。revision付きdeleteと一時object cleanupにはgeneration preconditionを使用します。生成するFirestore RulesとStorage Rulesはbrowser clientのread/writeを既定で全拒否し、Admin SDKの認可境界とは混同しません。Firestoreのcollection + `createdAt` queryに必要なcomposite indexも生成します。([Admin SDK setup](https://firebase.google.com/docs/admin/setup), [Cloud Storage Admin](https://firebase.google.com/docs/storage/admin/start), [Firestore data](https://firebase.google.com/docs/firestore/manage-data/add-data))

## 検証とsmoke test

通常CIでは同じfixtureを両targetへ決定的に生成し、全生成TypeScriptをtypecheckします。cloud account、課金resource、credentialは使用しません。

外部runtime smoke testは独立jobとして次を確認します。

1. Wrangler local resourceまたはFirebase Emulator Suiteを起動する。
2. record create/list/get/deleteを実行する。
3. binary put/resolve/get/delete、content type、size、SHA-256、revision不一致を確認する。
4. path traversal、size超過、integrity不一致がstable errorになることを確認する。
5. emulator failureは可視化し、core／target conformance testをskipしない。

## ロールバックとcleanup

IR v2は明示的な`--ir-version 2 --target ...`でだけ選択されます。問題のあるtargetを選択せず、`compilerIrV2=false`または既存IR v1／browser bridgeへ戻せます。生成はdeployやresource作成・削除を行いません。

deploymentをrollbackまたは停止してから、必要なD1／R2／Firestore／Cloud Storage dataをexportし、binding、IAM、依存functionを確認します。cloud resourceはgenerated READMEの手順に従い手動でcleanupし、generatorから自動削除しません。
