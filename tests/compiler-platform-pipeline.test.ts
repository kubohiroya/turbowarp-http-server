import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {Writable} from 'node:stream';
import {Hono} from 'hono';
import {ModuleKind, ScriptTarget, transpileModule} from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  compileDeployIrV2,
  compileToDirectory,
  generateHonoCore,
  type DeployIrV2,
  type PlatformAdapter
} from '../src/compiler/index.js';

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
      adapter: {id: 'cloudflare-workers', version: '1.5.0'},
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
    unsupportedIr.capabilities = [{kind: 'record-store'}, {kind: 'named-body-provider'}];
    const unsupported = compileDeployIrV2(unsupportedIr, {target: 'cloudflare-workers'});
    expect(unsupported).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
          targetId: 'cloudflare-workers',
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

  it.each([
    ['external-jwt', 'JWT_JWKS_URL'],
    ['trusted-access-jwt', 'CF_ACCESS_TEAM_DOMAIN']
  ] as const)('generates Cloudflare %s authentication at the adapter boundary', (scheme, environmentName) => {
    const ir = authApp(scheme);
    if (scheme === 'trusted-access-jwt') ir.capabilities.push({kind: 'auth', scheme: 'external-jwt'});
    const result = compileDeployIrV2(ir, {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error(`Expected ${scheme} compilation to succeed.`);

    expect(result.manifest.requirements).toContain(`auth:${scheme}`);
    expect(result.files['src/core.generated.ts']).toContain("route.auth === 'required'");
    expect(result.files['src/index.ts']).toContain('authenticateRequest');
    expect(result.files['src/index.ts']).toContain(environmentName);
    if (scheme === 'trusted-access-jwt') expect(result.files['src/index.ts']).not.toContain('JWT_JWKS_URL');
    expect(result.files['src/auth.ts']).toContain('jwtVerify');
    expect(JSON.parse(result.files['package.json']!)).toMatchObject({dependencies: {jose: '^6.1.0'}});
  });

  it('enforces required authentication in the core and typechecks the Cloudflare JWT scaffold', async () => {
    const ir = authApp('external-jwt');
    const generated = compileDeployIrV2(ir, {target: 'cloudflare-workers'});
    if (!generated.ok) throw new Error('Expected authenticated Cloudflare compilation to succeed.');
    const core = await loadModule(generated.files['src/core.generated.ts']!);

    const denied = new Hono();
    core.registerCoreRoutes!(denied, {authenticate: async () => null});
    const deniedResponse = await denied.request('http://local.test/private');
    expect(deniedResponse.status).toBe(401);
    expect(await deniedResponse.json()).toEqual({error: {code: 'UNAUTHORIZED'}});

    const allowed = new Hono();
    core.registerCoreRoutes!(allowed, {authenticate: async () => ({id: 'user-1', claims: {sub: 'user-1'}})});
    const allowedResponse = await allowed.request('http://local.test/private');
    expect(allowedResponse.status).toBe(200);
    expect(await allowedResponse.json()).toEqual({ok: true});

    const directory = await mkdtemp(join(resolve('tests'), '.generated-auth-v2-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'input.json');
    const output = join(directory, 'output');
    await writeFile(input, JSON.stringify(ir));
    await compileToDirectory({input, output, format: 'ir', target: 'cloudflare-workers'});
    await installCloudflareTypecheckDependencies(output);
    await execFileAsync(resolve('node_modules/.bin/tsc'), ['--project', join(output, 'tsconfig.json')], {
      cwd: resolve('.')
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

    const result = await compileToDirectory({
      input,
      output,
      format: 'ir',
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

  it('maps the KVS capability to D1 or Firestore without coupling IR to either target', () => {
    const cloudflare = compileDeployIrV2(kvsApp(), {target: 'cloudflare-workers'});
    const firebase = compileDeployIrV2(kvsApp(), {target: 'firebase-functions'});
    if (!cloudflare.ok || !firebase.ok) throw new Error('Expected both KVS targets to compile.');

    expect(cloudflare.manifest).toMatchObject({
      adapter: {id: 'cloudflare-workers', version: '1.5.0'},
      requirements: ['key-value-store'],
      plan: {bindings: {recordDatabase: 'DB'}}
    });
    expect(cloudflare.files['migrations/0001_init.sql']).toContain('CREATE TABLE IF NOT EXISTS kvs');
    expect(cloudflare.files['migrations/0001_init.sql']).not.toContain('CREATE TABLE IF NOT EXISTS records');
    expect(cloudflare.files['src/index.ts']).toContain('keyValues:');
    expect(cloudflare.files['src/index.ts']).not.toContain('records:');
    expect(cloudflare.files['src/platform.ts']).not.toContain('ORDER BY key ASC LIMIT');

    expect(firebase.manifest).toMatchObject({
      adapter: {id: 'firebase-functions', version: '1.3.0'},
      requirements: ['key-value-store'],
      plan: {bindings: {functionName: 'api', keyValueCollection: 'key_values'}}
    });
    expect(firebase.files['functions/src/platform.ts']).toContain("createHash('sha256')");
    expect(firebase.files['functions/src/platform.ts']).not.toContain("orderBy('key', 'asc').limit");
    expect(JSON.parse(firebase.files['firestore.indexes.json']!)).toMatchObject({
      indexes: [
        {
          collectionGroup: 'key_values',
          fields: [
            {fieldPath: 'namespace', order: 'ASCENDING'},
            {fieldPath: 'key', order: 'ASCENDING'}
          ]
        }
      ]
    });
  });

  it.each([
    ['cloudflare-workers', 'src/platform.ts'],
    ['firebase-functions', 'functions/src/platform.ts']
  ])('validates KVS locators before accessing the %s SDK', async (target, path) => {
    const result = compileDeployIrV2(kvsApp(), {target});
    if (!result.ok) throw new Error(`Expected ${target} compilation to succeed.`);
    const platform = await loadModule(result.files[path]!);
    const access = vi.fn();
    const sdk = target === 'cloudflare-workers'
      ? {prepare: access}
      : {collection: () => ({doc: access}), runTransaction: vi.fn()};
    const createKeyValueStore = platform.createKeyValueStore as (value: unknown, root?: string) => {
      get(namespace: string, key: string): Promise<string | null>;
    };
    const store = target === 'cloudflare-workers'
      ? createKeyValueStore(sdk)
      : createKeyValueStore(sdk, 'key_values');

    await expect(store.get('INVALID', 'key')).rejects.toMatchObject({code: 'KVS_NAMESPACE_INVALID'});
    expect(access).not.toHaveBeenCalled();
  });

  it('executes all KVS operations through injected services', async () => {
    const coreModule = await loadModule(generateHonoCore(kvsApp()).files['src/core.generated.ts']!);
    const values = new Map<string, string>();
    const key = (namespace: string, name: string): string => `${namespace}\u0000${name}`;
    const app = new Hono();
    coreModule.registerCoreRoutes!(app, {
      keyValues: () => ({
        set: async (namespace: string, name: string, value: string) => {values.set(key(namespace, name), value);},
        get: async (namespace: string, name: string) => values.get(key(namespace, name)) ?? null,
        has: async (namespace: string, name: string) => values.has(key(namespace, name)),
        delete: async (namespace: string, name: string) => values.delete(key(namespace, name)),
        list: async (namespace: string) => [...values.keys()]
          .filter((entry) => entry.startsWith(`${namespace}\u0000`))
          .map((entry) => entry.slice(namespace.length + 1))
          .sort()
      })
    });

    const response = await app.request('http://local.test/kvs');
    const listResponse = await app.request('http://local.test/kvs/keys');
    const deleteResponse = await app.request('http://local.test/kvs', {method: 'DELETE'});

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
    expect(await listResponse.json()).toEqual(['greeting']);
    expect(await deleteResponse.json()).toBe(false);
    expect(values.has(key('sessions', 'greeting'))).toBe(false);
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

  it('accepts R2 objects whose optional metadata maps are absent', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const uploaded = new Date('2026-09-19T00:00:00.000Z');
    const bucket = {
      head: async () => ({etag: 'etag-1', version: 'version-1', uploaded, size: 3})
    };
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      resolve(locator: {namespace: string; key: string}): Promise<Record<string, unknown> | null>;
    };

    await expect(createObjectStore(bucket).resolve({namespace: 'asset', key: 'fixture.bin'})).resolves.toEqual({
      namespace: 'asset',
      key: 'fixture.bin',
      size: 3,
      revision: `r2:${JSON.stringify(['version-1', 'etag-1', uploaded.getTime()])}`
    });
  });

  it('rejects an R2 revision whose condition window exceeds the Date range', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const get = vi.fn();
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      get(ref: {namespace: string; key: string; revision: string}): Promise<unknown>;
    };

    await expect(createObjectStore({get}).get({
      namespace: 'asset',
      key: 'fixture.bin',
      revision: `r2:${JSON.stringify(['version-1', 'etag-1', -8_640_000_000_000_000])}`
    })).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();
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

  it('buffers a bounded R2 upload into an accepted fixed-size body', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const uploaded = new Date('2026-09-19T00:00:00.000Z');
    const put = vi.fn(async (_key: string, body: Uint8Array) => ({
      etag: 'etag-1', version: 'version-1', uploaded, size: body.byteLength
    }));
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      put(
        locator: {namespace: string; key: string},
        source: {chunks: AsyncIterable<Uint8Array>; size?: number},
        metadata: {size?: number},
        maxBytes: number
      ): Promise<unknown>;
    };
    const chunks = (async function* (): AsyncIterable<Uint8Array> {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3]);
    })();

    await createObjectStore({put}).put(
      {namespace: 'asset', key: 'fixture.bin'},
      {chunks},
      {size: 3},
      1024
    );

    expect(put).toHaveBeenCalledWith('v1/asset/fixture.bin', new Uint8Array([1, 2, 3]), {});
  });

  it('rejects an R2 upload whose declared size differs from the consumed bytes', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const put = vi.fn();
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      put(
        locator: {namespace: string; key: string},
        source: {chunks: AsyncIterable<Uint8Array>},
        metadata: {size: number},
        maxBytes: number
      ): Promise<unknown>;
    };
    const chunks = (async function* (): AsyncIterable<Uint8Array> {yield new Uint8Array([1]);})();

    await expect(createObjectStore({put}).put(
      {namespace: 'asset', key: 'fixture.bin'},
      {chunks},
      {size: 2},
      1024
    )).rejects.toMatchObject({code: 'BINARY_INTEGRITY_MISMATCH'});
    expect(put).not.toHaveBeenCalled();
  });

  it('uses an atomic R2 conditional tombstone for revision-aware delete', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const puts: Array<{key: string; value: unknown; options: unknown}> = [];
    const uploaded = new Date('2026-09-19T00:00:00.000Z');
    const current = {
      etag: 'etag-1',
      version: 'version-1',
      uploaded,
      size: 1,
      httpMetadata: {},
      customMetadata: {}
    };
    const bucket = {
      head: async () => current,
      delete: async () => {throw new Error('revision delete must not use unconditional delete');},
      put: async (key: string, value: unknown, options: unknown) => {
        puts.push({key, value, options});
        return {etag: 'tombstone', version: 'v2', uploaded: new Date(), size: 0, httpMetadata: {}, customMetadata: {twDeleted: '1'}};
      }
    };
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      delete(target: {namespace: string; key: string; revision: string}): Promise<boolean>;
    };

    await expect(
      createObjectStore(bucket).delete({
        namespace: 'asset',
        key: 'fixture.bin',
        revision: `r2:${JSON.stringify(['version-1', 'etag-1', uploaded.getTime()])}`
      })
    ).resolves.toBe(true);
    expect(puts).toEqual([
      expect.objectContaining({
        key: 'v1/asset/fixture.bin',
        options: {
          onlyIf: {
            etagMatches: 'etag-1',
            uploadedAfter: new Date(uploaded.getTime() - 1),
            uploadedBefore: new Date(uploaded.getTime() + 1)
          },
          customMetadata: {twDeleted: '1'}
        }
      })
    ]);
  });

  it('does not delete a later R2 upload that reuses an earlier ETag', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const previous = new Date('2026-09-19T00:00:00.000Z');
    const replacement = new Date('2026-09-19T00:00:01.000Z');
    const put = vi.fn();
    const bucket = {
      head: async () => ({
        etag: 'same-etag',
        version: 'version-2',
        uploaded: replacement,
        size: 1,
        httpMetadata: {},
        customMetadata: {}
      }),
      put
    };
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      delete(target: {namespace: string; key: string; revision: string}): Promise<boolean>;
    };

    await expect(createObjectStore(bucket).delete({
      namespace: 'asset',
      key: 'fixture.bin',
      revision: `r2:${JSON.stringify(['version-1', 'same-etag', previous.getTime()])}`
    })).resolves.toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('does not read a later R2 upload that reuses an earlier ETag', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const previous = new Date('2026-09-19T00:00:00.000Z');
    const replacement = new Date('2026-09-19T00:00:01.000Z');
    const bucket = {
      get: async () => ({
        etag: 'same-etag',
        version: 'version-2',
        uploaded: replacement,
        size: 1,
        httpMetadata: {},
        customMetadata: {},
        body: new ReadableStream<Uint8Array>()
      })
    };
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      get(target: {namespace: string; key: string; revision: string}): Promise<unknown>;
    };

    await expect(createObjectStore(bucket).get({
      namespace: 'asset',
      key: 'fixture.bin',
      revision: `r2:${JSON.stringify(['version-1', 'same-etag', previous.getTime()])}`
    })).resolves.toBeNull();
  });

  it('retries an R2 locator delete with the latest ETag instead of issuing an unconditional delete', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'cloudflare-workers'});
    if (!result.ok) throw new Error('Expected Cloudflare compilation to succeed.');
    const platform = await loadModule(result.files['src/platform.ts']!);
    const revisions = [
      {etag: 'etag-1', version: 'version-1', uploaded: new Date('2026-09-19T00:00:00.000Z')},
      {etag: 'etag-2', version: 'version-2', uploaded: new Date('2026-09-19T00:00:01.000Z')}
    ];
    const matches: Array<{etagMatches: string}> = [];
    const bucket = {
      head: async () => ({
        ...revisions[matches.length]!,
        size: 1,
        httpMetadata: {},
        customMetadata: {}
      }),
      delete: async () => {throw new Error('locator delete must not use unconditional delete');},
      put: async (_key: string, _value: unknown, options: {onlyIf: {etagMatches: string}}) => {
        matches.push(options.onlyIf);
        return matches.length === 1
          ? null
          : {etag: 'tombstone', version: 'v3', uploaded: new Date(), size: 0, httpMetadata: {}, customMetadata: {twDeleted: '1'}};
      }
    };
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      delete(target: {namespace: string; key: string}): Promise<boolean>;
    };

    await expect(createObjectStore(bucket).delete({namespace: 'asset', key: 'fixture.bin'})).resolves.toBe(true);
    expect(matches.map(({etagMatches}) => etagMatches)).toEqual(['etag-1', 'etag-2']);
  });

  it('keeps an existing Firebase object when staged upload integrity fails', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'firebase-functions'});
    if (!result.ok) throw new Error('Expected Firebase compilation to succeed.');
    const platform = await loadModule(result.files['functions/src/platform.ts']!);
    const destinationDelete = vi.fn();
    const stagingDelete = vi.fn(async () => undefined);
    const destination = {delete: destinationDelete};
    const staging = {
      createWriteStream: () => new Writable({write(_chunk, _encoding, callback) {callback();}}),
      delete: stagingDelete
    };
    const bucket = {
      file: (key: string) => key === 'v1/asset/fixture.bin' ? destination : staging
    };
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      put(
        locator: {namespace: string; key: string},
        source: {chunks: AsyncIterable<Uint8Array>; size: number},
        metadata: {integrity: string},
        maxBytes: number
      ): Promise<unknown>;
    };
    const chunks = (async function* (): AsyncIterable<Uint8Array> {yield new Uint8Array([1]);})();

    await expect(
      createObjectStore(bucket).put(
        {namespace: 'asset', key: 'fixture.bin'},
        {chunks, size: 1},
        {integrity: `sha256:${'0'.repeat(64)}`},
        1024
      )
    ).rejects.toMatchObject({code: 'BINARY_INTEGRITY_MISMATCH'});
    expect(destinationDelete).not.toHaveBeenCalled();
    expect(stagingDelete).toHaveBeenCalledWith({ignoreNotFound: true});
  });

  it('returns Firebase destination metadata from the copy response after staged validation', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'firebase-functions'});
    if (!result.ok) throw new Error('Expected Firebase compilation to succeed.');
    const platform = await loadModule(result.files['functions/src/platform.ts']!);
    const destination = {};
    const stagingDelete = vi.fn(async () => undefined);
    const integrity = 'sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
    const staging = {
      createWriteStream: () => new Writable({write(_chunk, _encoding, callback) {callback();}}),
      getMetadata: async () => [{generation: 'stage-1', metadata: {}}],
      setMetadata: async () => [{}],
      copy: async (target: unknown) => [target, {
        done: true,
        resource: {
          generation: 'destination-7',
          size: '3',
          contentType: 'application/octet-stream',
          metadata: {twIntegrity: integrity}
        }
      }],
      delete: stagingDelete
    };
    const bucket = {file: (key: string) => key.startsWith('v1/.staging/') ? staging : destination};
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      put(
        locator: {namespace: string; key: string},
        source: {chunks: AsyncIterable<Uint8Array>; size: number},
        metadata: {contentType: string},
        maxBytes: number
      ): Promise<{revision: string; size: number; contentType: string; integrity: string}>;
    };
    const chunks = (async function* (): AsyncIterable<Uint8Array> {yield new Uint8Array([1, 2, 3]);})();

    await expect(createObjectStore(bucket).put(
      {namespace: 'asset', key: 'fixture.bin'},
      {chunks, size: 3},
      {contentType: 'application/octet-stream'},
      1024
    )).resolves.toMatchObject({
      revision: 'destination-7',
      size: 3,
      contentType: 'application/octet-stream',
      integrity
    });
    expect(stagingDelete).toHaveBeenCalledWith({ignoreNotFound: true, ifGenerationMatch: 'stage-1'});
  });

  it('pins a Firebase body stream to the metadata generation', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'firebase-functions'});
    if (!result.ok) throw new Error('Expected Firebase compilation to succeed.');
    const platform = await loadModule(result.files['functions/src/platform.ts']!);
    const calls: Array<{generation?: string | number} | undefined> = [];
    const latest = {
      getMetadata: async () => [{generation: '7', size: '2', contentType: 'application/octet-stream'}]
    };
    const pinned = {
      createReadStream: async function* (): AsyncIterable<Uint8Array> {yield new Uint8Array([1, 2]);}
    };
    const bucket = {
      file: (_key: string, options?: {generation?: string | number}) => {
        calls.push(options);
        return options === undefined ? latest : pinned;
      }
    };
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      get(ref: {namespace: string; key: string; revision: string}): Promise<{
        chunks: AsyncIterable<Uint8Array>;
        size: number;
        contentType: string;
      } | null>;
    };

    const source = await createObjectStore(bucket).get({namespace: 'asset', key: 'fixture.bin', revision: '7'});
    expect(source).not.toBeNull();
    const chunks: number[] = [];
    for await (const chunk of source!.chunks) chunks.push(...chunk);
    expect(chunks).toEqual([1, 2]);
    expect(calls).toEqual([undefined, {generation: '7'}]);
  });

  it('uses a Firebase generation precondition for revision-aware delete', async () => {
    const result = compileDeployIrV2(messageApp(), {target: 'firebase-functions'});
    if (!result.ok) throw new Error('Expected Firebase compilation to succeed.');
    const platform = await loadModule(result.files['functions/src/platform.ts']!);
    const remove = vi.fn(async () => Promise.reject(Object.assign(new Error('stale'), {code: 412})));
    const createObjectStore = platform.createObjectStore as (value: unknown) => {
      delete(target: {namespace: string; key: string; revision: string}): Promise<boolean>;
    };

    await expect(
      createObjectStore({file: () => ({delete: remove})}).delete({
        namespace: 'asset',
        key: 'fixture.bin',
        revision: '7'
      })
    ).resolves.toBe(false);
    expect(remove).toHaveBeenCalledWith({ifGenerationMatch: '7'});
  });

  it.each([
    ['INVALID_JSON', 422],
    ['PATH_NOT_FOUND', 422],
    ['KVS_NAMESPACE_INVALID', 422],
    ['KVS_KEY_INVALID', 422],
    ['KVS_STORAGE_FAILURE', 502],
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
  await symlink(resolve('node_modules'), join(output, 'node_modules'));
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

function authApp(scheme: 'external-jwt' | 'trusted-access-jwt'): DeployIrV2 {
  return {
    version: 2,
    name: 'authenticated-app',
    auth: {kind: 'jwt', scheme},
    capabilities: [{kind: 'auth', scheme}],
    routes: [
      {
        id: 'private',
        method: 'GET',
        path: '/private',
        auth: 'required',
        body: [
          {
            kind: 'respond',
            format: 'json',
            body: {kind: 'literal', valueType: 'json-object', value: {ok: true}}
          }
        ]
      }
    ]
  };
}

function kvsApp(): DeployIrV2 {
  const namespace = {kind: 'literal', valueType: 'string', value: 'sessions'} as const;
  const key = {kind: 'literal', valueType: 'string', value: 'greeting'} as const;
  return {
    version: 2,
    name: 'kvs-app',
    auth: {kind: 'none'},
    capabilities: [{kind: 'key-value-store'}],
    routes: [
      {
        id: 'kvs',
        method: 'GET',
        path: '/kvs',
        auth: 'public',
        body: [
          {
            kind: 'kvs-set-text',
            namespace,
            key,
            value: {kind: 'literal', valueType: 'string', value: 'hello'}
          },
          {
            kind: 'respond',
            format: 'text',
            body: {kind: 'kvs-get-text', valueType: 'string', namespace, key}
          }
        ]
      },
      {
        id: 'kvs-keys',
        method: 'GET',
        path: '/kvs/keys',
        auth: 'public',
        body: [
          {
            kind: 'respond',
            format: 'json',
            body: {kind: 'kvs-list-keys', valueType: 'json-text', namespace}
          }
        ]
      },
      {
        id: 'kvs-delete',
        method: 'DELETE',
        path: '/kvs',
        auth: 'public',
        body: [
          {kind: 'kvs-delete', namespace, key},
          {
            kind: 'respond',
            format: 'json',
            body: {kind: 'kvs-has', valueType: 'boolean', namespace, key}
          }
        ]
      }
    ]
  };
}
