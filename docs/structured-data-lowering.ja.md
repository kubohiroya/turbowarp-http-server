# Structured Data lowering

Deploy IR v2 frontendは、lockされた`@kubohiroya/turbowarp-structured-data` 0.11.0-rc.1（manifest format 2）の名前付きの値を、リクエスト内のIR stateと既存のjson nodeへ変換します。ここでは[Structured Data named values（設計）](structured-data-named-values.ja.md)の段階1（JSON）として実装した規則を説明します。Cloudflare Workers、Firebase等のSDKはこの層から参照しません。

## 対応する版

loweringは`STRUCTURED_DATA_PACKAGE_VERSIONS`（`src/compiler/structured-data/lowering.ts`）に列挙した、検証済みの正確な版だけを受け付けます。現在は`0.11.0-rc.1`だけです。

- manifestのregistry登録では、28個のserver対応blockすべてのsignatureが`KNOWN_SERVER_OPERATIONS`と完全に一致する必要があります。段階2・3のblockもsignatureは登録するので、manifest全体を読めます。
- 0.4.0のmanifest（JSON文字列を受け取り返すAPI）は同じoperation IDで引数が違うため、registryで`TW2_MANIFEST_OPERATION_MISMATCH`になります。0.4.0の意味論へのfallbackはしません。
- signatureが一致しても、一覧にない版をlockしたprojectは、Structured Dataのblockごとに`TW2_UNSUPPORTED_OPERATION`で止まります。

## Operation mapping（段階1）

| manifest operation | block | IR v2 |
| --- | --- | --- |
| `structuredData.parseJson` | `parseJson` | `named-value-set`（`structured-decode`、`schema: 'drop'`） |
| `structuredData.get` | `getJsonAtPath` | `json-stringify(json-get(named-value, PATH))` |
| `structuredData.getText` | `getTextAtPath` | `json-scalar-text(json-get(named-value, PATH))` |
| `structuredData.has` | `hasPath` | `json-has(named-value, PATH)` |
| `structuredData.keys` | `keysAtPath` | `json-stringify(json-keys(named-value, PATH))` |
| `structuredData.length` | `lengthAtPath` | `json-length(named-value, PATH)` |
| `structuredData.set` | `setJsonAtPath` | `named-value-set(json-set(named-value, PATH, VALUE), schema: 'keep')` |
| `structuredData.delete` | `deleteAtPath` | `named-value-set(json-delete(named-value, PATH), schema: 'keep')` |
| `structuredData.deleteData` | `deleteStructuredData` | `named-value-delete` |
| `structuredData.hasData` | `hasStructuredData` | `named-value-exists` |
| `structuredData.toJson` | `toJson` | `json-stringify(named-value)` |
| `structuredData.forEach` | `forEachAtPath` | `json-for-each`（root=`named-value`） |
| `structuredData.currentKey` | `currentKey` | `iteration-key` |
| `structuredData.currentIndex` | `currentIndex` | `iteration-index` |
| `structuredData.currentValue` | `currentValueJson` | `json-stringify(iteration-value)` |
| `structuredData.currentGet` | `currentJsonAtPath` | `json-stringify(json-get(iteration-value, PATH))` |
| `structuredData.currentGetText` | `currentTextAtPath` | `json-scalar-text(json-get(iteration-value, PATH))` |

frontendは、Structured DataのCOMMAND blockを`StructuredDataLoweringContext.lowerStatement`へ、reporterを`lowerReporter`へ、LOOP blockを`lowerForEach`へ渡します。

manifestで`pure`とされるreporterも保管場所の現在の値を読みます。IRはこれらを並べ替えたり、結果を使い回したりしません。coreはIRを書かれた順に解釈します。

### 段階2・3のoperation

次の11 operationは、使われたblockごとに`TW2_UNSUPPORTED_OPERATION`で止まります。messageには`until phase 2 (YAML)`または`until phase 3 (schema)`を含めます。類似の処理で近似することはしません。

- 段階2（YAML）: `parseYaml`、`toYaml`
- 段階3（schema）: `defineSchema`、`beginSchema`、`addSchemaProperty`、`commitSchema`、`deleteSchema`、`hasSchema`、`schemaOf`、`parseJsonWithSchema`、`parseYamlWithSchema`

`copyDocumentTree`はmanifestで`server.supported: false`なので、subset validatorが`TW2_UNSUPPORTED_OPERATION`で拒否します。

## 値の寿命と範囲

generated coreの`executeRoute`は、`handlerVariables`と並べてリクエスト内の保管場所`namedValues`（`Map`）を持ちます。リクエストの開始時は空で、終了時に破棄します。リクエストやworkerをまたいで共有しません。

- manifestの`lifetime: untilProjectStop`は、サーバーでは「リクエスト終了まで」と読み替えます。
- routeは1つのtargetのscriptから作られ、broadcastとcloneは拒否されるので、リクエストごとの保管場所がそのtargetの保管場所になります（`scope: target`）。
- リクエストをまたいで値を残すには、`to JSON [NAME]`の結果を`kvs.setText`に渡し、`kvs.getText`の結果を`parse JSON [TEXT] as [NAME]`に渡します。

