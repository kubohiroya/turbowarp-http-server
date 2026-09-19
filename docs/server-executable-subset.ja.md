# Server-executable subset

Deploy IR v2 pipelineは、TurboWarp projectをそのままserver runtimeとして実行しません。frontendでHTTP handlerから到達するblockをallowlist検証し、lowering後のIRをtarget-neutral validatorで再検証します。validatorを迂回してv2 code generationするoptionは提供しません。

このvalidatorはすべてのDeploy IR v2生成で必ず実行し、検証を迂回するCLI経路を提供しません。

## TurboWarp block subset

MVPで許可するblockは次の範囲です。

- HTTP request hat、request field／query／header reporter
- response status／header／terminal response
- request-local handler variable
- HTTP method guardとしてのtop-level `control_if`
- string join等、loweringが定義されたpure expression
- literal `0..1000`の`control_repeat`
- lock済みmanifestで`server.supported: true`かつcompiler allowlistとsignatureが一致するoperation

明示的に拒否するものは次のとおりです。

| 分類 | 代表opcode | diagnostic | 理由 |
| --- | --- | --- | --- |
| global variable/list | `data_*` | `TW2_GLOBAL_STATE_UNSUPPORTED` | request／workerを越える共有stateになる |
| broadcast/message | `event_broadcast*` | `TW2_MESSAGE_UNSUPPORTED` | schedulerとlifetimeをbounded requestへ写像できない |
| unbounded loop | `control_forever` | `TW2_UNBOUNDED_LOOP` | 上限を静的証明できない |
| clone | `control_*clone*` | `TW2_CLONE_UNSUPPORTED` | sprite runtime stateへ依存する |
| renderer/audio/UI | `motion_*`、`looks_*`、`sound_*`等 | `TW2_RUNTIME_DEPENDENCY_UNSUPPORTED` | browser／sprite runtimeへ依存する |
| 一般Scratch branch | `control_if_else`等 | `TW2_CONTROL_FLOW_UNSUPPORTED` | Scratch coercionをMVP frontendで推測しない |
| manifest未許可 | 任意extension block | `TW2_UNSUPPORTED_OPERATION` | block manifestの存在だけではserver実行を許可しない |

project内に存在してもHTTP request hatから到達しないbrowser scriptはserver compilerの対象にせず、このvalidatorでは拒否しません。

## Handler variableとtyped binding

handler variableはrequestごとに生成・破棄するScratch互換scalar stateです。

- nameはScratch scalarからstring castできるものだけ
- `set`はscalar inputをScratch string変換してstringを保持
- `change`はscalar inputと既存値をScratch number変換してnumberを保持
- JSON、`binary-ref`、`binary-body`を格納しない
- route間、request間、thread間で共有しない

未設定nameのreadはScratch互換の空文字、existsはfalseとして初期化されます。globalな初期値や前requestの値を引き継ぎません。

JSON、record result、binary参照、resourceはcompilerが割り当てるlexical typed bindingで扱います。binding IDはdynamicなuser inputから作らず、producerより後かつ同じscope内だけで参照できます。`if`の後へbindingを持ち出す場合、継続する両branchが同じIDと型を宣言する必要があります。loop内で宣言したbindingはloop外へ漏れません。

## Control flowとresponse

- IR `if` conditionはboolean型。Scratch truthinessを暗黙適用しません。
- 各正常control-flow pathはterminal responseへちょうど1回到達します。
- response後のstatement、同一路径の2回目のresponseを拒否します。
- loop内responseを拒否します。loopは0回または複数回実行され得るためです。
- runtime error responseは後続pipelineの共通error boundaryが作るため、user response数には含めません。

## Loopとwork budget

target-neutral上限は固定です。

- loop literal bound: `0..1000`
- loop nesting: 最大8
- route worst-case work: 最大10,000

通常statement／expressionは各1 stepです。sequenceは加算、`if`はconditionと重い方のbranch、bounded loopは`1 + maxIterations × body steps`で計算します。計算は10,000を越えた時点でsaturateし、巨大な積でnumber overflowを起こしません。target adapterはより小さい上限を要求できますが、target-neutral validatorを緩和できません。

## Capability phase

record操作やclient address参照等が必要とするlogical capabilityはIR rootに宣言されていなければ`TW2_CAPABILITY_MISSING`です。これはtarget選択前のエラーです。

IRが正しくても選択targetが要求を実装できない場合は、adapter phaseの`TW2_TARGET_CAPABILITY_UNSUPPORTED`を使います。diagnosticの`phase`はそれぞれ`target-neutral`と`target-capability`であり、fallbackや近似変換を行いません。

## binary-body lifetime

`BinaryBodyLifetimeTracker`はlexical scopeごとに`binary-body` bindingを追跡します。

- consumeは最大1回
- scope終了後の参照を拒否
- 未宣言resourceを拒否
- clone、tee、暗黙bufferは行わない

二重consumeは`TW2_BINARY_BODY_CONSUMED`、scope外利用は`TW2_BINARY_BODY_SCOPE`、未宣言利用は`TW2_BINARY_BODY_UNDECLARED`です。具体的なbinary producer／consumer IR nodeはbinary resource Issueでこのtrackerへ接続します。

## Diagnostic

target-neutral diagnosticはcode、route ID、理由、修正候補を必須とします。元blockを持つ場合はtarget index/name、block ID、opcode、任意のinput名を`sourceRef`に保持します。runtime error codeとcompile diagnostic codeを混同しません。

## ロールバック

問題時は生成を停止してbrowser bridgeを利用します。validatorだけを無効化して未検証IRを生成する経路は作りません。
