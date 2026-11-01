import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  IR_V2_STATEMENT_EFFECTS,
  JSON_VALUE_TYPE_V2,
  IrRuntimeError,
  STRUCTURED_DATA_RUNTIME_ERROR_CODES,
  STRUCTURED_DECODE_LIMITS,
  StructuredDataLoweringContext,
  canonicalizeDeployIrV2,
  compareUnicodeCodePoints,
  decodeStructuredJson,
  deleteJsonAtPath,
  getJsonAtPath,
  hasJsonAtPath,
  jsonKeysAtPath,
  jsonLengthAtPath,
  jsonScalarText,
  parseDeployIrV2,
  parseDeployIrV2Json,
  parseStructuredDataPath,
  setJsonAtPath,
  stringifyApplicationJson,
  structuredDataName,
  structuredIterationEntries,
  validateDeployIrV2Subset,
  type CompilerOpcodeRegistry,
  type CompilerOpcodeRegistryEntry,
  type DeployIrV2,
  type ExpressionIrV2,
  type JsonValue,
  type SourceRefV2,
  type StatementIrV2
} from '../src/compiler/index.js';
import {loadGeneratedCore} from './conformance/harness.js';
import {
  HTTP,
  SD,
  block,
  compileProject,
  lockedRegistry,
  outcome,
  query,
  reporter,
  requestBody,
  respondText,
  runProject,
  serverRequest,
  type InputSpec
} from './structured-data-support.js';

const source: SourceRefV2 = {
  targetIndex: 0,
  targetName: 'Stage',
  blockId: 'structured-block',
  opcode: 'kubohiroyastructureddata_getJsonAtPath'
};
const name = literal('string', 'doc');
const path = literal('string', '$.a[0]');
const dynamicName: ExpressionIrV2 = {kind: 'request-value', valueType: 'string', source: 'query', name: 'name'};
const bodyText: ExpressionIrV2 = {kind: 'request', valueType: 'string', source: 'body-text'};
const LIMIT = STRUCTURED_DECODE_LIMITS.maxInputBytes;

let registry: CompilerOpcodeRegistry;
beforeAll(async () => {
  registry = await lockedRegistry();
});

describe('Structured Data path', () => {
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
});

