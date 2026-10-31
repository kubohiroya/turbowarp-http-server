import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  buildCompilerOpcodeRegistry,
  KNOWN_SERVER_OPERATIONS,
  manifestIntegrity,
  parseCompilerExtensionManifestJson
} from '../src/compiler/manifest/index.js';
import {STRUCTURED_DATA_PACKAGE_VERSIONS} from '../src/compiler/structured-data/index.js';

/**
 * Reads real extension API manifests with the compiler's own reader.
 *
 * Every other test in this suite builds its manifests by hand, which is why a published extension
 * could drift out of what this reader accepts without anything failing: turbowarp-structured-data
 * shipped a format version 3 while the lock fixture recorded it as version 2, and no test noticed.
 * These cases read artifacts instead of constructing them.
 */
describe('real extension API manifests', () => {
  it("parses this extension's own generated manifest", async () => {
    const manifest = parseCompilerExtensionManifestJson(
      await readFile('dist/extension-manifest.json', 'utf8')
    );

    expect(manifest.id).toBe('kubohiroyaturbowarphttpserver');
    expect(manifest.blocks.length).toBeGreaterThan(0);
  });

  it('parses the manifest of every installed extension package', async () => {
    const scope = 'node_modules/@kubohiroya';
    const packages = await readdir(scope).catch(() => [] as string[]);
    const found: string[] = [];

    for (const name of packages.sort()) {
      const path = join(scope, name, 'dist/extension-manifest.json');
      const contents = await readFile(path, 'utf8').catch(() => null);
      if (contents === null) continue;
      found.push(name);
      // A dependency whose manifest this reader rejects cannot be compiled on a server, so the
      // failure belongs here rather than in whatever later step happens to trip over it.
      expect(() => parseCompilerExtensionManifestJson(contents), `${name} manifest`).not.toThrow();
    }

    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain('turbowarp-structured-data');
  });

  it('registers the published Structured Data manifest against the compiler allowlist', async () => {
    const packageDirectory = 'node_modules/@kubohiroya/turbowarp-structured-data';
    const packageJson = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    const text = await readFile(join(packageDirectory, 'dist/extension-manifest.json'), 'utf8');
    const manifest = parseCompilerExtensionManifestJson(text);
    const integrity = manifestIntegrity(text);

    // The allowlist compares JSON text, so registering the real file is what proves key order too.
    const registry = buildCompilerOpcodeRegistry([
      {
        manifest,
        exactIntegrity: integrity,
        lock: {
          extensionId: manifest.id,
          packageName: packageJson.name,
          packageVersion: packageJson.version,
          manifestFormatVersion: manifest.formatVersion,
          integrity,
          source: {kind: 'bundled', id: `${packageJson.name}@${packageJson.version}`}
        }
      }
    ]);

    expect(STRUCTURED_DATA_PACKAGE_VERSIONS).toContain(packageJson.version);
    expect(registry.entries).toHaveLength(manifest.blocks.length);
    const serverOperations = manifest.blocks
      .filter((block) => block.server?.supported === true)
      .map((block) => block.server?.irOperation)
      .sort();
    expect(serverOperations).toHaveLength(28);
    expect(serverOperations).toEqual(
      Object.keys(KNOWN_SERVER_OPERATIONS)
        .filter((operation) => operation.startsWith('structuredData.'))
        .sort()
    );
    // The committed fixture is the same file, byte for byte, so the lock integrity stays meaningful.
    expect(await readFile('tests/fixtures/compiler-manifests/structured-data.json', 'utf8')).toBe(text);
  });
});
