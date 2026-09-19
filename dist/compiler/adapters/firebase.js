import { findCapabilityOrigin } from '../pipeline/requirements.js';
export const firebaseFunctionsAdapter = {
    id: 'firebase-functions',
    version: '1.1.0',
    capabilities: () => ({
        keys: ['object-storage', 'record-store', 'request-metadata:client-address', 'streaming-body'],
        maxBinaryBytes: 10000000
    }),
    plan({ ir, requirements, config }) {
        const unsupported = requirements.keys.filter((requirement) => !firebaseFunctionsAdapter.capabilities().keys.includes(requirement));
        if (unsupported.length > 0) {
            return {
                ok: false,
                diagnostics: unsupported.map((requirement) => capabilityDiagnostic(requirement, ir))
            };
        }
        const parsed = parseConfig(config);
        if ('diagnostic' in parsed)
            return { ok: false, diagnostics: [parsed.diagnostic] };
        return {
            ok: true,
            plan: {
                targetId: firebaseFunctionsAdapter.id,
                adapterVersion: firebaseFunctionsAdapter.version,
                requirements: requirements.keys,
                bindings: {
                    ...(requirements.keys.includes('record-store') ? { recordCollection: parsed.recordCollection } : {}),
                    ...(requirements.keys.includes('object-storage') ? { objectBucketEnv: parsed.objectBucketEnv } : {}),
                    functionName: parsed.functionName
                }
            }
        };
    },
    generate({ ir, plan, core }) {
        return {
            ...relocateCore(core),
            'functions/package.json': functionsPackage(ir),
            'functions/tsconfig.json': functionsTsconfig(),
            'functions/src/index.ts': indexSource(plan),
            'functions/src/platform.ts': platformSource(),
            'firebase.json': firebaseJson(),
            '.firebaserc.example': firebaserc(),
            'firestore.rules': denyAllRules('cloud.firestore'),
            'firestore.indexes.json': firestoreIndexes(plan),
            'storage.rules': denyAllRules('firebase.storage'),
            'README.md': generatedReadme(plan)
        };
    }
};
function parseConfig(config) {
    const defaults = {
        functionName: 'api',
        objectBucketEnv: 'ASSET_BUCKET',
        recordCollection: 'records'
    };
    if (config === undefined || config === null)
        return defaults;
    if (typeof config !== 'object' || Array.isArray(config))
        return { diagnostic: configDiagnostic() };
    const value = config;
    if (Object.keys(value).some((key) => key !== 'functionName' && key !== 'objectBucketEnv' && key !== 'recordCollection')) {
        return { diagnostic: configDiagnostic() };
    }
    const functionName = value.functionName ?? defaults.functionName;
    const objectBucketEnv = value.objectBucketEnv ?? defaults.objectBucketEnv;
    const recordCollection = value.recordCollection ?? defaults.recordCollection;
    if (typeof functionName !== 'string' ||
        typeof objectBucketEnv !== 'string' ||
        typeof recordCollection !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(functionName) ||
        !/^[A-Z][A-Z0-9_]{0,63}$/u.test(objectBucketEnv) ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(recordCollection)) {
        return { diagnostic: configDiagnostic() };
    }
    return { functionName, objectBucketEnv, recordCollection };
}
function capabilityDiagnostic(requirement, ir) {
    const origin = findCapabilityOrigin(ir, requirement);
    return {
        severity: 'error',
        code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
        message: `Target firebase-functions does not support capability ${requirement}.`,
        reason: 'The Firebase Functions adapter cannot satisfy this target-neutral requirement.',
        suggestion: 'Use a target adapter that declares the capability or remove the requiring operation.',
        targetId: 'firebase-functions',
        ...(origin === undefined ? {} : { routeId: origin.routeId }),
        ...(origin?.sourceRef === undefined ? {} : { sourceRef: origin.sourceRef })
    };
}
function configDiagnostic() {
    return {
        severity: 'error',
        code: 'TW2_TARGET_CONFIG_INVALID',
        message: 'Firebase target config is invalid.',
        reason: 'Only functionName, objectBucketEnv, and recordCollection identifiers are accepted; secret or project values are not.',
        suggestion: 'Use {"functionName":"api","objectBucketEnv":"ASSET_BUCKET","recordCollection":"records"}.',
        targetId: 'firebase-functions'
    };
}
function relocateCore(core) {
    return Object.fromEntries(Object.entries(core.files).map(([path, source]) => [
        path.startsWith('src/') ? `functions/${path}` : `functions/src/${path}`,
        source
    ]));
}
function indexSource(plan) {
    const functionName = plan.bindings.functionName ?? 'api';
    const recordCollection = plan.bindings.recordCollection;
    const bucketEnvironment = plan.bindings.objectBucketEnv;
    const services = [
        ...(recordCollection === undefined
            ? []
            : [`records: () => createRecordStore(firestore, ${JSON.stringify(recordCollection)})`]),
        ...(bucketEnvironment === undefined
            ? []
            : [
                `objects: () => createObjectStore(storage.bucket(process.env[${JSON.stringify(bucketEnvironment)}]))`
            ]),
        "clientAddress: (context) => (context as {env?: {incoming?: {socket?: {remoteAddress?: string}}}}).env?.incoming?.socket?.remoteAddress ?? ''"
    ].join(',\n  ');
    return `import {getRequestListener} from '@hono/node-server';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {onRequest} from 'firebase-functions/v2/https';
import {Hono} from 'hono';
import {registerCoreRoutes} from './core.generated.js';
import {createObjectStore, createRecordStore} from './platform.js';

initializeApp();
const firestore = getFirestore();
const storage = getStorage();
const app = new Hono();
registerCoreRoutes(app, {
  ${services}
});
const listener = getRequestListener(app.fetch);
export const ${functionName} = onRequest((request, response) => listener(request, response));
`;
}
function platformSource() {
    return `import {createHash} from 'node:crypto';
import {once} from 'node:events';
import type {BinaryBodySource, BinaryLocator, BinaryMetadata, BinaryObjectStore, BinaryRef, RecordStore} from './core.generated.js';

interface DocumentSnapshot {exists: boolean; id: string; data(): Record<string, unknown> | undefined}
interface DocumentReference {id: string; set(value: unknown): Promise<unknown>; get(): Promise<DocumentSnapshot>; delete(): Promise<unknown>}
interface QuerySnapshot {readonly docs: readonly DocumentSnapshot[]}
interface QueryLike {
  where(field: string, operator: '==', value: unknown): QueryLike;
  orderBy(field: string, direction: 'desc'): QueryLike;
  limit(value: number): QueryLike;
  get(): Promise<QuerySnapshot>;
}
interface CollectionReference extends QueryLike {doc(id?: string): DocumentReference}
export interface FirestoreLike {collection(name: string): CollectionReference}
interface StorageMetadata {size?: string | number; contentType?: string; generation?: string | number; metadata?: Record<string, string>}
interface WritableLike extends NodeJS.WritableStream {destroy(): void}
interface FileLike {
  getMetadata(): Promise<[StorageMetadata, ...unknown[]]>;
  createReadStream(): AsyncIterable<Uint8Array>;
  createWriteStream(options: {resumable: boolean; metadata: {contentType?: string; metadata?: Record<string, string>}}): WritableLike;
  setMetadata(metadata: {metadata: Record<string, string>}): Promise<[StorageMetadata, ...unknown[]]>;
  copy(destination: FileLike): Promise<[FileLike, StorageMetadata]>;
  delete(options?: {ignoreNotFound?: boolean; ifGenerationMatch?: string | number}): Promise<unknown>;
}
export interface BucketLike {file(key: string): FileLike}

export function createRecordStore(database: FirestoreLike, root: string): RecordStore {
  const records = database.collection(root);
  return {
    async create(collection, data) {
      const document = records.doc();
      const now = new Date().toISOString();
      const value = {id: document.id, collection, data, createdAt: now, updatedAt: now};
      await document.set(value);
      return value;
    },
    async list(collection) {
      const snapshot = await records.where('collection', '==', collection).orderBy('createdAt', 'desc').limit(100).get();
      return snapshot.docs.map((document) => document.data() ?? {id: document.id});
    },
    async get(id) {
      const snapshot = await records.doc(id).get();
      return snapshot.exists ? snapshot.data() ?? {id} : null;
    },
    async delete(id) {
      const document = records.doc(id);
      const snapshot = await document.get();
      if (!snapshot.exists) return false;
      await document.delete();
      return true;
    }
  };
}

export function createObjectStore(bucket: BucketLike): BinaryObjectStore {
  return {
    async resolve(locator) {
      try {return metadataRef(locator, (await bucket.file(storageKey(locator)).getMetadata())[0])}
      catch (error) {if (isBinaryFault(error)) throw error; if (isNotFound(error)) return null; throw binaryFault('BINARY_STORAGE_FAILURE')}
    },
    async get(ref) {
      try {
        const file = bucket.file(storageKey(ref));
        const metadata = (await file.getMetadata())[0];
        if (ref.revision !== undefined && String(metadata.generation) !== ref.revision) return null;
        const size = metadataSize(metadata);
        const source: BinaryBodySource = {
          chunks: file.createReadStream(),
          ...(size === undefined ? {} : {size})
        };
        return metadata.contentType === undefined ? source : {...source, contentType: metadata.contentType};
      } catch (error) {if (isBinaryFault(error)) throw error; if (isNotFound(error)) return null; throw binaryFault('BINARY_STORAGE_FAILURE')}
    },
    async put(locator, source, metadata, maxBytes) {
      const destination = bucket.file(storageKey(locator));
      const staging = bucket.file('v1/.staging/' + crypto.randomUUID());
      const hash = createHash('sha256');
      const output = staging.createWriteStream({
        resumable: false,
        metadata: {
          ...(metadata.contentType === undefined ? {} : {contentType: metadata.contentType}),
          metadata: {}
        }
      });
      let size = 0;
      let stagingGeneration: string | number | undefined;
      try {
        for await (const chunk of source.chunks) {
          size += chunk.byteLength;
          if (size > maxBytes) throw binaryFault('BINARY_TOO_LARGE');
          hash.update(chunk);
          if (!output.write(chunk)) await once(output, 'drain');
        }
        output.end();
        await once(output, 'finish');
        const integrity = 'sha256:' + hash.digest('hex');
        if (metadata.size !== undefined && metadata.size !== size || metadata.integrity !== undefined && metadata.integrity !== integrity) {
          throw binaryFault('BINARY_INTEGRITY_MISMATCH');
        }
        const initial = (await staging.getMetadata())[0];
        stagingGeneration = initial.generation;
        await staging.setMetadata({metadata: {...initial.metadata, twIntegrity: integrity}});
        const [, stored] = await staging.copy(destination);
        return {...metadataRef(locator, stored), integrity, size};
      } catch (error) {
        output.destroy();
        if (isBinaryFault(error)) throw error;
        throw binaryFault('BINARY_STORAGE_FAILURE');
      } finally {
        await staging.delete({
          ignoreNotFound: true,
          ...(stagingGeneration === undefined ? {} : {ifGenerationMatch: stagingGeneration})
        }).catch(() => undefined);
      }
    },
    async delete(target) {
      const file = bucket.file(storageKey(target));
      try {
        await file.delete(
          'revision' in target && target.revision !== undefined
            ? {ifGenerationMatch: target.revision}
            : undefined
        );
        return true;
      } catch (error) {if (isBinaryFault(error)) throw error; if (isNotFound(error) || isPreconditionFailed(error)) return false; throw binaryFault('BINARY_STORAGE_FAILURE')}
    }
  };
}
function storageKey(locator: BinaryLocator): string {
  if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(locator.namespace) || locator.key.length > 512 || locator.key.includes('\\0') || locator.key.startsWith('/') || locator.key.includes('\\\\') || locator.key.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw binaryFault('BINARY_INVALID_REF');
  }
  return 'v1/' + locator.namespace + '/' + locator.key;
}
function metadataRef(locator: BinaryLocator, metadata: StorageMetadata): BinaryRef {
  const integrity = metadata.metadata?.twIntegrity;
  const revision = metadata.generation === undefined ? undefined : String(metadata.generation);
  const size = metadataSize(metadata);
  return {
    ...locator,
    ...(size === undefined ? {} : {size}),
    ...(revision === undefined ? {} : {revision}),
    ...(metadata.contentType === undefined ? {} : {contentType: metadata.contentType}),
    ...(integrity === undefined ? {} : {integrity})
  };
}
function metadataSize(metadata: StorageMetadata): number | undefined {
  const size = metadata.size === undefined ? undefined : Number(metadata.size);
  return size !== undefined && Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}
function binaryFault(code: string): Error & {code: string} {return Object.assign(new Error(code), {code})}
function isBinaryFault(error: unknown): error is Error & {code: string} {return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('BINARY_')}
function isNotFound(error: unknown): boolean {return typeof error === 'object' && error !== null && 'code' in error && (error.code === 404 || error.code === '404')}
function isPreconditionFailed(error: unknown): boolean {return typeof error === 'object' && error !== null && 'code' in error && (error.code === 412 || error.code === '412')}
`;
}
function functionsPackage(ir) {
    return `${JSON.stringify({
        name: `${ir.name.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-')}-functions`,
        private: true,
        type: 'module',
        main: 'lib/index.js',
        engines: { node: '22' },
        scripts: {
            build: 'tsc',
            typecheck: 'tsc --noEmit',
            serve: 'npm run build && firebase emulators:start --config ../firebase.json --only functions,firestore,storage',
            deploy: 'firebase deploy --config ../firebase.json --only functions,firestore,storage'
        },
        dependencies: {
            '@hono/node-server': '^2.1.1',
            'firebase-admin': '^14.4.0',
            'firebase-functions': '^7.4.0',
            hono: '^4.13.8'
        },
        devDependencies: { '@types/node': '^24.13.3', 'firebase-tools': '^15.30.2', typescript: '^5.9.3' }
    }, null, 2)}\n`;
}
function functionsTsconfig() {
    return `${JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            lib: ['ES2022', 'DOM'],
            types: ['node'],
            rootDir: 'src',
            outDir: 'lib',
            strict: true,
            skipLibCheck: true
        },
        include: ['src/**/*.ts']
    }, null, 2)}\n`;
}
function firebaseJson() {
    return `${JSON.stringify({
        functions: { source: 'functions', predeploy: ['npm --prefix functions run build'] },
        firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
        storage: { rules: 'storage.rules' },
        emulators: { functions: { port: 5001 }, firestore: { port: 8080 }, storage: { port: 9199 } }
    }, null, 2)}\n`;
}
function firebaserc() {
    return `${JSON.stringify({ projects: { default: 'replace-me' } }, null, 2)}\n`;
}
function firestoreIndexes(plan) {
    const collection = plan.bindings.recordCollection;
    const indexes = collection === undefined
        ? []
        : [
            {
                collectionGroup: collection,
                queryScope: 'COLLECTION',
                fields: [
                    { fieldPath: 'collection', order: 'ASCENDING' },
                    { fieldPath: 'createdAt', order: 'DESCENDING' }
                ]
            }
        ];
    return `${JSON.stringify({ indexes, fieldOverrides: [] }, null, 2)}\n`;
}
function denyAllRules(service) {
    if (service === 'cloud.firestore') {
        return `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}\n`;
    }
    return `rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{object=**} {\n      allow read, write: if false;\n    }\n  }\n}\n`;
}
function generatedReadme(plan) {
    const bucketEnvironment = plan.bindings.objectBucketEnv;
    return `# Generated Firebase Functions application

Run \`npm --prefix functions install\`, copy \`.firebaserc.example\` to \`.firebaserc\`, and replace \`replace-me\` with the Firebase project alias. When using a non-default Storage bucket, configure the bucket name through the \`${bucketEnvironment ?? 'ASSET_BUCKET'}\` environment variable; never commit credentials.

The generated HTTP function uses the Admin SDK and IAM. Firestore and Storage client Rules deny all access by default and do not authorize the Admin SDK. Binary uploads are validated under \`v1/.staging/\` before being copied to their destination; cleanup is best effort, so configure a lifecycle rule for abandoned staging objects. Use \`npm --prefix functions run serve\` for the Emulator Suite boundary and \`npm --prefix functions run deploy\` only after reviewing billing and IAM.

## Rollback and cleanup

Roll back or delete the generated HTTP function before changing data resources. The generator never deletes Firestore documents or Storage objects. Export required data and inspect IAM, bucket, Firestore, and dependent functions before manual cleanup.
`;
}
//# sourceMappingURL=firebase.js.map