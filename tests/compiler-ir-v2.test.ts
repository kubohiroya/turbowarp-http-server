import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {
  canonicalizeDeployIrV2,
  canonicalizeJson,
  DeployIrV2ParseError,
  IR_V2_EXPRESSION_KINDS,
  IR_V2_STATEMENT_EFFECTS,
  IR_V2_STATEMENT_KINDS,
  parseDeployIrV2,
  parseDeployIrV2Json,
  type DeployIrV2
} from '../src/compiler/ir-v2/index.js';
import {DEFAULT_COMPILER_FEATURE_FLAGS} from '../src/compiler/feature-flags.js';

describe('Deploy IR v2 schema foundation', () => {
  it('strictly parses typed values and canonicalizes the document deterministically', () => {
    const ir = parseDeployIrV2({
      version: 2,
      name: 'typed-api',
      auth: {kind: 'none'},
      capabilities: [],
      routes: [
        {
          id: 'home',
          method: 'GET',
          path: '/',
          auth: 'public',
          body: [
            {kind: 'set-status', status: 200},
            {
              kind: 'respond',
              format: 'json',
              body: {kind: 'literal', valueType: 'json-object', value: {z: -0, a: [true, null]}}
            }
          ]
        }
      ]
    });

    const canonical = canonicalizeDeployIrV2(ir);
    expect(canonical).toContain('"value":{"a":[true,null],"z":0}');
    expect(parseDeployIrV2Json(canonical)).toEqual(ir);
  });

  it('rejects duplicate JSON keys, unknown fields, and non-finite values', () => {
    expectIrV2Error(
      () =>
        parseDeployIrV2Json(
          '{"version":2,"name":"x","name":"y","auth":{"kind":"none"},"capabilities":[],"routes":[]}'
        ),
      'TW2_IR_DUPLICATE_KEY',
      /Duplicate object key: name/
    );

    const fixture = minimalV2();
    expectIrV2Error(
      () => parseDeployIrV2({...fixture, target: 'cloudflare-workers'}),
      'TW2_IR_UNKNOWN_FIELD',
      /unknown field: target/
    );
    const body = fixture.routes[0]!.body[0] as {body: {value: unknown}};
    body.body.value = Number.POSITIVE_INFINITY;
    expect(() => parseDeployIrV2(fixture)).toThrow(/finite JSON number/);
    expect(() => canonicalizeJson('\uD800')).toThrow(/lone surrogates/);
  });

  it('returns stable diagnostic codes for invalid versions, nodes, values, and JSON', () => {
    expectIrV2Error(() => parseDeployIrV2({...minimalV2(), version: 1}), 'TW2_IR_VERSION');
    expectIrV2Error(() => parseDeployIrV2({...minimalV2(), version: 3}), 'TW2_IR_VERSION');
    const unknownNode = minimalV2();
    unknownNode.routes[0]!.body[0] = {kind: 'unknown'} as never;
    expectIrV2Error(() => parseDeployIrV2(unknownNode), 'TW2_IR_UNKNOWN_NODE');
    expectIrV2Error(() => parseDeployIrV2({...minimalV2(), routes: []}), 'TW2_IR_INVALID_VALUE');
    expectIrV2Error(() => parseDeployIrV2Json('{'), 'TW2_IR_JSON_SYNTAX');
  });

  it('keeps binary-body as a resource binding type rather than a literal type', async () => {
    const schema = JSON.parse(await readFile('schemas/deploy-ir-v2.schema.json', 'utf8')) as {
      $defs: {
        atomicValueType: {enum: string[]};
        bindingType: {oneOf: Array<{properties: {resourceType?: {const?: string}}}>};
      };
    };
    expect(schema.$defs.atomicValueType.enum).not.toContain('binary-body');
    expect(schema.$defs.bindingType.oneOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({properties: expect.objectContaining({resourceType: {const: 'binary-body'}})})
      ])
    );
  });

  it('accepts only logical binary references and rejects inline payload fields', async () => {
    const fixture = minimalV2();
    (fixture.routes[0]!.body[0] as {body: unknown}).body = {
      kind: 'literal',
      valueType: 'binary-ref',
      value: {
        namespace: 'asset',
        key: 'hero-image',
        contentType: 'image/png',
        size: 42,
        integrity: `sha256:${'a'.repeat(64)}`,
        revision: 'opaque-revision'
      }
    };
    expect(parseDeployIrV2(fixture)).toEqual(fixture);

    const inlinePayload = minimalV2();
    (inlinePayload.routes[0]!.body[0] as {body: unknown}).body = {
      kind: 'literal',
      valueType: 'binary-ref',
      value: {namespace: 'asset', key: 'hero-image', base64: 'AA=='}
    };
    expectIrV2Error(() => parseDeployIrV2(inlinePayload), 'TW2_IR_UNKNOWN_FIELD', /base64/);

    const schema = JSON.parse(await readFile('schemas/deploy-ir-v2.schema.json', 'utf8')) as {
      $defs: {binaryRefDescriptor: {additionalProperties: boolean; required: string[]; properties: object}};
    };
    expect(schema.$defs.binaryRefDescriptor).toMatchObject({
      additionalProperties: false,
      required: ['namespace', 'key']
    });
    expect(schema.$defs.binaryRefDescriptor.properties).not.toHaveProperty('base64');
    expect(schema.$defs.binaryRefDescriptor.properties).not.toHaveProperty('byteLength');
  });

  it('keeps the TypeScript and JSON Schema node discriminants aligned', async () => {
    const schema = JSON.parse(await readFile('schemas/deploy-ir-v2.schema.json', 'utf8')) as IrV2Schema;
    expect(referencedKinds(schema, 'expression').sort()).toEqual([...IR_V2_EXPRESSION_KINDS].sort());
    expect(referencedKinds(schema, 'statement').sort()).toEqual([...IR_V2_STATEMENT_KINDS].sort());
    expect(Object.keys(IR_V2_STATEMENT_EFFECTS).sort()).toEqual([...IR_V2_STATEMENT_KINDS].sort());
  });

  it('represents path keys and array indices as different schema alternatives', async () => {
    const schema = JSON.parse(await readFile('schemas/deploy-ir-v2.schema.json', 'utf8')) as {
      $defs: {pathSegment: {oneOf: Array<{properties: {kind: {const: string}; value: {type: string}}}>}};
    };
    expect(schema.$defs.pathSegment.oneOf.map((entry) => entry.properties.kind.const)).toEqual(['key', 'index']);
    expect(schema.$defs.pathSegment.oneOf.map((entry) => entry.properties.value.type)).toEqual(['string', 'integer']);
  });

  it('keeps optional named response bodies disabled by default', () => {
    expect(DEFAULT_COMPILER_FEATURE_FLAGS).toEqual({namedResponseBody: false});
  });

  it('parses the committed v2 example and normalizes set-like type metadata', async () => {
    const example = await readFile('examples/compiler/message-app.v2.ir.json', 'utf8');
    const ir = parseDeployIrV2Json(example);
    expect(ir.version).toBe(2);
    expect(ir.capabilities).toEqual([{kind: 'record-store'}]);

    const fixture = minimalV2();
    fixture.capabilities = [{kind: 'record-store'}, {kind: 'request-metadata', field: 'client-address'}];
    expect(parseDeployIrV2(fixture).capabilities).toEqual([
      {kind: 'record-store'},
      {kind: 'request-metadata', field: 'client-address'}
    ]);
    expect(() => parseDeployIrV2({...fixture, capabilities: [{kind: 'record-store'}, {kind: 'record-store'}]})).toThrow(
      /must not contain duplicates/
    );
  });

});

