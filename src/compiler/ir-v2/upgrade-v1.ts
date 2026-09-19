import type {ActionIr, AuthMode, DeployIr, ExpressionIr} from '../ir.js';
import type {
  AuthPolicyV2,
  BindingDeclarationV2,
  CapabilityRequirementV2,
  CompilerDiagnosticV2,
  DeployIrV2,
  ExpressionIrV2,
  StatementIrV2,
  ValueTypeV2
} from './types.js';
import {DEPLOY_IR_V2_VERSION} from './types.js';

export interface LegacyTargetConfigV2 {
  target: 'cloudflare-workers';
  auth?: {provider: 'cloudflare-access'};
}

export interface UpgradeDeployIrV1Result {
  ir: DeployIrV2;
  diagnostics: CompilerDiagnosticV2[];
  targetConfig?: LegacyTargetConfigV2;
}

export function upgradeDeployIrV1(ir: DeployIr, target?: string): UpgradeDeployIrV1Result {
  const diagnostics: CompilerDiagnosticV2[] = [];
  const capabilities: CapabilityRequirementV2[] = [];
  const auth = upgradeAuth(ir.auth, target, diagnostics, capabilities);
  const routes = ir.routes.map((route) => {
    const bindingTypes = collectBindingTypes(route.actions);
    const body = route.actions.map((action) => upgradeAction(action, bindingTypes, capabilities));
    return {id: route.id, method: route.method, path: route.path, auth: route.auth, body};
  });
  const result: UpgradeDeployIrV1Result = {
    ir: {
      version: DEPLOY_IR_V2_VERSION,
      name: ir.name,
      auth,
      capabilities: deduplicateCapabilities(capabilities),
      routes
    },
    diagnostics
  };
  if (ir.auth === 'cloudflare-access' && target === 'cloudflare-workers') {
    result.targetConfig = {target: 'cloudflare-workers', auth: {provider: 'cloudflare-access'}};
  }
  return result;
}

function upgradeAuth(
  auth: AuthMode,
  target: string | undefined,
  diagnostics: CompilerDiagnosticV2[],
  capabilities: CapabilityRequirementV2[]
): AuthPolicyV2 {
  if (auth === 'none') return {kind: 'none'};
  if (auth === 'external-jwt') {
    capabilities.push({kind: 'auth', scheme: 'external-jwt'});
    return {kind: 'jwt', scheme: 'external-jwt'};
  }
  capabilities.push({kind: 'auth', scheme: 'trusted-access-jwt'});
  if (target !== 'cloudflare-workers') {
    diagnostics.push({
      severity: 'error',
      code: 'TW2_V1_TARGET_CONSTRAINT',
      message: 'IR v1 cloudflare-access auth can only be upgraded for target cloudflare-workers.'
    });
  }
  return {kind: 'jwt', scheme: 'trusted-access-jwt'};
}

function collectBindingTypes(actions: ActionIr[]): Map<string, ValueTypeV2> {
  const types = new Map<string, ValueTypeV2>();
  for (const action of actions) {
    if (action.kind === 'record-create') types.set(action.result, 'json-object');
    if (action.kind === 'record-list') types.set(action.result, 'json-array');
    if (action.kind === 'record-get') {
      types.set(action.result, {kind: 'union', members: ['null', 'json-object']});
    }
    if (action.kind === 'record-delete') types.set(action.result, 'boolean');
  }
  return types;
}

function upgradeAction(
  action: ActionIr,
  bindingTypes: ReadonlyMap<string, ValueTypeV2>,
  capabilities: CapabilityRequirementV2[]
): StatementIrV2 {
  if (action.kind === 'set-status' || action.kind === 'remove-header' || action.kind === 'clear-handler-variables') {
    return action;
  }
  if (action.kind === 'set-header') {
    return {kind: action.kind, name: action.name, value: upgradeExpression(action.value, bindingTypes, capabilities)};
  }
  if (action.kind === 'set-handler-variable' || action.kind === 'change-handler-variable') {
    return {
      kind: action.kind,
      name: upgradeExpression(action.name, bindingTypes, capabilities),
      value: upgradeExpression(action.value, bindingTypes, capabilities)
    };
  }
  if (action.kind === 'delete-handler-variable') {
    return {kind: action.kind, name: upgradeExpression(action.name, bindingTypes, capabilities)};
  }
  if (action.kind === 'respond') {
    return {kind: action.kind, format: action.format, body: upgradeExpression(action.body, bindingTypes, capabilities)};
  }
  capabilities.push({kind: 'record-store'});
  const result = binding(action.result, requireBindingType(bindingTypes, action.result));
  if (action.kind === 'record-create') {
    return {
      kind: action.kind,
      collection: action.collection,
      data: upgradeExpression(action.data, bindingTypes, capabilities),
      result
    };
  }
  if (action.kind === 'record-list') return {kind: action.kind, collection: action.collection, result};
  return {kind: action.kind, id: upgradeExpression(action.id, bindingTypes, capabilities), result};
}

function upgradeExpression(
  expression: ExpressionIr,
  bindingTypes: ReadonlyMap<string, ValueTypeV2>,
  capabilities: CapabilityRequirementV2[]
): ExpressionIrV2 {
  if (expression.kind === 'literal') return {kind: 'literal', valueType: 'string', value: expression.value};
  if (expression.kind === 'request') {
    if (expression.source === 'client-address') capabilities.push({kind: 'request-metadata', field: 'client-address'});
    return {
      kind: 'request',
      valueType: 'string',
      source: expression.source === 'body' ? 'body-text' : expression.source
    };
  }
  if (expression.kind === 'request-value') {
    return {kind: expression.kind, valueType: 'string', source: expression.source, name: expression.name};
  }
  if (expression.kind === 'concat') {
    return {
      kind: expression.kind,
      valueType: 'string',
      left: upgradeExpression(expression.left, bindingTypes, capabilities),
      right: upgradeExpression(expression.right, bindingTypes, capabilities)
    };
  }
  if (expression.kind === 'handler-variable') {
    return {
      kind: expression.kind,
      valueType: {kind: 'union', members: ['number', 'string']},
      name: upgradeExpression(expression.name, bindingTypes, capabilities)
    };
  }
  if (expression.kind === 'handler-variable-exists') {
    return {
      kind: expression.kind,
      valueType: 'boolean',
      name: upgradeExpression(expression.name, bindingTypes, capabilities)
    };
  }
  if (expression.kind === 'handler-variable-names') {
    return {kind: expression.kind, valueType: 'string'};
  }
  return {
    kind: 'binding',
    valueType: requireBindingType(bindingTypes, expression.name),
    binding: expression.name
  };
}

function requireBindingType(bindingTypes: ReadonlyMap<string, ValueTypeV2>, id: string): ValueTypeV2 {
  const type = bindingTypes.get(id);
  if (type === undefined) throw new Error(`IR v1 result binding is not declared: ${id}`);
  return type;
}

function binding(id: string, valueType: ValueTypeV2): BindingDeclarationV2 {
  return {id, type: {kind: 'value', valueType}};
}

function deduplicateCapabilities(capabilities: CapabilityRequirementV2[]): CapabilityRequirementV2[] {
  const entries = new Map<string, CapabilityRequirementV2>();
  for (const capability of capabilities) entries.set(JSON.stringify(capability), capability);
  return [...entries.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, capability]) => capability);
}
