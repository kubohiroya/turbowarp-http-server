import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Hono} from 'hono';
import {ModuleKind, ScriptTarget, transpileModule} from 'typescript';
import {
  InMemoryBinaryObjectStore,
  collectBinaryBody,
  generateHonoCore,
  parseDeployIrV2,
  type BinaryBodySource,
  type BinaryLocatorV2,
  type BinaryMetadataV2,
  type BinaryRefDescriptorV2,
  type DeployIrV2
} from '../../src/compiler/index.js';
import {generateCloudflareWorker} from '../../src/compiler/generator.js';
import type {DeployIr} from '../../src/compiler/ir.js';

export interface ConformanceRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  bodyText?: string;
}

export interface ResponseTrace {
  status: number;
  headers: Array<[string, string]>;
  bodyText: string;
  bodySha256: string;
}

export interface EffectTrace {
  capability: 'record-store' | 'object-storage';
  operation: string;
  subject: string;
  metadata?: Record<string, unknown>;
}

export interface CoreTrace {
  response: ResponseTrace;
  effects: EffectTrace[];
}

export interface CoreFixture {
  fixtureVersion: 1;
  id: string;
  layer: 'core';
  ir: unknown;
  request: ConformanceRequest;
  expected: CoreTrace;
}

export async function readCoreFixture(path: string): Promise<CoreFixture> {
  const value = JSON.parse(await readFile(path, 'utf8')) as Partial<CoreFixture>;
  if (
    value.fixtureVersion !== 1 ||
    typeof value.id !== 'string' ||
    value.layer !== 'core' ||
    value.ir === undefined ||
    value.request === undefined ||
    value.expected === undefined
  ) {
    throw new Error(`Invalid conformance fixture: ${path}`);
  }
  return value as CoreFixture;
}

