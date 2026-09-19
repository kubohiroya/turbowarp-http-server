import type {
  BindingDeclarationV2,
  BindingTypeV2,
  CapabilityRequirementV2,
  DeployIrV2,
  ExpressionIrV2,
  RouteIrV2,
  SourceRefV2,
  StatementIrV2,
  ValueTypeV2
} from '../ir-v2/types.js';
import {
  DEFAULT_SERVER_SUBSET_POLICY,
  type ServerSubsetDiagnosticCode,
  type ServerSubsetPolicy,
  type TargetCapabilityDiagnostic,
  type TargetNeutralDiagnostic
} from './types.js';

type BindingEnvironment = Map<string, BindingTypeV2>;

interface ValidationContext {
  route: RouteIrV2;
  diagnostics: TargetNeutralDiagnostic[];
  capabilities: ReadonlySet<string>;
  policy: Readonly<ServerSubsetPolicy>;
  loopDepth: number;
}

interface FlowResult {
  mayContinue: boolean;
  mayTerminate: boolean;
  bindings: BindingEnvironment;
}

export function validateDeployIrV2Subset(
  ir: DeployIrV2,
  policy: Readonly<ServerSubsetPolicy> = DEFAULT_SERVER_SUBSET_POLICY
): TargetNeutralDiagnostic[] {
  const diagnostics: TargetNeutralDiagnostic[] = [];
  const capabilities = new Set(ir.capabilities.map(capabilityKey));
  if (ir.auth.kind === 'jwt' && ir.routes[0] !== undefined) {
    const context: ValidationContext = {
      route: ir.routes[0],
      diagnostics,
      capabilities,
      policy,
      loopDepth: 0
    };
    requireCapability({kind: 'auth', scheme: ir.auth.scheme}, context, ir.routes[0].sourceRef);
  }
  for (const route of ir.routes) {
    const context: ValidationContext = {route, diagnostics, capabilities, policy, loopDepth: 0};
    const flow = analyzeSequence(route.body, new Map(), context);
    if (flow.mayContinue || !flow.mayTerminate) {
      report(
        context,
        'TW2_MISSING_RESPONSE',
        'Every normal control-flow path must end in one terminal response.',
        'At least one route path reaches the end of the handler without responding.',
        'Add a terminal response to every branch at the top level.',
        route.sourceRef
      );
    }
    const work = sequenceWork(route.body, policy.maxRouteWork);
    if (work > policy.maxRouteWork) {
      report(
        context,
        'TW2_WORK_BUDGET_EXCEEDED',
        `Route worst-case work ${work} exceeds the ${policy.maxRouteWork} step limit.`,
        'Bounded loops and nested expressions expand beyond the target-neutral work budget.',
        'Reduce loop bounds, nesting, or handler operations.',
        route.sourceRef ?? route.body[0]?.sourceRef
      );
    }
  }
  return diagnostics;
}

export function targetCapabilityDiagnostic(input: {
  targetId: string;
  routeId: string;
  capability: string;
  sourceRef?: SourceRefV2;
}): TargetCapabilityDiagnostic {
  const diagnostic: TargetCapabilityDiagnostic = {
    severity: 'error',
    phase: 'target-capability',
    code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
    message: `Target ${input.targetId} does not support capability ${input.capability}.`,
    routeId: input.routeId,
    targetId: input.targetId,
    reason: 'The target-neutral IR is valid, but the selected adapter cannot satisfy a declared requirement.',
    suggestion: 'Choose a capable target or remove the operation that requires this capability.'
  };
  if (input.sourceRef !== undefined) diagnostic.sourceRef = input.sourceRef;
  return diagnostic;
}

function analyzeSequence(
  statements: readonly StatementIrV2[],
  initialBindings: BindingEnvironment,
  context: ValidationContext
): FlowResult {
  let flow: FlowResult = {mayContinue: true, mayTerminate: false, bindings: initialBindings};
  for (const statement of statements) {
    if (!flow.mayContinue) {
      report(
        context,
        statement.kind === 'respond' ? 'TW2_MULTIPLE_RESPONSE' : 'TW2_RESPONSE_AFTER_TERMINAL',
        statement.kind === 'respond'
          ? 'A control-flow path contains more than one terminal response.'
          : 'A statement appears after a terminal response.',
        'Terminal response ends the current handler path.',
        'Remove the unreachable statement or move it before the response.',
        statement.sourceRef
      );
      continue;
    }
    const result = analyzeStatement(statement, flow.bindings, context);
    flow = {
      mayContinue: result.mayContinue,
      mayTerminate: flow.mayTerminate || result.mayTerminate,
      bindings: result.bindings
    };
  }
  return flow;
}

