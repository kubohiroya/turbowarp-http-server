import { DEFAULT_SERVER_SUBSET_POLICY } from './types.js';
export function validateDeployIrV2Subset(ir, policy = DEFAULT_SERVER_SUBSET_POLICY) {
    const diagnostics = [];
    const capabilities = new Set(ir.capabilities.map(capabilityKey));
    if (ir.auth.kind === 'jwt' && ir.routes[0] !== undefined) {
        const context = {
            route: ir.routes[0],
            diagnostics,
            capabilities,
            policy,
            loopDepth: 0,
            iterationLoopIds: new Set()
        };
        requireCapability({ kind: 'auth', scheme: ir.auth.scheme }, context, ir.routes[0].sourceRef);
    }
    for (const route of ir.routes) {
        const context = {
            route,
            diagnostics,
            capabilities,
            policy,
            loopDepth: 0,
            iterationLoopIds: new Set()
        };
        const flow = analyzeSequence(route.body, new Map(), context);
        if (flow.mayContinue || !flow.mayTerminate) {
            report(context, 'TW2_MISSING_RESPONSE', 'Every normal control-flow path must end in one terminal response.', 'At least one route path reaches the end of the handler without responding.', 'Add a terminal response to every branch at the top level.', route.sourceRef);
        }
        const work = sequenceWork(route.body, policy.maxRouteWork);
        if (work > policy.maxRouteWork) {
            report(context, 'TW2_WORK_BUDGET_EXCEEDED', `Route worst-case work ${work} exceeds the ${policy.maxRouteWork} step limit.`, 'Bounded loops and nested expressions expand beyond the target-neutral work budget.', 'Reduce loop bounds, nesting, or handler operations.', route.sourceRef ?? route.body[0]?.sourceRef);
        }
    }
    return diagnostics;
}
export function targetCapabilityDiagnostic(input) {
    const diagnostic = {
        severity: 'error',
        phase: 'target-capability',
        code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
        message: `Target ${input.targetId} does not support capability ${input.capability}.`,
        routeId: input.routeId,
        targetId: input.targetId,
        reason: 'The target-neutral IR is valid, but the selected adapter cannot satisfy a declared requirement.',
        suggestion: 'Choose a capable target or remove the operation that requires this capability.'
    };
    if (input.sourceRef !== undefined)
        diagnostic.sourceRef = input.sourceRef;
    return diagnostic;
}
function analyzeSequence(statements, initialBindings, context) {
    let flow = { mayContinue: true, mayTerminate: false, bindings: initialBindings };
    for (const statement of statements) {
        if (!flow.mayContinue) {
            report(context, statement.kind === 'respond' ? 'TW2_MULTIPLE_RESPONSE' : 'TW2_RESPONSE_AFTER_TERMINAL', statement.kind === 'respond'
                ? 'A control-flow path contains more than one terminal response.'
                : 'A statement appears after a terminal response.', 'Terminal response ends the current handler path.', 'Remove the unreachable statement or move it before the response.', statement.sourceRef);
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
function analyzeStatement(statement, bindings, context) {
    if (statement.kind === 'set-header') {
        const type = validateExpression(statement.value, bindings, context);
        requireScratchScalar(type, context, statement.sourceRef, 'Response header values');
    }
    else if (statement.kind === 'set-handler-variable' || statement.kind === 'change-handler-variable') {
        const nameType = validateExpression(statement.name, bindings, context);
        requireScratchScalar(nameType, context, statement.sourceRef, 'Handler variable names');
        const valueType = validateExpression(statement.value, bindings, context);
        requireScratchScalar(valueType, context, statement.sourceRef, 'Handler variable values');
    }
    else if (statement.kind === 'delete-handler-variable') {
        requireScratchScalar(validateExpression(statement.name, bindings, context), context, statement.sourceRef, 'Handler variable names');
    }
    else if (statement.kind === 'record-create') {
        requireCapability({ kind: 'record-store' }, context, statement.sourceRef);
        validateExpression(statement.data, bindings, context);
        declareBinding(statement.result, { kind: 'value', valueType: 'json-object' }, bindings, context, statement.sourceRef);
    }
    else if (statement.kind === 'record-list') {
        requireCapability({ kind: 'record-store' }, context, statement.sourceRef);
        declareBinding(statement.result, { kind: 'value', valueType: 'json-array' }, bindings, context, statement.sourceRef);
    }
    else if (statement.kind === 'record-get') {
        requireCapability({ kind: 'record-store' }, context, statement.sourceRef);
        requireScratchScalar(validateExpression(statement.id, bindings, context), context, statement.sourceRef, 'Record IDs');
        declareBinding(statement.result, { kind: 'value', valueType: { kind: 'union', members: ['null', 'json-object'] } }, bindings, context, statement.sourceRef);
    }
    else if (statement.kind === 'record-delete') {
        requireCapability({ kind: 'record-store' }, context, statement.sourceRef);
        requireScratchScalar(validateExpression(statement.id, bindings, context), context, statement.sourceRef, 'Record IDs');
        declareBinding(statement.result, { kind: 'value', valueType: 'boolean' }, bindings, context, statement.sourceRef);
    }
    else if (statement.kind === 'if') {
        const conditionType = validateExpression(statement.condition, bindings, context);
        if (!sameValueType(conditionType, 'boolean')) {
            report(context, 'TW2_CONDITION_TYPE', 'IR if condition must have boolean type.', 'IR v2 does not infer Scratch truthiness for direct IR input.', 'Insert an explicit boolean comparison in the frontend.', statement.condition.sourceRef ?? statement.sourceRef);
        }
        const thenFlow = analyzeSequence(statement.then, cloneBindings(bindings), context);
        const elseFlow = statement.else === undefined
            ? { mayContinue: true, mayTerminate: false, bindings: cloneBindings(bindings) }
            : analyzeSequence(statement.else, cloneBindings(bindings), context);
        return mergeBranchFlows(bindings, thenFlow, elseFlow, context, statement.sourceRef);
    }
    else if (statement.kind === 'bounded-loop' || statement.kind === 'json-for-each') {
        const nextDepth = context.loopDepth + 1;
        if (statement.kind === 'json-for-each') {
            requireJsonValue(validateExpression(statement.root, bindings, context), context, statement.root.sourceRef ?? statement.sourceRef, 'Structured Data for-each root');
            if (context.iterationLoopIds.has(statement.loopId)) {
                report(context, 'TW2_BINDING_DUPLICATE', `Iteration loop ID ${statement.loopId} is already active.`, 'Nested Structured Data loops require distinct lexical IDs.', 'Generate a unique loop ID from the source block.', statement.sourceRef);
            }
        }
        const minimum = statement.kind === 'json-for-each' ? 1 : 0;
        if (!Number.isSafeInteger(statement.maxIterations) ||
            statement.maxIterations < minimum ||
            statement.maxIterations > context.policy.maxLoopIterations) {
            report(context, 'TW2_LOOP_BOUND_INVALID', `Loop maxIterations must be an integer from ${minimum} to ${context.policy.maxLoopIterations}.`, 'Server loops require a statically proven finite bound.', 'Use a literal bound within the supported range.', statement.sourceRef);
        }
        if (nextDepth > context.policy.maxLoopNesting) {
            report(context, 'TW2_LOOP_NESTING_EXCEEDED', `Loop nesting exceeds the ${context.policy.maxLoopNesting} level limit.`, 'Deeply nested bounded loops can still create excessive work.', 'Flatten the iteration or split the handler.', statement.sourceRef);
        }
        const iterationLoopIds = statement.kind === 'json-for-each'
            ? new Set([...context.iterationLoopIds, statement.loopId])
            : context.iterationLoopIds;
        analyzeSequence(statement.body, cloneBindings(bindings), {
            ...context,
            loopDepth: nextDepth,
            iterationLoopIds
        });
    }
    else if (statement.kind === 'respond') {
        validateExpression(statement.body, bindings, context);
        if (context.loopDepth > 0) {
            report(context, 'TW2_RESPONSE_IN_LOOP', 'Terminal response is not allowed inside a loop.', 'A loop can execute zero or multiple times, so response cardinality would be ambiguous.', 'Move the response after the outermost loop.', statement.sourceRef);
        }
        return { mayContinue: false, mayTerminate: true, bindings };
    }
    return { mayContinue: true, mayTerminate: false, bindings };
}
function validateExpression(expression, bindings, context) {
    if (expression.kind === 'request' && expression.source === 'client-address') {
        requireCapability({ kind: 'request-metadata', field: 'client-address' }, context, expression.sourceRef);
    }
    if (expression.kind === 'concat') {
        const left = validateExpression(expression.left, bindings, context);
        const right = validateExpression(expression.right, bindings, context);
        if (!sameValueType(left, 'string') || !sameValueType(right, 'string')) {
            report(context, 'TW2_BINDING_TYPE_MISMATCH', 'concat operands must both have string type.', 'IR v2 does not apply implicit JSON or binary coercion.', 'Serialize or convert each operand explicitly.', expression.sourceRef);
        }
    }
    if (expression.kind === 'handler-variable' || expression.kind === 'handler-variable-exists') {
        requireScratchScalar(validateExpression(expression.name, bindings, context), context, expression.sourceRef, 'Handler variable names');
    }
    if (expression.kind === 'json-text-coerce') {
        requireValueType(validateExpression(expression.input, bindings, context), 'string', context, expression.sourceRef, 'json-text coercion input');
    }
    if (expression.kind === 'json-parse' || expression.kind === 'json-is-valid') {
        requireValueType(validateExpression(expression.text, bindings, context), 'json-text', context, expression.sourceRef, 'Structured Data JSON text input');
    }
    if (expression.kind === 'json-stringify') {
        requireJsonValue(validateExpression(expression.value, bindings, context), context, expression.sourceRef, 'Structured Data serialization input');
    }
    if (expression.kind === 'json-get' ||
        expression.kind === 'json-has' ||
        expression.kind === 'json-delete' ||
        expression.kind === 'json-keys' ||
        expression.kind === 'json-length') {
        requireJsonValue(validateExpression(expression.root, bindings, context), context, expression.sourceRef, 'Structured Data root');
    }
    if (expression.kind === 'json-set') {
        requireJsonValue(validateExpression(expression.root, bindings, context), context, expression.sourceRef, 'Structured Data root');
        requireJsonValue(validateExpression(expression.value, bindings, context), context, expression.sourceRef, 'Structured Data replacement');
    }
    if (expression.kind === 'iteration-key' ||
        expression.kind === 'iteration-index' ||
        expression.kind === 'iteration-value') {
        if (!context.iterationLoopIds.has(expression.loopId)) {
            report(context, 'TW2_ITERATION_CONTEXT_REQUIRED', `Iteration reporter references inactive loop ${expression.loopId}.`, 'Iteration reporters are valid only inside the lexical body of their Structured Data loop.', 'Bind the reporter to the nearest enclosing json-for-each loop.', expression.sourceRef);
        }
    }
    if (expression.kind === 'binding') {
        const declared = bindings.get(expression.binding);
        if (declared === undefined) {
            report(context, 'TW2_BINDING_UNDECLARED', `Binding ${expression.binding} is not declared in this lexical scope.`, 'Typed bindings are compiler-assigned and scoped to their declaring control-flow region.', 'Use the binding only after its producer and inside the same lexical scope.', expression.sourceRef);
        }
        else if (declared.kind !== 'value' || !sameValueType(declared.valueType, expression.valueType)) {
            report(context, 'TW2_BINDING_TYPE_MISMATCH', `Binding ${expression.binding} does not match the expression value type.`, 'Value bindings and resource bindings are distinct and cannot be substituted.', 'Use the declared value type, or pass a binary-body only to a resource consumer.', expression.sourceRef);
        }
    }
    return expression.valueType;
}
function declareBinding(declaration, expected, bindings, context, sourceRef) {
    if (bindings.has(declaration.id)) {
        report(context, 'TW2_BINDING_DUPLICATE', `Binding ${declaration.id} is already declared in this scope.`, 'Compiler-generated binding IDs must be unique along a control-flow path.', 'Allocate a new lexical binding ID.', sourceRef);
        return;
    }
    if (!sameBindingType(declaration.type, expected)) {
        report(context, 'TW2_BINDING_TYPE_MISMATCH', `Binding ${declaration.id} has an invalid result type for its producer.`, 'The declared binding type must match the operation result contract.', 'Use the producer result type defined by IR v2.', sourceRef);
    }
    bindings.set(declaration.id, expected);
}
function mergeBranchFlows(base, thenFlow, elseFlow, context, sourceRef) {
    const mayContinue = thenFlow.mayContinue || elseFlow.mayContinue;
    const mayTerminate = thenFlow.mayTerminate || elseFlow.mayTerminate;
    if (!mayContinue)
        return { mayContinue, mayTerminate, bindings: cloneBindings(base) };
    if (thenFlow.mayContinue && !elseFlow.mayContinue)
        return { mayContinue, mayTerminate, bindings: thenFlow.bindings };
    if (!thenFlow.mayContinue && elseFlow.mayContinue)
        return { mayContinue, mayTerminate, bindings: elseFlow.bindings };
    const merged = cloneBindings(base);
    const names = new Set([...thenFlow.bindings.keys(), ...elseFlow.bindings.keys()]);
    for (const name of names) {
        if (base.has(name))
            continue;
        const thenType = thenFlow.bindings.get(name);
        const elseType = elseFlow.bindings.get(name);
        if (thenType === undefined || elseType === undefined || !sameBindingType(thenType, elseType)) {
            report(context, 'TW2_BRANCH_BINDING_MISMATCH', `Binding ${name} is not declared with the same type in both continuing branches.`, 'A binding used after an if must exist consistently on every path that reaches the merge point.', 'Declare matching bindings in both branches or keep their use inside each branch.', sourceRef);
            continue;
        }
        merged.set(name, thenType);
    }
    return { mayContinue, mayTerminate, bindings: merged };
}
function requireCapability(capability, context, sourceRef) {
    const key = capabilityKey(capability);
    if (context.capabilities.has(key))
        return;
    report(context, 'TW2_CAPABILITY_MISSING', `IR operation requires undeclared capability ${key}.`, 'Target-neutral capability requirements must be complete before adapter selection.', 'Add the logical capability to IR.capabilities.', sourceRef);
}
function requireScratchScalar(type, context, sourceRef, subject) {
    const members = valueTypeMembers(type);
    if (members.every((member) => member === 'string' || member === 'number' || member === 'boolean'))
        return;
    report(context, 'TW2_HANDLER_VARIABLE_TYPE', `${subject} must use a Scratch-compatible scalar value.`, 'JSON, binary-ref, and resource state belong in typed lexical bindings.', 'Convert to a scalar or use a compiler-generated typed binding.', sourceRef);
}
function requireValueType(actual, expected, context, sourceRef, subject) {
    if (sameValueType(actual, expected))
        return;
    report(context, 'TW2_BINDING_TYPE_MISMATCH', `${subject} has an incompatible value type.`, 'IR v2 keeps json-text and typed JSON values as distinct nominal boundaries.', 'Insert the required parse, serialize, or json-text coercion node.', sourceRef);
}
function requireJsonValue(actual, context, sourceRef, subject) {
    const allowed = new Set(['null', 'boolean', 'number', 'string', 'json-array', 'json-object']);
    if (valueTypeMembers(actual).every((member) => allowed.has(member)))
        return;
    report(context, 'TW2_BINDING_TYPE_MISMATCH', `${subject} must be a typed JSON value.`, 'json-text and binary references cannot be used as parsed JSON values.', 'Parse json-text before using the value in a Structured Data operation.', sourceRef);
}
function sequenceWork(statements, limit) {
    let total = 0;
    for (const statement of statements) {
        total = saturatedAdd(total, statementWork(statement, limit), limit);
    }
    return total;
}
function statementWork(statement, limit) {
    if (statement.kind === 'if') {
        const branches = Math.max(sequenceWork(statement.then, limit), sequenceWork(statement.else ?? [], limit));
        return saturatedAdd(saturatedAdd(1, expressionWork(statement.condition, limit), limit), branches, limit);
    }
    if (statement.kind === 'bounded-loop' || statement.kind === 'json-for-each') {
        const rootWork = statement.kind === 'json-for-each' ? expressionWork(statement.root, limit) : 0;
        return saturatedAdd(saturatedAdd(1, rootWork, limit), saturatedMultiply(statement.maxIterations, sequenceWork(statement.body, limit), limit), limit);
    }
    let work = 1;
    if (statement.kind === 'set-header')
        work = saturatedAdd(work, expressionWork(statement.value, limit), limit);
    if (statement.kind === 'set-handler-variable' || statement.kind === 'change-handler-variable') {
        work = saturatedAdd(work, expressionWork(statement.name, limit), limit);
        work = saturatedAdd(work, expressionWork(statement.value, limit), limit);
    }
    if (statement.kind === 'delete-handler-variable')
        work = saturatedAdd(work, expressionWork(statement.name, limit), limit);
    if (statement.kind === 'record-create')
        work = saturatedAdd(work, expressionWork(statement.data, limit), limit);
    if (statement.kind === 'record-get' || statement.kind === 'record-delete') {
        work = saturatedAdd(work, expressionWork(statement.id, limit), limit);
    }
    if (statement.kind === 'respond')
        work = saturatedAdd(work, expressionWork(statement.body, limit), limit);
    return work;
}
function expressionWork(expression, limit) {
    if (expression.kind === 'concat') {
        return saturatedAdd(saturatedAdd(1, expressionWork(expression.left, limit), limit), expressionWork(expression.right, limit), limit);
    }
    if (expression.kind === 'handler-variable' || expression.kind === 'handler-variable-exists') {
        return saturatedAdd(1, expressionWork(expression.name, limit), limit);
    }
    if (expression.kind === 'json-text-coerce') {
        return saturatedAdd(1, expressionWork(expression.input, limit), limit);
    }
    if (expression.kind === 'json-parse' || expression.kind === 'json-is-valid') {
        return saturatedAdd(1, expressionWork(expression.text, limit), limit);
    }
    if (expression.kind === 'json-stringify') {
        return saturatedAdd(1, expressionWork(expression.value, limit), limit);
    }
    if (expression.kind === 'json-get' ||
        expression.kind === 'json-has' ||
        expression.kind === 'json-delete' ||
        expression.kind === 'json-keys' ||
        expression.kind === 'json-length') {
        return saturatedAdd(1, expressionWork(expression.root, limit), limit);
    }
    if (expression.kind === 'json-set') {
        return saturatedAdd(saturatedAdd(1, expressionWork(expression.root, limit), limit), expressionWork(expression.value, limit), limit);
    }
    return 1;
}
function saturatedAdd(left, right, limit) {
    return left > limit || right > limit || left + right > limit ? limit + 1 : left + right;
}
function saturatedMultiply(left, right, limit) {
    if (left < 0 || right < 0 || left > limit || right > limit || left * right > limit)
        return limit + 1;
    return left * right;
}
function capabilityKey(capability) {
    if (capability.kind === 'record-store')
        return capability.kind;
    return `${capability.kind}:${capability.kind === 'auth' ? capability.scheme : capability.field}`;
}
function cloneBindings(bindings) {
    return new Map(bindings);
}
function sameBindingType(left, right) {
    if (left.kind !== right.kind)
        return false;
    return left.kind === 'resource'
        ? right.kind === 'resource' && left.resourceType === right.resourceType
        : right.kind === 'value' && sameValueType(left.valueType, right.valueType);
}
function sameValueType(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function valueTypeMembers(type) {
    return typeof type === 'string' ? [type] : type.members;
}
function report(context, code, message, reason, suggestion, sourceRef) {
    const diagnostic = {
        severity: 'error',
        phase: 'target-neutral',
        code,
        message,
        routeId: context.route.id,
        reason,
        suggestion
    };
    if (sourceRef !== undefined)
        diagnostic.sourceRef = sourceRef;
    context.diagnostics.push(diagnostic);
}
//# sourceMappingURL=ir-validator.js.map