import {execFile, spawn, type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {compileDeployIrV2, type DeployIrV2} from '../src/compiler/index.js';

const execFileAsync = promisify(execFile);
const root = resolve('.');
const binaries = {
  firebase: resolve('node_modules/.bin/firebase'),
  tsc: resolve('node_modules/.bin/tsc'),
  wrangler: resolve('node_modules/.bin/wrangler')
};
const requestedTarget = process.argv[2];
const targets =
  requestedTarget === undefined
    ? ['cloudflare-workers', 'firebase-functions'] as const
    : requestedTarget === 'cloudflare-workers' || requestedTarget === 'firebase-functions'
      ? [requestedTarget]
      : fail('Usage: pnpm test:conformance:target-runtime [cloudflare-workers|firebase-functions]');

for (const target of targets) {
  const directory = await mkdtemp(join(tmpdir(), `tw-${target}-runtime-`));
  try {
    const result = compileDeployIrV2(targetIr(), {target});
    if (!result.ok) throw new Error(`${target} generation failed: ${JSON.stringify(result.diagnostics)}`);
    await writeProject(directory, result.files);
    if (target === 'cloudflare-workers') await checkCloudflare(directory);
    else await checkFirebase(directory);
    console.log(`${target}: runtime smoke passed`);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

async function checkCloudflare(directory: string): Promise<void> {
  await symlink(resolve('node_modules'), join(directory, 'node_modules'));
  const environment = {
    ...process.env,
    CI: 'true',
    WRANGLER_LOG_PATH: join(directory, 'wrangler.log')
  };
  await execute(
    binaries.wrangler,
    ['d1', 'execute', 'target-runtime-db', '--local', '--file=migrations/0001_init.sql'],
    directory,
    environment
  );
  const port = await freePort();
  const server = start(
    binaries.wrangler,
    ['dev', '--local', '--ip', '127.0.0.1', '--port', String(port)],
    directory,
    environment
  );
  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitForServer(origin, server);
    try {
      await exerciseRoutes(origin);
    } catch (error) {
      throw new Error(`${String(error)}\nRuntime output:\n${runtimeOutput(server)}`);
    }
  } finally {
    await terminate(server);
  }
}

async function checkFirebase(directory: string): Promise<void> {
  await symlink(resolve('node_modules'), join(directory, 'functions/node_modules'));
  await execute(binaries.tsc, ['--project', join(directory, 'functions/tsconfig.json')], root);
  const ports = {
    functions: await freePort(),
    firestore: await freePort(),
    storage: await freePort(),
    hub: await freePort(),
    logging: await freePort()
  };
  await writeFile(
    join(directory, 'firebase.runtime.json'),
    `${JSON.stringify({
      functions: {source: 'functions'},
      firestore: {rules: 'firestore.rules', indexes: 'firestore.indexes.json'},
      storage: {rules: 'storage.rules'},
      emulators: {
        functions: {host: '127.0.0.1', port: ports.functions},
        firestore: {host: '127.0.0.1', port: ports.firestore},
        storage: {host: '127.0.0.1', port: ports.storage},
        hub: {host: '127.0.0.1', port: ports.hub},
        logging: {host: '127.0.0.1', port: ports.logging},
        ui: {enabled: false}
      }
    }, null, 2)}\n`
  );
  const project = 'demo-target-runtime';
  const client = join(directory, 'runtime-client.mjs');
  const origin = `http://127.0.0.1:${ports.functions}/${project}/us-central1/api`;
  await writeFile(client, runtimeClientSource(origin));
  await execute(
    binaries.firebase,
    [
      'emulators:exec',
      '--project', project,
      '--only', 'functions,firestore,storage',
      '--config', 'firebase.runtime.json',
      'node runtime-client.mjs'
    ],
    directory,
    {...process.env, ASSET_BUCKET: `${project}.appspot.com`, CI: 'true'},
    180_000
  );
}

async function exerciseRoutes(origin: string): Promise<void> {
  const record = await fetch(`${origin}/records`, {method: 'POST'});
  if (record.status !== 200) throw new Error(`record route returned ${record.status}: ${await record.text()}`);
  const recordBody = await record.json() as {collection?: unknown; id?: unknown};
  if (recordBody.collection !== 'records' || typeof recordBody.id !== 'string') {
    throw new Error(`record route returned an invalid body: ${JSON.stringify(recordBody)}`);
  }

  const bytes = new TextEncoder().encode('target-runtime-smoke');
  const object = await fetch(`${origin}/objects`, {
    method: 'PUT',
    headers: {'content-type': 'application/octet-stream'},
    body: bytes
  });
  if (object.status !== 200) throw new Error(`object route returned ${object.status}: ${await object.text()}`);
  const objectBody = await object.json() as {key?: unknown; namespace?: unknown; revision?: unknown; size?: unknown};
  if (
    objectBody.namespace !== 'asset' ||
    objectBody.key !== 'fixture.bin' ||
    objectBody.size !== bytes.byteLength ||
    typeof objectBody.revision !== 'string'
  ) {
    throw new Error(`object route returned an invalid body: ${JSON.stringify(objectBody)}`);
  }
}

function runtimeClientSource(origin: string): string {
  return `const origin = ${JSON.stringify(origin)};
const record = await fetch(origin + '/records', {method: 'POST'});
if (record.status !== 200) throw new Error('record route returned ' + record.status + ': ' + await record.text());
const recordBody = await record.json();
if (recordBody.collection !== 'records' || typeof recordBody.id !== 'string') {
  throw new Error('record route returned an invalid body: ' + JSON.stringify(recordBody));
}
const bytes = new TextEncoder().encode('target-runtime-smoke');
const object = await fetch(origin + '/objects', {
  method: 'PUT', headers: {'content-type': 'application/octet-stream'}, body: bytes
});
if (object.status !== 200) throw new Error('object route returned ' + object.status + ': ' + await object.text());
const objectBody = await object.json();
if (objectBody.namespace !== 'asset' || objectBody.key !== 'fixture.bin' || objectBody.size !== bytes.byteLength || typeof objectBody.revision !== 'string') {
  throw new Error('object route returned an invalid body: ' + JSON.stringify(objectBody));
}
`;
}

async function writeProject(directory: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(directory, path);
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, contents);
  }
}

