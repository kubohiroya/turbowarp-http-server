import type {DeployIrV2} from '../ir-v2/types.js';
import type {
  PipelineDiagnostic,
  PlatformAdapter,
  PlatformPlan
} from '../pipeline/types.js';
import {findCapabilityOrigin} from '../pipeline/requirements.js';

export const cloudflareWorkersAdapter: PlatformAdapter = {
  id: 'cloudflare-workers',
  version: '1.3.0',
  capabilities: () => ({
    keys: ['object-storage', 'record-store', 'request-metadata:client-address', 'streaming-body'],
    maxBinaryBytes: 16 * 1024 * 1024
  }),
  plan({ir, requirements, config}) {
    const unsupported = requirements.keys.filter(
      (requirement) => !cloudflareWorkersAdapter.capabilities().keys.includes(requirement)
    );
    if (unsupported.length > 0) {
      return {
        ok: false,
        diagnostics: unsupported.map((requirement) => capabilityDiagnostic(requirement, ir))
      };
    }
    const parsed = parseConfig(config);
    if ('diagnostic' in parsed) return {ok: false, diagnostics: [parsed.diagnostic]};
    return {
      ok: true,
      plan: {
        targetId: cloudflareWorkersAdapter.id,
        adapterVersion: cloudflareWorkersAdapter.version,
        requirements: requirements.keys,
        bindings: {
          ...(requirements.keys.includes('record-store') ? {recordDatabase: parsed.recordDatabaseBinding} : {}),
          ...(requirements.keys.includes('object-storage') ? {objectBucket: parsed.objectBucketBinding} : {})
        }
      }
    };
  },
  generate({ir, plan, core}) {
    return {
      ...core.files,
      'package.json': packageJson(ir),
      'tsconfig.json': tsconfig(),
      'src/index.ts': indexSource(plan),
      'src/platform.ts': platformSource(),
      'wrangler.jsonc': wrangler(ir, plan),
      ...(plan.requirements.includes('record-store') ? {'migrations/0001_init.sql': migration()} : {}),
      'README.md': generatedReadme(ir, plan)
    };
  }
};

function parseConfig(config: unknown):
  | {recordDatabaseBinding: string; objectBucketBinding: string}
  | {diagnostic: PipelineDiagnostic} {
  if (config === undefined || config === null) return {recordDatabaseBinding: 'DB', objectBucketBinding: 'OBJECTS'};
  if (typeof config !== 'object' || Array.isArray(config)) return {diagnostic: configDiagnostic()};
  const record = config as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'recordDatabaseBinding' && key !== 'objectBucketBinding')) {
    return {diagnostic: configDiagnostic()};
  }
  const recordDatabaseBinding = record.recordDatabaseBinding ?? 'DB';
  const objectBucketBinding = record.objectBucketBinding ?? 'OBJECTS';
  if (
    typeof recordDatabaseBinding !== 'string' ||
    typeof objectBucketBinding !== 'string' ||
    !/^[A-Z][A-Z0-9_]*$/u.test(recordDatabaseBinding) ||
    !/^[A-Z][A-Z0-9_]*$/u.test(objectBucketBinding) ||
    recordDatabaseBinding === objectBucketBinding
  ) {
    return {diagnostic: configDiagnostic()};
  }
  return {recordDatabaseBinding, objectBucketBinding};
}

function capabilityDiagnostic(requirement: string, ir: DeployIrV2): PipelineDiagnostic {
  const origin = findCapabilityOrigin(ir, requirement);
  return {
    severity: 'error',
    code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
    message: `Target cloudflare-workers does not support capability ${requirement}.`,
    reason: 'The selected adapter cannot satisfy a target-neutral IR requirement.',
    suggestion: 'Choose a registered capable target or remove the requiring operation.',
    targetId: 'cloudflare-workers',
    ...(origin === undefined ? {} : {routeId: origin.routeId}),
    ...(origin?.sourceRef === undefined ? {} : {sourceRef: origin.sourceRef})
  };
}

function configDiagnostic(): PipelineDiagnostic {
  return {
    severity: 'error',
    code: 'TW2_TARGET_CONFIG_INVALID',
    message: 'Cloudflare target config is invalid.',
    reason: 'Only distinct, non-secret D1 and R2 binding identifiers are accepted.',
    suggestion: 'Use {"recordDatabaseBinding":"DB","objectBucketBinding":"OBJECTS"}.',
    targetId: 'cloudflare-workers'
  };
}