describe('Structured Data 0.11 lowering', () => {
  it('maps every phase 1 reporter to named-value reads and the existing json nodes', () => {
    const context = new StructuredDataLoweringContext();
    const root = {kind: 'named-value', name};
    expect(context.lowerReporter(entry('structuredData.get'), {NAME: name, PATH: path}, source)).toMatchObject({
      kind: 'json-stringify',
      value: {kind: 'json-get', root, path: [{kind: 'key', value: 'a'}, {kind: 'index', value: 0}]}
    });
    expect(context.lowerReporter(entry('structuredData.getText'), {NAME: name, PATH: path}, source)).toMatchObject({
      kind: 'json-scalar-text',
      valueType: 'string',
      value: {kind: 'json-get', root}
    });
    expect(context.lowerReporter(entry('structuredData.has'), {NAME: name, PATH: path}, source)).toMatchObject({
      kind: 'json-has',
      root
    });
    expect(context.lowerReporter(entry('structuredData.keys'), {NAME: name, PATH: path}, source)).toMatchObject({
      kind: 'json-stringify',
      value: {kind: 'json-keys', root}
    });
    expect(context.lowerReporter(entry('structuredData.length'), {NAME: name, PATH: path}, source)).toMatchObject({
      kind: 'json-length',
      root
    });
    expect(context.lowerReporter(entry('structuredData.hasData'), {NAME: name}, source)).toMatchObject({
      kind: 'named-value-exists',
      valueType: 'boolean',
      name
    });
    expect(context.lowerReporter(entry('structuredData.toJson'), {NAME: name}, source)).toMatchObject({
      kind: 'json-stringify',
      value: root
    });
    expect(context.diagnostics).toEqual([]);
  });

  it('maps every phase 1 command to named-value writes', () => {
    const context = new StructuredDataLoweringContext();
    expect(
      context.lowerStatement(entry('structuredData.parseJson'), {NAME: name, TEXT: literal('string', '{"b":2,"a":1}')}, source)
    ).toMatchObject({
      kind: 'named-value-set',
      name,
      value: {kind: 'literal', valueType: 'json-object', value: {b: 2, a: 1}},
      schema: 'drop'
    });
    expect(context.lowerStatement(entry('structuredData.parseJson'), {NAME: name, TEXT: bodyText}, source)).toMatchObject({
      kind: 'named-value-set',
      value: {kind: 'structured-decode', format: 'json', text: bodyText},
      schema: 'drop'
    });
    expect(
      context.lowerStatement(entry('structuredData.set'), {NAME: name, PATH: path, VALUE: literal('string', '[1]')}, source)
    ).toMatchObject({
      kind: 'named-value-set',
      name,
      value: {kind: 'json-set', root: {kind: 'named-value', name}, value: {kind: 'literal', value: [1]}},
      schema: 'keep'
    });
    expect(context.lowerStatement(entry('structuredData.set'), {NAME: name, PATH: path, VALUE: bodyText}, source)).toMatchObject({
      value: {kind: 'json-set', value: {kind: 'json-parse', text: {kind: 'json-text-coerce', input: bodyText}}}
    });
    expect(context.lowerStatement(entry('structuredData.delete'), {NAME: name, PATH: path}, source)).toMatchObject({
      kind: 'named-value-set',
      value: {kind: 'json-delete', root: {kind: 'named-value', name}},
      schema: 'keep'
    });
    expect(context.lowerStatement(entry('structuredData.deleteData'), {NAME: name}, source)).toEqual({
      kind: 'named-value-delete',
      name,
      sourceRef: source
    });
    expect(context.diagnostics).toEqual([]);
  });

  it('gives each read of a name its own copy, so no IR node has two parents', () => {
    const set = new StructuredDataLoweringContext().lowerStatement(
      entry('structuredData.set'),
      {NAME: dynamicName, PATH: path, VALUE: literal('string', '1')},
      source
    ) as Extract<StatementIrV2, {kind: 'named-value-set'}>;
    const update = set.value as Extract<ExpressionIrV2, {kind: 'json-set'}>;
    const root = update.root as Extract<ExpressionIrV2, {kind: 'named-value'}>;
    expect(root.name).toEqual(set.name);
    expect(root.name).not.toBe(set.name);
  });

  it('keeps any NAME expression but rejects an empty literal NAME at compile time', () => {
    const context = new StructuredDataLoweringContext();
    expect(context.lowerReporter(entry('structuredData.toJson'), {NAME: dynamicName}, source)).toMatchObject({
      value: {kind: 'named-value', name: dynamicName}
    });
    expect(context.lowerReporter(entry('structuredData.hasData'), {NAME: literal('string', '')}, source)).toBeUndefined();
    expect(context.lowerStatement(entry('structuredData.deleteData'), {NAME: literal('string', ' \t\n')}, source)).toBeUndefined();
    expect(context.diagnostics).toEqual([
      expect.objectContaining({code: 'TW2_STRUCTURED_INVALID_NAME', sourceRef: {...source, input: 'NAME'}}),
      expect.objectContaining({code: 'TW2_STRUCTURED_INVALID_NAME', sourceRef: {...source, input: 'NAME'}})
    ]);
  });

  it('decodes literal TEXT with the codec limits and reports TEXT before NAME, as the browser does', () => {
    const context = new StructuredDataLoweringContext();
    const parse = (text: string, nameValue = 'doc') =>
      context.lowerStatement(
        entry('structuredData.parseJson'),
        {NAME: literal('string', nameValue), TEXT: literal('string', text)},
        source
      );
    expect(parse('{', ' ')).toBeUndefined();
    expect(parse(`${'['.repeat(66)}${']'.repeat(66)}`)).toBeUndefined();
    expect(parse(`"${'a'.repeat(LIMIT - 1)}"`)).toBeUndefined();
    expect(parse(`${'['.repeat(65)}${']'.repeat(65)}`)).toMatchObject({value: {kind: 'literal', valueType: 'json-array'}});
    expect(context.diagnostics.map(({code, message, sourceRef}) => [code, message, sourceRef.input])).toEqual([
      ['TW2_STRUCTURED_INVALID_LITERAL', 'Structured Data JSON literal is invalid.', 'TEXT'],
      ['TW2_STRUCTURED_INVALID_NAME', 'Structured Data name literal is empty.', 'NAME'],
      ['TW2_STRUCTURED_INVALID_LITERAL', 'Structured Data JSON literal exceeds the parse limits.', 'TEXT'],
      ['TW2_STRUCTURED_INVALID_LITERAL', 'Structured Data JSON literal exceeds the parse limits.', 'TEXT']
    ]);
  });

  it('parses set VALUE without codec limits, as the browser only JSON.parses it', () => {
    const context = new StructuredDataLoweringContext();
    const deep = `${'['.repeat(100)}${']'.repeat(100)}`;
    expect(
      context.lowerStatement(entry('structuredData.set'), {NAME: name, PATH: path, VALUE: literal('string', deep)}, source)
    ).toMatchObject({value: {kind: 'json-set', value: {kind: 'literal', valueType: 'json-array'}}});
    expect(
      context.lowerStatement(entry('structuredData.set'), {NAME: name, PATH: path, VALUE: literal('string', '{')}, source)
    ).toBeUndefined();
    expect(context.diagnostics).toEqual([
      expect.objectContaining({code: 'TW2_STRUCTURED_INVALID_LITERAL', sourceRef: {...source, input: 'VALUE'}})
    ]);
  });

  it('keeps PATH and MAX literal and rejects deleting the root', () => {
    const context = new StructuredDataLoweringContext();
    expect(context.lowerReporter(entry('structuredData.get'), {NAME: name, PATH: bodyText}, source)).toBeUndefined();
    expect(
      context.lowerReporter(entry('structuredData.has'), {NAME: name, PATH: literal('string', '$..a')}, source)
    ).toBeUndefined();
    expect(
      context.lowerStatement(entry('structuredData.delete'), {NAME: name, PATH: literal('string', '$')}, source)
    ).toBeUndefined();
    expect(
      context.lowerForEach(
        entry('structuredData.forEach'),
        {NAME: name, PATH: literal('string', '$'), MAX: literal('number', 1001)},
        source,
        () => []
      )
    ).toBeUndefined();
    expect(context.diagnostics.map(({code, sourceRef}) => [code, sourceRef.input])).toEqual([
      ['TW2_STRUCTURED_DYNAMIC_PATH', 'PATH'],
      ['TW2_STRUCTURED_INVALID_PATH', 'PATH'],
      ['TW2_STRUCTURED_INVALID_PATH', 'PATH'],
      ['TW2_STRUCTURED_INVALID_MAX', 'MAX']
    ]);
  });

  it('iterates a named value and binds current reporters to the nearest lexical loop', () => {
    const context = new StructuredDataLoweringContext();
    let outerAfterNested: ExpressionIrV2 | undefined;
    const outer = context.lowerForEach(
      entry('structuredData.forEach'),
      {NAME: name, PATH: literal('string', '$'), MAX: literal('number', 10)},
      {...source, blockId: 'outer'},
      (outerContext) => {
        expect(outerContext.lowerReporter(entry('structuredData.currentValue'), {}, source)).toMatchObject({
          kind: 'json-stringify',
          value: {kind: 'iteration-value', loopId: 'structured_0_outer'}
        });
        const nested = outerContext.lowerForEach(
          entry('structuredData.forEach'),
          {NAME: name, PATH: literal('string', '$.items'), MAX: literal('number', 2)},
          {...source, blockId: 'inner'},
          (innerContext) => [
            respond(innerContext.lowerReporter(entry('structuredData.currentGet'), {PATH: literal('string', '$.id')}, source)!),
            respond(innerContext.lowerReporter(entry('structuredData.currentGetText'), {PATH: literal('string', '$')}, source)!)
          ]
        );
        outerAfterNested = outerContext.lowerReporter(entry('structuredData.currentIndex'), {}, source);
        return [nested!, {kind: 'set-header', name: 'x-index', value: outerAfterNested!}];
      }
    );
    expect(outer).toMatchObject({
      kind: 'json-for-each',
      loopId: 'structured_0_outer',
      root: {kind: 'named-value', name},
      maxIterations: 10
    });
    const inner = {kind: 'iteration-value', loopId: 'structured_0_inner'};
    expect((outer as Extract<StatementIrV2, {kind: 'json-for-each'}>).body[0]).toMatchObject({
      loopId: 'structured_0_inner',
      body: [
        {body: {kind: 'json-stringify', value: {kind: 'json-get', root: inner}}},
        {body: {kind: 'json-scalar-text', value: {kind: 'json-get', root: inner}}}
      ]
    });
    expect(outerAfterNested).toMatchObject({kind: 'iteration-index', loopId: 'structured_0_outer'});
    expect(context.diagnostics).toEqual([]);
  });

  it('checks the loop before the path for current reads outside a loop', () => {
    const context = new StructuredDataLoweringContext();
    expect(
      context.lowerReporter(entry('structuredData.currentGet'), {PATH: literal('string', '$..bad')}, source)
    ).toBeUndefined();
    expect(context.lowerReporter(entry('structuredData.currentValue'), {}, source)).toBeUndefined();
    expect(context.diagnostics.map(({code}) => code)).toEqual([
      'TW2_ITERATION_CONTEXT_REQUIRED',
      'TW2_ITERATION_CONTEXT_REQUIRED'
    ]);
  });

  it('stops each phase 2 and phase 3 block with a per-block diagnostic that names its phase', () => {
    const context = new StructuredDataLoweringContext();
    const later = registry.entries.filter(({block: manifestBlock}) =>
      /yaml|schema/iu.test(manifestBlock.server?.irOperation ?? '')
    );
    expect(later.map(({block: manifestBlock}) => manifestBlock.server?.irOperation).sort()).toEqual([
      'structuredData.addSchemaProperty',
      'structuredData.beginSchema',
      'structuredData.commitSchema',
      'structuredData.defineSchema',
      'structuredData.deleteSchema',
      'structuredData.hasSchema',
      'structuredData.parseJsonWithSchema',
      'structuredData.parseYaml',
      'structuredData.parseYamlWithSchema',
      'structuredData.schemaOf',
      'structuredData.toYaml'
    ]);
    for (const laterEntry of later) {
      const args = Object.fromEntries(laterEntry.block.arguments.map(({id}) => [id, literal('string', 'x')]));
      const lowered =
        laterEntry.block.blockType === 'COMMAND'
          ? context.lowerStatement(laterEntry, args, source)
          : context.lowerReporter(laterEntry, args, source);
      expect(lowered, laterEntry.opcode).toBeUndefined();
    }
    expect(context.diagnostics).toHaveLength(later.length);
    for (const diagnostic of context.diagnostics) {
      expect(diagnostic.code).toBe('TW2_UNSUPPORTED_OPERATION');
      expect(diagnostic.message).toMatch(/until phase (2 \(YAML\)|3 \(schema\))\.$/u);
    }
  });

  it('does not fall back for a package version it was not verified against', () => {
    for (const packageVersion of ['0.4.0', '0.11.0', '0.11.0-rc.0']) {
      const context = new StructuredDataLoweringContext();
      expect(
        context.lowerReporter({...entry('structuredData.toJson'), packageVersion}, {NAME: name}, source)
      ).toBeUndefined();
      expect(context.diagnostics).toEqual([expect.objectContaining({code: 'TW2_UNSUPPORTED_OPERATION'})]);
    }
  });
});

