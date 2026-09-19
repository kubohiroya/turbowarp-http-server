# Compiler extension manifest registry

Deploy IR v2 frontendは、外部TurboWarp extensionのopcodeをcompiler内の手書き定義だけから推測しません。明示された`turboWarp-server.lock.json`、lockが指すmanifestのexact bytes、compiler側allowlistの3つが一致した場合だけopcode registryへ登録します。

このmoduleは`compilerIrV2`配下の実験機能です。既存IR v1 frontendの組込みopcode mappingは変更しません。

## 対応形式

- compiler manifest format 1: extension ID、block type、argument ID/typeを提供するblock API manifest。Asset Manager 0.16.0 fixtureとの互換性を確認します。
- compiler manifest format 2: format 1にresult type、effect、immutable、runtime error、server-operation hintを加えた形式。package固有の型宣言としてtyped path segmentも任意で保持できます。Structured Data 0.4.0 fixtureとの互換性を確認します。
- lock format 1: extension ID、exact package version、manifest format version、exact-byte SHA-256、sourceを固定します。

machine-readable schemaは次のとおりです。

- [`schemas/compiler-extension-manifest.schema.json`](../schemas/compiler-extension-manifest.schema.json)
- [`schemas/compiler-manifest-lock-v1.schema.json`](../schemas/compiler-manifest-lock-v1.schema.json)

format 1 manifestはregistryへ読めますが、server-operation hintがないblockを自動的にserver対応とは判断しません。Asset Manager blockのIR対応は専用lowering Issueでformat／operationを確定します。

## Lock

```json
{
  "lockVersion": 1,
  "extensions": [
    {
      "extensionId": "kubohiroyastructureddata",
      "packageName": "@kubohiroya/turbowarp-structured-data",
      "packageVersion": "0.4.0",
      "manifestFormatVersion": 2,
      "integrity": "sha256-<base64 SHA-256>",
      "source": {"kind": "local", "path": "manifests/structured-data.json"}
    }
  ]
}
```

`packageVersion`はexact versionだけを受理し、range、tag、`latest`を解決しません。integrityはmanifest fileのexact bytesに対するSHA-256です。JSONの再整形やcanonicalization後のhashではありません。

sourceは次の2種類だけです。

- `bundled`: compiler callerがIDとexact bytesを登録したmanifest
- `local`: lock fileのdirectoryを基準とする相対path

URL、npm registry、cwd探索、暗黙downloadはありません。resolver順は常に「lock entry → entryが指すbundled/local source」です。

CLIではTurboWarp project入力に限り`--manifest-lock <file>`でlockを指定します。このoptionは`--format turbowarp-json --ir-version 2`と組み合わせ、direct IR入力やIR v1では受理しません。

local sourceはabsolute path、lock directory外への`..`、symlink componentを拒否します。realpath後にもlock directory内であることを再確認します。

## Registryとoperation hint

project opcodeは`<extensionId>_<opcode>`で一意に解決します。lockにないextension／opcodeは`TW2_MANIFEST_UNKNOWN_OPCODE`です。package versionをopcode prefixから推測しません。

`server.irOperation`は実装ruleではなくhintです。`server.supported: true`の場合、operation ID、opcode、block type、argument順・型・制約、result type、effect、immutableがcompilerの`KNOWN_SERVER_OPERATIONS`と完全一致しなければ`TW2_MANIFEST_OPERATION_MISMATCH`になります。manifestからJavaScript、module path、template、code snippetを読み込んだり実行したりしません。

## 入力制限

既定値はtargetによらず固定です。

- manifest／lock: 最大1 MiB
- JSON nesting: 最大64
- blocks: 最大2048
- duplicate JSON key: 拒否
- duplicate extension ID、opcode、argument ID、error code: 拒否
- unknown field／version／enum: 拒否
- UTF-8不正: 拒否

失敗は`CompilerManifestError`と安定した`TW2_MANIFEST_*` codeで返します。runtime error codeとは別namespaceです。

## 既存mappingからの移行

1. IR v1の`src/compiler/turbowarp.ts`は変更せず維持します。
2. v2 frontendはprojectで使われるnon-core extensionにlock entryを要求します。
3. registryでblock signatureとoperation hintを検証してから、既知loweringへ渡します。
4. parity fixtureが揃ったopcode単位でv2の手書き重複定義を削除します。
5. manifest version不一致時に旧定義へfallbackしません。

## ロールバック

`compilerIrV2=false`またはIR v1 pipelineを選ぶとregistryを使用しません。lockは診断・再現用artifactとして保持でき、既存v1 generatorへ影響しません。
