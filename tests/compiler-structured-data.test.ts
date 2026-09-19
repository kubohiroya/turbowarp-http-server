import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {
  JSON_VALUE_TYPE_V2,
  IrRuntimeError,
  StructuredDataLoweringContext,
  compareUnicodeCodePoints,
  deleteJsonAtPath,
  getJsonAtPath,
  hasJsonAtPath,
  jsonKeysAtPath,
  jsonLengthAtPath,
  parseDeployIrV2,
  parseStructuredDataPath,
  setJsonAtPath,
  stringifyApplicationJson,
  structuredIterationEntries,
  validateDeployIrV2Subset,
  type CompilerOpcodeRegistryEntry,
  type ExpressionIrV2,
  type JsonValue,
  type SourceRefV2,
  type StatementIrV2
} from '../src/compiler/index.js';

const source: SourceRefV2 = {
  targetIndex: 0,
  targetName: 'Stage',
  blockId: 'structured-block',
  opcode: 'kubohiroyastructureddata_getJsonAtPath'
};
const json = literal('string', '{"b":2,"a":[1,null]}');
const path = literal('string', '$.a[0]');

describe('Structured Data path and lowering', () => {
  it('preserves quoted numeric keys separately from array indices', () => {
    expect(parseStructuredDataPath('$["0"][0].value["escaped\\nkey"]')).toEqual([
      {kind: 'key', value: '0'},
      {kind: 'index', value: 0},
      {kind: 'key', value: 'value'},
      {kind: 'key', value: 'escaped\nkey'}
    ]);
    expect(() => parseStructuredDataPath('$.')).toThrow();
    expect(() => parseStructuredDataPath('$[01]')).toThrow();
  });

  it('maps every reporter operation and constant-folds literal JSON', () => {
    const context = new StructuredDataLoweringContext();
    const cases: Array<[string, string, Record<string, ExpressionIrV2>]> = [
      ['structuredData.normalizeJson', 'json-stringify', {JSON: json}],
      ['structuredData.isValidJson', 'literal', {JSON: json}],
      ['structuredData.get', 'json-stringify', {JSON: json, PATH: path}],
      ['structuredData.has', 'json-has', {JSON: json, PATH: path}],
      ['structuredData.set', 'json-stringify', {JSON: json, PATH: path, VALUE: literal('string', '3')}],
      ['structuredData.delete', 'json-stringify', {JSON: json, PATH: path}],
      ['structuredData.keys', 'json-stringify', {JSON: json, PATH: literal('string', '$')}],
      ['structuredData.length', 'json-length', {JSON: json, PATH: literal('string', '$.a')}]
    ];
    for (const [operation, kind, args] of cases) {
      expect(context.lowerReporter(entry(operation), args, source)?.kind).toBe(kind);
    }
    expect(context.diagnostics).toEqual([]);

    const normalized = context.lowerReporter(entry('structuredData.normalizeJson'), {JSON: json}, source);
    expect(normalized).toMatchObject({
      kind: 'json-stringify',
      value: {kind: 'literal', valueType: 'json-object', value: {b: 2, a: [1, null]}}
    });
  });

  it('inserts nominal parse boundaries for dynamic JSON and reports source inputs', () => {
    const dynamic = new StructuredDataLoweringContext();
    const result = dynamic.lowerReporter(
      entry('structuredData.normalizeJson'),
      {JSON: {kind: 'request', valueType: 'string', source: 'body-text'}},
      source
    );
    expect(result).toMatchObject({
      kind: 'json-stringify',
      value: {kind: 'json-parse', text: {kind: 'json-text-coerce', valueType: 'json-text'}}
    });

    const invalid = new StructuredDataLoweringContext();
    expect(invalid.lowerReporter(entry('structuredData.normalizeJson'), {JSON: literal('string', '{')}, source)).toBeUndefined();
    expect(
      invalid.lowerReporter(
        entry('structuredData.get'),
        {JSON: json, PATH: {kind: 'request', valueType: 'string', source: 'path'}},
        source
      )
    ).toBeUndefined();
    expect(invalid.diagnostics).toEqual([
      expect.objectContaining({code: 'TW2_STRUCTURED_INVALID_LITERAL', sourceRef: {...source, input: 'JSON'}}),
      expect.objectContaining({code: 'TW2_STRUCTURED_DYNAMIC_PATH', sourceRef: {...source, input: 'PATH'}})
    ]);
  });

  it('binds current reporters to the nearest lexical loop and restores the outer loop', () => {
    const context = new StructuredDataLoweringContext();
    let outerAfterNested: ExpressionIrV2 | undefined;
    const outer = context.lowerForEach(
      entry('structuredData.forEach'),
      {JSON: json, PATH: literal('string', '$'), MAX: literal('number', 10)},
      {...source, blockId: 'outer'},
      (outerContext) => {
        const outerValue = outerContext.lowerReporter(entry('structuredData.currentValue'), {}, source);
        expect(outerValue).toMatchObject({
          kind: 'json-stringify',
          value: {kind: 'iteration-value', loopId: 'structured_0_outer'}
        });
        const nested = outerContext.lowerForEach(
          entry('structuredData.forEach'),
          {JSON: json, PATH: literal('string', '$'), MAX: literal('number', 2)},
          {...source, blockId: 'inner'},
          (innerContext) => [
            respond(innerContext.lowerReporter(entry('structuredData.currentKey'), {}, source)!)
          ]
        );
        outerAfterNested = outerContext.lowerReporter(entry('structuredData.currentIndex'), {}, source);
        return [nested!, {kind: 'set-header', name: 'x-index', value: outerAfterNested!}];
      }
    );
    expect(outer).toMatchObject({kind: 'json-for-each', loopId: 'structured_0_outer', maxIterations: 10});
    expect((outer as Extract<StatementIrV2, {kind: 'json-for-each'}>).body[0]).toMatchObject({
      loopId: 'structured_0_inner',
      body: [{body: {loopId: 'structured_0_inner'}}]
    });
    expect(outerAfterNested).toMatchObject({kind: 'iteration-index', loopId: 'structured_0_outer'});
    expect(context.diagnostics).toEqual([]);

    expect(context.lowerReporter(entry('structuredData.currentValue'), {}, source)).toBeUndefined();
    expect(context.diagnostics[context.diagnostics.length - 1]).toMatchObject({
      code: 'TW2_ITERATION_CONTEXT_REQUIRED'
    });
  });

  it('rejects root delete and non-literal or out-of-range iteration maxima', () => {
    const context = new StructuredDataLoweringContext();
    expect(
      context.lowerReporter(
        entry('structuredData.delete'),
        {JSON: json, PATH: literal('string', '$')},
        source
      )
    ).toBeUndefined();
    expect(
      context.lowerForEach(
        entry('structuredData.forEach'),
        {JSON: json, PATH: literal('string', '$'), MAX: literal('number', 1001)},
        source,
        () => []
      )
    ).toBeUndefined();
    expect(context.diagnostics.map(({code}) => code)).toEqual([
      'TW2_STRUCTURED_INVALID_PATH',
      'TW2_STRUCTURED_INVALID_MAX'
    ]);
  });

  it('does not fall back for an unsupported package version', () => {
    const context = new StructuredDataLoweringContext();
    const incompatible = {...entry('structuredData.normalizeJson'), packageVersion: '0.5.0'};
    expect(context.lowerReporter(incompatible, {JSON: json}, source)).toBeUndefined();
    expect(context.diagnostics).toEqual([expect.objectContaining({code: 'TW2_UNSUPPORTED_OPERATION'})]);
  });
});