describe('Structured Data frontend routing', () => {
  it('routes Structured Data commands to the Structured Data lowering instead of TW2_UNSUPPORTED_COMMAND', async () => {
    const {ir, codes} = await compileProject([
      block(`${SD}parseJson`, {NAME: 'doc', TEXT: '{"items":[1,2]}'}),
      block(`${SD}setJsonAtPath`, {NAME: 'doc', PATH: '$.items[0]', VALUE: '3'}),
      block(`${SD}deleteAtPath`, {NAME: 'doc', PATH: '$.items[1]'}),
      block(`${SD}deleteStructuredData`, {NAME: 'other'}),
      respondText(reporter(`${SD}toJson`, {NAME: 'doc'}))
    ]);
    expect(codes).toEqual([]);
    expect(ir.routes[0]?.body.map(({kind}) => kind)).toEqual([
      'named-value-set',
      'named-value-set',
      'named-value-set',
      'named-value-delete',
      'respond'
    ]);
    expect(ir.capabilities).toEqual([]);
  });

  it('reports a later-phase command once, at its own block', async () => {
    const {codes, ir} = await compileProject([block(`${SD}parseYaml`, {NAME: 'doc', TEXT: 'a: 1'}), respondText('unreachable')]);
    expect(codes).toEqual(['TW2_UNSUPPORTED_OPERATION']);
    expect(ir.routes).toEqual([]);
  });
});

