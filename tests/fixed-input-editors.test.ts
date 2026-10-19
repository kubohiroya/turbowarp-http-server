import {describe, expect, it, vi} from 'vitest';
import {createFixedInputEditor, type FixedInputEditorOptions, type ArgumentSlot, type FixedBlockSnapshot, type JsonObject, type LiteralValue} from '@kubohiroya/turbowarp-extension-data-editor';
import {fixedInputEditors, fixedInputRegistration} from '../src/fixed-input-editors.js';
import canonical from '../schemas/block-editor-fixed-inputs.schema.json' with {type: 'json'};
function snapshot(options: FixedInputEditorOptions, argument: string, value: LiteralValue, reporter = false): FixedBlockSnapshot {
  const args: Record<string, ArgumentSlot> = {}, inputs: Record<string, FixedBlockSnapshot['fixedContext']['inputs'][string]> = {};
  for (const binding of options.bindings) {
    const raw = binding.argument === argument ? value : binding.control?.kind === 'enum' ? binding.control.choices![0]!.value as LiteralValue : '2';
    const connected = reporter && binding.argument === argument;
    args[binding.argument] = connected ? {kind: 'reporter'} : {kind: 'literal', value: raw};
    inputs[binding.argument] = {role: 'editable', source: connected ? 'reporter' : 'shadow', identity: binding.argument,
      ...(connected ? {} : {field: {blockId: `${binding.argument}-shadow`, name: binding.control?.kind === 'number' ? 'NUM' : 'TEXT', type: binding.control?.kind === 'number' ? 'math_number' : 'text'}})};
  }
  return {targetId: 'target', blockId: 'block', opcode: options.opcodes[0]!, revision: '1', arguments: args,
    fixedContext: {contractId: options.contractId, contractRevision: options.contractRevision, generation: '1', readOnlyArguments: [], dependencies: [], inputs}};
}
const changed = (draft: JsonObject, argument: string, value: LiteralValue) => {
  const copy = structuredClone(draft) as {inputs: Record<string, {value: LiteralValue; changed: boolean}>};
  copy.inputs[argument] = {value, changed: true}; return copy;
};
describe('owner canonical fixed input contracts', () => {
  for (const options of fixedInputEditors) for (const binding of options.bindings) {
    const name = `${options.opcodes[0]}.${binding.argument}`;
    it(`${name}: canonical JSON pointer and generated definition`, () => {
      const artifact = binding.schemaBundle.root.artifact;
      expect(artifact.role).toBe('canonical-schema');
      let selected: unknown = canonical;
      for (const component of artifact.source.symbol!.slice(2).split('/')) selected = (selected as Record<string, unknown>)[component];
      expect(selected).toEqual(binding.schemaBundle.root.document);
      expect(createFixedInputEditor(options).editorId).toBe(options.editorId);
    });
    it(`${name}: old unknown/alias values are untouched on open/save`, () => {
      const definition = createFixedInputEditor(options);
      for (const raw of binding.control?.kind === 'number' ? ['0x10', '+1', '001', '1.', '', 'NaN', 'Infinity', 'invalid'] : ['legacy-unknown', ' GET ', ' JSON ']) {
        const current = snapshot(options, binding.argument, raw);
        const before = structuredClone(current);
        expect(definition.prepareFixedSave(definition.readFixed(current), current)).toMatchObject({kind: 'ready', changes: []});
        expect(current).toEqual(before);
      }
    });
    it(`${name}: reporter remains readonly and cannot be replaced`, () => {
      const definition = createFixedInputEditor(options), current = snapshot(options, binding.argument, '2', true);
      const draft = definition.readFixed(current);
      expect(definition.describeFixed!(draft, current).inputs[binding.argument]!.state).toBe('readonly');
      expect(definition.prepareFixedSave(draft, current)).toMatchObject({kind: 'ready', changes: []});
      expect(definition.prepareFixedSave(changed(draft, binding.argument, '3'), current).kind).toBe('invalid');
      expect(current.arguments[binding.argument]).toEqual({kind: 'reporter'});
    });
    if (binding.control?.kind === 'number') {
      it(`${name}: new NP tokens preserve representation and reject aliases/incomplete input`, () => {
        const definition = createFixedInputEditor(options), current = snapshot(options, binding.argument, '2');
        for (const token of ['1.5e2', '3.00']) expect(definition.prepareFixedSave(changed(definition.readFixed(current), binding.argument, token), current)).toMatchObject({kind: 'ready', changes: [{argument: binding.argument, value: token}]});
        for (const token of ['', ' ', '0x10', '+1', '001', '1.', '.5', '1e', 'NaN', 'Infinity', '1e999']) {
          expect(() => binding.encode(token, {consumerId: 'fixed-boundary-test', nowMs: 0, settings: null})).toThrow();
          expect(definition.prepareFixedSave(changed(definition.readFixed(current), binding.argument, token), current).kind).toBe('invalid');
        }
      });
    } else {
      it(`${name}: every closed choice is accepted and unknown new values refused`, () => {
        const definition = createFixedInputEditor(options), current = snapshot(options, binding.argument, 'legacy-unknown');
        for (const choice of binding.control!.kind === 'enum' ? binding.control!.choices ?? [] : []) expect(definition.prepareFixedSave(changed(definition.readFixed(current), binding.argument, choice.value as LiteralValue), current).kind).toBe('ready');
        expect(definition.prepareFixedSave(changed(definition.readFixed(current), binding.argument, 'new-unknown'), current).kind).toBe('invalid');
      });
    }
  }
});
describe('optional host registration', () => {
  const opcodes = fixedInputEditors.flatMap(x => [...x.opcodes]);
  it('legacy, fixed-OFF, and unsupported API do not register or listen', () => {
    for (const api of [undefined, {}, {apiVersion: 2, registerFixedInputEditor: vi.fn()}, {apiVersion: 1}]) {
      const on = vi.fn(), lifecycle = fixedInputRegistration({gui: {blockEditors: api}, vm: {runtime: {on}}});
      lifecycle.ensure(opcodes); lifecycle.dispose(); expect(on).not.toHaveBeenCalled();
    }
  });
  it('membership, repeat getInfo, API replacement and dispose own exactly their registrations', () => {
    const events = new Map<string, () => void>(), cleaned: number[] = [];
    const api = {apiVersion: 1, registerFixedInputEditor: vi.fn(() => () => {cleaned.push(1);})};
    const host = {gui: {blockEditors: api}, vm: {runtime: {on: (e: string, fn: () => void) => events.set(e, fn), off: (e: string) => {events.delete(e);}}}};
    const lifecycle = fixedInputRegistration(host); lifecycle.ensure([]); expect(api.registerFixedInputEditor).not.toHaveBeenCalled();
    lifecycle.ensure(opcodes); lifecycle.ensure(opcodes); expect(api.registerFixedInputEditor).toHaveBeenCalledTimes(fixedInputEditors.length);
    lifecycle.ensure([]); expect(cleaned).toHaveLength(fixedInputEditors.length); expect(events.size).toBe(0);
    lifecycle.ensure(opcodes); host.gui.blockEditors = {...api, registerFixedInputEditor: vi.fn(() => () => {cleaned.push(2);})};
    lifecycle.ensure(opcodes); expect(cleaned).toHaveLength(fixedInputEditors.length * 2);
    events.get('RUNTIME_DISPOSED')!(); lifecycle.ensure(opcodes); lifecycle.dispose(); expect(events.size).toBe(0);
    expect(cleaned).toHaveLength(fixedInputEditors.length * 3);
  });
  it('partial failure rolls back only this attempt', () => {
    const remove = vi.fn(), count = {value: 0};
    const api = {apiVersion: 1, registerFixedInputEditor: () => {if (++count.value === 2 || fixedInputEditors.length === 1) throw new Error('refused'); return remove;}};
    const lifecycle = fixedInputRegistration({gui: {blockEditors: api}});
    expect(() => lifecycle.ensure(opcodes)).toThrow('refused'); expect(remove).toHaveBeenCalledTimes(fixedInputEditors.length === 1 ? 0 : 1);
    lifecycle.dispose();
  });
});
