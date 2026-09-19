import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Hono} from 'hono';
import {ModuleKind, ScriptTarget, transpileModule} from 'typescript';
import {afterEach, describe, expect, it} from 'vitest';
import {
  compileDeployIrV2,
  compileToDirectory,
  generateHonoCore,
  upgradeDeployIrV1,
  type DeployIrV2,
  type PlatformAdapter
} from '../src/compiler/index.js';
import {generateCloudflareWorker} from '../src/compiler/generator.js';
import {parseDeployIr} from '../src/compiler/validate.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})));
});

describe('IR v2 platform pipeline', () => {
  it('generates deterministic core and Cloudflare adapter artifacts with a trace manifest', () => {
    const ir = messageApp();
    const first = compileDeployIrV2(ir, {target: 'cloudflare-workers'});
    const second = compileDeployIrV2(ir, {target: 'cloudflare-workers'});
    expect(first).toEqual(second);
    if (!first.ok) throw new Error('Expected successful compilation.');

    expect(Object.keys(first.files)).toEqual([...Object.keys(first.files)].sort());
    expect(Object.values(first.files).every((source) => source.endsWith('\n') && !source.includes('\r'))).toBe(true);
    expect(first.manifest).toMatchObject({
      formatVersion: 1,
      irVersion: 2,
      adapter: {id: 'cloudflare-workers', version: '1.1.0'},
      requirements: ['record-store'],
      plan: {requirements: ['record-store'], bindings: {recordDatabase: 'DB'}}
    });
    expect(JSON.parse(first.files['turbowarp-server.generated.json']!)).toEqual(first.manifest);
    expect(first.files['src/core.generated.ts']).not.toMatch(/Cloudflare|Firebase|D1Database|R2Bucket|cf-connecting/u);
    expect(first.files['src/index.ts']).toContain('D1Database');
  });

  it('returns distinct unknown-target, capability, and config diagnostics', () => {
    const unknown = compileDeployIrV2(messageApp(), {target: 'unknown-platform'});
    expect(unknown).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({code: 'TW2_UNKNOWN_TARGET', targetId: 'unknown-platform'})]
    });

    const unsupportedIr = messageApp();
    unsupportedIr.auth = {kind: 'jwt', scheme: 'external-jwt'};
    unsupportedIr.capabilities = [{kind: 'record-store'}, {kind: 'auth', scheme: 'external-jwt'}];
    unsupportedIr.routes[0]!.auth = 'required';
    const sourceRef = {targetIndex: 0, targetName: 'Stage', blockId: 'auth-route', opcode: 'http_auth_required'};
    unsupportedIr.routes[0]!.sourceRef = sourceRef;
    const unsupported = compileDeployIrV2(unsupportedIr, {target: 'cloudflare-workers'});
    expect(unsupported).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
          targetId: 'cloudflare-workers',
          routeId: 'create',
          sourceRef,
          reason: expect.any(String),
          suggestion: expect.any(String)
        })
      ]
    });

    const config = compileDeployIrV2(messageApp(), {
      target: 'cloudflare-workers',
      targetConfig: {secret: 'must-not-be-accepted'}
    });
    expect(config).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({code: 'TW2_TARGET_CONFIG_INVALID'})]
    });
  });

  it('adds a custom target without changing frontend or core generation', () => {
    const adapter: PlatformAdapter = {
      id: 'test-target',
      version: '7.0.0',
      capabilities: () => ({keys: ['record-store']}),
      plan: ({requirements}) => ({
        ok: true,
        plan: {
          targetId: 'test-target',
          adapterVersion: '7.0.0',
          requirements: requirements.keys,
          bindings: {}
        }
      }),
      generate: ({core}) => ({...core.files, 'target.txt': 'test'})
    };
    const result = compileDeployIrV2(messageApp(), {target: 'test-target', adapters: [adapter]});
    expect(result).toMatchObject({ok: true, manifest: {adapter: {id: 'test-target', version: '7.0.0'}}});
    if (result.ok) expect(result.files['target.txt']).toBe('test\n');
  });

  it('writes and typechecks the v2 Cloudflare fixture through the explicit CLI contract', async () => {
    const directory = await mkdtemp(join(resolve('tests'), '.generated-v2-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'input.json');
    const output = join(directory, 'output');
    await writeFile(input, JSON.stringify(messageApp()));

    await expect(
      compileToDirectory({input, output, format: 'ir', irVersion: 2})
    ).rejects.toThrow(/requires --target/);
    const result = await compileToDirectory({
      input,
      output,
      format: 'ir',
      irVersion: 2,
      target: 'cloudflare-workers'
    });
    expect(result.files).toContain('src/core.generated.ts');
    expect(await readFile(join(output, 'turbowarp-server.generated.json'), 'utf8')).toContain('cloudflare-workers');

    await installCloudflareTypecheckDependencies(output);
    await execFileAsync(resolve('node_modules/.bin/tsc'), ['--project', join(output, 'tsconfig.json')], {
      cwd: resolve('.')
    });
  });

  it('keeps core generation a pure filesystem-artifact operation', async () => {
    const before = generateHonoCore(messageApp());
    const after = generateHonoCore(messageApp());
    expect(before).toEqual(after);
    expect(before.entryModule).toBe('./core.generated.js');
  });

  it.each([
    ['cloudflare-workers', 'src/platform.ts'],
    ['firebase-functions', 'functions/src/platform.ts']
  ])('rejects an unsafe object key inside the %s adapter before SDK access', async (target, path) => {
    const result = compileDeployIrV2(messageApp(), {target});
    if (!result.ok) throw new Error(`Expected ${target} compilation to succeed.`);
    const platform = await loadModule(result.files[path]!);
    let accessed = false;
    const sdk =
      target === 'cloudflare-workers'
        ? {head: async () => {accessed = true; return null;}}
        : {file: () => {accessed = true; throw new Error('SDK must not be called.');}};
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      resolve(locator: {namespace: string; key: string}): Promise<unknown>;
    };

    await expect(createObjectStore(sdk).resolve({namespace: 'asset', key: '../private'})).rejects.toMatchObject({
      code: 'BINARY_INVALID_REF'
    });
    expect(accessed).toBe(false);
  });

  it.each([
    ['put: checksum does not match (10037)', 'BINARY_INTEGRITY_MISMATCH'],
    ['put: access denied (10003)', 'BINARY_STORAGE_FAILURE']
  ])('maps a documented R2 error without exposing its message', async (message, code) => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      put(
        locator: {namespace: string; key: string},
        source: {chunks: AsyncIterable<Uint8Array>; size: number},
        metadata: {integrity: string},
        maxBytes: number
      ): Promise<unknown>;
    };
    const bucket = {put: async () => Promise.reject(new Error(message))};
    const chunks = (async function* (): AsyncIterable<Uint8Array> {yield new Uint8Array([1]);})();

    await expect(
      createObjectStore(bucket).put(
        {namespace: 'asset', key: 'fixture.bin'},
        {chunks, size: 1},
        {integrity: `sha256:${'0'.repeat(64)}`},
        1024
      )
    ).rejects.toMatchObject({code, message: code});
  });

  it('preserves v1 HTTP route behavior after upgrading to the v2 core', async () => {
    const legacy = parseDeployIr({
      version: 1,
      name: 'parity',
      auth: 'none',
      routes: [
        {
          id: 'hello',
          method: 'GET',
          path: '/hello',
          auth: 'public',
          actions: [
            {kind: 'set-status', status: 202},
            {kind: 'set-header', name: 'x-parity', value: {kind: 'literal', value: 'yes'}},
            {kind: 'respond', format: 'text', body: {kind: 'literal', value: 'hello'}}
          ]
        }
      ]
    });
    const legacySource = generateCloudflareWorker(legacy)['src/routes.generated.ts']!
      .replace("'./auth'", "'./auth.mjs'")
      .replace("'./storage'", "'./storage.mjs'");
    const legacyModule = await loadModule(legacySource, {
      'auth.mjs': 'export async function authenticate() { return null; }\n',
      'storage.mjs':
        'export async function createRecord() {}\nexport async function deleteRecord() {}\nexport async function getRecord() {}\nexport async function listRecords() {}\n'
    });
    const upgraded = upgradeDeployIrV1(legacy, 'cloudflare-workers');
    expect(upgraded.diagnostics).toEqual([]);
    const coreModule = await loadModule(generateHonoCore(upgraded.ir).files['src/core.generated.ts']!);

    const legacyApp = new Hono();
    legacyModule.registerGeneratedRoutes!(legacyApp);
    const v2App = new Hono();
    coreModule.registerCoreRoutes!(v2App, {});
    const [legacyResponse, v2Response] = await Promise.all([
      legacyApp.request('http://local.test/hello'),
      v2App.request('http://local.test/hello')
    ]);

    expect({status: v2Response.status, header: v2Response.headers.get('x-parity'), body: await v2Response.text()}).toEqual({
      status: legacyResponse.status,
      header: legacyResponse.headers.get('x-parity'),
      body: await legacyResponse.text()
    });
  });

  it.each([
    ['INVALID_JSON', 422],
    ['PATH_NOT_FOUND', 422],
    ['BINARY_NOT_FOUND', 404],
    ['BINARY_TOO_LARGE', 413],
    ['BINARY_INTEGRITY_MISMATCH', 502],
    ['BINARY_BODY_CONSUMED', 500],
    ['BINARY_STORAGE_FAILURE', 502],
    ['PRIVATE_PLATFORM_FAILURE', 500]
  ])('maps runtime fault %s to a secret-safe %i response', async (code, status) => {
    const coreModule = await loadModule(generateHonoCore(messageApp()).files['src/core.generated.ts']!);
    const app = new Hono();
    const failure = Object.assign(new Error('private platform message'), {code});
    coreModule.registerCoreRoutes!(app, {
      records: () => ({
        create: async () => Promise.reject(failure),
        list: async () => [],
        get: async () => null,
        delete: async () => false
      })
    });

    const response = await app.request('http://local.test/messages', {method: 'POST', body: '{}'});
    expect(response.status).toBe(status);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({error: {code: code === 'PRIVATE_PLATFORM_FAILURE' ? 'IR_RUNTIME_ERROR' : code}});
    expect(body).not.toContain('private platform message');
  });
});

