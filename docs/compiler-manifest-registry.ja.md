# Compiler extension manifest registry

Deploy IR v2 frontendは、外部TurboWarp extensionのopcodeをcompiler内の手書き定義だけから推測しません。明示された`turboWarp-server.lock.json`、lockが指すmanifestのexact bytes、compiler側allowlistの3つが一致した場合だけopcode registryへ登録します。

manifest registryはTurboWarp projectをIR v2へ変換する唯一の外部extension解決経路です。

## 対応形式

- compiler manifest format 1: extension ID、block type、argument ID/typeだけを提供するlegacy block API manifest。
- compiler manifest format 2: format 1にresult type、effect、immutable、runtime error、server-operation hintを加えた形式。Asset Cache 0.1.0のbrowser-only宣言、Structured Data 0.4.0、KVS 0.1.0のfixtureとの互換性を確認します。
- lock format 1: extension ID、exact package version、manifest format version、exact-byte SHA-256、sourceを固定します。

machine-readable schemaは次のとおりです。

- [`schemas/compiler-extension-manifest.schema.json`](../schemas/compiler-extension-manifest.schema.json)
- [`schemas/compiler-manifest-lock-v1.schema.json`](../schemas/compiler-manifest-lock-v1.schema.json)

format 1 manifestはregistryへ読めますが、server-operation hintがないblockを自動的にserver対応とは判断しません。Asset Cache blockをKVSやobject storageへ推測変換しません。KVSはformat 2の明示的な`kvs.*` operationだけをloweringします。

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

CLIではTurboWarp project入力に限り`--manifest-lock <file>`でlockを指定します。このoptionは`--format turbowarp-json`と組み合わせ、direct IR入力では受理しません。

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

## Lowering境界

1. frontendはprojectで使われるnon-core extensionにlock entryを要求します。
2. registryでblock signatureとoperation hintを検証してから、既知loweringへ渡します。
3. manifest version不一致時に旧定義や類似operationへfallbackしません。

## ロールバック

問題時は該当manifest lockを使う生成を停止します。lockは診断・再現用artifactとして保持し、compilerは外部packageやcloud resourceを変更しません。
