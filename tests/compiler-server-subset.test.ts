import {describe, expect, it} from 'vitest';
import {
  BinaryBodyLifetimeTracker,
  resolveCompilerManifestLock,
  targetCapabilityDiagnostic,
  validateDeployIrV2Subset,
  validateTurboWarpServerSubset,
  type DeployIrV2,
  type ExpressionIrV2,
  type JsonValue,
  type SourceRefV2,
  type StatementIrV2,
  type TargetNeutralDiagnostic
} from '../src/compiler/index.js';

const httpPrefix = 'kubohiroyaturbowarphttpserver_';
const source: SourceRefV2 = {
  targetIndex: 0,
  targetName: 'Stage',
  blockId: 'source-block',
  opcode: `${httpPrefix}respondWithText`
};

describe('IR v2 server subset validator', () => {
  it('accepts request-local scalar state and typed record bindings', () => {
    const ir = fixture([
      {
        kind: 'set-handler-variable',
        name: literal('string', 'counter'),
        value: literal('string', '1')
      },
      {
        kind: 'record-list',
        collection: 'messages',
        result: {id: 'records', type: {kind: 'value', valueType: 'json-array'}}
      },
      {
        kind: 'respond',
        format: 'json',
        body: {kind: 'binding', binding: 'records', valueType: 'json-array'}
      }
    ]);
    ir.capabilities = [{kind: 'record-store'}];

    expect(validateDeployIrV2Subset(ir)).toEqual([]);
  });

  it('rejects JSON handler state, undeclared bindings, and missing capabilities with source context', () => {
    const ir = fixture([
      {
        kind: 'set-handler-variable',
        name: literal('string', 'state'),
        value: literal('json-object', {unsafe: true}),
        sourceRef: source
      },
      {
        kind: 'record-list',
        collection: 'messages',
        result: {id: 'records', type: {kind: 'value', valueType: 'json-array'}},
        sourceRef: source
      },
      {
        kind: 'respond',
        format: 'json',
        body: {kind: 'binding', binding: 'missing', valueType: 'json-array', sourceRef: source}
      }
    ]);

    const diagnostics = validateDeployIrV2Subset(ir);
    expect(codes(diagnostics)).toEqual(
      expect.arrayContaining(['TW2_HANDLER_VARIABLE_TYPE', 'TW2_CAPABILITY_MISSING', 'TW2_BINDING_UNDECLARED'])
    );
    expect(diagnostics.every((item) => item.routeId === 'route')).toBe(true);
    expect(diagnostics.every((item) => item.reason.length > 0 && item.suggestion.length > 0)).toBe(true);
    expect(diagnostics.find((item) => item.code === 'TW2_HANDLER_VARIABLE_TYPE')?.sourceRef).toEqual(source);
  });

  it('does not share lexical bindings between routes or requests', () => {
    const ir = fixture([recordList('routeLocal'), respondWithBinding('routeLocal', 'json-array')]);
    ir.capabilities = [{kind: 'record-store'}];
    ir.routes.push({
      id: 'second-route',
      method: 'GET',
      path: '/second',
      auth: 'public',
      body: [respondWithBinding('routeLocal', 'json-array')]
    });

    const diagnostics = validateDeployIrV2Subset(ir);
    expect(diagnostics).toEqual([
      expect.objectContaining({code: 'TW2_BINDING_UNDECLARED', routeId: 'second-route'})
    ]);
  });

  it('merges only bindings declared with equal types on all continuing branches', () => {
    const valid = fixture([
      {
        kind: 'if',
        condition: literal('boolean', true),
        then: [recordList('result')],
        else: [recordList('result')]
      },
      respondWithBinding('result', 'json-array')
    ]);
    valid.capabilities = [{kind: 'record-store'}];
    expect(validateDeployIrV2Subset(valid)).toEqual([]);

    const invalid = fixture([
      {
        kind: 'if',
        condition: literal('boolean', true),
        then: [recordList('result')],
        else: [
          {
            kind: 'record-create',
            collection: 'messages',
            data: literal('json-object', {}),
            result: {id: 'result', type: {kind: 'value', valueType: 'json-object'}}
          }
        ]
      },
      respondWithBinding('result', 'json-array')
    ]);
    invalid.capabilities = [{kind: 'record-store'}];
    expect(codes(validateDeployIrV2Subset(invalid))).toEqual(
      expect.arrayContaining(['TW2_BRANCH_BINDING_MISMATCH', 'TW2_BINDING_UNDECLARED'])
    );
  });

  it('enforces one terminal response and rejects response inside loops', () => {
    expect(codes(validateDeployIrV2Subset(fixture([{kind: 'set-status', status: 204}])))).toContain(
      'TW2_MISSING_RESPONSE'
    );
    expect(
      codes(
        validateDeployIrV2Subset(
          fixture([respond('first'), respond('second')])
        )
      )
    ).toContain('TW2_MULTIPLE_RESPONSE');
    expect(
      codes(validateDeployIrV2Subset(fixture([respond('done'), {kind: 'set-status', status: 201}])))
    ).toContain('TW2_RESPONSE_AFTER_TERMINAL');
    expect(
      codes(
        validateDeployIrV2Subset(
          fixture([{kind: 'bounded-loop', maxIterations: 1, body: [respond('inside')]}, respond('outside')])
        )
      )
    ).toContain('TW2_RESPONSE_IN_LOOP');
  });

  it('checks loop bound 1000, nesting 8, and route work budget 10000 boundaries', () => {
    const allowedBound = fixture([
      {kind: 'bounded-loop', maxIterations: 1000, body: [{kind: 'set-status', status: 200}]},
      respond('done')
    ]);
    expect(codes(validateDeployIrV2Subset(allowedBound))).not.toContain('TW2_LOOP_BOUND_INVALID');

    const excessiveBound = fixture([
      {kind: 'bounded-loop', maxIterations: 1001, body: [{kind: 'set-status', status: 200}]},
      respond('done')
    ]);
    expect(codes(validateDeployIrV2Subset(excessiveBound))).toContain('TW2_LOOP_BOUND_INVALID');

    expect(codes(validateDeployIrV2Subset(fixture([nestedLoops(8), respond('done')])))).not.toContain(
      'TW2_LOOP_NESTING_EXCEEDED'
    );
    expect(codes(validateDeployIrV2Subset(fixture([nestedLoops(9), respond('done')])))).toContain(
      'TW2_LOOP_NESTING_EXCEEDED'
    );

    const baseLoop: StatementIrV2 = {
      kind: 'bounded-loop',
      maxIterations: 1000,
      body: Array.from({length: 9}, () => ({kind: 'set-status', status: 200}) as const)
    };
    const exactBudget = fixture([
      baseLoop,
      ...Array.from({length: 997}, () => ({kind: 'set-status', status: 200}) as const),
      respond('done')
    ]);
    expect(codes(validateDeployIrV2Subset(exactBudget))).not.toContain('TW2_WORK_BUDGET_EXCEEDED');
    exactBudget.routes[0]!.body.splice(-1, 0, {kind: 'set-status', status: 200});
    expect(codes(validateDeployIrV2Subset(exactBudget))).toContain('TW2_WORK_BUDGET_EXCEEDED');
  });

  it('keeps target-neutral and adapter capability diagnostics distinct', () => {
    const diagnostic = targetCapabilityDiagnostic({
      targetId: 'firebase-functions',
      routeId: 'route',
      capability: 'streaming-body',
      sourceRef: source
    });
    expect(diagnostic).toMatchObject({
      phase: 'target-capability',
      code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
      targetId: 'firebase-functions',
      sourceRef: source
    });
    expect(validateDeployIrV2Subset(fixture([respond('done')]))).toEqual([]);
  });
});

