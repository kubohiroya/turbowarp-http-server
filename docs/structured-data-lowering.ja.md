# Structured Data lowering

Deploy IR v2 frontendは、lockされた`@kubohiroya/turbowarp-structured-data` 0.4.0／manifest format 2のserver operationを、platform-neutralなIRとruntime helperへ変換します。Cloudflare Workers、Firebase等のSDKはこの層から参照しません。

この機能は`compilerIrV2=true`かつmanifest lockのversion・integrity・signature検証が成功した場合だけ利用します。未対応versionやoperationを類似処理へfallbackしません。

## Operation mapping

| manifest operation | IR v2 |
| --- | --- |
| `structuredData.normalizeJson` | parse済みJSON + `json-stringify` |
| `structuredData.isValidJson` | `json-is-valid` |
| `structuredData.get` | `json-get` + `json-stringify` |
| `structuredData.has` | `json-has` |
| `structuredData.set` | `json-set` + `json-stringify` |
| `structuredData.delete` | `json-delete` + `json-stringify` |
| `structuredData.keys` | `json-keys` + `json-stringify` |
| `structuredData.length` | `json-length` |
| `structuredData.forEach` | bounded `json-for-each` |
| `structuredData.currentKey` | lexical `iteration-key` |
| `structuredData.currentIndex` | lexical `iteration-index` |
| `structuredData.currentValue` | lexical `iteration-value` + `json-stringify` |

TurboWarp blockのJSON入出力は実体がstringのnominal `json-text`です。動的な通常string入力には`json-text-coerce`を置き、その後`json-parse`で内部`JsonValue`へ変換します。JSON literalはcompile時に検証してtyped literalへfoldします。既知の不正literalは`TW2_STRUCTURED_INVALID_LITERAL`で停止し、動的入力の失敗だけをruntime `INVALID_JSON`にします。reporterがJSONを返す場合は`json-stringify`で`json-text`へ戻します。

## Path

MVPのgrammar IDは`tw-structured-path@1`です。compiler自身が次のliteral grammarだけを解析し、manifestからparser codeを読み込みません。

- root `$`
- identifier key `.name`
- array index `[0]`
- JSON quoted key `["name.with.dots"]`

`["0"]`はkey、`[0]`はindexとして異なるtyped segmentになります。dynamic pathは`TW2_STRUCTURED_DYNAMIC_PATH`、不正literalは`TW2_STRUCTURED_INVALID_PATH`です。diagnosticの`sourceRef.input`には`PATH`等の入力名を保持します。

`set`はroot置換、既存objectへのkey追加、既存array indexの置換だけを行います。中間container生成、sparse array、appendは行いません。`delete`はrootをcompile時に拒否し、array要素削除時は後続要素を左へ詰めます。すべての更新は入力を変更せず、新しいJSON値を返します。

## Iteration

`forEach`の`MAX`は1以上1000以下のinteger literalだけを受理します。IR validatorでは通常loopと共通のnesting上限8とroute worst-case work上限10000も適用します。

各loopはsource blockから決定的な`loopId`を作ります。current key／index／valueは構文木上で最も内側のactive `json-for-each`へ束縛され、nested loop終了後は外側contextへ戻ります。loop外またはscope終了後の参照は`TW2_ITERATION_CONTEXT_REQUIRED`です。objectはUnicode code point順、arrayはindex順で反復します。

## Runtime errors

runtime helperは次のcodeを持つ`IrRuntimeError`をHTTP status 422として送出します。

- `INVALID_JSON`
- `INVALID_PATH`（malformed IR防御。正常なgenerated codeでは発生しない）
- `PATH_NOT_FOUND`
- `TYPE_MISMATCH`
- `INDEX_OUT_OF_RANGE`
- `ITERATION_LIMIT_EXCEEDED`
- `ITERATION_CONTEXT_REQUIRED`（adapter側防御用）

helperのmessageに入力JSON、path、keyを埋め込みません。HTTP responseへの安定したerror envelope化はadapter error boundaryの責務です。

application JSONのobject keyはUnicode code point順に再帰的にserializeします。IR documentのcanonical serialization規則とは別であり、platform native object／mapの順序には依存しません。

## ロールバック

`compilerIrV2=false`またはIR v1を選択すると、このloweringとruntime nodeを使用しません。manifest version不一致時はcompileを停止し、旧意味論へfallbackしません。
