# Structured Data named values（設計）

`@kubohiroya/turbowarp-structured-data` 0.11の名前付きの値（target-local named data）を、Deploy IR v2でサーバー実行できるようにするための設計です。「決定事項」の6点は推奨案で合意済みで、実装は段階1から進めます。現行の0.4.0向けの規則は[Structured Data lowering](structured-data-lowering.ja.md)にあり、実装と同時に置き換えます。

## 現状

compilerは0.4.0の、JSON文字列を引数で受け取りJSON文字列を返すAPIに固定されています（`src/compiler/structured-data/lowering.ts`の`STRUCTURED_DATA_PACKAGE_VERSION = '0.4.0'`）。0.11では、`parse JSON`で値に名前を付け、以後は名前とpathで読み書きします。

0.11の`dist/extension-manifest.json`（format version 2）はmanifest readerで読めますが、`buildCompilerOpcodeRegistry`が最初のblockで`TW2_MANIFEST_OPERATION_MISMATCH`（`structuredData.addSchemaProperty`がallowlistにない）を返します。0.11を使うprojectはサーバーでは1つもcompileできません。

サーバー実行に対応した28 operationと`KNOWN_SERVER_OPERATIONS`の照合結果です。

| 結果 | 件数 | operation |
| --- | --- | --- |
| 一致 | 2 | `currentIndex`、`currentKey` |
| signature不一致 | 8 | `currentValue`、`get`、`has`、`keys`、`length`、`forEach`（`JSON`→`NAME`）、`set`、`delete`（REPORTER→COMMAND、`effect: state`） |
| allowlistにない | 18 | `getText`、`currentGet`、`currentGetText`、`parseJson`、`parseYaml`、`toJson`、`toYaml`、`deleteData`、`hasData`、schema系9件 |
| allowlistだけにある | 2 | `isValidJson`、`normalizeJson`（0.11にない） |

manifest側の語彙（`effect: state`、`resultType: jsonText`／`yamlText`、`dataReferenceType`）はreaderがすでに受け付けます。不足しているのはallowlist、lowering、IR、generated coreです。また、frontendはmanifestのCOMMAND blockをKVSにしか渡さず、Structured Dataのcommandは`TW2_UNSUPPORTED_COMMAND`になります。

## 値の寿命と範囲

名前付きの値は1回のroute実行（1リクエスト）の間だけ保持します。リクエストの開始時は空で、終了時に破棄します。

- ブラウザでは値はtargetごとに保持され、project停止（`PROJECT_STOP_ALL`）で消えます。サーバーにはgreen flagも停止もなく、1リクエストが1回のproject実行に当たります。manifestの`lifetime: untilProjectStop`は、サーバーでは「リクエスト終了まで」と読み替えます。
- Scratchの変数とリストは「lifetimeがリクエストとworkerをまたいで共有される」ため`TW2_GLOBAL_STATE_UNSUPPORTED`で拒否しています。名前付きの値も同じ理由で、リクエストをまたいで保持しません。
- routeは1つのtargetのscriptから作られ、broadcast（`TW2_MESSAGE_UNSUPPORTED`）とclone（`TW2_CLONE_UNSUPPORTED`）は拒否されます。そのため、リクエストごとの保管場所は、そのままそのtargetの保管場所になります（`scope: target`を満たします）。
- リクエストをまたいで値を残すには、KVSを使います（`to JSON [NAME]`の結果を`kvs.setText`に渡し、`kvs.getText`の結果を`parse JSON [TEXT] as [NAME]`に渡す）。

## 名前

名前には動的な式を使えます。ブラウザと同じく`Cast.toString`してから前後の空白を除き、空なら`INVALID_NAME`です。literalの名前はcompile時に検査し、空のliteralは診断にします。

名前をliteralに限定すれば保管場所を静的に割り当てられますが、handler variableが動的な名前を許していること、分岐をまたぐ読み書きの静的検査で得られるものが小さいことから採りません。

## 段階