function minimalV2(): DeployIrV2 {
  return {
    version: 2,
    name: 'minimal',
    auth: {kind: 'none'},
    capabilities: [],
    routes: [
      {
        id: 'home',
        method: 'GET',
        path: '/',
        auth: 'public',
        body: [
          {
            kind: 'respond',
            format: 'text',
            body: {kind: 'literal', valueType: 'number', value: 1}
          }
        ]
      }
    ]
  };
}

interface IrV2Schema {
  $defs: Record<
    string,
    {
      oneOf?: Array<{
        $ref?: string;
        properties?: {kind?: {const?: string; enum?: string[]}};
      }>;
      properties?: {kind?: {const?: string; enum?: string[]}};
    }
  >;
}

function referencedKinds(schema: IrV2Schema, definition: string): string[] {
  const references = schema.$defs[definition]?.oneOf ?? [];
  return references.flatMap((reference) => {
    const name = reference.$ref?.slice('#/$defs/'.length);
    const kind = name === undefined ? reference.properties?.kind : schema.$defs[name]?.properties?.kind;
    if (kind?.const !== undefined) return [kind.const];
    return kind?.enum ?? [];
  });
}

function expectIrV2Error(
  operation: () => unknown,
  code: DeployIrV2ParseError['code'],
  message?: RegExp
): void {
  try {
    operation();
    throw new Error('Expected DeployIrV2ParseError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DeployIrV2ParseError);
    expect((error as DeployIrV2ParseError).code).toBe(code);
    if (message !== undefined) expect((error as Error).message).toMatch(message);
  }
}