describe('Structured Data IR nodes', () => {
  it('round-trips the named-value nodes through the strict parser and canonical form', () => {
    const ir = namedValueIr([
      {kind: 'named-value-set', name: dynamicName, value: decode(bodyText), schema: 'drop'},
      {kind: 'set-header', name: 'x-text', value: scalarText(get(read(dynamicName)))},
      {kind: 'named-value-delete', name: literal('string', 'doc')},
      respond({kind: 'named-value-exists', valueType: 'boolean', name: literal('string', 'doc')})
    ]);
    const parsed = parseDeployIrV2(ir);
    expect(parsed).toEqual(ir);
    expect(parseDeployIrV2Json(canonicalizeDeployIrV2(parsed))).toEqual(parsed);
    expect(validateDeployIrV2Subset(parsed)).toEqual([]);
    expect(IR_V2_STATEMENT_EFFECTS['named-value-set']).toEqual(['handler-state-write']);
    expect(IR_V2_STATEMENT_EFFECTS['named-value-delete']).toEqual(['handler-state-write']);
  });

  it('rejects unknown fields, other formats, and unknown schema policies', () => {
    const withStatement = (statement: unknown) => ({
      ...namedValueIr([respond(literal('string', 'ok'))]),
      routes: [{id: 'route', method: 'POST', path: '/', auth: 'public', body: [statement, respond(literal('string', 'ok'))]}]
    });
    const set = {kind: 'named-value-set', name, value: decode(bodyText), schema: 'drop'};
    expect(() => parseDeployIrV2(withStatement(set))).not.toThrow();
    expect(() => parseDeployIrV2(withStatement({...set, schema: 'replace'}))).toThrowError(
      expect.objectContaining({code: 'TW2_IR_INVALID_VALUE'})
    );
    expect(() => parseDeployIrV2(withStatement({...set, schemaRef: {}}))).toThrowError(
      expect.objectContaining({code: 'TW2_IR_UNKNOWN_FIELD'})
    );
    expect(() => parseDeployIrV2(withStatement({...set, value: {...decode(bodyText), format: 'yaml'}}))).toThrowError(
      expect.objectContaining({code: 'TW2_IR_INVALID_VALUE'})
    );
    expect(() =>
      parseDeployIrV2(withStatement({kind: 'named-value-delete', name: {kind: 'named-value-exists', valueType: 'string', name}}))
    ).toThrowError(expect.objectContaining({code: 'TW2_IR_INVALID_VALUE'}));
  });

  it('requires Scratch scalar names, typed JSON values, and Scratch text to decode', () => {
    const jsonName = literal('json-object', {});
    const ir = namedValueIr([
      {kind: 'named-value-set', name: jsonName, value: literal('json-text', '{}'), schema: 'drop'},
      {kind: 'named-value-delete', name: jsonName},
      {kind: 'set-header', name: 'x-text', value: scalarText(literal('json-text', '1'))},
      {kind: 'named-value-set', name, value: decode(literal('json-array', [])), schema: 'drop'},
      respond({kind: 'named-value-exists', valueType: 'boolean', name: jsonName})
    ]);
    expect(validateDeployIrV2Subset(ir).map(({code, message}) => [code, message])).toEqual([
      ['TW2_BINDING_TYPE_MISMATCH', 'Structured Data named value must be a typed JSON value.'],
      ['TW2_HANDLER_VARIABLE_TYPE', 'Structured Data names must use a Scratch-compatible scalar value.'],
      ['TW2_HANDLER_VARIABLE_TYPE', 'Structured Data names must use a Scratch-compatible scalar value.'],
      ['TW2_BINDING_TYPE_MISMATCH', 'Structured Data text input must be a typed JSON value.'],
      ['TW2_HANDLER_VARIABLE_TYPE', 'Structured Data decode text must use a Scratch-compatible scalar value.'],
      ['TW2_HANDLER_VARIABLE_TYPE', 'Structured Data names must use a Scratch-compatible scalar value.']
    ]);
  });

  it('accepts json-text where Scratch casts a value to a string', () => {
    const toJson: ExpressionIrV2 = {kind: 'json-stringify', valueType: 'json-text', value: read(name)};
    const ir = namedValueIr([
      {kind: 'named-value-set', name, value: literal('json-object', {}), schema: 'drop'},
      {kind: 'set-handler-variable', name: literal('string', 'saved'), value: toJson},
      {kind: 'named-value-set', name: toJson, value: decode(toJson), schema: 'drop'},
      respond(literal('string', 'ok'))
    ]);
    expect(validateDeployIrV2Subset(ir)).toEqual([]);
  });

  it('charges one work step per new node plus its inputs', () => {
    // Each set is the statement, its name, the decode, and the decode text: 4 steps.
    const sets = Array.from(
      {length: 2499},
      (): StatementIrV2 => ({kind: 'named-value-set', name, value: decode(bodyText), schema: 'drop'})
    );
    const remove: StatementIrV2 = {kind: 'named-value-delete', name};
    // 2499 * 4 + delete (2) + respond (2) is exactly the 10,000 step budget.
    expect(validateDeployIrV2Subset(namedValueIr([...sets, remove, respond(literal('string', 'ok'))]))).toEqual([]);
    const exists: ExpressionIrV2 = {kind: 'named-value-exists', valueType: 'boolean', name};
    expect(validateDeployIrV2Subset(namedValueIr([...sets, remove, respond(exists)])).map(({code}) => code)).toEqual([
      'TW2_WORK_BUDGET_EXCEEDED'
    ]);
  });
});