| 段階 | operation | 件数 |
| --- | --- | --- |
| 1. JSON | `parseJson`、`get`、`getText`、`has`、`keys`、`length`、`set`、`delete`、`deleteData`、`hasData`、`toJson`、`forEach`、`currentKey`、`currentIndex`、`currentValue`、`currentGet`、`currentGetText` | 17 |
| 2. YAML | `parseYaml`、`toYaml` | 2 |
| 3. schema | `defineSchema`、`beginSchema`、`addSchemaProperty`、`commitSchema`、`deleteSchema`、`hasSchema`、`schemaOf`、`parseJsonWithSchema`、`parseYamlWithSchema` | 9 |

段階1で28 operationすべてのsignatureをallowlistに入れ、manifestを登録できるようにします。まだloweringしないoperationは、使われたblockごとに`TW2_UNSUPPORTED_OPERATION`で停止します。類似処理へのfallbackはしません。

## IR v2の追加

generated coreの`executeRoute`に、`handlerVariables`と並べてリクエスト内の保管場所を置きます。

```ts
const namedValues = new Map<string, {value: JsonValue; schemaRef?: {id: string; version: string}}>();
```

既存のjson nodeは、rootに任意のJSON式を取り、更新は新しい値を返すimmutableな式です。名前付きの値は、この既存nodeの前後に読み出しと書き込みを足すだけで表せます。

| 種類 | node | 型・意味 |
| --- | --- | --- |
| 式 | `named-value {name}` | JSON値。名前が空なら`INVALID_NAME`、なければ`DATA_NOT_FOUND` |
| 式 | `named-value-exists {name}` | boolean |
| 式 | `structured-decode {format: 'json', text}` | JSON値。codecと同じ上限（UTF-8で256 KiB、深さ64、値50,000個）を適用する |
| 式 | `json-scalar-text {value}` | string。stringはそのまま、numberとbooleanはJSON表記、null・array・objectは`TYPE_MISMATCH` |
| 文 | `named-value-set {name, value, schema: 'drop' \| 'keep'}` | 値を結び付ける。`drop`はschema参照を外し、`keep`は残す |
| 文 | `named-value-delete {name}` | 値を外す。なければ`DATA_NOT_FOUND` |

段階2で`structured-decode`に`format: 'yaml'`と`yaml-stringify`を、段階3でschema用のnodeと`schema: {id, version}`を足します。

### Operation mapping（段階1）

| manifest operation | IR v2 |
| --- | --- |
| `structuredData.parseJson` | `named-value-set`（`structured-decode`、`schema: 'drop'`） |
| `structuredData.get` | `json-stringify(json-get(named-value, PATH))` |
| `structuredData.getText` | `json-scalar-text(json-get(named-value, PATH))` |
| `structuredData.has` | `json-has(named-value, PATH)` |
| `structuredData.keys` | `json-stringify(json-keys(named-value, PATH))` |
| `structuredData.length` | `json-length(named-value, PATH)` |
| `structuredData.set` | `named-value-set(json-set(named-value, PATH, json-parse(VALUE)), schema: 'keep')` |
| `structuredData.delete` | `named-value-set(json-delete(named-value, PATH), schema: 'keep')` |
| `structuredData.deleteData` | `named-value-delete` |
| `structuredData.hasData` | `named-value-exists` |
| `structuredData.toJson` | `json-stringify(named-value)` |
| `structuredData.forEach` | `json-for-each`（root=`named-value`） |
| `structuredData.currentKey`／`currentIndex`／`currentValue` | 既存の`iteration-key`／`iteration-index`／`iteration-value` |
| `structuredData.currentGet` | `json-stringify(json-get(iteration-value, PATH))` |
| `structuredData.currentGetText` | `json-scalar-text(json-get(iteration-value, PATH))` |

既存helperの意味論は0.11と一致しています。

- path grammarは`$`、`.ident`、`["..."]`、`[n]`です。
- `has`がfalseを返すのは`PATH_NOT_FOUND`と`INDEX_OUT_OF_RANGE`のときだけです。
- `keys`はobjectだけを受け付け、code point順に並べます。`length`はarrayだけを受け付けます。
- `set`は中間containerを作らず、appendもしません。`delete`はarray要素を左へ詰め、rootの削除はcompile時に拒否します。
- `stringifyApplicationJson`は、code point順のcompactなcanonical JSONを出力します。

PATHとMAXは今と同じくliteralに限ります（`TW2_STRUCTURED_DYNAMIC_PATH`、`TW2_STRUCTURED_INVALID_MAX`）。

