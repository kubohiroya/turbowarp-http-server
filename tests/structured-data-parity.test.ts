import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {
  decodeStructuredJson,
  getJsonAtPath,
  parseCompilerExtensionManifestJson,
  parseStructuredDataPath,
  structuredIterationEntries,
  type CompilerExtensionManifest,
  type DeployIrV2,
  type ExpressionIrV2,
  type StatementIrV2
} from '../src/compiler/index.js';
import {
  HTTP,
  SD,
  block,
  browserOutcome,
  browserUtility,
  createBrowserStructuredData,
  query,
  reporter,
  requestBody,
  respondText,
  runProject,
  type BrowserStructuredData,
  type InputSpec,
  type ServerOutcome,
  type StatementSpec
} from './structured-data-support.js';

/**
 * Runs the Structured Data semantic-parity fixture through the server pipeline: each case becomes a
 * minimal TurboWarp project, the frontend lowers it with the locked 0.11.0-rc.1 manifest, the IR
 * validator checks it, and the generated Hono core answers a request.
 *
 * Where the browser fails at runtime but the server rejects the project when it compiles, the case
 * asserts the compile-time diagnostic instead of the runtime code:
 *
 * | browser runtime code                              | server diagnostic                | why                             |
 * | ------------------------------------------------- | -------------------------------- | ------------------------------- |
 * | INVALID_PATH                                      | TW2_STRUCTURED_INVALID_PATH      | PATH must be a literal          |
 * | INVALID_PATH from deleting the root               | TW2_STRUCTURED_INVALID_PATH      | the root path is literal        |
 * | ITERATION_CONTEXT_REQUIRED                        | TW2_ITERATION_CONTEXT_REQUIRED   | loops are lexical in the IR     |
 * | INVALID_NAME from a literal NAME                  | TW2_STRUCTURED_INVALID_NAME      | the empty literal is known      |
 * | INVALID_JSON, PARSE_LIMIT_EXCEEDED, literal TEXT  | TW2_STRUCTURED_INVALID_LITERAL   | literal TEXT is decoded early   |
 * | INVALID_JSON from a literal set VALUE             | TW2_STRUCTURED_INVALID_LITERAL   | literal VALUE is parsed early   |
 * | any code of parse YAML (phase 2)                  | TW2_UNSUPPORTED_OPERATION        | YAML is not lowered in phase 1  |
 *
 * Every case runs twice: once with literal inputs, and once with TEXT read from the request body and
 * every NAME read from a query parameter, which moves INVALID_NAME and decoding errors to runtime.
 */

const FIXTURE = 'tests/fixtures/structured-data/semantic-parity.json';
const SOURCE = 'tests/fixtures/structured-data/semantic-parity.source.json';
const MANIFEST = 'tests/fixtures/compiler-manifests/structured-data.json';

interface ParityCase {
  name: string;
  format: 'json' | 'yaml';
  text: string;
  dataName: string;
  path?: string;
  normalizedPath?: unknown;
  setJson?: string;
  expectedJson?: string;
  error?: string;
}

interface ReadCase {
  name: string;
  format: 'json' | 'yaml';
  text: string;
  dataName: string;
  loops?: Array<{path: string; entry: number}>;
  operation: string;
  readName?: string;
  path: string;
  expectedJson?: string;
  expectedText?: string;
  error?: string;
}

interface ParityFixture {
  schemaVersion: number;
  manifestFormatVersion: number;
  dataReference: {kind: string; scope: string; lifetime: string};
  serverUnsupportedOpcodes: string[];
  cases: ParityCase[];
  readCases: ReadCase[];
}

type Variant = 'literal' | 'dynamic';
const VARIANTS: readonly Variant[] = ['literal', 'dynamic'];

const fixtureText = await readFile(FIXTURE, 'utf8');
const fixture = JSON.parse(fixtureText) as ParityFixture;
const manifest: CompilerExtensionManifest = parseCompilerExtensionManifestJson(await readFile(MANIFEST, 'utf8'));
const blockByOperation = new Map(
  manifest.blocks.flatMap((entry) => (entry.server?.irOperation === undefined ? [] : [[entry.server.irOperation, entry]]))
);

