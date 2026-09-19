import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Hono} from 'hono';
import {ModuleKind, ScriptTarget, transpileModule} from 'typescript';
import {afterEach, describe, expect, it} from 'vitest';
import {
  compileToDirectory,
  compileDeployIrV2,
  generateHonoCore,
  parseDeployIrV2,
  validateDeployIrV2Subset,
  type DeployIrV2,
  type PlatformAdapter
} from '../src/compiler/index.js';
import {
  NamedBodyResponder,
  NamedBodyResolver,
  type NamedBodyProvider,
  type NamedBodyRequest
} from '../src/named-body.js';

const temporaryDirectories: string[] = [];
const enabled = {compilerIrV2: true, namedResponseBody: true} as const;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})));
});

describe('named response body IR', () => {
  it('strictly parses the canonical descriptor without inline bytes', () => {
    const ir = parseDeployIrV2(fixture());
    expect(ir.routes[0]!.method).toBe('ALL');
    expect(ir.routes[0]!.body[0]).toMatchObject({
      kind: 'respond-named-body',
      reference: {namespace: 'structured-data', name: 'profile', kind: 'structured', scope: 'project'},
      representation: 'json',
      maxBytes: 1024
    });

    const inline = fixture() as unknown as {routes: Array<{body: Array<Record<string, unknown>>}>};
    inline.routes[0]!.body[0]!.base64 = 'AA==';
    expect(() => parseDeployIrV2(inline)).toThrow(/unknown field: base64/u);
  });

  it('requires the named capability and an explicit feature flag', () => {
    const ir = parseDeployIrV2(fixture());
    expect(validateDeployIrV2Subset(ir).map(({code}) => code)).toEqual([
      'TW2_NAMED_RESPONSE_BODY_DISABLED',
      'TW2_NAMED_RESPONSE_BODY_DISABLED'
    ]);
    expect(validateDeployIrV2Subset(ir, undefined, enabled)).toEqual([]);

    ir.capabilities = [];
    expect(validateDeployIrV2Subset(ir, undefined, enabled).map(({code}) => code)).toContain(
      'TW2_CAPABILITY_MISSING'
    );
  });

  it('rejects ambiguous target and project scope identities', () => {
    const missing = fixture();
    const missingStatement = missing.routes[0]!.body[0]!;
    if (missingStatement.kind !== 'respond-named-body') throw new Error('Expected named response fixture.');
    missingStatement.reference.scope = 'target';
    expect(() => parseDeployIrV2(missing)).toThrow(/targetId is required/u);

    const extra = fixture();
    const extraStatement = extra.routes[0]!.body[0]!;
    if (extraStatement.kind !== 'respond-named-body') throw new Error('Expected named response fixture.');
    extraStatement.targetId = 'Stage:1';
    expect(() => parseDeployIrV2(extra)).toThrow(/targetId is not allowed/u);
  });

  it('runs structured and raw named responses through the generated Hono core', async () => {
    const ir = parseDeployIrV2(fixture());
    const module = await loadModule(generateHonoCore(ir).files['src/core.generated.ts']!);
    const bodies = new Map([
      ['structured-data\0profile\0json', {mediaType: 'application/json', bytes: new TextEncoder().encode('{"name":"Ada"}')}],
      ['asset-manager\0avatar\0raw', {mediaType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47])}]
    ]);
    const provider: NamedBodyProvider = {
      canResolve: () => true,
      stat: (request) => {
        const item = bodies.get(bodyKey(request));
        return item === undefined ? null : {mediaType: item.mediaType, byteLength: item.bytes.byteLength};
      },
      openBody: (request) => {
        const item = bodies.get(bodyKey(request));
        return item === undefined
          ? null
          : {
              metadata: {mediaType: item.mediaType, byteLength: item.bytes.byteLength},
              body: item.bytes,
              release: () => undefined
            };
      }
    };
    const responder = new NamedBodyResponder(new NamedBodyResolver([provider]), {namedResponseBody: true});
    const app = new Hono();
    module.registerCoreRoutes!(app, {namedBodies: () => responder});

    const profile = await app.request('http://local.test/profile');
    expect(profile.headers.get('content-type')).toBe('application/json');
    expect(await profile.json()).toEqual({name: 'Ada'});
    const head = await app.request('http://local.test/profile', {method: 'HEAD'});
    expect(head.headers.get('content-length')).toBe('14');
    expect(await head.text()).toBe('');
    const avatar = await app.request('http://local.test/avatar');
    expect(new Uint8Array(await avatar.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('keeps targets explicit until a real provider adapter is installed', () => {
    const ir = parseDeployIrV2(fixture());
    expect(compileDeployIrV2(ir, {target: 'cloudflare-workers'})).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({code: 'TW2_NAMED_RESPONSE_BODY_DISABLED', routeId: 'profile'}),
        expect.objectContaining({code: 'TW2_NAMED_RESPONSE_BODY_DISABLED', routeId: 'avatar'})
      ]
    });
    expect(compileDeployIrV2(ir, {target: 'cloudflare-workers', featureFlags: enabled})).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
          targetId: 'cloudflare-workers',
          routeId: 'profile'
        })
      ]
    });

    const fakeTarget: PlatformAdapter = {
      id: 'named-test',
      version: '1.0.0',
      capabilities: () => ({keys: ['named-body-provider'], maxBinaryBytes: 1024}),
      plan: ({requirements}) => ({
        ok: true,
        plan: {
          targetId: 'named-test',
          adapterVersion: '1.0.0',
          requirements: requirements.keys,
          bindings: {}
        }
      }),
      generate: ({core}) => core.files
    };
    expect(
      compileDeployIrV2(ir, {target: 'named-test', adapters: [fakeTarget], featureFlags: enabled})
    ).toMatchObject({ok: true});
  });

  it('wires the opt-in through the public directory compiler', async () => {
    const directory = await mkdtemp(join(resolve('tests'), '.compile-named-ir-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'deploy-ir.json');
    await writeFile(input, JSON.stringify(fixture()));

    await expect(
      compileToDirectory({
        input,
        output: join(directory, 'disabled'),
        format: 'ir',
        irVersion: 2,
        target: 'cloudflare-workers'
      })
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({code: 'TW2_NAMED_RESPONSE_BODY_DISABLED'}), expect.anything()]
    });
    await expect(
      compileToDirectory({
        input,
        output: join(directory, 'enabled'),
        format: 'ir',
        irVersion: 2,
        target: 'cloudflare-workers',
        namedResponseBody: true
      })
    ).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED'})]
    });
  });
});

