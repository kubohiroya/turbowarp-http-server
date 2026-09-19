import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
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
      adapter: {id: 'cloudflare-workers', version: '1.0.0'},
      requirements: ['record-store'],
      plan: {requirements: ['record-store'], bindings: {recordDatabase: 'DB'}}
    });
    expect(JSON.parse(first.files['turbowarp-server.generated.json']!)).toEqual(first.manifest);
    expect(first.files['src/core.generated.ts']).not.toMatch(/Cloudflare|Firebase|D1Database|R2Bucket|cf-connecting/u);
    expect(first.files['src/index.ts']).toContain('D1Database');
  });

  it('returns distinct unknown-target, capability, and config diagnostics', () => {
    const unknown = compileDeployIrV2(messageApp(), {target: 'firebase-functions'});
    expect(unknown).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({code: 'TW2_UNKNOWN_TARGET', targetId: 'firebase-functions'})]
    });

    const binary = messageApp();
    binary.capabilities = [{kind: 'record-store'}, {kind: 'object-storage'}];
    const sourceRef = {targetIndex: 0, targetName: 'Stage', blockId: 'asset', opcode: 'asset_resolve'};
    binary.routes[0]!.body.splice(-1, 0, {
      kind: 'asset-resolve',
      locator: {namespace: 'assets', key: 'hero.png'},
      result: {
        id: 'asset',
        type: {kind: 'value', valueType: {kind: 'union', members: ['null', 'binary-ref']}}
      },
      sourceRef
    });
    const unsupported = compileDeployIrV2(binary, {target: 'cloudflare-workers'});
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

    await symlink(resolve('node_modules'), join(output, 'node_modules'));
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