describe('Structured Data runtime helpers', () => {
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
    expect(structuredIterationEntries(['third', 'first'], [], 2).map(({value: item}) => item)).toEqual(['third', 'first']);
  });

  it('checks the UTF-8 size before parsing, counting as TextEncoder does', () => {
    expect(STRUCTURED_DECODE_LIMITS).toEqual({maxInputBytes: 262144, maxDepth: 64, maxNodes: 50000});
    expect(decodeStructuredJson(`"${'a'.repeat(LIMIT - 2)}"`)).toHaveLength(LIMIT - 2);
    expectRuntimeError(() => decodeStructuredJson(`"${'a'.repeat(LIMIT - 1)}"`), 'PARSE_LIMIT_EXCEEDED');
    // "あ" is three bytes: 87380 of them, two more ASCII bytes, and the quotes are exactly the limit.
    expect(decodeStructuredJson(`"${'あ'.repeat(87380)}aa"`)).toBeTypeOf('string');
    expectRuntimeError(() => decodeStructuredJson(`"${'あ'.repeat(87380)}aaa"`), 'PARSE_LIMIT_EXCEEDED');
    // A lone surrogate is the three bytes of U+FFFD, so this text is over the limit before it is
    // found to be invalid, and one fewer is invalid JSON within it.
    expectRuntimeError(() => decodeStructuredJson(`{${'\ud800'.repeat(87382)}`), 'PARSE_LIMIT_EXCEEDED');
    expectRuntimeError(() => decodeStructuredJson(`{${'\ud800'.repeat(87381)}`), 'INVALID_JSON');
    expectRuntimeError(() => decodeStructuredJson(`{${' '.repeat(LIMIT)}`), 'PARSE_LIMIT_EXCEEDED');
  });

  it('accepts exactly what JSON.parse accepts, keeping its duplicate-key and "__proto__" results', () => {
    for (const text of ['', ' ', '{', '[1,]', '01', '\u00a01', '\ufeff1', '// x\n1', "'a'", 'NaN', '{"a":1}x']) {
      expectRuntimeError(() => decodeStructuredJson(text), 'INVALID_JSON');
    }
    expect(decodeStructuredJson(' \t\r\n1 ')).toBe(1);
    expect(decodeStructuredJson('"a\u2028b"')).toBe('a\u2028b');
    expect(decodeStructuredJson('{"a":1,"a":2}')).toEqual({a: 2});
    expect(Object.keys(decodeStructuredJson('{"__proto__":1}') as object)).toEqual(['__proto__']);
  });

  it('counts depth from a depth-0 root and every value but no key, in traversal order', () => {
    expect(decodeStructuredJson(`${'['.repeat(65)}${']'.repeat(65)}`)).toBeInstanceOf(Array);
    expectRuntimeError(() => decodeStructuredJson(`${'['.repeat(66)}${']'.repeat(66)}`), 'PARSE_LIMIT_EXCEEDED');
    expectRuntimeError(() => decodeStructuredJson(`${'['.repeat(120000)}${']'.repeat(120000)}`), 'PARSE_LIMIT_EXCEEDED');
    expect(decodeStructuredJson(`[${Array(49999).fill('0').join(',')}]`)).toHaveLength(49999);
    expectRuntimeError(() => decodeStructuredJson(`[${Array(50000).fill('0').join(',')}]`), 'PARSE_LIMIT_EXCEEDED');
    // 16,666 objects of two members are 1 + 16,666 + 33,332 = 49,999 values; counting keys would
    // put them far over, and one more object (three more values) is over without them.
    const pairs = (count: number) => `[${Array(count).fill('{"a":0,"b":0}').join(',')}]`;
    expect(decodeStructuredJson(pairs(16666))).toHaveLength(16666);
    expectRuntimeError(() => decodeStructuredJson(pairs(16667)), 'PARSE_LIMIT_EXCEEDED');
    // A non-finite number is INVALID_JSON where the traversal meets it, which follows the parsed
    // object's key order: integer-like keys first, then insertion order.
    expectRuntimeError(() => decodeStructuredJson('[1e999]'), 'INVALID_JSON');
    const deep = `${'['.repeat(70)}${']'.repeat(70)}`;
    expectRuntimeError(() => decodeStructuredJson(`{"b":1e999,"a":${deep}}`), 'INVALID_JSON');
    expectRuntimeError(() => decodeStructuredJson(`{"b":1e999,"1":${deep}}`), 'PARSE_LIMIT_EXCEEDED');
  });

  it('casts names like Scratch and trims them', () => {
    expect(structuredDataName('  doc \n')).toBe('doc');
    expect(structuredDataName(0)).toBe('0');
    expect(structuredDataName(true)).toBe('true');
    expectRuntimeError(() => structuredDataName(' \t\u3000'), 'INVALID_NAME');
  });

  it('renders scalars as text and rejects null and containers', () => {
    expect(jsonScalarText('say "hi"')).toBe('say "hi"');
    expect(jsonScalarText(1.5)).toBe('1.5');
    expect(jsonScalarText(1e21)).toBe('1e+21');
    expect(jsonScalarText(false)).toBe('false');
    for (const value of [null, [], {}]) expectRuntimeError(() => jsonScalarText(value), 'TYPE_MISMATCH');
  });

  it('returns stable 422 runtime errors without embedding input values', () => {
    expect(STRUCTURED_DATA_RUNTIME_ERROR_CODES).toEqual(
      expect.arrayContaining(['INVALID_NAME', 'DATA_NOT_FOUND', 'PARSE_LIMIT_EXCEEDED'])
    );
    expectRuntimeError(() => deleteJsonAtPath({}, []), 'INVALID_PATH');
    expectRuntimeError(() => getJsonAtPath({}, [{kind: 'key', value: 'secret-value'}]), 'PATH_NOT_FOUND');
    expectRuntimeError(() => structuredIterationEntries([1, 2], [], 1), 'ITERATION_LIMIT_EXCEEDED');
    for (const operation of [
      () => getJsonAtPath({}, [{kind: 'key', value: 'secret-value'}]),
      () => decodeStructuredJson('{"secret-value"'),
      () => structuredDataName('   ')
    ]) {
      expect(operation).toThrowError(expect.not.objectContaining({message: expect.stringContaining('secret-value')}));
    }
  });

  it('does not import a deployment platform SDK', async () => {
    const sources = await Promise.all(
      ['runtime.ts', 'lowering.ts', 'path.ts'].map((file) => readFile(`src/compiler/structured-data/${file}`, 'utf8'))
    );
    expect(sources.join('\n')).not.toMatch(/cloudflare|firebase|@google-cloud|wrangler/u);
  });
});