function indexSource(plan: PlatformPlan): string {
  const recordBinding = plan.bindings.recordDatabase;
  const objectBinding = plan.bindings.objectBucket;
  const bindingMembers = [
    ...(recordBinding === undefined ? [] : [`${recordBinding}: D1Database`]),
    ...(objectBinding === undefined ? [] : [`${objectBinding}: R2Bucket`])
  ].join('; ');
  const services = [
    ...(recordBinding === undefined
      ? []
      : [`records: (context) => createRecordStore((context as {env: Bindings}).env.${recordBinding})`]),
    ...(objectBinding === undefined
      ? []
      : [`objects: (context) => createObjectStore((context as {env: Bindings}).env.${objectBinding})`]),
    "clientAddress: (context) => (context as {req: {header(name: string): string | undefined}}).req.header('cf-connecting-ip') ?? ''"
  ].join(',\n  ');
  return `import {Hono} from 'hono';
import {registerCoreRoutes} from './core.generated.js';
import {createObjectStore, createRecordStore} from './platform.js';

type Bindings = {${bindingMembers}};
const app = new Hono<{Bindings: Bindings}>();
registerCoreRoutes(app, {
  ${services}
});
export default app;
`;
}

function platformSource(): string {
  return `import type {BinaryBodySource, BinaryLocator, BinaryMetadata, BinaryObjectStore, BinaryRef, RecordStore} from './core.generated.js';

type RecordRow = {id: string; collection: string; data_json: string; created_at: string; updated_at: string};
export function createRecordStore(database: D1Database): RecordStore {
  return {
    async create(collection, data) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await database.prepare('INSERT INTO records (id, collection, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, collection, JSON.stringify(data), now, now).run();
      return {id, collection, data, createdAt: now, updatedAt: now};
    },
    async list(collection) {
      const result = await database.prepare('SELECT id, collection, data_json, created_at, updated_at FROM records WHERE collection = ? ORDER BY created_at DESC LIMIT 100').bind(collection).all<RecordRow>();
      return result.results.map(fromRow);
    },
    async get(id) {
      const row = await database.prepare('SELECT id, collection, data_json, created_at, updated_at FROM records WHERE id = ?').bind(id).first<RecordRow>();
      return row ? fromRow(row) : null;
    },
    async delete(id) {
      const result = await database.prepare('DELETE FROM records WHERE id = ?').bind(id).run();
      return result.meta.changes > 0;
    }
  };
}
function fromRow(row: RecordRow): Record<string, unknown> {
  return {id: row.id, collection: row.collection, data: JSON.parse(row.data_json), createdAt: row.created_at, updatedAt: row.updated_at};
}

export function createObjectStore(bucket: R2Bucket): BinaryObjectStore {
  return {
    async resolve(locator) {
      try {
        const object = await bucket.head(storageKey(locator));
        return object === null || isTombstone(object) ? null : objectRef(locator, object);
      } catch (error) {if (isBinaryFault(error)) throw error; throw binaryFault('BINARY_STORAGE_FAILURE')}
    },
    async get(ref) {
      try {
        const key = storageKey(ref);
        let object: R2ObjectBody | R2Object | null;
        let expected: R2Revision | undefined;
        if (ref.revision === undefined) {
          object = await bucket.get(key);
        } else {
          expected = parseR2Revision(ref.revision);
          if (expected === undefined) return null;
          object = await bucket.get(key, {onlyIf: revisionCondition(expected)});
        }
        if (object === null || !hasR2Body(object) || isTombstone(object)) return null;
        if (expected !== undefined && !matchesRevision(object, expected)) return null;
        return {
          chunks: readableChunks(object.body),
          size: object.size,
          ...(object.httpMetadata?.contentType === undefined ? {} : {contentType: object.httpMetadata.contentType})
        };
      } catch (error) {if (isBinaryFault(error)) throw error; throw binaryFault('BINARY_STORAGE_FAILURE')}
    },
    async put(locator, source, metadata, maxBytes) {
      try {
        if (source.size !== undefined && source.size > maxBytes) throw binaryFault('BINARY_TOO_LARGE');
        const integrity = metadata.integrity?.startsWith('sha256:') === true ? metadata.integrity.slice(7) : undefined;
        const object = await bucket.put(storageKey(locator), binaryStream(limitedChunks(source.chunks, maxBytes)), {
          ...(metadata.contentType === undefined ? {} : {httpMetadata: {contentType: metadata.contentType}}),
          ...(metadata.integrity === undefined ? {} : {customMetadata: {twIntegrity: metadata.integrity}}),
          ...(integrity === undefined ? {} : {sha256: integrity})
        });
        if (object === null) throw binaryFault('BINARY_STORAGE_FAILURE');
        return objectRef(locator, object);
      } catch (error) {
        if (isBinaryFault(error)) throw error;
        throw binaryFault(metadata.integrity !== undefined && isR2BadDigest(error) ? 'BINARY_INTEGRITY_MISMATCH' : 'BINARY_STORAGE_FAILURE');
      }
    },
    async delete(target) {
      try {
        const key = storageKey(target);
        if ('revision' in target && target.revision !== undefined) {
          const expected = parseR2Revision(target.revision);
          if (expected === undefined) return false;
          const current = await bucket.head(key);
          if (current === null || isTombstone(current) || !matchesRevision(current, expected)) return false;
          return putTombstone(bucket, key, current);
        }
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const current = await bucket.head(key);
          if (current === null || isTombstone(current)) return false;
          if (await putTombstone(bucket, key, current)) return true;
        }
        throw binaryFault('BINARY_STORAGE_FAILURE');
      } catch (error) {if (isBinaryFault(error)) throw error; throw binaryFault('BINARY_STORAGE_FAILURE')}
    }
  };
}
function storageKey(locator: BinaryLocator): string {
  if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(locator.namespace) || locator.key.length > 512 || locator.key.includes('\\0') || locator.key.startsWith('/') || locator.key.includes('\\\\') || locator.key.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw binaryFault('BINARY_INVALID_REF');
  }
  return 'v1/' + locator.namespace + '/' + locator.key;
}
function objectRef(locator: BinaryLocator, object: R2Object): BinaryRef {
  const integrity = object.customMetadata?.twIntegrity;
  const contentType = object.httpMetadata?.contentType;
  return {
    ...locator,
    size: object.size,
    revision: encodeR2Revision(object),
    ...(contentType === undefined ? {} : {contentType}),
    ...(integrity === undefined ? {} : {integrity})
  };
}
interface R2Revision {version: string; etag: string; uploaded: number}
function isTombstone(object: R2Object): boolean {return object.customMetadata?.twDeleted === '1'}
function encodeR2Revision(object: R2Object): string {
  const revision = 'r2:' + JSON.stringify([object.version, object.etag, object.uploaded.getTime()]);
  if (revision.length > 256) throw binaryFault('BINARY_STORAGE_FAILURE');
  return revision;
}
function parseR2Revision(value: string): R2Revision | undefined {
  if (!value.startsWith('r2:')) return undefined;
  try {
    const parsed: unknown = JSON.parse(value.slice(3));
    if (!Array.isArray(parsed) || parsed.length !== 3 || typeof parsed[0] !== 'string' || parsed[0].length === 0 || typeof parsed[1] !== 'string' || parsed[1].length === 0 || typeof parsed[2] !== 'number' || !Number.isSafeInteger(parsed[2]) || new Date(parsed[2] - 1).getTime() !== parsed[2] - 1 || new Date(parsed[2]).getTime() !== parsed[2] || new Date(parsed[2] + 1).getTime() !== parsed[2] + 1) return undefined;
    return {version: parsed[0], etag: parsed[1], uploaded: parsed[2]};
  } catch {return undefined}
}
function matchesRevision(object: R2Object, revision: R2Revision): boolean {
  return object.version === revision.version && object.etag === revision.etag && object.uploaded.getTime() === revision.uploaded;
}
function revisionCondition(revision: R2Revision): R2Conditional {
  return {
    etagMatches: revision.etag,
    uploadedAfter: new Date(revision.uploaded - 1),
    uploadedBefore: new Date(revision.uploaded + 1)
  };
}
async function putTombstone(bucket: R2Bucket, key: string, current: R2Object): Promise<boolean> {
  const revision = {version: current.version, etag: current.etag, uploaded: current.uploaded.getTime()};
  return await bucket.put(key, new Uint8Array(), {
    onlyIf: revisionCondition(revision),
    customMetadata: {twDeleted: '1'}
  }) !== null;
}
function hasR2Body(object: R2Object): object is R2ObjectBody {return 'body' in object}
function binaryStream(chunks: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {const item = await iterator.next(); if (item.done) controller.close(); else controller.enqueue(item.value);},
    cancel() {return iterator.return?.().then(() => undefined)}
  });
}
async function* readableChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {while (true) {const item = await reader.read(); if (item.done) return; yield item.value;}}
  finally {reader.releaseLock()}
}
async function* limitedChunks(chunks: AsyncIterable<Uint8Array>, maximum: number): AsyncIterable<Uint8Array> {
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > maximum) throw binaryFault('BINARY_TOO_LARGE');
    yield chunk;
  }
}
function binaryFault(code: string): Error & {code: string} {return Object.assign(new Error(code), {code})}
function isBinaryFault(error: unknown): error is Error & {code: string} {return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('BINARY_')}
function isR2BadDigest(error: unknown): boolean {return error instanceof Error && /\\(10037\\)$/u.test(error.message)}
`;
}