export async function runGeneratedCore(irInput: unknown, request: ConformanceRequest): Promise<CoreTrace> {
  const ir = parseDeployIrV2(irInput);
  const generated = generateHonoCore(ir);
  const directory = await mkdtemp(join(tmpdir(), 'tw-conformance-core-'));
  try {
    const modulePath = join(directory, 'core.mjs');
    const javascript = transpileModule(generated.files['src/core.generated.ts']!, {
      compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.ES2022}
    }).outputText;
    await writeFile(modulePath, javascript);
    const core = (await import(`${pathToFileURL(modulePath).href}?id=${encodeURIComponent(ir.name)}`)) as {
      registerCoreRoutes(app: Hono, services: unknown): void;
    };
    const effects: EffectTrace[] = [];
    const records = new TraceRecordStore(effects);
    const objects = new TraceBinaryObjectStore(effects);
    const app = new Hono();
    core.registerCoreRoutes(app, {
      records: () => records,
      objects: () => objects,
      clientAddress: () => '192.0.2.1'
    });
    const response = await app.request(request.url, {
      method: request.method,
      ...(request.headers === undefined ? {} : {headers: request.headers}),
      ...(request.bodyText === undefined ? {} : {body: request.bodyText})
    });
    return {response: await responseTrace(response), effects};
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

export async function runLegacyCore(ir: DeployIr, request: ConformanceRequest): Promise<CoreTrace> {
  const source = generateCloudflareWorker(ir)['src/routes.generated.ts']!
    .replace("'./auth'", "'./auth.mjs'")
    .replace("'./storage'", "'./storage.mjs'");
  const directory = await mkdtemp(join(tmpdir(), 'tw-conformance-v1-'));
  try {
    await writeFile(join(directory, 'auth.mjs'), 'export async function authenticate() { return null; }\n');
    await writeFile(
      join(directory, 'storage.mjs'),
      'export async function createRecord() {}\nexport async function deleteRecord() {}\nexport async function getRecord() {}\nexport async function listRecords() {}\n'
    );
    const modulePath = join(directory, 'routes.mjs');
    await writeFile(
      modulePath,
      transpileModule(source, {
        compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.ES2022}
      }).outputText
    );
    const routes = (await import(`${pathToFileURL(modulePath).href}?name=${encodeURIComponent(ir.name)}`)) as {
      registerGeneratedRoutes(app: Hono): void;
    };
    const app = new Hono();
    routes.registerGeneratedRoutes(app);
    const response = await app.request(request.url, {
      method: request.method,
      ...(request.headers === undefined ? {} : {headers: request.headers}),
      ...(request.bodyText === undefined ? {} : {body: request.bodyText})
    });
    return {response: await responseTrace(response), effects: []};
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

export async function runBinaryVector(bytes: Uint8Array, maxBytes: number): Promise<{
  responseBodySha256: string;
  effects: EffectTrace[];
}> {
  const effects: EffectTrace[] = [];
  const store = new InMemoryBinaryObjectStore();
  const locator = {namespace: 'asset', key: 'fixture.bin'};
  const metadata = {contentType: 'application/octet-stream'};
  const ref = await store.put(locator, binarySource(bytes), metadata, maxBytes);
  effects.push({capability: 'object-storage', operation: 'put', subject: 'asset/fixture.bin', metadata});
  const loaded = await store.get(ref);
  if (loaded === null) throw new Error('Binary vector could not load the stored object.');
  effects.push({capability: 'object-storage', operation: 'get', subject: 'asset/fixture.bin'});
  const output = await collectBinaryBody(loaded, maxBytes);
  await store.delete(ref);
  effects.push({capability: 'object-storage', operation: 'delete', subject: 'asset/fixture.bin'});
  return {responseBodySha256: sha256(output), effects};
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function responseTrace(response: Response): Promise<ResponseTrace> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    headers: [...response.headers.entries()].map(([name, value]) => [name.toLowerCase(), value]),
    bodyText: new TextDecoder().decode(bytes),
    bodySha256: sha256(bytes)
  };
}

class TraceRecordStore {
  private readonly records = new Map<string, Record<string, unknown>>();
  private nextId = 1;

  public constructor(private readonly effects: EffectTrace[]) {}

  public async create(collection: string, data: unknown): Promise<Record<string, unknown>> {
    const id = `record-${String(this.nextId).padStart(4, '0')}`;
    this.nextId += 1;
    const record = {id, collection, data};
    this.records.set(id, record);
    this.effects.push({capability: 'record-store', operation: 'create', subject: collection, metadata: {id}});
    return record;
  }

  public async list(collection: string): Promise<Record<string, unknown>[]> {
    this.effects.push({capability: 'record-store', operation: 'list', subject: collection});
    return [...this.records.values()].filter((record) => record.collection === collection);
  }

  public async get(id: string): Promise<Record<string, unknown> | null> {
    this.effects.push({capability: 'record-store', operation: 'get', subject: id});
    return this.records.get(id) ?? null;
  }

  public async delete(id: string): Promise<boolean> {
    this.effects.push({capability: 'record-store', operation: 'delete', subject: id});
    return this.records.delete(id);
  }
}

class TraceBinaryObjectStore {
  private readonly store = new InMemoryBinaryObjectStore();

  public constructor(private readonly effects: EffectTrace[]) {}

  public async resolve(locator: BinaryLocatorV2): Promise<BinaryRefDescriptorV2 | null> {
    this.effects.push({capability: 'object-storage', operation: 'resolve', subject: locatorSubject(locator)});
    return this.store.resolve(locator);
  }

  public async get(ref: BinaryRefDescriptorV2): Promise<BinaryBodySource | null> {
    this.effects.push({capability: 'object-storage', operation: 'get', subject: locatorSubject(ref)});
    return this.store.get(ref);
  }

  public async put(
    locator: BinaryLocatorV2,
    source: BinaryBodySource,
    metadata: BinaryMetadataV2,
    maxBytes: number
  ): Promise<BinaryRefDescriptorV2> {
    this.effects.push({
      capability: 'object-storage',
      operation: 'put',
      subject: locatorSubject(locator),
      metadata: {...metadata}
    });
    return this.store.put(locator, source, metadata, maxBytes);
  }

  public async delete(target: BinaryLocatorV2 | BinaryRefDescriptorV2): Promise<boolean> {
    this.effects.push({capability: 'object-storage', operation: 'delete', subject: locatorSubject(target)});
    return this.store.delete(target);
  }
}

function binarySource(bytes: Uint8Array): BinaryBodySource {
  return {
    size: bytes.byteLength,
    chunks: (async function* () {
      yield bytes.slice();
    })()
  };
}

function locatorSubject(locator: BinaryLocatorV2): string {
  return `${locator.namespace}/${locator.key}`;
}

export function fixtureIr(value: unknown): DeployIrV2 {
  return parseDeployIrV2(value);
}