function analyzeStatement(
  statement: StatementIrV2,
  bindings: BindingEnvironment,
  context: ValidationContext
): FlowResult {
  if (statement.kind === 'set-header') {
    const type = validateExpression(statement.value, bindings, context);
    requireScratchScalar(type, context, statement.sourceRef, 'Response header values');
  } else if (statement.kind === 'set-handler-variable' || statement.kind === 'change-handler-variable') {
    const nameType = validateExpression(statement.name, bindings, context);
    requireScratchScalar(nameType, context, statement.sourceRef, 'Handler variable names');
    const valueType = validateExpression(statement.value, bindings, context);
    requireScratchScalar(valueType, context, statement.sourceRef, 'Handler variable values');
  } else if (statement.kind === 'delete-handler-variable') {
    requireScratchScalar(
      validateExpression(statement.name, bindings, context),
      context,
      statement.sourceRef,
      'Handler variable names'
    );
  } else if (statement.kind === 'record-create') {
    requireCapability({kind: 'record-store'}, context, statement.sourceRef);
    validateExpression(statement.data, bindings, context);
    declareBinding(statement.result, {kind: 'value', valueType: 'json-object'}, bindings, context, statement.sourceRef);
  } else if (statement.kind === 'record-list') {
    requireCapability({kind: 'record-store'}, context, statement.sourceRef);
    declareBinding(statement.result, {kind: 'value', valueType: 'json-array'}, bindings, context, statement.sourceRef);
  } else if (statement.kind === 'record-get') {
    requireCapability({kind: 'record-store'}, context, statement.sourceRef);
    requireScratchScalar(validateExpression(statement.id, bindings, context), context, statement.sourceRef, 'Record IDs');
    declareBinding(
      statement.result,
      {kind: 'value', valueType: {kind: 'union', members: ['null', 'json-object']}},
      bindings,
      context,
      statement.sourceRef
    );
  } else if (statement.kind === 'record-delete') {
    requireCapability({kind: 'record-store'}, context, statement.sourceRef);
    requireScratchScalar(validateExpression(statement.id, bindings, context), context, statement.sourceRef, 'Record IDs');
    declareBinding(statement.result, {kind: 'value', valueType: 'boolean'}, bindings, context, statement.sourceRef);
  } else if (statement.kind === 'if') {
    const conditionType = validateExpression(statement.condition, bindings, context);
    if (!sameValueType(conditionType, 'boolean')) {
      report(
        context,
        'TW2_CONDITION_TYPE',
        'IR if condition must have boolean type.',
        'IR v2 does not infer Scratch truthiness for direct IR input.',
        'Insert an explicit boolean comparison in the frontend.',
        statement.condition.sourceRef ?? statement.sourceRef
      );
    }
    const thenFlow = analyzeSequence(statement.then, cloneBindings(bindings), context);
    const elseFlow =
      statement.else === undefined
        ? {mayContinue: true, mayTerminate: false, bindings: cloneBindings(bindings)}
        : analyzeSequence(statement.else, cloneBindings(bindings), context);
    return mergeBranchFlows(bindings, thenFlow, elseFlow, context, statement.sourceRef);
  } else if (statement.kind === 'bounded-loop') {
    const nextDepth = context.loopDepth + 1;
    if (
      !Number.isSafeInteger(statement.maxIterations) ||
      statement.maxIterations < 0 ||
      statement.maxIterations > context.policy.maxLoopIterations
    ) {
      report(
        context,
        'TW2_LOOP_BOUND_INVALID',
        `Loop maxIterations must be an integer from 0 to ${context.policy.maxLoopIterations}.`,
        'Server loops require a statically proven finite bound.',
        'Use a literal bound within the supported range.',
        statement.sourceRef
      );
    }
    if (nextDepth > context.policy.maxLoopNesting) {
      report(
        context,
        'TW2_LOOP_NESTING_EXCEEDED',
        `Loop nesting exceeds the ${context.policy.maxLoopNesting} level limit.`,
        'Deeply nested bounded loops can still create excessive work.',
        'Flatten the iteration or split the handler.',
        statement.sourceRef
      );
    }
    analyzeSequence(statement.body, cloneBindings(bindings), {...context, loopDepth: nextDepth});
  } else if (statement.kind === 'respond') {
    validateExpression(statement.body, bindings, context);
    if (context.loopDepth > 0) {
      report(
        context,
        'TW2_RESPONSE_IN_LOOP',
        'Terminal response is not allowed inside a loop.',
        'A loop can execute zero or multiple times, so response cardinality would be ambiguous.',
        'Move the response after the outermost loop.',
        statement.sourceRef
      );
    }
    return {mayContinue: false, mayTerminate: true, bindings};
  }
  return {mayContinue: true, mayTerminate: false, bindings};
}

