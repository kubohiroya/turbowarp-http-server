import {mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  buildCompilerOpcodeRegistry,
  CompilerManifestError,
  manifestIntegrity,
  parseCompilerExtensionManifestJson,
  parseCompilerManifestLockJson,
  resolveCompilerManifestLock,
  resolveCompilerProjectOpcode
} from '../src/compiler/manifest/index.js';

const fixtureDirectory = 'tests/fixtures/compiler-manifests';
const fixtureLock = `${fixtureDirectory}/turbowarp-server.lock.json`;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})));
});

describe('compiler extension manifest registry', () => {
  it('resolves locked Asset Cache, KVS, and Structured Data fixtures offline', async () => {
    const first = await resolveCompilerManifestLock(fixtureLock);
    const second = await resolveCompilerManifestLock(fixtureLock);

    expect(first.manifests.map(({manifest}) => [manifest.id, manifest.formatVersion])).toEqual([
      ['kubohiroyaassetcache', 2],
      ['kubohiroyakvs', 2],
      ['kubohiroyastructureddata', 2]
    ]);
    expect(first.registry.entries).toEqual(second.registry.entries);
    expect(first.registry.entries.map((entry) => entry.projectOpcode)).toEqual(
      expect.arrayContaining([
        'kubohiroyaassetcache_isLoaded',
        'kubohiroyaassetcache_registerAsset',
        'kubohiroyakvs_deleteKey',
        'kubohiroyakvs_getValue',
        'kubohiroyakvs_hasKey',
        'kubohiroyakvs_listKeys',
        'kubohiroyakvs_setValue',
        'kubohiroyastructureddata_forEachAtPath',
        'kubohiroyastructureddata_parseJson'
      ])
    );
    expect(resolveCompilerProjectOpcode(first.registry, 'kubohiroyastructureddata_parseJson')).toMatchObject({
      extensionId: 'kubohiroyastructureddata',
      opcode: 'parseJson',
      packageVersion: '0.11.0-rc.1',
      block: {effect: 'state', server: {irOperation: 'structuredData.parseJson'}}
    });
    expect(resolveCompilerProjectOpcode(first.registry, 'kubohiroyakvs_setValue')).toMatchObject({
      extensionId: 'kubohiroyakvs',
      opcode: 'setValue',
      packageName: '@kubohiroya/turbowarp-kvs',
      packageVersion: '0.1.0',
      block: {effect: 'storage-write', immutable: false, server: {irOperation: 'kvs.setText'}}
    });
  });

  it('hashes exact manifest bytes and rejects modified content', async () => {
    const bytes = await readFile(`${fixtureDirectory}/structured-data.json`);
    expect(manifestIntegrity(bytes)).toBe('sha256-HQLxeHKHXs74OsGEZjcQGdRfeFAqTg6vK+Io6a6Cp6E=');

    const directory = await temporaryDirectory();
    const manifestPath = join(directory, 'structured-data.json');
    const lockPath = join(directory, 'turbowarp-server.lock.json');
    await writeFile(manifestPath, `${bytes.toString('utf8')}\n`);
    await writeFile(
      lockPath,
      JSON.stringify({
        lockVersion: 1,
        extensions: [
          {
            extensionId: 'kubohiroyastructureddata',
            packageName: '@kubohiroya/turbowarp-structured-data',
            packageVersion: '0.11.0-rc.1',
            manifestFormatVersion: 2,
            integrity: 'sha256-HQLxeHKHXs74OsGEZjcQGdRfeFAqTg6vK+Io6a6Cp6E=',
            source: {kind: 'local', path: 'structured-data.json'}
          }
        ]
      })
    );

    await expectManifestError(resolveCompilerManifestLock(lockPath), 'TW2_MANIFEST_INTEGRITY_MISMATCH');
  });

  it('requires an explicit lock and rejects unknown project opcodes', async () => {
    await expectManifestError(resolveCompilerManifestLock(undefined), 'TW2_MANIFEST_LOCK_REQUIRED');
    const resolved = await resolveCompilerManifestLock(fixtureLock);
    expectManifestError(
      () => resolveCompilerProjectOpcode(resolved.registry, 'kubohiroyastructureddata_notInManifest'),
      'TW2_MANIFEST_UNKNOWN_OPCODE'
    );
  });

  it('rejects duplicate keys, versions, opcodes, depth, size, and block count', () => {
    expectManifestError(
      () => parseCompilerExtensionManifestJson('{"formatVersion":1,"id":"x","id":"y","blocks":[]}'),
      'TW2_MANIFEST_DUPLICATE_KEY'
    );
    expectManifestError(
      () => parseCompilerExtensionManifestJson('{"formatVersion":3,"id":"x","blocks":[]}'),
      'TW2_MANIFEST_UNSUPPORTED_VERSION'
    );
    expectManifestError(
      () =>
        parseCompilerExtensionManifestJson(
          JSON.stringify({
            formatVersion: 1,
            id: 'x',
            blocks: [basicBlock('same'), basicBlock('same')]
          })
        ),
      'TW2_MANIFEST_DUPLICATE_OPCODE'
    );
    expectManifestError(
      () => parseCompilerExtensionManifestJson('{"formatVersion":1,"id":"x","blocks":[{"opcode":"x","blockType":"COMMAND","arguments":[[[[]]]]}]}', {maxBytes: 1024, maxDepth: 3, maxBlocks: 10}),
      'TW2_MANIFEST_TOO_DEEP'
    );
    expectManifestError(
      () => parseCompilerExtensionManifestJson(JSON.stringify({formatVersion: 1, id: 'x', blocks: [basicBlock('x')]}), {maxBytes: 10, maxDepth: 64, maxBlocks: 10}),
      'TW2_MANIFEST_TOO_LARGE'
    );
    expectManifestError(
      () => parseCompilerExtensionManifestJson(JSON.stringify({formatVersion: 1, id: 'x', blocks: [basicBlock('a'), basicBlock('b')]}), {maxBytes: 1024, maxDepth: 64, maxBlocks: 1}),
      'TW2_MANIFEST_TOO_MANY_BLOCKS'
    );
  });

  it('rejects server-operation hints whose allowlisted signature does not match', async () => {
    const source = await readFile(`${fixtureDirectory}/structured-data.json`, 'utf8');
    const manifest = parseCompilerExtensionManifestJson(
      source.replace('"opcode": "toJson"', '"opcode": "toJsonChanged"')
    );
    expectManifestError(
      () =>
        buildCompilerOpcodeRegistry([
          {
            manifest,
            exactIntegrity: manifestIntegrity(source),
            lock: {
              extensionId: manifest.id,
              packageName: '@kubohiroya/turbowarp-structured-data',
              packageVersion: '0.11.0-rc.1',
              manifestFormatVersion: 2,
              integrity: manifestIntegrity(source),
              source: {kind: 'bundled', id: 'test'}
            }
          }
        ]),
      'TW2_MANIFEST_OPERATION_MISMATCH'
    );
  });

  it('rejects a Structured Data 0.4.0 manifest instead of falling back to its JSON-text API', () => {
    // The 0.4.0 blocks took JSON text and returned JSON text; 0.11 reuses the operation IDs for named
    // values, so the allowlist cannot hold both and the old signature no longer matches.
    const text = JSON.stringify(STRUCTURED_DATA_0_4_0_MANIFEST);
    const manifest = parseCompilerExtensionManifestJson(text);
    expectManifestError(
      () =>
        buildCompilerOpcodeRegistry([
          {
            manifest,
            exactIntegrity: manifestIntegrity(text),
            lock: {
              extensionId: manifest.id,
              packageName: '@kubohiroya/turbowarp-structured-data',
              packageVersion: '0.4.0',
              manifestFormatVersion: 2,
              integrity: manifestIntegrity(text),
              source: {kind: 'bundled', id: 'structured-data@0.4.0'}
            }
          }
        ]),
      'TW2_MANIFEST_OPERATION_MISMATCH'
    );
  });

  it('rejects lock paths outside the lock directory and every symlink component', async () => {
    const directory = await temporaryDirectory();
    const outsideDirectory = await temporaryDirectory();
    const manifest = await readFile(`${fixtureDirectory}/asset-cache.json`);
    const outsideManifest = join(outsideDirectory, 'asset-cache.json');
    await writeFile(outsideManifest, manifest);

    const escapingLock = join(directory, 'escape.lock.json');
    const outsideName = outsideDirectory.split('/').slice(-1)[0]!;
    await writeSingleEntryLock(escapingLock, `../${outsideName}/asset-cache.json`, manifestIntegrity(manifest));
    await expectManifestError(resolveCompilerManifestLock(escapingLock), 'TW2_MANIFEST_SOURCE_UNSAFE');

    await symlink(outsideDirectory, join(directory, 'linked'));
    const symlinkLock = join(directory, 'symlink.lock.json');
    await writeSingleEntryLock(symlinkLock, 'linked/asset-cache.json', manifestIntegrity(manifest));
    await expectManifestError(resolveCompilerManifestLock(symlinkLock), 'TW2_MANIFEST_SOURCE_UNSAFE');
  });

  it('pins the core extension as registered bundled exact bytes and rejects URL-like source kinds', async () => {
    const manifest = await readFile('dist/extension-manifest.json', 'utf8');
    const directory = await temporaryDirectory();
    const lockPath = join(directory, 'bundled.lock.json');
    await writeFile(
      lockPath,
      JSON.stringify({
        lockVersion: 1,
        extensions: [
          {
            extensionId: 'kubohiroyaturbowarphttpserver',
            packageName: '@kubohiroya/turbowarp-http-server',
            packageVersion: '0.0.0',
            manifestFormatVersion: 1,
            integrity: manifestIntegrity(manifest),
            source: {kind: 'bundled', id: 'http-server@0.0.0'}
          }
        ]
      })
    );
    const result = await resolveCompilerManifestLock(lockPath, {
      bundled: {'http-server@0.0.0': manifest}
    });
    expect(result.registry.entries.length).toBeGreaterThan(20);
    expect(result.manifests[0]?.lock).toMatchObject({
      extensionId: 'kubohiroyaturbowarphttpserver',
      packageVersion: '0.0.0',
      source: {kind: 'bundled', id: 'http-server@0.0.0'}
    });

    expectManifestError(
      () =>
        parseCompilerManifestLockJson(
          JSON.stringify({
            lockVersion: 1,
            extensions: [
              {
                extensionId: 'x',
                packageName: 'x',
                packageVersion: '1.0.0',
                manifestFormatVersion: 1,
                integrity: manifestIntegrity('{}'),
                source: {kind: 'url', url: 'https://example.invalid/manifest.json'}
              }
            ]
          })
        ),
      'TW2_MANIFEST_SCHEMA'
    );
  });

  it('keeps the committed schemas valid JSON', async () => {
    await expect(readFile('schemas/compiler-extension-manifest.schema.json', 'utf8').then(JSON.parse)).resolves.toBeTruthy();
    await expect(readFile('schemas/compiler-manifest-lock-v1.schema.json', 'utf8').then(JSON.parse)).resolves.toBeTruthy();
  });
});