function packageJson(ir: DeployIrV2): string {
  return `${JSON.stringify(
    {
      name: ir.name.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-'),
      private: true,
      type: 'module',
      scripts: {dev: 'wrangler dev', deploy: 'wrangler deploy', typecheck: 'tsc --noEmit'},
      dependencies: {hono: '^4.13.8'},
      devDependencies: {'@cloudflare/workers-types': '^5.20260919.1', typescript: '^5.9.3', wrangler: '^4.135.0'}
    },
    null,
    2
  )}\n`;
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022'],
        strict: true, noEmit: true, skipLibCheck: true, types: ['@cloudflare/workers-types']
      },
      include: ['src/**/*.ts']
    },
    null,
    2
  )}\n`;
}

function wrangler(ir: DeployIrV2, plan: PlatformPlan): string {
  const recordBinding = plan.bindings.recordDatabase;
  const objectBinding = plan.bindings.objectBucket;
  const config = {
    name: ir.name,
    main: 'src/index.ts',
    compatibility_date: '2026-09-01',
    ...(recordBinding === undefined ? {} : {d1_databases: [{binding: recordBinding, database_name: `${ir.name}-db`, database_id: 'replace-me'}]}),
    ...(objectBinding === undefined ? {} : {r2_buckets: [{binding: objectBinding, bucket_name: `${ir.name}-objects`}]})
  };
  return `// Generated by turbowarp-http-server.\n${JSON.stringify(config, null, 2)}\n`;
}

