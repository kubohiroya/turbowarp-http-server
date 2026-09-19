import {extensionConfig} from '../../config.js';
import type {CompilerOpcodeRegistry} from '../manifest/types.js';
import type {SourceRefV2} from '../ir-v2/types.js';
import {
  DEFAULT_SERVER_SUBSET_POLICY,
  type ServerSubsetDiagnosticCode,
  type ServerSubsetPolicy,
  type TargetNeutralDiagnostic
} from './types.js';

interface ScratchProject {
  targets?: unknown;
}

interface ScratchTarget {
  name?: unknown;
  blocks?: unknown;
}

interface ScratchBlock {
  opcode?: unknown;
  next?: unknown;
  parent?: unknown;
  topLevel?: unknown;
  inputs?: unknown;
}

type BlockMap = Record<string, ScratchBlock>;

const HTTP_PREFIX = `${extensionConfig.id}_`;
const HTTP_HAT = `${HTTP_PREFIX}whenHttpRequestReceived`;
const HTTP_SERVER_OPCODES = new Set(
  [
    'whenHttpRequestReceived',
    'setHttpStatus',
    'setResponseHeader',
    'removeResponseHeader',
    'setHandlerVariable',
    'changeHandlerVariable',
    'deleteHandlerVariable',
    'clearHandlerVariables',
    'respondWithText',
    'respondWithHtml',
    'respondWithJson',
    'sendResponse',
    'currentHttpMethod',
    'currentRequestPath',
    'currentRequestUrl',
    'currentRequestBody',
    'currentRequestContentType',
    'currentRequestClientAddress',
    'queryParameter',
    'pathParameter',
    'requestHeader',
    'handlerVariable',
    'handlerVariableExists',
    'listHandlerVariables'
  ].map((opcode) => `${HTTP_PREFIX}${opcode}`)
);

const MESSAGE_OPCODES = new Set(['event_broadcast', 'event_broadcastandwait', 'event_whenbroadcastreceived']);
const CLONE_OPCODES = new Set(['control_create_clone_of', 'control_start_as_clone', 'control_delete_this_clone']);
const RUNTIME_PREFIXES = ['motion_', 'looks_', 'sound_', 'pen_', 'music_', 'videoSensing_', 'sensing_'];

export function validateTurboWarpServerSubset(
  value: unknown,
  registry?: CompilerOpcodeRegistry,
  policy: Readonly<ServerSubsetPolicy> = DEFAULT_SERVER_SUBSET_POLICY
): TargetNeutralDiagnostic[] {
  const project = object(value) as ScratchProject;
  if (!Array.isArray(project.targets)) throw new Error('TurboWarp project.targets must be an array.');
  const diagnostics: TargetNeutralDiagnostic[] = [];
  project.targets.forEach((rawTarget, targetIndex) => {
    const target = object(rawTarget) as ScratchTarget;
    const targetName = typeof target.name === 'string' ? target.name : `target-${targetIndex}`;
    const blocks = blockMap(target.blocks);
    const reachable = reachableHandlerBlocks(blocks);
    const methodGuardBlocks = new Set<string>();
    for (const id of reachable) {
      if (blocks[id]?.opcode === 'control_if' && isMethodGuard(blocks, id)) {
        methodGuardBlocks.add(id);
        const condition = inputBlockId(inputMap(blocks[id]?.inputs).CONDITION, blocks);
        if (condition !== null) methodGuardBlocks.add(condition);
      }
    }
    for (const id of reachable) {
      const block = blocks[id];
      if (block === undefined || typeof block.opcode !== 'string') continue;
      validateBlock(
        blocks,
        id,
        block,
        targetIndex,
        targetName,
        methodGuardBlocks,
        registry,
        policy,
        diagnostics
      );
    }
  });
  return diagnostics;
}

