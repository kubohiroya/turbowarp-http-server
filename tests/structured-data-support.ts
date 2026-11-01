import {
  compileTurboWarpProjectV2,
  resolveCompilerManifestLock,
  validateDeployIrV2Subset,
  type CompilerOpcodeRegistry,
  type DeployIrV2
} from '../src/compiler/index.js';
import {loadGeneratedCore} from './conformance/harness.js';

/** Builds small TurboWarp projects that use Structured Data and runs them through the real pipeline. */

export const SD = 'kubohiroyastructureddata_';
export const HTTP = 'kubohiroyaturbowarphttpserver_';
export const MANIFEST_LOCK = 'tests/fixtures/compiler-manifests/turbowarp-server.lock.json';

/** A literal string, a literal number, or a reporter block. */
export type InputSpec = string | number | ReporterSpec;
export interface ReporterSpec {
  opcode: string;
  inputs?: Record<string, InputSpec>;
}
export interface StatementSpec {
  opcode: string;
  inputs?: Record<string, InputSpec>;
  substack?: StatementSpec[];
}

export function block(opcode: string, inputs: Record<string, InputSpec> = {}, substack?: StatementSpec[]): StatementSpec {
  return substack === undefined ? {opcode, inputs} : {opcode, inputs, substack};
}

export function reporter(opcode: string, inputs: Record<string, InputSpec> = {}): ReporterSpec {
  return {opcode, inputs};
}

export function query(name: string): ReporterSpec {
  return reporter(`${HTTP}queryParameter`, {NAME: name});
}

export const requestBody: ReporterSpec = reporter(`${HTTP}currentRequestBody`);

export function respondText(body: InputSpec): StatementSpec {
  return block(`${HTTP}respondWithText`, {BODY: body});
}

/** One stage with one HTTP hat whose handler is `statements`, as TurboWarp stores it in project.json. */
export function turboWarpProject(statements: readonly StatementSpec[]): Record<string, unknown> {
  const blocks: Record<string, {opcode: string; next: string | null; parent: string | null; topLevel: boolean; inputs: Record<string, unknown>}> = {};
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}${(counter += 1)}`;
  const inputsOf = (ownerId: string, inputs: Record<string, InputSpec> = {}): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(inputs).map(([name, spec]) => {
        if (typeof spec === 'string') return [name, [1, [10, spec]]];
        if (typeof spec === 'number') return [name, [1, [4, String(spec)]]];
        const id = nextId('reporter');
        blocks[id] = {opcode: spec.opcode, next: null, parent: ownerId, topLevel: false, inputs: {}};
        blocks[id].inputs = inputsOf(id, spec.inputs);
        return [name, [3, id, [10, '']]];
      })
    );
  const stack = (specs: readonly StatementSpec[], parent: string): string | null => {
    let first: string | null = null;
    let previous: string | null = null;
    for (const spec of specs) {
      const id = nextId('block');
      const current: (typeof blocks)[string] = {
        opcode: spec.opcode,
        next: null,
        parent: previous ?? parent,
        topLevel: false,
        inputs: {}
      };
      blocks[id] = current;
      current.inputs = inputsOf(id, spec.inputs);
      if (spec.substack !== undefined) {
        const body = stack(spec.substack, id);
        if (body !== null) current.inputs.SUBSTACK = [2, body];
      }
      if (previous === null) first = id;
      else blocks[previous]!.next = id;
      previous = id;
    }
    return first;
  };
  blocks.hat = {opcode: `${HTTP}whenHttpRequestReceived`, next: null, parent: null, topLevel: true, inputs: {}};
  blocks.hat.next = stack(statements, 'hat');
  return {targets: [{isStage: true, name: 'Stage', blocks}]};
}

let registry: Promise<CompilerOpcodeRegistry> | undefined;

export function lockedRegistry(): Promise<CompilerOpcodeRegistry> {
  registry ??= resolveCompilerManifestLock(MANIFEST_LOCK).then((resolved) => resolved.registry);
  return registry;
}

/** What a project does on the server: stops at compile time, responds, or fails with a runtime code. */
export type ServerOutcome = {compile: string[]} | {value: string} | {error: string};

export interface ServerRequest {
  query?: Record<string, string>;
  body?: string;
}

export interface CompileResult {
  ir: DeployIrV2;
  codes: string[];
}

/** Frontend lowering followed by the target-neutral validator, as compileToDirectory runs them. */
export async function compileProject(
  statements: readonly StatementSpec[],
  transform?: (ir: DeployIrV2) => void
): Promise<CompileResult> {
  const compiled = compileTurboWarpProjectV2(turboWarpProject(statements), await lockedRegistry());
  if (compiled.diagnostics.length > 0) return {ir: compiled.ir, codes: compiled.diagnostics.map(({code}) => code)};
  transform?.(compiled.ir);
  return {ir: compiled.ir, codes: validateDeployIrV2Subset(compiled.ir).map(({code}) => code)};
}

export async function runProject(
  statements: readonly StatementSpec[],
  request: ServerRequest = {},
  transform?: (ir: DeployIrV2) => void
): Promise<ServerOutcome> {
  const {ir, codes} = await compileProject(statements, transform);
  if (codes.length > 0) return {compile: codes};
  const core = await loadGeneratedCore(ir);
  return outcome(await core.request(serverRequest(request)));
}

export function serverRequest(request: ServerRequest = {}): {method: string; url: string; bodyText?: string} {
  const search = new URLSearchParams(request.query ?? {}).toString();
  return {
    method: 'POST',
    url: `http://structured.test/${search === '' ? '' : `?${search}`}`,
    ...(request.body === undefined ? {} : {bodyText: request.body})
  };
}