describe('Structured Data named values in the generated core', () => {
  it('starts every request empty, so a value set by one request is absent in the next', async () => {
    const {ir, codes} = await compileProject([
      block(`${HTTP}setHandlerVariable`, {NAME: 'before', VALUE: reporter(`${SD}hasStructuredData`, {NAME: 'doc'})}),
      block(`${SD}parseJson`, {NAME: 'doc', TEXT: requestBody}),
      respondText(reporter(`${HTTP}handlerVariable`, {NAME: 'before'}))
    ]);
    expect(codes).toEqual([]);
    const core = await loadGeneratedCore(ir);
    for (let index = 0; index < 3; index += 1) {
      expect(outcome(await core.request(serverRequest({body: '{"n":1}'})))).toEqual({value: 'false'});
    }
  });

  it('keeps concurrent requests apart', async () => {
    const {ir} = await compileProject([
      block(`${SD}parseJson`, {NAME: 'doc', TEXT: requestBody}),
      respondText(reporter(`${SD}toJson`, {NAME: 'doc'}))
    ]);
    const core = await loadGeneratedCore(ir);
    const bodies = Array.from({length: 8}, (_, index) => `{"request":${index}}`);
    const responses = await Promise.all(bodies.map((body) => core.request(serverRequest({body}))));
    expect(responses.map(outcome)).toEqual(bodies.map((body) => ({value: body})));
  });

  it('resolves dynamic names at runtime with Cast.toString and trimming', async () => {
    const joined = reporter('operator_join', {STRING1: query('a'), STRING2: query('b')});
    const statements = [
      block(`${SD}parseJson`, {NAME: query('write'), TEXT: '{"v":1}'}),
      respondText(reporter(`${SD}getTextAtPath`, {NAME: joined, PATH: '$.v'}))
    ];
    await expect(runProject(statements, {query: {write: ' ab\t', a: 'a', b: 'b '}})).resolves.toEqual({value: '1'});
    await expect(runProject(statements, {query: {write: '\u3000', a: 'a', b: 'b'}})).resolves.toEqual({error: 'INVALID_NAME'});
    await expect(runProject(statements, {query: {write: 'ab', a: 'a', b: 'c'}})).resolves.toEqual({error: 'DATA_NOT_FOUND'});
  });

  it('decodes request text with the codec limits and error order', async () => {
    const statements = [
      block(`${SD}parseJson`, {NAME: query('name'), TEXT: requestBody}),
      respondText(reporter(`${SD}toJson`, {NAME: query('name')}))
    ];
    const run = (body: string, nameValue = 'doc') => runProject(statements, {query: {name: nameValue}, body});
    await expect(run('{"b":[1,{"a":null}]}')).resolves.toEqual({value: '{"b":[1,{"a":null}]}'});
    // TEXT is decoded before NAME is checked, so decoding errors win over INVALID_NAME.
    await expect(run('{', ' ')).resolves.toEqual({error: 'INVALID_JSON'});
    await expect(run(`{${' '.repeat(LIMIT)}`, ' ')).resolves.toEqual({error: 'PARSE_LIMIT_EXCEEDED'});
    await expect(run(`${'['.repeat(66)}${']'.repeat(66)}`, ' ')).resolves.toEqual({error: 'PARSE_LIMIT_EXCEEDED'});
    await expect(run('[]', ' ')).resolves.toEqual({error: 'INVALID_NAME'});
    // Request bodies are UTF-8, and the limit counts those bytes rather than characters.
    await expect(run(`"${'あ'.repeat(87380)}aa"`)).resolves.toEqual({value: `"${'あ'.repeat(87380)}aa"`});
    await expect(run(`"${'あ'.repeat(87380)}aaa"`)).resolves.toEqual({error: 'PARSE_LIMIT_EXCEEDED'});
    await expect(run(`${'['.repeat(120000)}${']'.repeat(120000)}`)).resolves.toEqual({error: 'PARSE_LIMIT_EXCEEDED'});
    await expect(run(`[${Array(50000).fill('0').join(',')}]`)).resolves.toEqual({error: 'PARSE_LIMIT_EXCEEDED'});
    await expect(run('[1e999]')).resolves.toEqual({error: 'INVALID_JSON'});
  });

  it('evaluates the written value before the name, as parse JSON and set do in the browser', async () => {
    const core = await loadGeneratedCore(
      namedValueIr([
        {kind: 'named-value-set', name: dynamicName, value: decode(bodyText), schema: 'drop'},
        respond(literal('string', 'ok'))
      ])
    );
    expect(outcome(await core.request(serverRequest({query: {name: ' '}, body: '{'})))).toEqual({error: 'INVALID_JSON'});
    expect(outcome(await core.request(serverRequest({query: {name: ' '}, body: '{}'})))).toEqual({error: 'INVALID_NAME'});
    expect(outcome(await core.request(serverRequest({query: {name: 'x'}, body: '{}'})))).toEqual({value: 'ok'});
  });

  it('reports missing values, deletes, and scalar text failures with their codes only', async () => {
    const core = await loadGeneratedCore(
      namedValueIr([
        {kind: 'named-value-set', name: literal('string', 'doc'), value: literal('json-object', {list: [1]}), schema: 'drop'},
        {kind: 'named-value-set', name: literal('string', 'other'), value: literal('null', null), schema: 'drop'},
        {kind: 'named-value-delete', name: dynamicName},
        respond(scalarText(get(read(literal('string', 'doc')), [{kind: 'key', value: 'list'}])))
      ])
    );
    expect(await core.request(serverRequest({query: {name: 'missing'}}))).toMatchObject({
      status: 422,
      bodyText: '{"error":{"code":"DATA_NOT_FOUND"}}'
    });
    expect(outcome(await core.request(serverRequest({query: {name: ''}})))).toEqual({error: 'INVALID_NAME'});
    expect(outcome(await core.request(serverRequest({query: {name: 'doc'}})))).toEqual({error: 'DATA_NOT_FOUND'});
    expect(outcome(await core.request(serverRequest({query: {name: 'other'}})))).toEqual({error: 'TYPE_MISMATCH'});
  });

  it('round-trips a value through KVS, the way the design keeps data across requests', async () => {
    const {ir, codes} = await compileProject([
      block(`${SD}parseJson`, {NAME: 'saved', TEXT: reporter('kubohiroyakvs_getValue', {NAMESPACE: 'app', KEY: 'doc'})}),
      block(`${SD}setJsonAtPath`, {NAME: 'saved', PATH: '$.count', VALUE: requestBody}),
      block('kubohiroyakvs_setValue', {NAMESPACE: 'app', KEY: 'doc', VALUE: reporter(`${SD}toJson`, {NAME: 'saved'})}),
      respondText(reporter(`${SD}toJson`, {NAME: 'saved'}))
    ]);
    expect(codes).toEqual([]);
    expect(ir.capabilities).toEqual([{kind: 'key-value-store'}]);
    const values = new Map<string, string>([['app\0doc', '{"count":0}']]);
    const core = await loadGeneratedCore(ir, {
      keyValues: () => ({
        async get(namespace: string, key: string) {
          return values.get(`${namespace}\0${key}`) ?? null;
        },
        async set(namespace: string, key: string, value: string) {
          values.set(`${namespace}\0${key}`, value);
        }
      })
    });
    expect(outcome(await core.request(serverRequest({body: '1'})))).toEqual({value: '{"count":1}'});
    expect(outcome(await core.request(serverRequest({body: '[2]'})))).toEqual({value: '{"count":[2]}'});
    expect(values.get('app\0doc')).toBe('{"count":[2]}');
  });

  it('keeps a literal "__proto__" key, as JSON.parse does at runtime', async () => {
    const statements = (text: InputSpec) => [
      block(`${SD}parseJson`, {NAME: 'doc', TEXT: text}),
      respondText(reporter(`${SD}keysAtPath`, {NAME: 'doc', PATH: '$'}))
    ];
    const text = '{"__proto__":{"x":1}}';
    await expect(runProject(statements(text))).resolves.toEqual({value: '["__proto__"]'});
    await expect(runProject(statements(requestBody), {body: text})).resolves.toEqual({value: '["__proto__"]'});
  });
});

