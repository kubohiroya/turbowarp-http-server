import {parseFixedNumberInput} from '@kubohiroya/turbowarp-extension-data-editor/schema';
import type {FixedInputBinding, FixedInputEditorOptions, JsonValue, LiteralValue} from '@kubohiroya/turbowarp-extension-data-editor';
import {fixedInputBundle} from './fixed-input-schema.js';
const extensionId = "kubohiroyaturbowarphttpserver";
const repository = "turbowarp-http-server";
interface Field {opcode: string; argument: string; control: 'number' | 'enum'; choices: readonly string[];
  normalization: string; shape: string; maxBytes: boolean}
const fields: readonly Field[] = [
  {
    "opcode": "changeHandlerVariable",
    "argument": "AMOUNT",
    "control": "number",
    "choices": [],
    "normalization": "identity",
    "shape": "math_number.NUM",
    "maxBytes": false
  },
  {
    "opcode": "setHttpStatus",
    "argument": "STATUS",
    "control": "number",
    "choices": [],
    "normalization": "identity",
    "shape": "math_number.NUM",
    "maxBytes": false
  },
  {
    "opcode": "respondWithNamedBody",
    "argument": "KIND",
    "control": "enum",
    "choices": [
      "structured",
      "document",
      "binary",
      "asset"
    ],
    "normalization": "lowercase",
    "shape": "text.TEXT",
    "maxBytes": false
  },
  {
    "opcode": "respondWithNamedBody",
    "argument": "SCOPE",
    "control": "enum",
    "choices": [
      "target",
      "project"
    ],
    "normalization": "lowercase",
    "shape": "text.TEXT",
    "maxBytes": false
  },
  {
    "opcode": "respondWithNamedBody",
    "argument": "REPRESENTATION",
    "control": "enum",
    "choices": [
      "json",
      "yaml",
      "html",
      "markdown",
      "raw"
    ],
    "normalization": "lowercase",
    "shape": "text.TEXT",
    "maxBytes": false
  },
  {
    "opcode": "respondWithNamedBody",
    "argument": "MAX_BYTES",
    "control": "number",
    "choices": [],
    "normalization": "identity",
    "shape": "math_number.NUM",
    "maxBytes": true
  },
  {
    "opcode": "markdownHeading",
    "argument": "LEVEL",
    "control": "number",
    "choices": [],
    "normalization": "identity",
    "shape": "math_number.NUM",
    "maxBytes": false
  }
];
function literalString(value: JsonValue | LiteralValue): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string literal.');
  return value;
}
/** Legacy nonempty finite aliases are projections; opening never creates a write. */
export function existingFixedNumber(value: JsonValue | LiteralValue): number {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && value.trim() === '')) throw new TypeError('Unavailable numeric projection.');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Unavailable numeric projection.');
  return number;
}
function normalizeChoice(field: Field, raw: string): string {
  if (field.normalization === 'lowercase') return raw.toLowerCase();
  if (field.normalization === 'method') return raw.trim().toUpperCase();
  if (field.normalization === 'trim') return raw.trim();
  if (field.normalization === 'parse-format') {
    const lower = raw.trim().toLowerCase();
    return lower === 'json' ? 'JSON' : lower === 'yaml' ? 'YAML' : lower === 'auto' ? 'auto' : raw;
  }
  return raw;
}
function binding(field: Field): FixedInputBinding {
  return {argument: field.argument, schemaBundle: fixedInputBundle(field.opcode, field.argument),
    control: {kind: field.control, ...(field.control === 'enum' ? {choices: field.choices.map(value => ({value}))} : {})},
    read(value) {return field.control === 'number' ? existingFixedNumber(value) : normalizeChoice(field, literalString(value));},
    encode(value) {
      if (field.control === 'number') {
        const parsed = parseFixedNumberInput(value);
        if (parsed.kind !== 'valid') throw new TypeError('Invalid new numeric input.');
        return parsed.token;
      }
      const raw = literalString(value), normalized = normalizeChoice(field, raw);
      if (!field.choices.includes(normalized)) throw new TypeError('Unsupported fixed choice.');
      return field.shape === 'menu-shadow' || field.shape === 'direct-field-dropdown' ? normalized : raw;
    },
    validateCandidate(value) {
      try {
        if (field.control === 'number') {
          const number = existingFixedNumber(value);
          if (field.maxBytes && (!Number.isSafeInteger(Math.trunc(number)) || Math.trunc(number) < 1)) return [{message: 'Invalid named body size.'}];
          return [];
        }
        return field.choices.includes(normalizeChoice(field, literalString(value))) ? [] : [{message: 'Unsupported fixed choice.'}];
      } catch {return [{message: 'Invalid fixed input.'}];}
    }
  };
}
export const fixedInputEditors: readonly FixedInputEditorOptions[] = [...new Set(fields.map(f => f.opcode))].map(opcode => ({
  apiVersion: 1, extensionId, editorId: `${opcode}-fixed-inputs`, opcodes: [`${extensionId}_${opcode}`],
  contractId: `${repository}/${opcode}`, contractRevision: 'fixed-inputs-v1',
  bindings: fields.filter(field => field.opcode === opcode).map(binding),
  validationContext: () => ({consumerId: repository, nowMs: 0, settings: null})
}));

interface OptionalFixedHost {
  gui?: {blockEditors?: {apiVersion?: number; registerFixedInputEditor?: (definition: FixedInputEditorOptions) => () => void}};
  vm?: {runtime?: {on?: (event: string, listener: () => void) => void; off?: (event: string, listener: () => void) => void}};
}
/** Registration follows the advertised opcode membership and the optional host capability. */
export function fixedInputRegistration(scratch: unknown) {
  const host = (scratch ?? {}) as OptionalFixedHost;
  let active: unknown;
  let membership = '';
  const removers: (() => void)[] = [];
  let stopped = false;
  const clear = () => {
    host.vm?.runtime?.off?.('RUNTIME_DISPOSED', shutdown);
    for (const remove of removers.splice(0).reverse()) remove();
    active = undefined;
    membership = '';
  };
  const shutdown = () => {stopped = true; clear();};
  return {
    ensure(visibleOpcodes: readonly string[]) {
      const api = host.gui?.blockEditors;
      const definitions = fixedInputEditors.filter(definition => definition.opcodes.every(opcode => visibleOpcodes.includes(opcode)));
      const key = definitions.map(definition => definition.editorId).join(',');
      if (stopped || (api === active && membership === key)) return;
      clear();
      if (api?.apiVersion !== 1 || typeof api.registerFixedInputEditor !== 'function' || !definitions.length) return;
      try {
        for (const definition of definitions) {
          const remove = api.registerFixedInputEditor.call(api, definition);
          if (typeof remove !== 'function') throw new TypeError('Invalid fixed input cleanup.');
          removers.push(remove);
        }
        active = api;
        membership = key;
        host.vm?.runtime?.on?.('RUNTIME_DISPOSED', shutdown);
      } catch (error) {clear(); throw error;}
    },
    dispose: shutdown
  };
}