export function outcome(response: {status: number; bodyText: string}): ServerOutcome {
  if (response.status === 200) return {value: response.bodyText};
  if (response.status === 422) {
    const body = JSON.parse(response.bodyText) as {error: {code: string}};
    // Runtime errors carry only the code: no name, path, or input value.
    if (Object.keys(body).length !== 1 || Object.keys(body.error).length !== 1) {
      throw new Error(`Unexpected error body: ${response.bodyText}`);
    }
    return {error: body.error.code};
  }
  throw new Error(`Unexpected response ${response.status}: ${response.bodyText}`);
}

/** The structural subset of the published browser extension these tests drive. */
export interface BrowserStructuredData {
  parseJson(args: {TEXT: unknown; NAME: unknown}, util: BrowserUtility): void;
  parseYaml(args: {TEXT: unknown; NAME: unknown}, util: BrowserUtility): void;
  setJsonAtPath(args: {NAME: unknown; PATH: unknown; VALUE: unknown}, util: BrowserUtility): void;
  deleteAtPath(args: {NAME: unknown; PATH: unknown}, util: BrowserUtility): void;
  deleteStructuredData(args: {NAME: unknown}, util: BrowserUtility): void;
  hasStructuredData(args: {NAME: unknown}, util: BrowserUtility): boolean;
  getJsonAtPath(args: {NAME: unknown; PATH: unknown}, util: BrowserUtility): string;
  getTextAtPath(args: {NAME: unknown; PATH: unknown}, util: BrowserUtility): string;
  hasPath(args: {NAME: unknown; PATH: unknown}, util: BrowserUtility): boolean;
  keysAtPath(args: {NAME: unknown; PATH: unknown}, util: BrowserUtility): string;
  lengthAtPath(args: {NAME: unknown; PATH: unknown}, util: BrowserUtility): number;
  toJson(args: {NAME: unknown}, util: BrowserUtility): string;
  forEachAtPath(args: {NAME: unknown; PATH: unknown; MAX: unknown}, util: BrowserUtility): void;
  currentKey(args: Record<string, never>, util: BrowserUtility): string;
  currentIndex(args: Record<string, never>, util: BrowserUtility): number;
  currentValueJson(args: Record<string, never>, util: BrowserUtility): string;
  currentJsonAtPath(args: {PATH: unknown}, util: BrowserUtility): string;
  currentTextAtPath(args: {PATH: unknown}, util: BrowserUtility): string;
}

export interface BrowserUtility {
  target: object;
  thread: object;
  stackFrame: Record<string, unknown>;
  startBranch(branch: number, isLoop: boolean): void;
}

/**
 * Creates the published browser extension (`@kubohiroya/turbowarp-structured-data/bundle-module`)
 * with the Scratch members it reads. Cast.toString is String, as in scratch-vm.
 */
export async function createBrowserStructuredData(): Promise<BrowserStructuredData> {
  const module = (await import('@kubohiroya/turbowarp-structured-data/bundle-module')) as unknown as {
    createExtension(scratch: unknown): BrowserStructuredData;
  };
  const flags = globalThis as {STRUCTURED_DATA_MVP?: unknown};
  const previous = flags.STRUCTURED_DATA_MVP;
  flags.STRUCTURED_DATA_MVP = true;
  try {
    return module.createExtension({
      Cast: {toString: String, toNumber: Number},
      BlockType: {},
      ArgumentType: {},
      translate: String,
      vm: {runtime: {on() {}, off() {}}}
    });
  } finally {
    if (previous === undefined) delete flags.STRUCTURED_DATA_MVP;
    else flags.STRUCTURED_DATA_MVP = previous;
  }
}

export function browserUtility(target: object = {}, thread: object = {}): BrowserUtility {
  return {target, thread, stackFrame: {}, startBranch() {}};
}

/** Runs browser calls in order and reports the first failure's code, as one server request would. */
export function browserOutcome(run: () => unknown): ServerOutcome {
  try {
    return {value: String(run())};
  } catch (error) {
    const code = (error as {code?: unknown}).code;
    if (typeof code !== 'string') throw error;
    return {error: code};
  }
}
