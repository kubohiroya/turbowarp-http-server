import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  compileToDirectory,
  compileTurboWarpProjectV2,
  resolveCompilerManifestLock
} from '../src/compiler/index.js';

const prefix = 'kubohiroyaturbowarphttpserver_';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})));
});

describe('TurboWarp IR v2 frontend', () => {
  it('upgrades the legacy built-in subset without changing its response semantics', () => {
    const project = namedProject();
    const blocks = targetBlocks(project);
    blocks.named = {
      opcode: `${prefix}respondWithText`,
      next: null,
      parent: 'hat',
      inputs: {BODY: [1, [10, 'Hello v2']]}
    };

    const result = compileTurboWarpProjectV2(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir).toMatchObject({
      version: 2,
      capabilities: [],
      routes: [
        {
          method: 'ALL',
          path: '/',
          body: [
            {
              kind: 'respond',
              format: 'text',
              body: {kind: 'literal', valueType: 'string', value: 'Hello v2'}
            }
          ]
        }
      ]
    });
  });

  it('lowers the named response block and derives its capability and source location', () => {
    const result = compileTurboWarpProjectV2(namedProject());

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.capabilities).toEqual([{kind: 'named-body-provider'}]);
    expect(result.ir.routes[0]).toMatchObject({
      sourceRef: {targetIndex: 0, targetName: 'Stage', blockId: 'hat'},
      body: [
        {
          kind: 'respond-named-body',
          reference: {
            namespace: 'asset',
            name: 'avatar',
            kind: 'asset',
            scope: 'project'
          },
          representation: 'raw',
          maxBytes: 1024,
          sourceRef: {targetIndex: 0, targetName: 'Stage', blockId: 'named'}
        }
      ]
    });
  });

  it('rejects dynamic named descriptors and forbidden Scratch state with block source refs', () => {
    const dynamic = namedProject();
    const dynamicBlocks = targetBlocks(dynamic);
    const namedInputs = dynamicBlocks.named!.inputs as Record<string, unknown>;
    dynamicBlocks.named!.inputs = {...namedInputs, NAME: [3, 'path']};
    dynamicBlocks.path = {
      opcode: `${prefix}currentRequestPath`,
      next: null,
      parent: 'named',
      inputs: {}
    };
    const dynamicResult = compileTurboWarpProjectV2(dynamic);
    expect(dynamicResult.diagnostics).toEqual([
      expect.objectContaining({
        code: 'TW2_NAMED_DYNAMIC_DESCRIPTOR',
        sourceRef: expect.objectContaining({blockId: 'named', input: 'NAME'})
      })
    ]);

    const global = namedProject();
    const globalBlocks = targetBlocks(global);
    globalBlocks.global = {
      opcode: 'data_setvariableto',
      next: 'named',
      parent: 'hat',
      inputs: {}
    };
    globalBlocks.hat!.next = 'global';
    const globalResult = compileTurboWarpProjectV2(global);
    expect(globalResult.diagnostics).toEqual([
      expect.objectContaining({
        code: 'TW2_GLOBAL_STATE_UNSUPPORTED',
        sourceRef: expect.objectContaining({blockId: 'global'})
      })
    ]);
  });

  it('connects project.json to the IR v2 CLI pipeline while preserving explicit target checks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-v2-frontend-'));
    temporaryDirectories.push(directory);
    const legacyInput = join(directory, 'legacy.json');
    const legacy = namedProject();
    targetBlocks(legacy).named = {
      opcode: `${prefix}respondWithText`,
      next: null,
      parent: 'hat',
      inputs: {BODY: [1, [10, 'Hello v2']]}
    };
    await writeFile(legacyInput, JSON.stringify(legacy));
    const output = join(directory, 'worker');

    const compiled = await compileToDirectory({
      input: legacyInput,
      output,
      format: 'turbowarp-json',
      irVersion: 2,
      target: 'cloudflare-workers'
    });
    expect(compiled.ir.version).toBe(2);
    expect(await readFile(join(output, 'src/core.generated.ts'), 'utf8')).toContain('Hello v2');

    const namedInput = join(directory, 'named.json');
    await writeFile(namedInput, JSON.stringify(namedProject()));
    await expect(
      compileToDirectory({
        input: namedInput,
        output: join(directory, 'named-disabled'),
        format: 'turbowarp-json',
        irVersion: 2,
        target: 'cloudflare-workers'
      })
    ).rejects.toThrow(/TW2_NAMED_RESPONSE_BODY_DISABLED/u);
    await expect(
      compileToDirectory({
        input: namedInput,
        output: join(directory, 'named-enabled'),
        format: 'turbowarp-json',
        irVersion: 2,
        target: 'cloudflare-workers',
        namedResponseBody: true
      })
    ).rejects.toThrow(/TW2_TARGET_CAPABILITY_UNSUPPORTED/u);
  });

  it('lowers literal bounded repeats instead of accepting blocks that the frontend cannot compile', () => {
    const project = namedProject();
    const blocks = targetBlocks(project);
    blocks.hat!.next = 'repeat';
    blocks.repeat = {
      opcode: 'control_repeat',
      next: 'response',
      parent: 'hat',
      inputs: {TIMES: [1, [4, '2']], SUBSTACK: [2, 'status']}
    };
    blocks.status = {
      opcode: `${prefix}setHttpStatus`,
      next: null,
      parent: 'repeat',
      inputs: {STATUS: [1, [4, '201']]}
    };
    blocks.response = {
      opcode: `${prefix}respondWithText`,
      next: null,
      parent: 'repeat',
      inputs: {BODY: [1, [10, 'done']]}
    };
    delete blocks.named;

    const result = compileTurboWarpProjectV2(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.routes[0]?.body).toMatchObject([
      {kind: 'bounded-loop', maxIterations: 2, body: [{kind: 'set-status', status: 201}]},
      {kind: 'respond', format: 'text'}
    ]);
  });

  it('uses the locked manifest registry to lower Structured Data reporters in project.json', async () => {
    const {registry} = await resolveCompilerManifestLock(
      'tests/fixtures/compiler-manifests/turbowarp-server.lock.json'
    );
    const project = namedProject();
    const blocks = targetBlocks(project);
    blocks.named = {
      opcode: `${prefix}respondWithJson`,
      next: null,
      parent: 'hat',
      inputs: {BODY: [3, 'normalize']}
    };
    blocks.normalize = {
      opcode: 'kubohiroyastructureddata_normalizeJson',
      next: null,
      parent: 'named',
      inputs: {JSON: [1, [10, '{"b":2,"a":1}']]}
    };

    const result = compileTurboWarpProjectV2(project, registry);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.routes[0]?.body[0]).toMatchObject({
      kind: 'respond',
      format: 'json',
      body: {
        kind: 'json-stringify',
        value: {kind: 'literal', valueType: 'json-object', value: {b: 2, a: 1}}
      }
    });

    const directory = await mkdtemp(join(tmpdir(), 'tw-v2-manifest-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'project.json');
    const output = join(directory, 'worker');
    await writeFile(input, JSON.stringify(project));
    const compiled = await compileToDirectory({
      input,
      output,
      format: 'turbowarp-json',
      irVersion: 2,
      target: 'cloudflare-workers',
      manifestLock: 'tests/fixtures/compiler-manifests/turbowarp-server.lock.json'
    });
    expect(compiled.diagnostics).toEqual([]);
    expect(await readFile(join(output, 'src/core.generated.ts'), 'utf8')).toContain('stringifyApplicationJson');
  });

  it('lowers locked KVS commands and reporters to target-neutral IR', async () => {
    const {registry} = await resolveCompilerManifestLock(
      'tests/fixtures/compiler-manifests/turbowarp-server.lock.json'
    );
    const project = namedProject();
    const blocks = targetBlocks(project);
    blocks.hat!.next = 'set';
    blocks.set = {
      opcode: 'kubohiroyakvs_setValue',
      next: 'response',
      parent: 'hat',
      inputs: {
        NAMESPACE: [1, [10, 'sessions']],
        KEY: [1, [10, 'greeting']],
        VALUE: [1, [10, 'hello']]
      }
    };
    blocks.response = {
      opcode: `${prefix}respondWithText`,
      next: null,
      parent: 'set',
      inputs: {BODY: [3, 'get']}
    };
    blocks.get = {
      opcode: 'kubohiroyakvs_getValue',
      next: null,
      parent: 'response',
      inputs: {
        NAMESPACE: [1, [10, 'sessions']],
        KEY: [1, [10, 'greeting']]
      }
    };
    delete blocks.named;

    const result = compileTurboWarpProjectV2(project, registry);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.capabilities).toEqual([{kind: 'key-value-store'}]);
    expect(result.ir.routes[0]?.body).toMatchObject([
      {
        kind: 'kvs-set-text',
        namespace: {kind: 'literal', value: 'sessions'},
        key: {kind: 'literal', value: 'greeting'},
        value: {kind: 'literal', value: 'hello'}
      },
      {
        kind: 'respond',
        format: 'text',
        body: {
          kind: 'kvs-get-text',
          namespace: {kind: 'literal', value: 'sessions'},
          key: {kind: 'literal', value: 'greeting'}
        }
      }
    ]);

    const directory = await mkdtemp(join(tmpdir(), 'tw-v2-kvs-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'project.json');
    const output = join(directory, 'worker');
    await writeFile(input, JSON.stringify(project));
    const compiled = await compileToDirectory({
      input,
      output,
      format: 'turbowarp-json',
      irVersion: 2,
      target: 'cloudflare-workers',
      manifestLock: 'tests/fixtures/compiler-manifests/turbowarp-server.lock.json'
    });
    expect(compiled.diagnostics).toEqual([]);
    expect(await readFile(join(output, 'src/index.ts'), 'utf8')).toContain('keyValues:');
    expect(await readFile(join(output, 'migrations/0001_init.sql'), 'utf8')).toContain(
      'CREATE TABLE IF NOT EXISTS kvs'
    );
  });

  it('keeps source locations unambiguous when targets have the same display name', () => {
    const project = namedProject();
    const duplicate = structuredClone((project.targets as unknown[])[0]) as {
      blocks: Record<string, Record<string, unknown>>;
    };
    duplicate.blocks = {
      secondHat: {
        opcode: `${prefix}whenHttpRequestReceived`,
        next: 'unsafe',
        parent: null,
        topLevel: true,
        inputs: {}
      },
      unsafe: {
        opcode: `${prefix}setResponseHeader`,
        next: 'secondResponse',
        parent: 'secondHat',
        inputs: {NAME: [1, [10, 'content-length']], VALUE: [1, [10, '1']]}
      },
      secondResponse: {
        opcode: `${prefix}respondWithText`,
        next: null,
        parent: 'unsafe',
        inputs: {BODY: [1, [10, 'no']]}
      }
    };
    (project.targets as unknown[]).push(duplicate);

    const result = compileTurboWarpProjectV2(project);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TW2_UNSAFE_HEADER',
        sourceRef: expect.objectContaining({targetIndex: 1, targetName: 'Stage', blockId: 'unsafe'})
      })
    );
  });
});

function namedProject(): Record<string, unknown> {
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        blocks: {
          hat: {
            opcode: `${prefix}whenHttpRequestReceived`,
            next: 'named',
            parent: null,
            topLevel: true,
            inputs: {}
          },
          named: {
            opcode: `${prefix}respondWithNamedBody`,
            next: null,
            parent: 'hat',
            inputs: {
              NAMESPACE: [1, [10, 'asset']],
              NAME: [1, [10, 'avatar']],
              KIND: [1, [10, 'asset']],
              SCOPE: [1, [10, 'project']],
              TARGET_ID: [1, [10, 'Stage:1']],
              REPRESENTATION: [1, [10, 'raw']],
              MAX_BYTES: [1, [4, '1024']]
            }
          }
        }
      }
    ]
  };
}

function targetBlocks(project: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (project.targets as Array<{blocks: Record<string, Record<string, unknown>>}>)[0]!.blocks;
}
