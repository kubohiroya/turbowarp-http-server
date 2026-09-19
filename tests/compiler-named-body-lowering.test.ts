import {describe, expect, it} from 'vitest';
import {
  lowerNamedBodyResponse,
  type ExpressionIrV2,
  type SourceRefV2
} from '../src/compiler/index.js';

const sourceRef: SourceRefV2 = {
  targetIndex: 0,
  targetName: 'Stage',
  blockId: 'named-response',
  opcode: 'kubohiroyaturbowarphttpserver_respondWithNamedBody'
};

describe('named response body lowering', () => {
  it('lowers a project asset descriptor without embedding target identity or bytes', () => {
    const result = lowerNamedBodyResponse(args(), sourceRef);

    expect(result.diagnostics).toEqual([]);
    expect(result.statement).toEqual({
      kind: 'respond-named-body',
      reference: {
        namespace: 'asset',
        name: 'avatar',
        kind: 'asset',
        scope: 'project'
      },
      representation: 'raw',
      maxBytes: 1024,
      sourceRef
    });
    expect(JSON.stringify(result.statement)).not.toMatch(/base64|data:|bytes/u);
  });

  it('normalizes canonical enum literals and includes target identity only for target scope', () => {
    const result = lowerNamedBodyResponse(
      args({KIND: text('BINARY'), SCOPE: text('TARGET'), REPRESENTATION: text('RAW')}),
      sourceRef
    );

    expect(result.statement).toMatchObject({
      reference: {kind: 'binary', scope: 'target'},
      representation: 'raw',
      targetId: 'Stage:1'
    });
  });

  it('rejects dynamic descriptor values with input-level source locations', () => {
    const result = lowerNamedBodyResponse(
      args({NAME: {kind: 'request', valueType: 'string', source: 'path'}}),
      sourceRef
    );

    expect(result.statement).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'TW2_NAMED_DYNAMIC_DESCRIPTOR',
        sourceRef: {...sourceRef, input: 'NAME'}
      })
    ]);
  });

  it.each([
    [{NAMESPACE: text('../assets')}, 'TW2_NAMED_INVALID_DESCRIPTOR'],
    [{NAME: text('bad\nname')}, 'TW2_NAMED_INVALID_DESCRIPTOR'],
    [{KIND: text('unknown')}, 'TW2_NAMED_INVALID_DESCRIPTOR'],
    [{SCOPE: text('target'), TARGET_ID: text('')}, 'TW2_NAMED_INVALID_DESCRIPTOR'],
    [{MAX_BYTES: number(0)}, 'TW2_NAMED_INVALID_MAX'],
    [{MAX_BYTES: number(16 * 1024 * 1024 + 1)}, 'TW2_NAMED_INVALID_MAX']
  ] as const)('rejects invalid canonical input %#', (overrides, code) => {
    const result = lowerNamedBodyResponse(args(overrides), sourceRef);
    expect(result.statement).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });
});

function args(overrides: Partial<Record<string, ExpressionIrV2>> = {}): Record<string, ExpressionIrV2> {
  return {
    NAMESPACE: text('asset'),
    NAME: text('avatar'),
    KIND: text('asset'),
    SCOPE: text('project'),
    TARGET_ID: text('Stage:1'),
    REPRESENTATION: text('raw'),
    MAX_BYTES: number(1024),
    ...overrides
  };
}

function text(value: string): ExpressionIrV2 {
  return {kind: 'literal', valueType: 'string', value};
}

function number(value: number): ExpressionIrV2 {
  return {kind: 'literal', valueType: 'number', value};
}