describe('Structured Data target-neutral runtime', () => {
  it('implements immutable get, has, set, delete, keys, and length semantics', () => {
    const original: JsonValue = {array: [1, 2, 3], object: {b: 2, a: null}};
    expect(getJsonAtPath(original, parseStructuredDataPath('$.object.a'))).toBeNull();
    expect(hasJsonAtPath(original, parseStructuredDataPath('$.object.a'))).toBe(true);
    expect(hasJsonAtPath(original, parseStructuredDataPath('$.object.missing'))).toBe(false);
    expect(jsonKeysAtPath(original, parseStructuredDataPath('$.object'))).toEqual(['a', 'b']);
    expect(jsonLengthAtPath(original, parseStructuredDataPath('$.array'))).toBe(3);

    const set = setJsonAtPath(original, parseStructuredDataPath('$.object.c'), {nested: true});
    const deleted = deleteJsonAtPath(original, parseStructuredDataPath('$.array[1]'));
    expect(set).toEqual({array: [1, 2, 3], object: {b: 2, a: null, c: {nested: true}}});
    expect(deleted).toEqual({array: [1, 3], object: {b: 2, a: null}});
    expect(original).toEqual({array: [1, 2, 3], object: {b: 2, a: null}});
  });

  it('sorts object keys by Unicode code point and preserves array order', () => {
    const value = {'😀': 4, z: 3, A: 1, 'é': 2};
    const expectedKeys = Object.keys(value).sort(compareUnicodeCodePoints);
    expect(expectedKeys).toEqual(['A', 'z', 'é', '😀']);
    expect(stringifyApplicationJson(value)).toBe('{"A":1,"z":3,"é":2,"😀":4}');
    expect(stringifyApplicationJson({'2': 2, '10': 1, '01': 3})).toBe('{"01":3,"10":1,"2":2}');
    expect(structuredIterationEntries(value, [], 4).map(({key}) => key)).toEqual(expectedKeys);
    expect(structuredIterationEntries(['third', 'first'], [], 2).map(({value: item}) => item)).toEqual([
      'third',
      'first'
    ]);
  });

  it('returns stable 422 runtime errors without embedding input values', () => {
    expectRuntimeError(() => deleteJsonAtPath({}, []), 'INVALID_PATH');
    expectRuntimeError(() => getJsonAtPath({}, [{kind: 'key', value: 'secret-value'}]), 'PATH_NOT_FOUND');
    expectRuntimeError(() => structuredIterationEntries([1, 2], [], 1), 'ITERATION_LIMIT_EXCEEDED');
    try {
      getJsonAtPath({}, [{kind: 'key', value: 'secret-value'}]);
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-value');
    }
  });

  it('does not import a deployment platform SDK', async () => {
    const sources = await Promise.all(
      ['runtime.ts', 'lowering.ts', 'path.ts'].map((name) =>
        readFile(`src/compiler/structured-data/${name}`, 'utf8')
      )
    );
    expect(sources.join('\n')).not.toMatch(/cloudflare|firebase|@google-cloud|wrangler/u);
  });
});

