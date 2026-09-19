import {DEFAULT_MAX_BINARY_BYTES} from '../binary/types.js';
import {isNamedDataNamespace} from '../../named-data-namespace.js';
import type {
  ExpressionIrV2,
  NamedBodyRepresentationV2,
  NamedDataKindV2,
  NamedDataScopeV2,
  SourceRefV2,
  StatementIrV2
} from '../ir-v2/types.js';

export type NamedBodyLoweringDiagnosticCode =
  | 'TW2_NAMED_DYNAMIC_DESCRIPTOR'
  | 'TW2_NAMED_INVALID_DESCRIPTOR'
  | 'TW2_NAMED_INVALID_MAX';

export interface NamedBodyLoweringDiagnostic {
  severity: 'error';
  code: NamedBodyLoweringDiagnosticCode;
  message: string;
  reason: string;
  suggestion: string;
  sourceRef: SourceRefV2;
}

export interface NamedBodyLoweringResult {
  statement?: Extract<StatementIrV2, {kind: 'respond-named-body'}>;
  diagnostics: NamedBodyLoweringDiagnostic[];
}

export type NamedBodyArguments = Readonly<Record<string, ExpressionIrV2>>;

const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const KINDS: readonly NamedDataKindV2[] = ['structured', 'document', 'binary', 'asset'];
const SCOPES: readonly NamedDataScopeV2[] = ['target', 'project'];
const REPRESENTATIONS: readonly NamedBodyRepresentationV2[] = ['json', 'yaml', 'html', 'markdown', 'raw'];

export function lowerNamedBodyResponse(
  args: NamedBodyArguments,
  sourceRef: SourceRefV2
): NamedBodyLoweringResult {
  const diagnostics: NamedBodyLoweringDiagnostic[] = [];
  const namespace = literalString(args.NAMESPACE, 'NAMESPACE', sourceRef, diagnostics);
  const name = literalString(args.NAME, 'NAME', sourceRef, diagnostics);
  const kind = literalMember(args.KIND, 'KIND', KINDS, sourceRef, diagnostics);
  const scope = literalMember(args.SCOPE, 'SCOPE', SCOPES, sourceRef, diagnostics);
  const representation = literalMember(
    args.REPRESENTATION,
    'REPRESENTATION',
    REPRESENTATIONS,
    sourceRef,
    diagnostics
  );
  const maxBytes = literalMaximum(args.MAX_BYTES, sourceRef, diagnostics);
  if (
    namespace === undefined ||
    name === undefined ||
    kind === undefined ||
    scope === undefined ||
    representation === undefined ||
    maxBytes === undefined
  ) {
    return {diagnostics};
  }
  if (!isNamedDataNamespace(namespace) || name.length < 1 || name.length > 256 || hasControlCharacter(name)) {
    report(
      diagnostics,
      'TW2_NAMED_INVALID_DESCRIPTOR',
      'Named response namespace or name is invalid.',
      'The canonical descriptor requires a safe logical namespace and a bounded non-control name.',
      'Use a canonical namespace such as asset and a name from 1 to 256 characters.',
      sourceRef
    );
    return {diagnostics};
  }

  let targetId: string | undefined;
  if (scope === 'target') {
    targetId = literalString(args.TARGET_ID, 'TARGET_ID', sourceRef, diagnostics);
    if (targetId === undefined) return {diagnostics};
    if (!TARGET_ID.test(targetId)) {
      report(
        diagnostics,
        'TW2_NAMED_INVALID_DESCRIPTOR',
        'Target-scoped named response has an invalid target ID.',
        'Target scope requires a stable runtime-local identity.',
        'Use a non-empty target ID containing only letters, digits, dot, underscore, colon, or hyphen.',
        inputSource(sourceRef, 'TARGET_ID')
      );
      return {diagnostics};
    }
  }

  return {
    statement: {
      kind: 'respond-named-body',
      reference: {namespace, name, kind, scope},
      representation,
      ...(targetId === undefined ? {} : {targetId}),
      maxBytes,
      sourceRef
    },
    diagnostics
  };
}

function literalString(
  expression: ExpressionIrV2 | undefined,
  input: string,
  sourceRef: SourceRefV2,
  diagnostics: NamedBodyLoweringDiagnostic[]
): string | undefined {
  if (expression?.kind === 'literal' && expression.valueType === 'string' && typeof expression.value === 'string') {
    return expression.value;
  }
  report(
    diagnostics,
    'TW2_NAMED_DYNAMIC_DESCRIPTOR',
    `Named response ${input} must be a compile-time string literal.`,
    'Static descriptors are required to validate provider capability and scope before generation.',
    'Replace the input with a literal value.',
    inputSource(sourceRef, input)
  );
}

function literalMember<T extends string>(
  expression: ExpressionIrV2 | undefined,
  input: string,
  values: readonly T[],
  sourceRef: SourceRefV2,
  diagnostics: NamedBodyLoweringDiagnostic[]
): T | undefined {
  const value = literalString(expression, input, sourceRef, diagnostics);
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (values.includes(normalized as T)) return normalized as T;
  report(
    diagnostics,
    'TW2_NAMED_INVALID_DESCRIPTOR',
    `Named response ${input} is not supported.`,
    `Accepted values are: ${values.join(', ')}.`,
    'Use one of the canonical descriptor values.',
    inputSource(sourceRef, input)
  );
}

function literalMaximum(
  expression: ExpressionIrV2 | undefined,
  sourceRef: SourceRefV2,
  diagnostics: NamedBodyLoweringDiagnostic[]
): number | undefined {
  const value = expression?.kind === 'literal' && expression.valueType === 'number' ? expression.value : undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= DEFAULT_MAX_BINARY_BYTES) {
    return value;
  }
  report(
    diagnostics,
    'TW2_NAMED_INVALID_MAX',
    `Named response MAX_BYTES must be an integer literal from 1 to ${DEFAULT_MAX_BINARY_BYTES}.`,
    'A static byte bound is required for target planning and runtime enforcement.',
    'Use a numeric literal within the compiler-wide binary limit.',
    inputSource(sourceRef, 'MAX_BYTES')
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0)!;
    return point <= 0x1f || point === 0x7f;
  });
}

function inputSource(sourceRef: SourceRefV2, input: string): SourceRefV2 {
  return {...sourceRef, input};
}

function report(
  diagnostics: NamedBodyLoweringDiagnostic[],
  code: NamedBodyLoweringDiagnosticCode,
  message: string,
  reason: string,
  suggestion: string,
  sourceRef: SourceRefV2
): void {
  diagnostics.push({severity: 'error', code, message, reason, suggestion, sourceRef});
}