function migration(): string {
  return `CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, collection TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);\n`;
}

function generatedReadme(ir: DeployIrV2, plan: PlatformPlan): string {
  const resources = [
    ...(plan.requirements.includes('record-store') ? [`the D1 database \`${ir.name}-db\``] : []),
    ...(plan.requirements.includes('object-storage') ? [`the R2 bucket \`${ir.name}-objects\``] : [])
  ];
  const setup = resources.length === 0
    ? 'review the generated `wrangler.jsonc`'
    : `create ${resources.join(' and ')} named in \`wrangler.jsonc\``;
  const migration = plan.requirements.includes('record-store')
    ? ` Apply \`migrations/0001_init.sql\` with Wrangler before serving record routes.`
    : '';
  return `# Generated Cloudflare Workers application

Run \`npm install\`, ${setup}, replace only placeholder resource IDs, then run \`npm run dev\` or \`npm run deploy\`.${migration}

R2 stores binary bytes under the versioned \`v1/<namespace>/<key>\` prefix. Revisions combine R2's unique upload version, ETag, and upload timestamp. Deletes use ETag-and-time-conditional zero-byte \`twDeleted\` tombstones that resolve/get treat as absent; locator deletes retry when a concurrent write wins, and a later put replaces the tombstone. D1 stores queryable records. Do not substitute KV for read-after-write object or record operations.

## Rollback and cleanup

Stop traffic or roll back the Worker deployment first. Generated code never deletes cloud resources automatically. Export required data, inspect D1/R2 bindings and dependent services, then delete resources manually only when no deployment references them.
`;
}