async function loadModule(
  source: string,
  supportFiles: Readonly<Record<string, string>> = {}
): Promise<Record<string, (...args: unknown[]) => unknown>> {
  const directory = await mkdtemp(join(resolve('tests'), '.generated-module-'));
  temporaryDirectories.push(directory);
  for (const [name, contents] of Object.entries(supportFiles)) await writeFile(join(directory, name), contents);
  const modulePath = join(directory, 'generated.mjs');
  const javascript = transpileModule(source, {
    compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.ES2022}
  }).outputText;
  await writeFile(modulePath, javascript);
  return import(`${pathToFileURL(modulePath).href}?test=${temporaryDirectories.length}`) as Promise<
    Record<string, (...args: unknown[]) => unknown>
  >;
}

async function installCloudflareTypecheckDependencies(output: string): Promise<void> {
  const typesDirectory = join(output, 'node_modules/@cloudflare/workers-types');
  await mkdir(typesDirectory, {recursive: true});
  await writeFile(
    join(typesDirectory, 'package.json'),
    JSON.stringify({name: '@cloudflare/workers-types', version: '0.0.0-test', types: 'index.d.ts'})
  );
  await writeFile(join(typesDirectory, 'index.d.ts'), cloudflareSdkStubs());
  await symlink(resolve('node_modules/hono'), join(output, 'node_modules/hono'));
}

