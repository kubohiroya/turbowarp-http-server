import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {TurboWarpHttpServerExtension} from '../src/extension.js';
import type {FixedBlockSnapshot} from '@kubohiroya/turbowarp-extension-data-editor';
import {fixedInputEditors} from '../src/fixed-input-editors.js';
import baseline from './fixtures/stage3-fixed-getinfo.json' with {type: 'json'};
const candidateSnapshot: FixedBlockSnapshot = {targetId: 'target', blockId: 'block', opcode: fixedInputEditors[0]!.opcodes[0]!, revision: '1', arguments: {}, fixedContext: {contractId: fixedInputEditors[0]!.contractId, contractRevision: fixedInputEditors[0]!.contractRevision, generation: '1', readOnlyArguments: [], dependencies: [], inputs: {}}};
const translate = (message: string | {default: string}) => typeof message === 'string' ? message : message.default;
beforeEach(() => vi.stubGlobal('Scratch', {
  translate, Cast: {toString: (v: unknown) => String(v), toNumber: (v: unknown) => Number(v), toBoolean: (v: unknown) => Boolean(v)},
  BlockType: {COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'Boolean', HAT: 'hat'},
  ArgumentType: {STRING: 'string', NUMBER: 'number', BOOLEAN: 'Boolean'},
  vm: {runtime: {on: vi.fn(), off: vi.fn()}}
}));
afterEach(() => vi.unstubAllGlobals());
it('retains the exact baseline getInfo with the legacy host capability', () => {
  const owner = new TurboWarpHttpServerExtension();
  expect(owner.getInfo()).toEqual(baseline.find(s => s.id === 'native-default')!.getInfo);
  void owner.dispose();
});
it('registers only the real visible opcodes once and disposes its own registrations', () => {
  const cleanup = vi.fn();const register = vi.fn(() => cleanup);
  (globalThis as unknown as {Scratch: {gui: unknown}}).Scratch.gui = {blockEditors: {apiVersion: 1, registerFixedInputEditor: register}};
  const owner = new TurboWarpHttpServerExtension();
  const info = owner.getInfo();owner.getInfo();
  const expected = baseline.find(s => s.id === "native-default")!.getInfo;
  expect(info).toEqual(expected);
  expect(register).toHaveBeenCalledTimes(fixedInputEditors.length);
  const visible = ((info as {id: string; blocks: {opcode?: string}[]}).blocks).flatMap(b => b.opcode ? [`${(info as {id: string}).id}_${b.opcode}`] : []);
  for (const [options] of register.mock.calls as unknown as [{opcodes: string[]}][]) expect(options.opcodes.every(op => visible.includes(op))).toBe(true);
  void owner.dispose();void owner.dispose();expect(cleanup).toHaveBeenCalledTimes(fixedInputEditors.length);
});
it('preserves positive-safe truncated MAX_BYTES and lowercase-only enum matching', () => {
  const options = fixedInputEditors.find(o => o.opcodes.some(op => op.endsWith('_respondWithNamedBody')))!;
  const size = options.bindings.find(b => b.argument === 'MAX_BYTES')!;
  const context = {consumerId: 'compatibility', nowMs: 0, settings: null};
  for (const raw of ['1.1', '1.9', '0x10', '+1', '001', '1.']) expect(size.validateCandidate!(raw, context, candidateSnapshot)).toEqual([]);
  for (const raw of ['0.9', '-1', '', 'Infinity', '9007199254740992']) expect(size.validateCandidate!(raw, context, candidateSnapshot).length).toBeGreaterThan(0);
  const kind = options.bindings.find(b => b.argument === 'KIND')!;
  expect(kind.read('STRUCTURED')).toBe('structured');expect(kind.validateCandidate!(' structured ', context, candidateSnapshot).length).toBeGreaterThan(0);
});

it('retains construction before Scratch is installed', () => {
  vi.unstubAllGlobals();expect(() => new TurboWarpHttpServerExtension()).not.toThrow();
});