function literal(
  valueType: 'null' | 'boolean' | 'number' | 'string' | 'json-text' | 'json-array' | 'json-object',
  value: JsonValue
): ExpressionIrV2 {
  return {kind: 'literal', valueType, value};
}

function decode(text: ExpressionIrV2): ExpressionIrV2 {
  return {kind: 'structured-decode', valueType: JSON_VALUE_TYPE_V2, format: 'json', text};
}

function read(nameExpression: ExpressionIrV2): ExpressionIrV2 {
  return {kind: 'named-value', valueType: JSON_VALUE_TYPE_V2, name: nameExpression};
}

function get(root: ExpressionIrV2, pathValue: Extract<ExpressionIrV2, {kind: 'json-get'}>['path'] = []): ExpressionIrV2 {
  return {kind: 'json-get', valueType: JSON_VALUE_TYPE_V2, root, path: pathValue};
}

function scalarText(value: ExpressionIrV2): ExpressionIrV2 {
  return {kind: 'json-scalar-text', valueType: 'string', value};
}

function respond(body: ExpressionIrV2): StatementIrV2 {
  return {kind: 'respond', format: 'text', body};
}

function namedValueIr(body: StatementIrV2[]): DeployIrV2 {
  return {
    version: 2,
    name: 'named-values',
    auth: {kind: 'none'},
    capabilities: [],
    routes: [{id: 'route', method: 'POST', path: '/', auth: 'public', body}]
  };
}

/** The locked registry entry for an operation, so lowering sees the real 0.11.0-rc.1 block. */
function entry(operation: string): CompilerOpcodeRegistryEntry {
  const found = registry.entries.find(({block: manifestBlock}) => manifestBlock.server?.irOperation === operation);
  if (found === undefined) throw new Error(`No locked block for ${operation}`);
  return found;
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