describe('binary-body affine lifetime', () => {
  it('rejects double consumption and use after lexical scope exit', () => {
    const diagnostics: TargetNeutralDiagnostic[] = [];
    const tracker = new BinaryBodyLifetimeTracker('binary-route', diagnostics);
    tracker.declare('rootBody', source);
    expect(tracker.consume('rootBody')).toBe(true);
    expect(tracker.consume('rootBody', source)).toBe(false);

    tracker.enterScope();
    tracker.declare('branchBody', source);
    tracker.leaveScope();
    expect(tracker.consume('branchBody', source)).toBe(false);
    expect(tracker.consume('neverDeclared', source)).toBe(false);

    expect(codes(diagnostics)).toEqual([
      'TW2_BINARY_BODY_CONSUMED',
      'TW2_BINARY_BODY_SCOPE',
      'TW2_BINARY_BODY_UNDECLARED'
    ]);
  });
});

describe('TurboWarp server subset frontend validation', () => {
  it('rejects reachable global state, messages, forever, clone, and renderer blocks', () => {
    const project = projectWithChain([
      ['global', 'data_setvariableto'],
      ['broadcast', 'event_broadcast'],
      ['forever', 'control_forever'],
      ['clone', 'control_create_clone_of'],
      ['move', 'motion_movesteps']
    ]);
    const diagnostics = validateTurboWarpServerSubset(project);
    expect(codes(diagnostics)).toEqual([
      'TW2_GLOBAL_STATE_UNSUPPORTED',
      'TW2_MESSAGE_UNSUPPORTED',
      'TW2_UNBOUNDED_LOOP',
      'TW2_CLONE_UNSUPPORTED',
      'TW2_RUNTIME_DEPENDENCY_UNSUPPORTED'
    ]);
    expect(diagnostics[0]).toMatchObject({
      phase: 'target-neutral',
      routeId: 'project:0:Stage',
      sourceRef: {targetIndex: 0, targetName: 'Stage', blockId: 'global', opcode: 'data_setvariableto'}
    });
  });

  it('ignores unsafe blocks outside HTTP handlers and accepts the top-level method guard', () => {
    const project = methodGuardProject();
    const blocks = (project.targets as Array<{blocks: Record<string, unknown>}>)[0]!.blocks;
    blocks.unused = {opcode: 'control_forever', next: null, parent: null, topLevel: true, inputs: {}};
    expect(validateTurboWarpServerSubset(project)).toEqual([]);
  });

  it('requires literal repeat bounds and limits nesting to eight', () => {
    const literal = projectWithRepeatNesting(8, '1000');
    expect(codes(validateTurboWarpServerSubset(literal))).toEqual([]);

    const excessive = projectWithRepeatNesting(9, '1001');
    expect(codes(validateTurboWarpServerSubset(excessive))).toEqual(
      expect.arrayContaining(['TW2_LOOP_BOUND_INVALID', 'TW2_LOOP_NESTING_EXCEEDED'])
    );

    const dynamic = projectWithRepeatNesting(1, null);
    expect(codes(validateTurboWarpServerSubset(dynamic))).toContain('TW2_LOOP_BOUND_INVALID');
  });

  it('allows only locked extension blocks with validated server-operation hints', async () => {
    const {registry} = await resolveCompilerManifestLock(
      'tests/fixtures/compiler-manifests/turbowarp-server.lock.json'
    );
    const project = projectWithChain([
      ['structured', 'kubohiroyastructureddata_normalizeJson'],
      ['asset', 'kubohiroyaassetmanager_isLoaded']
    ]);
    const diagnostics = validateTurboWarpServerSubset(project, registry);
    expect(codes(diagnostics)).toEqual(['TW2_UNSUPPORTED_OPERATION']);
    expect(diagnostics[0]?.sourceRef?.blockId).toBe('asset');
  });
});