async function loadModule(source: string): Promise<Record<string, (...args: unknown[]) => unknown>> {
  const directory = await mkdtemp(join(resolve('tests'), '.generated-named-ir-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'core.mjs');
  await writeFile(
    path,
    transpileModule(source, {
      compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.ES2022}
    }).outputText
  );
  return import(`${pathToFileURL(path).href}?test=${temporaryDirectories.length}`) as Promise<
    Record<string, (...args: unknown[]) => unknown>
  >;
}

function fixture(): DeployIrV2 {
  return {
    version: 2,
    name: 'named-body',
    auth: {kind: 'none'},
    capabilities: [{kind: 'named-body-provider'}],
    routes: [
      {
        id: 'profile',
        method: 'ALL',
        path: '/profile',
        auth: 'public',
        body: [
          {
            kind: 'respond-named-body',
            reference: {namespace: 'structured-data', name: 'profile', kind: 'structured', scope: 'project'},
            representation: 'json',
            maxBytes: 1024
          }
        ]
      },
      {
        id: 'avatar',
        method: 'GET',
        path: '/avatar',
        auth: 'public',
        body: [
          {
            kind: 'respond-named-body',
            reference: {namespace: 'asset-manager', name: 'avatar', kind: 'asset', scope: 'project'},
            representation: 'raw',
            maxBytes: 1024
          }
        ]
      }
    ]
  };
}

function bodyKey(request: NamedBodyRequest): string {
  return `${request.reference.namespace}\0${request.reference.name}\0${request.representation}`;
}