`named-value-set`の`schema`は、`drop`がschema参照を外し、`keep`が残します。段階1ではschema参照を付ける操作がないので、どちらも値だけを置き換えます。fieldは段階3でshapeを変えないために持ちます。

## 名前

NAMEには任意の式を使えます。coreはScratchの`Cast.toString`（`String(value)`）で文字列にし、前後の空白を除きます。空なら`INVALID_NAME`、値がなければ`DATA_NOT_FOUND`です。`has data`も空の名前を`INVALID_NAME`にします。

空白だけ、または空のliteralはcompile時に`TW2_STRUCTURED_INVALID_NAME`（`sourceRef.input`は`NAME`）です。IR validatorは、名前の式がScratchのscalar（string、number、boolean、`json-text`）であることを確かめます。

## 評価の順序

coreは`named-value-set`で値を先に評価し、名前をその後に評価します。ブラウザの順序とは次のように対応します。

- `parse JSON`はTEXTを解析してからNAMEを確かめます。そのため`INVALID_JSON`と`PARSE_LIMIT_EXCEEDED`が`INVALID_NAME`より先です。
- `set`はNAME、値の有無、VALUEの解析、pathの更新の順です。`set`と`delete`の値は`named-value`を含むので、値を先に評価しても`INVALID_NAME`と`DATA_NOT_FOUND`が先に出ます。

`set`と`delete`では、名前の式を`named-value`と`named-value-set`で2回評価します。IRの式は副作用を持たないので、どちらも同じ名前になります。例外はKVSの読み出しを名前に使い、2回の評価の間に別のリクエストがその値を書き換えた場合です。

## JSONの解析

`parse JSON`のTEXTは、`@kubohiroya/turbowarp-yaml-json`のcodecと同じ上限と順序で解析します（`structured-decode`、`decodeStructuredJson`）。

1. UTF-8のbyte数（`TextEncoder`の数え方で、lone surrogateはU+FFFDの3 byte）が262,144を超えれば`PARSE_LIMIT_EXCEEDED`
2. `JSON.parse`が失敗すれば`INVALID_JSON`
3. 深さ優先に値をたどり、深さ（rootが0、子は1深い）が64を超えるか、値の数（object keyは数えない）が50,000を超えれば`PARSE_LIMIT_EXCEEDED`。たどる途中で有限でない数（`1e999`等）に会えば`INVALID_JSON`

codecはjsonc-parserで構文を確かめてから`JSON.parse`で値を作るので、受け付ける構文は`JSON.parse`と同じです。重複keyは最後の値になり、`"__proto__"`は普通のkeyとして残ります。

literalのTEXTはcompile時に同じ規則で解析してtyped literalにします。不正または上限超過のliteralは`TW2_STRUCTURED_INVALID_LITERAL`で止まります。

`set`のVALUEは、ブラウザが`JSON.parse`するだけなので上限を設けません。literalはcompile時に解析し、不正なら`TW2_STRUCTURED_INVALID_LITERAL`です。動的なVALUEは`json-text-coerce`と`json-parse`で解析します。動的なVALUEはstringまたは`json-text`の式に限り、それ以外は`TW2_STRUCTURED_TYPE_MISMATCH`です。

## 出力

JSONを返すreporterは`json-stringify`で、object keyをUnicode code point順に並べたcompactなJSONを返します。codecの`serializeValue`（`keyOrder: 'unicode'`、`indent: 0`）と同じ文字列です。

textを返すreporterは`json-scalar-text`です。stringはそのまま、numberとbooleanはJSON表記を返し、null、array、objectは`TYPE_MISMATCH`です。

`json-text`はruntimeではstringです。IR validatorは、Scratchが値をstringにする位置（handler variableの名前と値、KVSのnamespace・key・値、response header、Structured Dataの名前とTEXT）で`json-text`を受け付けます。parse済みのJSON値が要る位置では受け付けません。`concat`は今もstring同士だけです。

## Path

grammar IDは`tw-structured-path@1`です。compiler自身が次のliteral grammarだけを解析し、manifestからparser codeを読み込みません。

- root `$`
- identifier key `.name`
- array index `[0]`
- JSON quoted key `["name.with.dots"]`

`["0"]`はkey、`[0]`はindexとして異なるtyped segmentになります。dynamic pathは`TW2_STRUCTURED_DYNAMIC_PATH`、不正literalは`TW2_STRUCTURED_INVALID_PATH`です。diagnosticの`sourceRef.input`には`PATH`等の入力名を保持します。

`has`がfalseを返すのは`PATH_NOT_FOUND`と`INDEX_OUT_OF_RANGE`のときだけです。`keys`はobjectだけ、`length`はarrayだけを受け付けます。`set`はroot置換、既存objectへのkey追加、既存array indexの置換だけを行い、中間containerの生成とappendはしません。`delete`はarray要素を左へ詰め、rootの削除はcompile時に`TW2_STRUCTURED_INVALID_PATH`で拒否します。すべての更新は新しい値を作り、それを名前に結び付け直します。