function fixture(body: StatementIrV2[]): DeployIrV2 {
  return {
    version: 2,
    name: 'fixture',
    auth: {kind: 'none'},
    capabilities: [],
    routes: [{id: 'route', method: 'GET', path: '/', auth: 'public', body}]
  };
}

function literal(
  valueType: 'boolean' | 'number' | 'string' | 'json-array' | 'json-object',
  value: JsonValue
): ExpressionIrV2 {
  return {kind: 'literal', valueType, value};
}

function respond(value: string): StatementIrV2 {
  return {kind: 'respond', format: 'text', body: literal('string', value)};
}

function recordList(id: string): StatementIrV2 {
  return {
    kind: 'record-list',
    collection: 'messages',
    result: {id, type: {kind: 'value', valueType: 'json-array'}}
  };
}

function respondWithBinding(id: string, valueType: 'json-array' | 'json-object'): StatementIrV2 {
  return {kind: 'respond', format: 'json', body: {kind: 'binding', binding: id, valueType}};
}

function nestedLoops(depth: number): StatementIrV2 {
  let statement: StatementIrV2 = {kind: 'set-status', status: 200};
  for (let index = 0; index < depth; index += 1) {
    statement = {kind: 'bounded-loop', maxIterations: 0, body: [statement]};
  }
  return statement;
}