function validateBlock(
  blocks: BlockMap,
  id: string,
  block: ScratchBlock,
  targetIndex: number,
  targetName: string,
  methodGuardBlocks: ReadonlySet<string>,
  registry: CompilerOpcodeRegistry | undefined,
  policy: Readonly<ServerSubsetPolicy>,
  diagnostics: TargetNeutralDiagnostic[]
): void {
  const opcode = block.opcode as string;
  const sourceRef: SourceRefV2 = {targetIndex, targetName, blockId: id, opcode};
  const routeId = `project:${targetIndex}:${targetName}`;
  if (opcode.startsWith('data_')) {
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_GLOBAL_STATE_UNSUPPORTED',
      'Scratch global variables and lists are not server-executable.',
      'Their lifetime is shared across requests and workers.',
      'Use request-local handler variables or compiler-generated typed bindings.'
    );
    return;
  }
  if (MESSAGE_OPCODES.has(opcode)) {
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_MESSAGE_UNSUPPORTED',
      'Broadcast and message blocks are not server-executable.',
      'Message scheduling has no bounded request-local lifetime.',
      'Call a supported operation directly inside the HTTP handler.'
    );
    return;
  }
  if (opcode === 'control_forever') {
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_UNBOUNDED_LOOP',
      'forever is not allowed in a server handler.',
      'The loop has no statically provable upper bound.',
      'Use a literal bounded repeat or a manifest-declared bounded loop.'
    );
    return;
  }
  if (CLONE_OPCODES.has(opcode)) {
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_CLONE_UNSUPPORTED',
      'Clone blocks are not server-executable.',
      'Clone state belongs to the sprite runtime and can outlive a request.',
      'Represent request data with lexical values instead.'
    );
    return;
  }
  if (RUNTIME_PREFIXES.some((prefix) => opcode.startsWith(prefix))) {
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_RUNTIME_DEPENDENCY_UNSUPPORTED',
      `Runtime-dependent block ${opcode} is not server-executable.`,
      'The operation depends on sprite, UI, renderer, audio, camera, or browser state.',
      'Move the operation to the browser project and pass only request data to the server.'
    );
    return;
  }
  if (opcode === 'control_repeat') {
    const count = repeatLiteral(inputMap(block.inputs).TIMES, blocks);
    if (count === null || count < 0 || count > policy.maxLoopIterations) {
      addDiagnostic(
        diagnostics,
        routeId,
        sourceRef,
        'TW2_LOOP_BOUND_INVALID',
        `repeat count must be an integer literal from 0 to ${policy.maxLoopIterations}.`,
        'Dynamic Scratch number coercion cannot prove a server work bound.',
        'Replace the repeat input with a supported integer literal.'
      );
    }
    const depth = repeatNestingDepth(blocks, id);
    if (depth > policy.maxLoopNesting) {
      addDiagnostic(
        diagnostics,
        routeId,
        sourceRef,
        'TW2_LOOP_NESTING_EXCEEDED',
        `Loop nesting exceeds the ${policy.maxLoopNesting} level limit.`,
        'Nested bounded loops can multiply into excessive work.',
        'Flatten the loop or split the handler.'
      );
    }
    return;
  }
  if (opcode === 'control_if' && !methodGuardBlocks.has(id)) {
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_CONTROL_FLOW_UNSUPPORTED',
      'Scratch control_if is not lowered by the MVP frontend except for the top-level HTTP method guard.',
      'Scratch truthiness and branch binding semantics are not inferred.',
      'Use the supported method guard or direct typed IR input.'
    );
    return;
  }
  if (opcode === 'control_if_else') {
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_CONTROL_FLOW_UNSUPPORTED',
      'Scratch control_if_else is not lowered by the MVP frontend.',
      'Scratch truthiness and branch binding semantics are not inferred.',
      'Use direct typed IR input until frontend coercion rules are specified.'
    );
    return;
  }
  if (
    opcode === HTTP_HAT ||
    HTTP_SERVER_OPCODES.has(opcode) ||
    opcode === 'operator_join' ||
    methodGuardBlocks.has(id)
  ) {
    return;
  }
  const manifestEntry = registry?.byProjectOpcode.get(opcode);
  if (manifestEntry !== undefined) {
    if (manifestEntry.block.server?.supported === true) return;
    addDiagnostic(
      diagnostics,
      routeId,
      sourceRef,
      'TW2_UNSUPPORTED_OPERATION',
      `Extension block ${opcode} is not declared server-compatible.`,
      'A block API manifest entry alone does not authorize server execution.',
      'Use a block with a validated server-operation hint.'
    );
    return;
  }
  addDiagnostic(
    diagnostics,
    routeId,
    sourceRef,
    'TW2_UNSUPPORTED_BLOCK',
    `Block ${opcode} is outside the server-executable allowlist.`,
    'No built-in rule or locked server-operation manifest authorizes this opcode.',
    'Remove the block or provide a compatible locked extension manifest.'
  );
}