describe('Structured Data semantic-parity fixture', () => {
  it('is the recorded upstream file and agrees with the locked manifest', async () => {
    const source = JSON.parse(await readFile(SOURCE, 'utf8')) as {repository: string; commit: string; sha256: string};
    expect(source.repository).toBe('https://github.com/kubohiroya/turbowarp-structured-data');
    expect(source.commit).toMatch(/^6bbb908[0-9a-f]{33}$/u);
    expect(createHash('sha256').update(fixtureText).digest('hex')).toBe(source.sha256);

    expect(fixture.manifestFormatVersion).toBe(manifest.formatVersion);
    expect(manifest.dataReferenceType).toMatchObject(fixture.dataReference);
    expect(fixture.serverUnsupportedOpcodes).toEqual(
      manifest.blocks.filter((entry) => entry.server?.supported !== true).map((entry) => entry.opcode)
    );
    for (const testCase of fixture.readCases) {
      const entry = blockByOperation.get(testCase.operation);
      expect(entry?.server?.supported, testCase.name).toBe(true);
      if (testCase.error !== undefined) expect(entry?.errors, testCase.name).toContain(testCase.error);
    }
  });

  it('describes the published browser extension this compiler is checked against', async () => {
    for (const testCase of fixture.cases) {
      const extension = await createBrowserStructuredData();
      const util = browserUtility();
      const result = browserOutcome(() => {
        parse(extension, testCase, util);
        if (testCase.setJson !== undefined) {
          extension.setJsonAtPath({NAME: testCase.dataName, PATH: testCase.path, VALUE: testCase.setJson}, util);
        }
        return extension.toJson({NAME: testCase.dataName}, util);
      });
      expect(result, testCase.name).toEqual(
        testCase.error === undefined ? {value: testCase.expectedJson} : {error: testCase.error}
      );
    }
    for (const testCase of fixture.readCases) {
      if (testCase.loops !== undefined || testCase.operation.startsWith('structuredData.current')) continue;
      const extension = await createBrowserStructuredData();
      const util = browserUtility();
      parse(extension, testCase, util);
      const args = {NAME: testCase.readName ?? testCase.dataName, PATH: testCase.path};
      const result = browserOutcome(() =>
        testCase.operation === 'structuredData.get' ? extension.getJsonAtPath(args, util) : extension.getTextAtPath(args, util)
      );
      expect(result, testCase.name).toEqual(
        testCase.error === undefined ? {value: testCase.expectedJson ?? testCase.expectedText} : {error: testCase.error}
      );
    }
  });
});

describe('Structured Data parity cases on the server', () => {
  it.each(fixture.cases.flatMap((testCase) => VARIANTS.map((variant) => [testCase.name, variant, testCase] as const)))(
    '%s (%s)',
    async (_name, variant, testCase) => {
      if (testCase.normalizedPath !== undefined) {
        expect(parseStructuredDataPath(testCase.path!)).toEqual(testCase.normalizedPath);
      }
      const dynamic = variant === 'dynamic';
      const name: InputSpec = dynamic ? query('name') : testCase.dataName;
      const statements: StatementSpec[] = [parseBlock(testCase.format, name, dynamic ? requestBody : testCase.text)];
      if (testCase.setJson !== undefined) {
        statements.push(
          block(`${SD}setJsonAtPath`, {NAME: name, PATH: testCase.path!, VALUE: dynamic ? query('value') : testCase.setJson})
        );
      }
      statements.push(respondText(reporter(`${SD}toJson`, {NAME: name})));

      const result = await runProject(
        statements,
        dynamic ? {query: {name: testCase.dataName, value: testCase.setJson ?? ''}, body: testCase.text} : {}
      );

      if (testCase.format === 'yaml') expect(result).toEqual({compile: ['TW2_UNSUPPORTED_OPERATION']});
      else if (testCase.error !== undefined) expect(result).toEqual(serverError(testCase.error, variant));
      else expect(result).toEqual({value: testCase.expectedJson});
    }
  );
});

describe('Structured Data parity read cases on the server', () => {
  it.each(fixture.readCases.flatMap((testCase) => VARIANTS.map((variant) => [testCase.name, variant, testCase] as const)))(
    '%s (%s)',
    async (_name, variant, testCase) => {
      const dynamic = variant === 'dynamic';
      const parseName: InputSpec = dynamic ? query('name') : testCase.dataName;
      const readName: InputSpec = dynamic ? query('read') : (testCase.readName ?? testCase.dataName);
      const read = readReporter(testCase.operation, readName, testCase.path);
      const parse = parseBlock(testCase.format, parseName, dynamic ? requestBody : testCase.text);

      let statements: StatementSpec[];
      let transform: ((ir: DeployIrV2) => void) | undefined;
      if (testCase.loops === undefined) {
        statements = [parse, respondText(read)];
      } else {
        // The read happens inside the loops and leaves them through a handler variable, because a
        // response inside a loop is rejected. MAX is 10 rather than the browser test's 100 so nested
        // loops stay inside the route work budget; every fixture collection is far smaller.
        let body: StatementSpec[] = [block(`${HTTP}setHandlerVariable`, {NAME: 'result', VALUE: read})];
        for (const loop of [...testCase.loops].reverse()) {
          body = [block(`${SD}forEachAtPath`, {NAME: parseName, PATH: loop.path, MAX: 10}, body)];
        }
        statements = [parse, ...body, respondText(reporter(`${HTTP}handlerVariable`, {NAME: 'result'}))];
        transform = (ir) => selectEntries(ir, entryKeys(testCase));
      }

      const result = await runProject(
        statements,
        dynamic ? {query: {name: testCase.dataName, read: testCase.readName ?? testCase.dataName}, body: testCase.text} : {},
        transform
      );

      expect(result).toEqual(expectedRead(testCase, variant));
    }
  );
});