function validateExpression(
  expression: ExpressionIrV2,
  bindings: ReadonlyMap<string, BindingTypeV2>,
  context: ValidationContext
): ValueTypeV2 {
  if (expression.kind === 'request' && expression.source === 'client-address') {
    requireCapability({kind: 'request-metadata', field: 'client-address'}, context, expression.sourceRef);
  }
  if (expression.kind === 'concat') {
    const left = validateExpression(expression.left, bindings, context);
    const right = validateExpression(expression.right, bindings, context);
    if (!sameValueType(left, 'string') || !sameValueType(right, 'string')) {
      report(
        context,
        'TW2_BINDING_TYPE_MISMATCH',
        'concat operands must both have string type.',
        'IR v2 does not apply implicit JSON or binary coercion.',
        'Serialize or convert each operand explicitly.',
        expression.sourceRef
      );
    }
  }
  if (expression.kind === 'handler-variable' || expression.kind === 'handler-variable-exists') {
    requireScratchScalar(
      validateExpression(expression.name, bindings, context),
      context,
      expression.sourceRef,
      'Handler variable names'
    );
  }
  if (expression.kind === 'binding') {
    const declared = bindings.get(expression.binding);
    if (declared === undefined) {
      report(
        context,
        'TW2_BINDING_UNDECLARED',
        `Binding ${expression.binding} is not declared in this lexical scope.`,
        'Typed bindings are compiler-assigned and scoped to their declaring control-flow region.',
        'Use the binding only after its producer and inside the same lexical scope.',
        expression.sourceRef
      );
    } else if (declared.kind !== 'value' || !sameValueType(declared.valueType, expression.valueType)) {
      report(
        context,
        'TW2_BINDING_TYPE_MISMATCH',
        `Binding ${expression.binding} does not match the expression value type.`,
        'Value bindings and resource bindings are distinct and cannot be substituted.',
        'Use the declared value type, or pass a binary-body only to a resource consumer.',
        expression.sourceRef
      );
    }
  }
  return expression.valueType;
}

function declareBinding(
  declaration: BindingDeclarationV2,
  expected: BindingTypeV2,
  bindings: BindingEnvironment,
  context: ValidationContext,
  sourceRef?: SourceRefV2
): void {
  if (bindings.has(declaration.id)) {
    report(
      context,
      'TW2_BINDING_DUPLICATE',
      `Binding ${declaration.id} is already declared in this scope.`,
      'Compiler-generated binding IDs must be unique along a control-flow path.',
      'Allocate a new lexical binding ID.',
      sourceRef
    );
    return;
  }
  if (!sameBindingType(declaration.type, expected)) {
    report(
      context,
      'TW2_BINDING_TYPE_MISMATCH',
      `Binding ${declaration.id} has an invalid result type for its producer.`,
      'The declared binding type must match the operation result contract.',
      'Use the producer result type defined by IR v2.',
      sourceRef
    );
  }
  bindings.set(declaration.id, expected);
}

function mergeBranchFlows(
  base: BindingEnvironment,
  thenFlow: FlowResult,
  elseFlow: FlowResult,
  context: ValidationContext,
  sourceRef?: SourceRefV2
): FlowResult {
  const mayContinue = thenFlow.mayContinue || elseFlow.mayContinue;
  const mayTerminate = thenFlow.mayTerminate || elseFlow.mayTerminate;
  if (!mayContinue) return {mayContinue, mayTerminate, bindings: cloneBindings(base)};
  if (thenFlow.mayContinue && !elseFlow.mayContinue) return {mayContinue, mayTerminate, bindings: thenFlow.bindings};
  if (!thenFlow.mayContinue && elseFlow.mayContinue) return {mayContinue, mayTerminate, bindings: elseFlow.bindings};

  const merged = cloneBindings(base);
  const names = new Set([...thenFlow.bindings.keys(), ...elseFlow.bindings.keys()]);
  for (const name of names) {
    if (base.has(name)) continue;
    const thenType = thenFlow.bindings.get(name);
    const elseType = elseFlow.bindings.get(name);
    if (thenType === undefined || elseType === undefined || !sameBindingType(thenType, elseType)) {
      report(
        context,
        'TW2_BRANCH_BINDING_MISMATCH',
        `Binding ${name} is not declared with the same type in both continuing branches.`,
        'A binding used after an if must exist consistently on every path that reaches the merge point.',
        'Declare matching bindings in both branches or keep their use inside each branch.',
        sourceRef
      );
      continue;
    }
    merged.set(name, thenType);
  }
  return {mayContinue, mayTerminate, bindings: merged};
}