async function execute(
  executable: string,
  args: string[],
  cwd: string,
  env = process.env,
  timeout = 60_000
): Promise<void> {
  try {
    await execFileAsync(executable, args, {cwd, env, timeout, maxBuffer: 10 * 1024 * 1024});
  } catch (error) {
    const output =
      typeof error === 'object' && error !== null
        ? `${'stdout' in error ? String(error.stdout) : ''}${'stderr' in error ? String(error.stderr) : ''}`
        : String(error);
    throw new Error(`${executable} ${args.join(' ')} failed:\n${output}`);
  }
}

function start(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(executable, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => { output = appendOutput(output, chunk); });
  child.stderr?.on('data', (chunk: Buffer) => { output = appendOutput(output, chunk); });
  Object.assign(child, {runtimeOutput: () => output});
  return child;
}

async function waitForServer(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`runtime exited early:\n${runtimeOutput(child)}`);
    try {
      await fetch(origin);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
  }
  throw new Error(`runtime did not become ready:\n${runtimeOutput(child)}`);
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function runtimeOutput(child: ChildProcess): string {
  const value = (child as ChildProcess & {runtimeOutput?: () => string}).runtimeOutput;
  return value?.() ?? '';
}

function appendOutput(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString()}`.slice(-20_000);
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Could not allocate a local port.'));
        return;
      }
      server.close((error) => error === undefined ? resolvePort(address.port) : rejectPort(error));
    });
  });
}

function fail(message: string): never {
  throw new Error(message);
}

function targetIr(): DeployIrV2 {
  return {
    version: 2,
    name: 'target-runtime',
    auth: {kind: 'none'},
    capabilities: [{kind: 'object-storage'}, {kind: 'record-store'}, {kind: 'streaming-body'}],
    routes: [
      {
        id: 'create', method: 'POST', path: '/records', auth: 'public',
        body: [
          {
            kind: 'record-create', collection: 'records',
            data: {kind: 'literal', valueType: 'json-object', value: {}},
            result: {id: 'created', type: {kind: 'value', valueType: 'json-object'}}
          },
          {kind: 'respond', format: 'json', body: {kind: 'binding', valueType: 'json-object', binding: 'created'}}
        ]
      },
      {
        id: 'upload', method: 'PUT', path: '/objects', auth: 'public',
        body: [
          {
            kind: 'request-body-binary', maxBytes: 1024,
            result: {id: 'body', type: {kind: 'resource', resourceType: 'binary-body'}}
          },
          {
            kind: 'asset-object-put', locator: {namespace: 'asset', key: 'fixture.bin'}, body: 'body',
            metadata: {contentType: 'application/octet-stream'}, maxBytes: 1024,
            result: {id: 'stored', type: {kind: 'value', valueType: 'binary-ref'}}
          },
          {kind: 'respond', format: 'json', body: {kind: 'binding', valueType: 'binary-ref', binding: 'stored'}}
        ]
      }
    ]
  };
}