`json-for-each`はrootを1回だけ評価するので、ループ開始時の値を反復します。これは、ブラウザがループ開始時に要素を写し取り、本体での変更が反復に影響しない動作と同じです。

frontendには、Structured DataのCOMMAND blockを`StructuredDataLoweringContext`へ渡す分岐を足します。manifestで`pure`とされるreporterも保管場所の現在の値を読むため、IRはこれらを並べ替えたり、結果を使い回したりしてはいけません。今のcoreはIRを書かれた順に解釈するため、この条件を満たします。

## 実行時error

14 codeすべてをHTTP 422の`IrRuntimeError`にします。responseにはcodeだけを入れ、名前、path、入力値は入れません（既存の規則と同じ）。段階1で新たに出るcodeは、`INVALID_NAME`、`DATA_NOT_FOUND`、`PARSE_LIMIT_EXCEEDED`です。

## 決定事項

1. **0.4.0への対応をやめる。**allowlistはoperation IDだけで引くため、`structuredData.get`など同じIDで引数の違う2つのsignatureを同時に持てません。両方を残すには、allowlistをpackageの版ごとに分ける必要があります。0.4.0をlockしたprojectは、registryで`TW2_MANIFEST_OPERATION_MISMATCH`になります。
2. **版は検証済みの一覧で固定する。**`STRUCTURED_DATA_PACKAGE_VERSION`を、検証済みの版の一覧に置き換えます。lockは今と同じく正確な版を要求し、signatureの完全一致が契約の本体です。
3. **JSONの解析はcoreの中で完結させる。**段階1では`JSON.parse`にcodecと同じ上限の数え方を足します。codecのJSON解析は、jsonc-parserで構文を確かめてから`JSON.parse`で値を作るので、厳密な`JSON.parse`と受け付ける構文は同じです。差は上限とerrorの分類だけで、これはparity fixtureで確かめます。
4. **`set`のVALUEには上限を設けない。**ブラウザはVALUEを`JSON.parse`するだけで、codecの上限を適用しません。段階1はこれに合わせます。structured-data側で両方に同じ上限を入れるかは別に決めます。
5. **YAML（段階2）はcodecを依存に加える。**`@kubohiroya/turbowarp-yaml-json`のcodecを、YAMLのnodeを使うときだけgenerated packageの依存に加えます。codecは`TextEncoder`しか使わない純粋なJavaScriptで、`eval`も使いません。esbuildで最小化すると約116 KB（gzipで約36 KB）です。YAMLの細かな規則（`.inf`やaliasの拒否、keyの書き出し方）を再実装すると、ずれる危険が大きいためです。この場合、coreが`type {Hono}`しかimportしないという今の性質は、YAMLを使うprojectに限って崩れます。
6. **schema（段階3）はnamed-functionsのvalidatorを使う。**ブラウザのschema registryとbuilderの下書きはtargetごとにあり、projectの停止で消えます。サーバーではどちらもリクエストごとに持ちます。validatorは`@kubohiroya/turbowarp-named-functions`の`./composition`を依存に加えて使います。`enum`と`const`の比較が`JSON.stringify`によることや、最初のerrorだけを報告することなど、ブラウザと同じ癖を持たせるためです。

## 検証

- structured-dataのgit tagから`tests/fixtures/semantic-parity.json`と`tests/fixtures/schema-parity.json`を取り込み、取り込み元のtagを記録します（npm packageには含まれません）。`readCases`はIR operation名で書かれているので、conformance harnessでgenerated coreに対してそのまま実行できます。
- fixtureには`has`、`keys`、`length`、`delete`、`toYaml`、MAX、上限のcaseがありません。structured-data側で先に追加します。
- `@kubohiroya/turbowarp-structured-data`をdevDependencyに加え、`tests/compiler-manifest-artifacts.test.ts`が実際のmanifestを読み、registryに登録できることまで確かめます。今はpackageが入っていないため、このtestは0.11のmanifestを読んでいません。
- 0.4.0向けのtestとfixture（`tests/fixtures/compiler-manifests/structured-data.json`、`structured-*`のconformance fixture）は0.11向けに置き換えます。

## ロールバック

問題があれば、Structured Dataのmanifest lockを使う生成を停止し、ブラウザまたはWebSocket bridgeで実行します。0.4.0の意味論へのfallbackはしません。
