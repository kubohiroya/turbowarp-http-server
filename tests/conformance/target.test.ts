import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {describe, expect, it} from 'vitest';
import {compileDeployIrV2, type DeployIrV2} from '../../src/compiler/index.js';

const execFileAsync = promisify(execFile);

describe('conformance target layer', () => {
  it('runs every registered target matrix entry deterministically and typechecks Cloudflare output', async () => {
    const matrix = JSON.parse(
      await readFile(resolve('tests/fixtures/conformance/target/matrix.json'), 'utf8')
    ) as {
      fixtureVersion: number;
      targets: Array<{id: string; adapterVersion: string; expectedFiles: string[]}>;
    };
    expect(matrix.fixtureVersion).toBe(1);
    expect(matrix.targets.map(({id}) => id)).toEqual(['cloudflare-workers']);

    for (const target of matrix.targets) {
      const first = compileDeployIrV2(targetIr(), {target: target.id});
      const second = compileDeployIrV2(targetIr(), {target: target.id});
      expect(first).toEqual(second);
      if (!first.ok) throw new Error(`Target ${target.id} did not compile.`);
      expect(first.manifest.adapter).toEqual({id: target.id, version: target.adapterVersion});
      expect(Object.keys(first.files)).toEqual(target.expectedFiles);
      if (target.id === 'cloudflare-workers') await typecheckGeneratedProject(first.files);
    }
  });
});

async function typecheckGeneratedProject(files: Readonly<Record<string, string>>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'tw-conformance-target-'));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const destination = join(directory, path);
      await mkdir(dirname(destination), {recursive: true});
      await writeFile(destination, contents);
    }
    await symlink(resolve('node_modules'), join(directory, 'node_modules'));
    try {
      await execFileAsync(resolve('node_modules/.bin/tsc'), ['--project', join(directory, 'tsconfig.json')], {
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

function targetIr(): DeployIrV2 {
  return {
    version: 2,
    name: 'target-matrix',
    auth: {kind: 'none'},
    capabilities: [{kind: 'record-store'}],
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
      }
    ]
  };
}
