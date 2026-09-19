import type {
  CapabilityRequirementV2,
  DeployIrV2,
  ExpressionIrV2,
  SourceRefV2,
  StatementIrV2
} from '../ir-v2/types.js';
import type {CapabilityRequirements} from './types.js';

export interface CapabilityOrigin {
  routeId: string;
  sourceRef?: SourceRefV2;
}

type LocatedNode = {sourceRef?: SourceRefV2};

export function extractCapabilityRequirements(ir: DeployIrV2): CapabilityRequirements {
  return {keys: [...new Set(ir.capabilities.map(capabilityKey))].sort()};
}

export function capabilityKey(capability: CapabilityRequirementV2): string {
  if (capability.kind === 'auth') return `auth:${capability.scheme}`;
  if (capability.kind === 'request-metadata') return `request-metadata:${capability.field}`;
  return capability.kind;
}

export function findCapabilityOrigin(ir: DeployIrV2, key: string): CapabilityOrigin | undefined {
  for (const route of ir.routes) {
    const located = findInStatements(route.body, key);
    if (located !== undefined) {
      return {...(located.sourceRef === undefined ? {} : {sourceRef: located.sourceRef}), routeId: route.id};
    }
  }
  const fallback = ir.routes[0];
  if (fallback === undefined) return undefined;
  return {...(fallback.sourceRef === undefined ? {} : {sourceRef: fallback.sourceRef}), routeId: fallback.id};
}

function findInStatements(statements: readonly StatementIrV2[], key: string): LocatedNode | undefined {
  for (const statement of statements) {
    if (statementRequires(statement, key)) {
      return statement.sourceRef === undefined ? {} : {sourceRef: statement.sourceRef};
    }
    for (const expression of statementExpressions(statement)) {
      const located = findInExpression(expression, key);
      if (located !== undefined) return located;
    }
    if (statement.kind === 'if') {
      const nested = findInStatements([...statement.then, ...(statement.else ?? [])], key);
      if (nested !== undefined) return nested;
    } else if (statement.kind === 'bounded-loop' || statement.kind === 'json-for-each') {
      const nested = findInStatements(statement.body, key);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function statementRequires(statement: StatementIrV2, key: string): boolean {
  if (key === 'record-store') return statement.kind.startsWith('record-');
  if (key === 'object-storage') return statement.kind.startsWith('asset-');
  if (key === 'streaming-body') {
    return (
      statement.kind === 'request-body-binary' ||
      statement.kind === 'asset-object-get' ||
      statement.kind === 'respond-binary'
    );
  }
  return false;
}

function statementExpressions(statement: StatementIrV2): ExpressionIrV2[] {
  if (statement.kind === 'set-header') return [statement.value];
  if (statement.kind === 'set-handler-variable' || statement.kind === 'change-handler-variable') {
    return [statement.name, statement.value];
  }
  if (statement.kind === 'delete-handler-variable') return [statement.name];
  if (statement.kind === 'record-create') return [statement.data];
  if (statement.kind === 'record-get' || statement.kind === 'record-delete') return [statement.id];
  if (statement.kind === 'asset-object-get') return [statement.ref];
  if (statement.kind === 'asset-object-delete' && statement.target.kind === 'ref') return [statement.target.ref];
  if (statement.kind === 'if') return [statement.condition];
  if (statement.kind === 'json-for-each') return [statement.root];
  if (statement.kind === 'respond') return [statement.body];
  return [];
}

function findInExpression(expression: ExpressionIrV2, key: string): LocatedNode | undefined {
  if (
    key === 'request-metadata:client-address' &&
    expression.kind === 'request' &&
    expression.source === 'client-address'
  ) {
    return expression.sourceRef === undefined ? {} : {sourceRef: expression.sourceRef};
  }
  for (const child of childExpressions(expression)) {
    const located = findInExpression(child, key);
    if (located !== undefined) return located;
  }
  return undefined;
}

function childExpressions(expression: ExpressionIrV2): ExpressionIrV2[] {
  if (expression.kind === 'concat') return [expression.left, expression.right];
  if (
    expression.kind === 'handler-variable' ||
    expression.kind === 'handler-variable-exists' ||
    expression.kind === 'json-text-coerce'
  ) {
    return [expression.kind === 'json-text-coerce' ? expression.input : expression.name];
  }
  if (expression.kind === 'json-parse' || expression.kind === 'json-is-valid') return [expression.text];
  if (expression.kind === 'json-stringify') return [expression.value];
  if (
    expression.kind === 'json-get' ||
    expression.kind === 'json-has' ||
    expression.kind === 'json-delete' ||
    expression.kind === 'json-keys' ||
    expression.kind === 'json-length'
  ) {
    return [expression.root];
  }
  if (expression.kind === 'json-set') return [expression.root, expression.value];
  return [];
}
