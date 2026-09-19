import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach, describe, expect, it} from 'vitest';
import {compileToDirectory} from '../src/compiler/index.js';
import {generateCloudflareWorker} from '../src/compiler/generator.js';
import {compileTurboWarpProject} from '../src/compiler/turbowarp.js';
import {parseDeployIr} from '../src/compiler/validate.js';

const temporaryDirectories: string[] = [];
const prefix = 'kubohiroyaturbowarphttpserver_';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})));
});

describe('TurboWarp to Cloudflare Workers compiler', () => {
  it('extracts stage and sprite method handlers into route IR', () => {
    const result = compileTurboWarpProject(projectFixture());

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.routes).toMatchObject([
      {method: 'GET', path: '/', auth: 'public'},
      {method: 'POST', path: '/messages', auth: 'public'}
    ]);
    expect(result.ir.routes[1]?.actions).toEqual([
      {
        kind: 'respond',
        format: 'json',
        body: {kind: 'concat', left: {kind: 'literal', value: '{"body":"'}, right: {kind: 'request', source: 'body'}}
      }
    ]);
  });

  it('reports unsupported blocks without generating partial handlers', () => {
    const project = projectFixture();
    const targets = project.targets as Array<{blocks: Record<string, {opcode: string}>}>;
    targets[0]!.blocks.respond!.opcode = 'motion_movesteps';

    const result = compileTurboWarpProject(project);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({severity: 'error', code: 'TW_UNSUPPORTED_COMMAND'})])
    );
    expect(result.ir.routes).toHaveLength(1);
  });

  it('compiles request-local handler variables without persistent global state', () => {
    const project = projectFixture();
    const targets = project.targets as Array<{blocks: Record<string, Record<string, unknown>>}>;
    const stageBlocks = targets[0]!.blocks;
    stageBlocks.guard!.inputs = {CONDITION: [2, 'equals'], SUBSTACK: [2, 'setLocal']};
    stageBlocks.setLocal = {
      opcode: `${prefix}setHandlerVariable`,
      next: 'respondLocal',
      parent: 'guard',
      inputs: {NAME: [1, [10, 'greeting']], VALUE: [1, [10, 'hello']]}
    };
    stageBlocks.localReporter = {
      opcode: `${prefix}handlerVariable`,
      next: null,
      parent: 'respondLocal',
      inputs: {NAME: [1, [10, 'greeting']]}
    };
    stageBlocks.respondLocal = {
      opcode: `${prefix}respondWithText`,
      next: null,
      parent: 'setLocal',
      inputs: {BODY: [3, 'localReporter']}
    };

    const result = compileTurboWarpProject(project);

    expect(result.diagnostics).toEqual([]);
    expect(result.ir.routes[0]?.actions).toEqual([
      {
        kind: 'set-handler-variable',
        name: {kind: 'literal', value: 'greeting'},
        value: {kind: 'literal', value: 'hello'}
      },
      {
        kind: 'respond',
        format: 'text',
        body: {kind: 'handler-variable', name: {kind: 'literal', value: 'greeting'}}
      }
    ]);
    const source = generateCloudflareWorker(parseDeployIr(result.ir))['src/routes.generated.ts'];
    expect(source).toContain('new Map<string, string>()');
    expect(source).toContain('handlerVariables.get');
  });

  it('validates auth, storage, reserved routes, and unsafe headers in IR', () => {
    const ir = parseDeployIr({
      version: 1,
      name: 'message-api',
      auth: 'external-jwt',
      routes: [
        {
          id: 'create-message',
          method: 'POST',
          path: '/messages',
          auth: 'required',
          actions: [
            {
              kind: 'record-create',
              collection: 'messages',
              data: {kind: 'request', source: 'body'},
              result: 'created'
            },
            {kind: 'respond', format: 'json', body: {kind: 'result', name: 'created'}}
          ]
        }
      ]
    });

    expect(ir.routes[0]?.actions[0]).toMatchObject({kind: 'record-create', collection: 'messages'});
    expect(() =>
      parseDeployIr({
        ...ir,
        routes: [{...ir.routes[0], path: '/@assets/file'}]
      })
    ).toThrow(/reserved path/);
    expect(() =>
      parseDeployIr({
        ...ir,
        routes: [
          {...ir.routes[0], actions: [{kind: 'set-header', name: 'content-length', value: {kind: 'literal', value: '1'}}, ...ir.routes[0]!.actions]}
        ]
      })
    ).toThrow(/Unsafe response header/);
  });

  it('generates deployable scaffold boundaries and embeds the selected auth mode', () => {
    const ir = parseDeployIr({
      version: 1,
      name: 'message-api',
      auth: 'cloudflare-access',
      routes: [
        {
          id: 'home',
          method: 'GET',
          path: '/',
          auth: 'required',
          actions: [{kind: 'respond', format: 'text', body: {kind: 'literal', value: 'Hello'}}]
        }
      ]
    });

    const files = generateCloudflareWorker(ir);

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'src/index.ts',
        'src/routes.generated.ts',
        'src/auth.ts',
        'src/storage.ts',
        'wrangler.jsonc',
        'migrations/0001_init.sql',
        '.dev.vars.example',
        'README.md'
      ])
    );
    expect(files['src/routes.generated.ts']).toContain("authenticate(c.req.raw, c.env, \"cloudflare-access\")");
    expect(files['src/auth.ts']).toContain('jwtVerify');
    expect(files['src/storage.ts']).toContain('interface AssetStore');
  });

  it('writes generated files only through the explicit compile operation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-compiler-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'project.json');
    const output = join(directory, 'worker');
    await import('node:fs/promises').then(({writeFile}) => writeFile(input, JSON.stringify(projectFixture())));

    const result = await compileToDirectory({input, output, format: 'turbowarp-json'});

    expect(result.files).toContain('src/routes.generated.ts');
    expect(await readFile(join(output, 'src/index.ts'), 'utf8')).toContain('registerGeneratedRoutes');
    await expect(compileToDirectory({input, output, format: 'turbowarp-json'})).rejects.toThrow(/not empty/);
  });
});