function cloudflareSdkStubs(): string {
  return `interface D1ResultMeta {changes: number}
interface D1Result<T> {results: T[]; meta: D1ResultMeta}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result<unknown>>;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
}
interface D1Database {prepare(query: string): D1PreparedStatement}
interface R2HTTPMetadata {contentType?: string}
interface R2Object {version: string; size: number; httpMetadata: R2HTTPMetadata; customMetadata: Record<string, string>}
interface R2ObjectBody extends R2Object {body: ReadableStream<Uint8Array>}
interface R2PutOptions {httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string>; sha256?: string}
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream<Uint8Array>, options?: R2PutOptions): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
}
`;
}

function messageApp(): DeployIrV2 {
  return {
    version: 2,
    name: 'message-app',
    auth: {kind: 'none'},
    capabilities: [{kind: 'record-store'}],
    routes: [
      {
        id: 'create',
        method: 'POST',
        path: '/messages',
        auth: 'public',
        body: [
          {
            kind: 'record-create',
            collection: 'messages',
            data: {kind: 'request', valueType: 'string', source: 'body-text'},
            result: {id: 'created', type: {kind: 'value', valueType: 'json-object'}}
          },
          {kind: 'set-status', status: 201},
          {
            kind: 'respond',
            format: 'json',
            body: {kind: 'binding', valueType: 'json-object', binding: 'created'}
          }
        ]
      }
    ]
  };
}