describe('Structured Data IR validation', () => {
  it('round-trips structured nodes and enforces lexical iteration context', () => {
    const loop: StatementIrV2 = {
      kind: 'json-for-each',
      loopId: 'items',
      root: literal('json-array', [1]),
      path: [],
      maxIterations: 1,
      body: [{kind: 'set-header', name: 'x-index', value: {kind: 'iteration-index', valueType: 'number', loopId: 'items'}}]
    };
    const ir = parseDeployIrV2({
      version: 2,
      name: 'structured',
      auth: {kind: 'none'},
      capabilities: [],
      routes: [
        {
          id: 'route',
          method: 'GET',
          path: '/',
          auth: 'public',
          body: [loop, respond({kind: 'json-stringify', valueType: 'json-text', value: literal('json-object', {})})]
        }
      ]
    });
    expect(validateDeployIrV2Subset(ir)).toEqual([]);

    ir.routes[0]!.body[1] = respond({kind: 'iteration-value', valueType: JSON_VALUE_TYPE_V2, loopId: 'items'});
    expect(validateDeployIrV2Subset(ir)).toEqual([
      expect.objectContaining({code: 'TW2_ITERATION_CONTEXT_REQUIRED'})
    ]);
  });
});

function literal(
  valueType: 'boolean' | 'number' | 'string' | 'json-array' | 'json-object',
  value: JsonValue
): ExpressionIrV2 {
  return {kind: 'literal', valueType, value};
}

function respond(body: ExpressionIrV2): StatementIrV2 {
  return {kind: 'respond', format: 'json', body};
}

function entry(operation: string): CompilerOpcodeRegistryEntry {
  const parts = operation.split('.');
  return {
    extensionId: 'kubohiroyastructureddata',
    opcode: parts[parts.length - 1]!,
    projectOpcode: `kubohiroyastructureddata_${operation}`,
    packageName: '@kubohiroya/turbowarp-structured-data',
    packageVersion: '0.4.0',
    block: {
      opcode: operation,
      blockType: operation === 'structuredData.forEach' ? 'LOOP' : 'REPORTER',
      arguments: [],
      server: {supported: true, irOperation: operation}
    }
  };
}

function expectRuntimeError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected IrRuntimeError.');
  } catch (error) {
    expect(error).toBeInstanceOf(IrRuntimeError);
    expect(error).toMatchObject({code, httpStatus: 422});
  }
}
