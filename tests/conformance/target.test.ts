import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {describe, expect, it} from 'vitest';
import {compileDeployIrV2, type DeployIrV2} from '../../src/compiler/index.js';

const execFileAsync = promisify(execFile);

describe('conformance target layer', () => {
  it('runs every registered target matrix entry deterministically and typechecks its output', async () => {
    const matrix = JSON.parse(
      await readFile(resolve('tests/fixtures/conformance/target/matrix.json'), 'utf8')
    ) as {
      fixtureVersion: number;
      targets: Array<{id: string; adapterVersion: string; tsconfig: string; expectedFiles: string[]}>;
    };
    expect(matrix.fixtureVersion).toBe(1);
    expect(matrix.targets.map(({id}) => id)).toEqual(['cloudflare-workers', 'firebase-functions']);

    for (const target of matrix.targets) {
      const first = compileDeployIrV2(targetIr(), {target: target.id});
      const second = compileDeployIrV2(targetIr(), {target: target.id});
      expect(first).toEqual(second);
      if (!first.ok) throw new Error(`Target ${target.id} did not compile.`);
      expect(first.manifest.adapter).toEqual({id: target.id, version: target.adapterVersion});
      expect(Object.keys(first.files)).toEqual(target.expectedFiles);
      await typecheckGeneratedProject(first.files, target.tsconfig, target.id);
      expect(first.files[target.id === 'cloudflare-workers' ? 'src/core.generated.ts' : 'functions/src/core.generated.ts'])
        .not.toMatch(/Cloudflare|Firebase|D1Database|R2Bucket|Firestore/u);
      if (target.id === 'cloudflare-workers') {
        expect(first.files['wrangler.jsonc']).toContain('r2_buckets');
      } else {
        expect(first.files['storage.rules']).toContain('allow read, write: if false');
        expect(first.files['firestore.rules']).toContain('allow read, write: if false');
      }
    }
  });

  it('rejects secrets and reports unsupported auth capability per target', () => {
    for (const target of ['cloudflare-workers', 'firebase-functions']) {
      const secret = compileDeployIrV2(targetIr(), {
        target,
        targetConfig: {serviceAccountKey: 'must-not-be-generated'}
      });
      expect(secret).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({code: 'TW2_TARGET_CONFIG_INVALID', targetId: target})]
      });
    }

    const ir = targetIr();
    ir.auth = {kind: 'jwt', scheme: 'external-jwt'};
    ir.capabilities.push({kind: 'auth', scheme: 'external-jwt'});
    ir.routes[0]!.auth = 'required';
    for (const target of ['cloudflare-workers', 'firebase-functions']) {
      expect(compileDeployIrV2(ir, {target})).toEqual({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
            targetId: target,
            routeId: 'create',
            suggestion: expect.any(String)
          })
        ]
      });
    }
  });

  it('enforces a target-specific binary limit before generation', () => {
    const ir = targetIr();
    const statement = ir.routes[1]!.body[0]!;
    if (statement.kind !== 'request-body-binary') throw new Error('Expected binary request fixture.');
    statement.maxBytes = 10_000_001;
    statement.sourceRef = {
      targetIndex: 0,
      targetName: 'Stage',
      blockId: 'binary-request',
      opcode: 'http_request_body_binary'
    };

    expect(compileDeployIrV2(ir, {target: 'cloudflare-workers'})).toMatchObject({ok: true});
    expect(compileDeployIrV2(ir, {target: 'firebase-functions'})).toEqual({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'TW2_TARGET_BINARY_LIMIT_EXCEEDED',
          targetId: 'firebase-functions',
          routeId: 'upload',
          sourceRef: statement.sourceRef,
          suggestion: expect.stringContaining('10000000')
        })
      ]
    });
  });
});

