import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  canonicalizeDeployIrV2,
  parseDeployIrV2,
  resolveCompilerManifestLock,
  resolveCompilerProjectOpcode,
  StructuredDataLoweringContext,
  upgradeDeployIrV1,
  validateDeployIrV2Subset
} from '../../src/compiler/index.js';
import {compileTurboWarpProject} from '../../src/compiler/turbowarp.js';

const fixtureDirectory = resolve('tests/fixtures/conformance/frontend');

describe('conformance frontend layer', () => {
  it('locks external vectors and matches the expected canonical IR v2 golden', async () => {
    const fixturePath = join(fixtureDirectory, 'hello.fixture.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
      fixtureVersion: number;
      projectFile: string;
      manifestLockFile: string;
      expectedIrFile: string;
      externalVectors: Array<{packageName: string; packageVersion: string; integrity: string}>;
    };
    expect(fixture.fixtureVersion).toBe(1);
    const base = dirname(fixturePath);
    const resolved = await resolveCompilerManifestLock(resolve(base, fixture.manifestLockFile));
    expect(
      resolved.manifests.map(({lock, exactIntegrity}) => ({
        packageName: lock.packageName,
        packageVersion: lock.packageVersion,
        integrity: exactIntegrity
      }))
    ).toEqual(fixture.externalVectors);

    const entry = resolveCompilerProjectOpcode(resolved.registry, 'kubohiroyastructureddata_normalizeJson');
    if (entry === undefined) throw new Error('Locked Structured Data operation is missing.');
    const lowering = new StructuredDataLoweringContext();
    expect(
      lowering.lowerReporter(
        entry,
        {JSON: {kind: 'request', valueType: 'string', source: 'body-text'}},
        {targetIndex: 0, targetName: 'Stage', blockId: 'normalize', opcode: entry.projectOpcode}
      )
    ).toMatchObject({
      kind: 'json-stringify',
      value: {kind: 'json-parse', text: {kind: 'json-text-coerce', input: {kind: 'request'}}}
    });
    expect(lowering.diagnostics).toEqual([]);

    const project = JSON.parse(await readFile(resolve(base, fixture.projectFile), 'utf8')) as unknown;
    const compiled = compileTurboWarpProject(project);
    expect(compiled.diagnostics).toEqual([]);
    const upgraded = upgradeDeployIrV1(compiled.ir);
    expect(upgraded.diagnostics).toEqual([]);
    const expected = parseDeployIrV2(
      JSON.parse(await readFile(resolve(base, fixture.expectedIrFile), 'utf8')) as unknown
    );
    expect(canonicalizeDeployIrV2(upgraded.ir)).toBe(canonicalizeDeployIrV2(expected));
  });

  it('matches expected target-neutral diagnostic codes', async () => {
    const fixture = JSON.parse(
      await readFile(join(fixtureDirectory, 'missing-capability.fixture.json'), 'utf8')
    ) as {fixtureVersion: number; ir: unknown; expectedDiagnosticCodes: string[]};
    expect(fixture.fixtureVersion).toBe(1);
    const diagnosticCodes = validateDeployIrV2Subset(parseDeployIrV2(fixture.ir)).map(({code}) => code);
    expect(diagnosticCodes).toEqual(fixture.expectedDiagnosticCodes);
  });
});
