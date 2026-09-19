import {CompilerManifestError} from './error.js';
import type {
  CompilerManifestArgument,
  CompilerManifestBlock,
  ManifestBlockType,
  ManifestEffect,
  ManifestResultType
} from './types.js';

interface ServerOperationSignature {
  opcode: string;
  blockType: ManifestBlockType;
  arguments: readonly CompilerManifestArgument[];
  resultType: ManifestResultType;
  effect: ManifestEffect;
  immutable: boolean;
}

const STRING = 'STRING' as const;
const NUMBER = 'NUMBER' as const;

export const KNOWN_SERVER_OPERATIONS: Readonly<Record<string, ServerOperationSignature>> = {
  'structuredData.currentIndex': signature('currentIndex', 'REPORTER', [], 'number', 'control'),
  'structuredData.currentKey': signature('currentKey', 'REPORTER', [], 'string', 'control'),
  'structuredData.currentValue': signature('currentValueJson', 'REPORTER', [], 'json', 'control'),
  'structuredData.delete': signature(
    'deleteAtPath',
    'REPORTER',
    [{id: 'JSON', type: STRING}, pathArgument()],
    'json',
    'immutable'
  ),
  'structuredData.forEach': signature(
    'forEachAtPath',
    'LOOP',
    [
      {id: 'JSON', type: STRING},
      {id: 'MAX', type: NUMBER, staticLiteral: true, minimum: 1, maximum: 1000},
      pathArgument()
    ],
    'void',
    'control'
  ),
  'structuredData.get': signature(
    'getJsonAtPath',
    'REPORTER',
    [{id: 'JSON', type: STRING}, pathArgument()],
    'json',
    'pure'
  ),
  'structuredData.has': signature(
    'hasPath',
    'BOOLEAN',
    [{id: 'JSON', type: STRING}, pathArgument()],
    'boolean',
    'pure'
  ),
  'structuredData.isValidJson': signature(
    'isValidJson',
    'BOOLEAN',
    [{id: 'JSON', type: STRING}],
    'boolean',
    'pure'
  ),
  'structuredData.keys': signature(
    'keysAtPath',
    'REPORTER',
    [{id: 'JSON', type: STRING}, pathArgument()],
    'json',
    'pure'
  ),
  'structuredData.length': signature(
    'lengthAtPath',
    'REPORTER',
    [{id: 'JSON', type: STRING}, pathArgument()],
    'number',
    'pure'
  ),
  'structuredData.normalizeJson': signature(
    'normalizeJson',
    'REPORTER',
    [{id: 'JSON', type: STRING}],
    'json',
    'pure'
  ),
  'structuredData.set': signature(
    'setJsonAtPath',
    'REPORTER',
    [{id: 'JSON', type: STRING}, pathArgument(), {id: 'VALUE', type: STRING}],
    'json',
    'immutable'
  )
};

export function validateServerOperationHint(block: CompilerManifestBlock): void {
  const operation = block.server?.irOperation;
  if (block.server?.supported !== true) {
    if (operation !== undefined) operationMismatch(block, operation, 'unsupported blocks must not declare an operation');
    return;
  }
  if (operation === undefined) operationMismatch(block, '<missing>', 'supported blocks require an operation');
  const expected = KNOWN_SERVER_OPERATIONS[operation];
  if (expected === undefined) operationMismatch(block, operation, 'operation is not in the compiler allowlist');

  const actual = {
    opcode: block.opcode,
    blockType: block.blockType,
    arguments: block.arguments,
    resultType: block.resultType,
    effect: block.effect,
    immutable: block.immutable
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    operationMismatch(block, operation, 'block signature does not match the compiler allowlist');
  }
}

function signature(
  opcode: string,
  blockType: ManifestBlockType,
  argumentsValue: readonly CompilerManifestArgument[],
  resultType: ManifestResultType,
  effect: ManifestEffect
): ServerOperationSignature {
  return {opcode, blockType, arguments: argumentsValue, resultType, effect, immutable: true};
}

function pathArgument(): CompilerManifestArgument {
  return {id: 'PATH', type: STRING, normalizesTo: 'pathSegments'};
}

function operationMismatch(block: CompilerManifestBlock, operation: string, reason: string): never {
  throw new CompilerManifestError(
    'TW2_MANIFEST_OPERATION_MISMATCH',
    `Manifest operation ${operation} on block ${block.opcode} is invalid: ${reason}.`
  );
}
