import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  BinaryBodyHandle,
  parseDeployIrV2,
  validateDeployIrV2Subset,
  type BinaryBodySource
} from '../../src/compiler/index.js';
import {
  readCoreFixture,
  runBinaryVector,
  runGeneratedCore,
  sha256,
  type EffectTrace
} from './harness.js';

const fixtureRoot = resolve('tests/fixtures/conformance');

describe('conformance core runtime layer', () => {
  it.each(['structured-normal', 'structured-nested', 'structured-error', 'binary-upload'])(
    'matches the generated Hono trace for %s',
    async (name) => {
      const fixture = await readCoreFixture(join(fixtureRoot, 'core', `${name}.json`));
      const ir = parseDeployIrV2(fixture.ir);
      expect(validateDeployIrV2Subset(ir)).toEqual([]);
      await expect(runGeneratedCore(ir, fixture.request)).resolves.toEqual(fixture.expected);
    }
  );

  it('runs the file-backed binary put/get/delete vector without snapshotting bytes', async () => {
    const directory = join(fixtureRoot, 'binary');
    const fixture = JSON.parse(await readFile(join(directory, 'vector.json'), 'utf8')) as {
      fixtureVersion: number;
      bodyFile: string;
      bodySha256: string;
      maxBytes: number;
      expectedEffects: EffectTrace[];
    };
    expect(fixture.fixtureVersion).toBe(1);
    const bytes = new Uint8Array(await readFile(join(directory, fixture.bodyFile)));
    expect(sha256(bytes)).toBe(fixture.bodySha256);
    await expect(runBinaryVector(bytes, fixture.maxBytes)).resolves.toEqual({
      responseBodySha256: fixture.bodySha256,
      effects: fixture.expectedEffects
    });
    await expect(runBinaryVector(bytes, fixture.maxBytes - 1)).rejects.toMatchObject({
      code: 'BINARY_TOO_LARGE',
      httpStatus: 413
    });
    const handle = new BinaryBodyHandle(binarySource(bytes));
    expect(handle.take()).toBeTruthy();
    expect(() => handle.take()).toThrow(expect.objectContaining({code: 'BINARY_BODY_CONSUMED'}));
  });

});

function binarySource(bytes: Uint8Array): BinaryBodySource {
  return {
    size: bytes.byteLength,
    chunks: (async function* () {
      yield bytes;
    })()
  };
}