## Iteration

`forEach`の`MAX`は1以上1000以下のinteger literalだけを受理します（`TW2_STRUCTURED_INVALID_MAX`）。IR validatorでは通常loopと共通のnesting上限8とroute worst-case work上限10000も適用します。

`json-for-each`はroot（`named-value`）を1回だけ評価するので、ループ開始時の値を反復します。ブラウザもループ開始時に要素を写し取るので、本体での`set`、`delete`、`delete data`は反復に影響しません。

各loopはsource blockから決定的な`loopId`を作ります。current reporterは構文木上で最も内側のloopへ束縛され、nested loop終了後は外側へ戻ります。loop外の参照は`TW2_ITERATION_CONTEXT_REQUIRED`です。`current JSON at path`と`current text at path`は、ブラウザと同じくloopの有無をpathより先に確かめるので、loop外では不正なpathでもこのdiagnosticだけを返します。objectはUnicode code point順、arrayはindex順で反復します。

## 実行時error

runtime helperとgenerated coreは、次のcodeをHTTP status 422の`IrRuntimeError`として返します。responseは`{"error":{"code":"..."}}`だけで、名前、path、入力値を含めません。

- `INVALID_JSON`
- `INVALID_NAME`
- `DATA_NOT_FOUND`
- `INVALID_PATH`（malformed IR防御。正常なgenerated codeでは発生しない）
- `PATH_NOT_FOUND`
- `TYPE_MISMATCH`
- `INDEX_OUT_OF_RANGE`
- `ITERATION_LIMIT_EXCEEDED`
- `ITERATION_CONTEXT_REQUIRED`（adapter側防御用）
- `PARSE_LIMIT_EXCEEDED`

## compile時に止まるもの

ブラウザでは実行時のerrorになるもののうち、literalから結果が分かるものはcompile時に止めます。

| ブラウザのruntime code | サーバーのdiagnostic | 理由 |
| --- | --- | --- |
| `INVALID_PATH` | `TW2_STRUCTURED_INVALID_PATH` | PATHはliteralに限る |
| rootの`delete`による`INVALID_PATH` | `TW2_STRUCTURED_INVALID_PATH` | rootのpathはliteralで分かる |
| `ITERATION_CONTEXT_REQUIRED` | `TW2_ITERATION_CONTEXT_REQUIRED` | loopはIRで字句的に決まる |
| literalのNAMEによる`INVALID_NAME` | `TW2_STRUCTURED_INVALID_NAME` | 空のliteralは分かる |
| literalのTEXTによる`INVALID_JSON`、`PARSE_LIMIT_EXCEEDED` | `TW2_STRUCTURED_INVALID_LITERAL` | literalのTEXTはcompile時に解析する |
| literalのVALUEによる`INVALID_JSON` | `TW2_STRUCTURED_INVALID_LITERAL` | literalのVALUEはcompile時に解析する |
| 段階2・3のoperation | `TW2_UNSUPPORTED_OPERATION` | 段階1ではloweringしない |

動的なNAMEとTEXTは、ブラウザと同じruntime codeを返します。

## ブラウザとの既知の差

- 数千段の入れ子（Node 24の既定のstackでは8,000段）では、ブラウザのjsonc-parserが再帰の深さで`RangeError`を投げ、Structured Dataのerrorになりません。サーバーは上限どおり`PARSE_LIMIT_EXCEEDED`を返します。
- request bodyの先頭のBOMは、bodyをtextにする時点で取り除かれます。これは`current request body`の性質で、Structured Dataの解析自体はBOMを`INVALID_JSON`にします。

## 検証

- `tests/fixtures/structured-data/semantic-parity.json`は、turbowarp-structured-dataのcommit `6bbb908`（manifestFormatVersion 2）からbyte単位で取り込んだfixtureです。取り込み元とSHA-256は`semantic-parity.source.json`に記録しています。`tests/structured-data-parity.test.ts`は、`cases`と`readCases`をそれぞれ最小のTurboWarp projectにし、frontend、IR validator、generated coreを通して実行します。literalの入力と、request由来の入力の両方で実行します。
- `tests/structured-data-differential.test.ts`は、公開されたブラウザ版（devDependencyの`@kubohiroya/turbowarp-structured-data/bundle-module`）とサーバーに同じblock列を実行させ、結果または最初のerror codeが一致することを確かめます。error順、上限の境界、JSON構文の端、反復時の写し取りを含みます。
- `tests/compiler-manifest-artifacts.test.ts`は、installしたpackageのmanifestをregistryへ登録し、28個のserver operationがallowlistと一致することを確かめます。

## ロールバック

問題時は、Structured Dataのmanifest lockを使う生成を停止し、ブラウザまたはWebSocket bridgeで実行します。manifest versionが一致しないときはcompileを停止し、旧意味論へfallbackしません。