function codes(diagnostics: readonly TargetNeutralDiagnostic[]): string[] {
  return diagnostics.map((item) => item.code);
}

function projectWithChain(entries: Array<[string, string]>): Record<string, unknown> {
  const blocks: Record<string, Record<string, unknown>> = {
    hat: {opcode: `${httpPrefix}whenHttpRequestReceived`, next: entries[0]?.[0] ?? null, parent: null, topLevel: true, inputs: {}}
  };
  entries.forEach(([id, opcode], index) => {
    blocks[id] = {
      opcode,
      next: entries[index + 1]?.[0] ?? null,
      parent: index === 0 ? 'hat' : entries[index - 1]![0],
      inputs: {}
    };
  });
  return {targets: [{name: 'Stage', blocks}]};
}

function methodGuardProject(): Record<string, unknown> {
  return {
    targets: [
      {
        name: 'Stage',
        blocks: {
          hat: {opcode: `${httpPrefix}whenHttpRequestReceived`, next: 'guard', parent: null, topLevel: true, inputs: {}},
          guard: {
            opcode: 'control_if',
            next: null,
            parent: 'hat',
            inputs: {CONDITION: [2, 'equals'], SUBSTACK: [2, 'respond']}
          },
          equals: {
            opcode: 'operator_equals',
            next: null,
            parent: 'guard',
            inputs: {OPERAND1: [3, 'method'], OPERAND2: [1, [10, 'GET']]}
          },
          method: {opcode: `${httpPrefix}currentHttpMethod`, next: null, parent: 'equals', inputs: {}},
          respond: {
            opcode: `${httpPrefix}respondWithText`,
            next: null,
            parent: 'guard',
            inputs: {BODY: [1, [10, 'ok']]}
          }
        }
      }
    ]
  };
}

function projectWithRepeatNesting(depth: number, literalValue: string | null): Record<string, unknown> {
  const blocks: Record<string, Record<string, unknown>> = {
    hat: {opcode: `${httpPrefix}whenHttpRequestReceived`, next: 'repeat0', parent: null, topLevel: true, inputs: {}},
    respond: {
      opcode: `${httpPrefix}respondWithText`,
      next: null,
      parent: `repeat${depth - 1}`,
      inputs: {BODY: [1, [10, 'ok']]}
    },
    dynamic: {opcode: `${httpPrefix}currentRequestBody`, next: null, parent: 'repeat0', inputs: {}}
  };
  for (let index = 0; index < depth; index += 1) {
    const child = index === depth - 1 ? 'respond' : `repeat${index + 1}`;
    blocks[`repeat${index}`] = {
      opcode: 'control_repeat',
      next: null,
      parent: index === 0 ? 'hat' : `repeat${index - 1}`,
      inputs: {
        TIMES: literalValue === null && index === 0 ? [3, 'dynamic'] : [1, [4, literalValue ?? '1']],
        SUBSTACK: [2, child]
      }
    };
  }
  return {targets: [{name: 'Stage', blocks}]};
}