function reachableHandlerBlocks(blocks: BlockMap): Set<string> {
  const reachable = new Set<string>();
  const pending = Object.entries(blocks)
    .filter(([, block]) => block.opcode === HTTP_HAT && block.topLevel === true)
    .map(([id]) => id);
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const block = blocks[id];
    if (block === undefined) continue;
    const next = typeof block.next === 'string' && blocks[block.next] !== undefined ? block.next : undefined;
    if (next !== undefined) pending.push(next);
    for (const input of Object.values(inputMap(block.inputs))) {
      for (const referenced of referencedBlockIds(input, blocks)) pending.push(referenced);
    }
  }
  return reachable;
}

function isMethodGuard(blocks: BlockMap, id: string): boolean {
  const block = blocks[id];
  if (block?.opcode !== 'control_if' || block.next !== null) return false;
  const parent = typeof block.parent === 'string' ? blocks[block.parent] : undefined;
  if (parent?.opcode !== HTTP_HAT) return false;
  const conditionId = inputBlockId(inputMap(block.inputs).CONDITION, blocks);
  if (conditionId === null) return false;
  const condition = blocks[conditionId];
  if (condition?.opcode !== 'operator_equals') return false;
  const inputs = inputMap(condition.inputs);
  return [
    [inputs.OPERAND1, inputs.OPERAND2],
    [inputs.OPERAND2, inputs.OPERAND1]
  ].some(([reporterInput, literalInput]) => {
    const reporterId = inputBlockId(reporterInput, blocks);
    const reporter = reporterId === null ? undefined : blocks[reporterId];
    const method = primitiveLiteral(literalInput);
    return (
      reporter?.opcode === `${HTTP_PREFIX}currentHttpMethod` &&
      typeof method === 'string' &&
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method.toUpperCase())
    );
  });
}

function repeatNestingDepth(blocks: BlockMap, id: string): number {
  let depth = 1;
  let parent = blocks[id]?.parent;
  const visited = new Set<string>([id]);
  while (typeof parent === 'string' && !visited.has(parent)) {
    visited.add(parent);
    const block = blocks[parent];
    if (block?.opcode === 'control_repeat') depth += 1;
    parent = block?.parent;
  }
  return depth;
}

function repeatLiteral(input: unknown, blocks: BlockMap): number | null {
  if (inputBlockId(input, blocks) !== null) return null;
  const value = primitiveLiteral(input);
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function primitiveLiteral(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  const primary = input[1];
  if (Array.isArray(primary)) return primary[1];
  return primary;
}

function referencedBlockIds(input: unknown, blocks: BlockMap): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  for (const candidate of [input[1], input[2]]) {
    if (typeof candidate === 'string' && blocks[candidate] !== undefined) result.push(candidate);
  }
  return result;
}

function inputBlockId(input: unknown, blocks: BlockMap): string | null {
  return referencedBlockIds(input, blocks)[0] ?? null;
}

function inputMap(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function blockMap(value: unknown): BlockMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as BlockMap) : {};
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('TurboWarp project value must be an object.');
  }
  return value as Record<string, unknown>;
}

function addDiagnostic(
  diagnostics: TargetNeutralDiagnostic[],
  routeId: string,
  sourceRef: SourceRefV2,
  code: ServerSubsetDiagnosticCode,
  message: string,
  reason: string,
  suggestion: string
): void {
  diagnostics.push({
    severity: 'error',
    phase: 'target-neutral',
    code,
    message,
    routeId,
    reason,
    suggestion,
    sourceRef
  });
}