async function typecheckGeneratedProject(
  files: Readonly<Record<string, string>>,
  tsconfig: string,
  target: string
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'tw-conformance-target-'));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const destination = join(directory, path);
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, contents);
    }
    if (target === 'cloudflare-workers') {
      const typesDirectory = join(directory, 'node_modules/@cloudflare/workers-types');
      await mkdir(typesDirectory, {recursive: true});
      await writeFile(
        join(typesDirectory, 'package.json'),
        JSON.stringify({name: '@cloudflare/workers-types', version: '0.0.0-test', types: 'index.d.ts'})
      );
      await writeFile(join(typesDirectory, 'index.d.ts'), cloudflareSdkStubs());
      await symlink(resolve('node_modules/hono'), join(directory, 'node_modules/hono'));
    } else {
      await symlink(resolve('node_modules'), join(directory, 'node_modules'));
      await writeFile(join(directory, 'functions/src/conformance-sdk-stubs.d.ts'), firebaseSdkStubs());
    }
    try {
      await execFileAsync(resolve('node_modules/.bin/tsc'), ['--project', join(directory, tsconfig)], {
        cwd: resolve('.')
      });
    } catch (error) {
      const output =
        typeof error === 'object' && error !== null
          ? `${'stdout' in error ? String(error.stdout) : ''}${'stderr' in error ? String(error.stderr) : ''}`
          : String(error);
      throw new Error(output);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
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
interface R2Object {version: string; etag: string; size: number; httpMetadata: R2HTTPMetadata; customMetadata: Record<string, string>}
interface R2ObjectBody extends R2Object {body: ReadableStream<Uint8Array>}
interface R2Conditional {etagMatches?: string}
interface R2PutOptions {onlyIf?: R2Conditional; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string>; sha256?: string}
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: {onlyIf?: R2Conditional}): Promise<R2ObjectBody | R2Object | null>;
  put(key: string, value: ReadableStream<Uint8Array> | Uint8Array, options?: R2PutOptions): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
}
`;
}

function firebaseSdkStubs(): string {
  return `declare module 'firebase-admin/app' {export function initializeApp(): unknown}
declare module 'firebase-admin/firestore' {export function getFirestore(): import('./platform.js').FirestoreLike}
declare module 'firebase-admin/storage' {export function getStorage(): {bucket(name?: string): import('./platform.js').BucketLike}}
declare module 'firebase-functions/v2/https' {
  import type {IncomingMessage, ServerResponse} from 'node:http';
  export function onRequest(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): unknown;
}
`;
}

function targetIr(): DeployIrV2 {
  return {
    version: 2,
    name: 'target-matrix',
    auth: {kind: 'none'},
    capabilities: [{kind: 'object-storage'}, {kind: 'record-store'}, {kind: 'streaming-body'}],
    routes: [
      {
        id: 'create',
        method: 'POST',
        path: '/records',
        auth: 'public',
        body: [
          {
            kind: 'record-create',
            collection: 'records',
            data: {kind: 'literal', valueType: 'json-object', value: {}},
            result: {id: 'created', type: {kind: 'value', valueType: 'json-object'}}
          },
          {
            kind: 'respond',
            format: 'json',
            body: {kind: 'binding', valueType: 'json-object', binding: 'created'}
          }
        ]
      },
      {
        id: 'upload',
        method: 'PUT',
        path: '/objects',
        auth: 'public',
        body: [
          {
            kind: 'request-body-binary',
            maxBytes: 1024,
            result: {id: 'body', type: {kind: 'resource', resourceType: 'binary-body'}}
          },
          {
            kind: 'asset-object-put',
            locator: {namespace: 'asset', key: 'fixture.bin'},
            body: 'body',
            metadata: {contentType: 'application/octet-stream'},
            maxBytes: 1024,
            result: {id: 'stored', type: {kind: 'value', valueType: 'binary-ref'}}
          },
          {
            kind: 'respond',
            format: 'json',
            body: {kind: 'binding', valueType: 'binary-ref', binding: 'stored'}
          }
        ]
      }
    ]
  };
}