/** The two-block 0.4.0-shaped manifest this suite used as its Structured Data fixture until 0.11. */
const STRUCTURED_DATA_0_4_0_MANIFEST = {
  formatVersion: 2,
  id: 'kubohiroyastructureddata',
  pathSegmentType: {
    kind: 'discriminatedUnion',
    variants: [
      {kind: 'key', valueType: 'string'},
      {kind: 'index', valueType: 'nonNegativeInteger'}
    ]
  },
  blocks: [
    {
      opcode: 'forEachAtPath',
      blockType: 'LOOP',
      arguments: [
        {id: 'JSON', type: 'STRING'},
        {id: 'MAX', type: 'NUMBER', staticLiteral: true, minimum: 1, maximum: 1000},
        {id: 'PATH', type: 'STRING', normalizesTo: 'pathSegments'}
      ],
      resultType: 'void',
      effect: 'control',
      immutable: true,
      errors: ['INVALID_JSON', 'INVALID_PATH', 'PATH_NOT_FOUND', 'TYPE_MISMATCH', 'INDEX_OUT_OF_RANGE', 'ITERATION_LIMIT_EXCEEDED'],
      server: {supported: true, irOperation: 'structuredData.forEach'}
    },
    {
      opcode: 'normalizeJson',
      blockType: 'REPORTER',
      arguments: [{id: 'JSON', type: 'STRING'}],
      resultType: 'json',
      effect: 'pure',
      immutable: true,
      errors: ['INVALID_JSON'],
      server: {supported: true, irOperation: 'structuredData.normalizeJson'}
    }
  ]
};

function basicBlock(opcode: string): Record<string, unknown> {
  return {opcode, blockType: 'COMMAND', arguments: []};
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tw-manifest-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSingleEntryLock(path: string, sourcePath: string, integrity: string): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({
      lockVersion: 1,
      extensions: [
        {
          extensionId: 'kubohiroyaassetcache',
          packageName: '@kubohiroya/turbowarp-asset-cache',
          packageVersion: '0.1.0',
          manifestFormatVersion: 2,
          integrity,
          source: {kind: 'local', path: sourcePath}
        }
      ]
    })
  );
}

function expectManifestError(
  operation: (() => unknown) | Promise<unknown>,
  code: CompilerManifestError['code']
): void | Promise<void> {
  if (operation instanceof Promise) {
    return expect(operation).rejects.toMatchObject({name: 'CompilerManifestError', code});
  }
  try {
    operation();
    throw new Error('Expected CompilerManifestError.');
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerManifestError);
    expect((error as CompilerManifestError).code).toBe(code);
  }
}