function requireCapability(
  capability: CapabilityRequirementV2,
  context: ValidationContext,
  sourceRef?: SourceRefV2
): void {
  const key = capabilityKey(capability);
  if (context.capabilities.has(key)) return;
  report(
    context,
    'TW2_CAPABILITY_MISSING',
    `IR operation requires undeclared capability ${key}.`,
    'Target-neutral capability requirements must be complete before adapter selection.',
    'Add the logical capability to IR.capabilities.',
    sourceRef
  );
}

function requireScratchScalar(
  type: ValueTypeV2,
  context: ValidationContext,
  sourceRef: SourceRefV2 | undefined,
  subject: string
): void {
  const members = valueTypeMembers(type);
  if (members.every((member) => member === 'string' || member === 'number' || member === 'boolean')) return;
  report(
    context,
    'TW2_HANDLER_VARIABLE_TYPE',
    `${subject} must use a Scratch-compatible scalar value.`,
    'JSON, binary-ref, and resource state belong in typed lexical bindings.',
    'Convert to a scalar or use a compiler-generated typed binding.',
    sourceRef
  );
}

function sequenceWork(statements: readonly StatementIrV2[], limit: number): number {
  let total = 0;
  for (const statement of statements) {
    total = saturatedAdd(total, statementWork(statement, limit), limit);
  }
  return total;
}

function statementWork(statement: StatementIrV2, limit: number): number {
  if (statement.kind === 'if') {
    const branches = Math.max(sequenceWork(statement.then, limit), sequenceWork(statement.else ?? [], limit));
    return saturatedAdd(saturatedAdd(1, expressionWork(statement.condition, limit), limit), branches, limit);
  }
  if (statement.kind === 'bounded-loop') {
    return saturatedAdd(1, saturatedMultiply(statement.maxIterations, sequenceWork(statement.body, limit), limit), limit);
  }
  let work = 1;
  if (statement.kind === 'set-header') work = saturatedAdd(work, expressionWork(statement.value, limit), limit);
  if (statement.kind === 'set-handler-variable' || statement.kind === 'change-handler-variable') {
    work = saturatedAdd(work, expressionWork(statement.name, limit), limit);
    work = saturatedAdd(work, expressionWork(statement.value, limit), limit);
  }
  if (statement.kind === 'delete-handler-variable') work = saturatedAdd(work, expressionWork(statement.name, limit), limit);
  if (statement.kind === 'record-create') work = saturatedAdd(work, expressionWork(statement.data, limit), limit);
  if (statement.kind === 'record-get' || statement.kind === 'record-delete') {
    work = saturatedAdd(work, expressionWork(statement.id, limit), limit);
  }
  if (statement.kind === 'respond') work = saturatedAdd(work, expressionWork(statement.body, limit), limit);
  return work;
}

function expressionWork(expression: ExpressionIrV2, limit: number): number {
  if (expression.kind === 'concat') {
    return saturatedAdd(
      saturatedAdd(1, expressionWork(expression.left, limit), limit),
      expressionWork(expression.right, limit),
      limit
    );
  }
  if (expression.kind === 'handler-variable' || expression.kind === 'handler-variable-exists') {
    return saturatedAdd(1, expressionWork(expression.name, limit), limit);
  }
  return 1;
}

function saturatedAdd(left: number, right: number, limit: number): number {
  return left > limit || right > limit || left + right > limit ? limit + 1 : left + right;
}

function saturatedMultiply(left: number, right: number, limit: number): number {
  if (left < 0 || right < 0 || left > limit || right > limit || left * right > limit) return limit + 1;
  return left * right;
}

function capabilityKey(capability: CapabilityRequirementV2): string {
  if (capability.kind === 'record-store') return capability.kind;
  return `${capability.kind}:${capability.kind === 'auth' ? capability.scheme : capability.field}`;
}

function cloneBindings(bindings: ReadonlyMap<string, BindingTypeV2>): BindingEnvironment {
  return new Map(bindings);
}

function sameBindingType(left: BindingTypeV2, right: BindingTypeV2): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === 'resource'
    ? right.kind === 'resource' && left.resourceType === right.resourceType
    : right.kind === 'value' && sameValueType(left.valueType, right.valueType);
}

function sameValueType(left: ValueTypeV2, right: ValueTypeV2): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function valueTypeMembers(type: ValueTypeV2): readonly string[] {
  return typeof type === 'string' ? [type] : type.members;
}

function report(
  context: ValidationContext,
  code: ServerSubsetDiagnosticCode,
  message: string,
  reason: string,
  suggestion: string,
  sourceRef?: SourceRefV2
): void {
  const diagnostic: TargetNeutralDiagnostic = {
    severity: 'error',
    phase: 'target-neutral',
    code,
    message,
    routeId: context.route.id,
    reason,
    suggestion
  };
  if (sourceRef !== undefined) diagnostic.sourceRef = sourceRef;
  context.diagnostics.push(diagnostic);
}