function expectedRead(testCase: ReadCase, variant: Variant): ServerOutcome {
  if (testCase.format === 'yaml') return {compile: ['TW2_UNSUPPORTED_OPERATION']};
  if (testCase.error !== undefined) return serverError(testCase.error, variant);
  const entry = blockByOperation.get(testCase.operation);
  return {value: (entry?.resultType === 'string' ? testCase.expectedText : testCase.expectedJson)!};
}

/** The server outcome for a browser runtime code, following the table at the top of this file. */
function serverError(code: string, variant: Variant): ServerOutcome {
  if (code === 'INVALID_PATH') return {compile: ['TW2_STRUCTURED_INVALID_PATH']};
  if (code === 'ITERATION_CONTEXT_REQUIRED') return {compile: ['TW2_ITERATION_CONTEXT_REQUIRED']};
  if (variant === 'literal' && code === 'INVALID_NAME') return {compile: ['TW2_STRUCTURED_INVALID_NAME']};
  if (variant === 'literal' && (code === 'INVALID_JSON' || code === 'PARSE_LIMIT_EXCEEDED')) {
    return {compile: ['TW2_STRUCTURED_INVALID_LITERAL']};
  }
  return {error: code};
}

function parse(extension: BrowserStructuredData, testCase: {format: string; text: string; dataName: string}, util = browserUtility()): void {
  if (testCase.format === 'json') extension.parseJson({TEXT: testCase.text, NAME: testCase.dataName}, util);
  else extension.parseYaml({TEXT: testCase.text, NAME: testCase.dataName}, util);
}

function parseBlock(format: 'json' | 'yaml', name: InputSpec, text: InputSpec): StatementSpec {
  return block(`${SD}${format === 'json' ? 'parseJson' : 'parseYaml'}`, {NAME: name, TEXT: text});
}

/** The reporter block the manifest names for an operation, with only the inputs it declares. */
function readReporter(operation: string, name: InputSpec, path: string) {
  const entry = blockByOperation.get(operation);
  if (entry === undefined) throw new Error(`Unknown operation ${operation}`);
  const inputs: Record<string, InputSpec> = {};
  for (const argument of entry.arguments) {
    if (argument.id === 'NAME') inputs.NAME = name;
    if (argument.id === 'PATH') inputs.PATH = path;
  }
  return reporter(`${SD}${entry.opcode}`, inputs);
}

/** The browser test enters each loop at an entry index; the server needs that entry's key. */
function entryKeys(testCase: ReadCase): string[] {
  const root = decodeStructuredJson(testCase.text);
  return (testCase.loops ?? []).map((loop) => {
    const entries = structuredIterationEntries(getJsonAtPath(root, parseStructuredDataPath(loop.path)), [], 1000);
    const entry = entries[loop.entry];
    if (entry === undefined) throw new Error(`${testCase.name}: loop entry ${loop.entry} does not exist.`);
    return entry.key;
  });
}

/**
 * The browser fixture steps each loop by hand to one entry and reads there; the server runs every
 * entry. The frontend has no conditional block, so this wraps each frontend-lowered loop body in an IR
 * `if` that passes only for the selected entry's key. The read itself stays exactly as lowered.
 */
function selectEntries(ir: DeployIrV2, keys: readonly string[]): void {
  const route = ir.routes[0]!;
  const text = (value: string): ExpressionIrV2 => ({kind: 'literal', valueType: 'string', value});
  const wrap = (statements: StatementIrV2[], level: number): void => {
    for (const statement of statements) {
      if (statement.kind !== 'json-for-each') continue;
      wrap(statement.body, level + 1);
      statement.body = [
        {
          kind: 'if',
          condition: {
            kind: 'handler-variable-exists',
            valueType: 'boolean',
            name: {
              kind: 'concat',
              valueType: 'string',
              left: text(`entry${level}:`),
              right: {kind: 'iteration-key', valueType: 'string', loopId: statement.loopId}
            }
          },
          then: statement.body
        }
      ];
    }
  };
  wrap(route.body, 0);
  route.body.unshift(
    ...keys.map(
      (key, level): StatementIrV2 => ({kind: 'set-handler-variable', name: text(`entry${level}:${key}`), value: text('1')})
    )
  );
}