function projectFixture(): Record<string, unknown> {
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        blocks: {
          hat: {opcode: `${prefix}whenHttpRequestReceived`, next: 'guard', parent: null, topLevel: true, inputs: {}},
          guard: {
            opcode: 'control_if',
            next: null,
            parent: 'hat',
            inputs: {CONDITION: [2, 'equals'], SUBSTACK: [2, 'respond']}
          },
          equals: {opcode: 'operator_equals', next: null, parent: 'guard', inputs: {OPERAND1: [3, 'method'], OPERAND2: [1, [10, 'GET']]}},
          method: {opcode: `${prefix}currentHttpMethod`, next: null, parent: 'equals', inputs: {}},
          respond: {opcode: `${prefix}respondWithText`, next: null, parent: 'guard', inputs: {BODY: [1, [10, 'Hello']]}}
        }
      },
      {
        isStage: false,
        name: 'Messages',
        blocks: {
          hat2: {opcode: `${prefix}whenHttpRequestReceived`, next: 'guard2', parent: null, topLevel: true, inputs: {}},
          guard2: {
            opcode: 'control_if',
            next: null,
            parent: 'hat2',
            inputs: {CONDITION: [2, 'equals2'], SUBSTACK: [2, 'respond2']}
          },
          equals2: {opcode: 'operator_equals', next: null, parent: 'guard2', inputs: {OPERAND1: [3, 'method2'], OPERAND2: [1, [10, 'POST']]}},
          method2: {opcode: `${prefix}currentHttpMethod`, next: null, parent: 'equals2', inputs: {}},
          join: {opcode: 'operator_join', next: null, parent: 'respond2', inputs: {STRING1: [1, [10, '{"body":"']], STRING2: [3, 'body']}},
          body: {opcode: `${prefix}currentRequestBody`, next: null, parent: 'join', inputs: {}},
          respond2: {opcode: `${prefix}respondWithJson`, next: null, parent: 'guard2', inputs: {BODY: [3, 'join']}}
        }
      }
    ]
  };
}
