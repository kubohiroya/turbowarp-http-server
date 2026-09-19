import { extensionConfig } from '../config.js';
import { DEPLOY_IR_V2_VERSION } from './ir-v2/types.js';
import { lowerNamedBodyResponse } from './named-body/lowering.js';
import { StructuredDataLoweringContext } from './structured-data/lowering.js';
import { validateTurboWarpServerSubset } from './validator/turbowarp-subset.js';
const PREFIX = `${extensionConfig.id}_`;
const HAT_OPCODE = `${PREFIX}whenHttpRequestReceived`;
const NAMED_RESPONSE_OPCODE = `${PREFIX}respondWithNamedBody`;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
/** Compiles the locked server-executable TurboWarp subset directly into typed IR v2. */
export function compileTurboWarpProjectV2(value, registry) {
    const subsetDiagnostics = validateTurboWarpServerSubset(value, registry).map(toCompilerDiagnostic);
    if (subsetDiagnostics.length > 0)
        return { ir: emptyIr(), diagnostics: subsetDiagnostics };
    const project = object(value);
    if (!Array.isArray(project.targets))
        throw new Error('TurboWarp project.targets must be an array.');
    const diagnostics = [];
    const capabilities = [];
    const routes = [];
    const structured = new StructuredDataLoweringContext();
    let discoveredHandlers = 0;
    project.targets.forEach((rawTarget, targetIndex) => {
        const target = object(rawTarget);
        const targetName = typeof target.name === 'string' ? target.name : `target-${targetIndex}`;
        const blocks = blockMap(target.blocks);
        const path = target.isStage === true ? '/' : `/${routeSegment(targetName)}`;
        const context = {
            blocks,
            targetIndex,
            targetName,
            ...(registry === undefined ? {} : { registry }),
            diagnostics,
            capabilities
        };
        for (const [hatId, hat] of Object.entries(blocks)) {
            if (hat.opcode !== HAT_OPCODE || hat.topLevel !== true)
                continue;
            discoveredHandlers += 1;
            const firstId = blockId(hat.next);
            const hatSource = sourceRef(context, hatId, HAT_OPCODE);
            if (firstId === null) {
                report(context, 'TW2_EMPTY_HANDLER', 'HTTP request hat has no handler body.', hatSource);
                continue;
            }
            const first = blocks[firstId];
            const route = first?.opcode === 'control_if'
                ? compileMethodGuard(context, firstId, path, hatSource, routes.length, structured)
                : compileRouteBody(context, firstId, 'ALL', path, hatSource, routes.length, structured);
            if (route !== null)
                routes.push(route);
        }
    });
    diagnostics.push(...structured.diagnostics);
    if (discoveredHandlers === 0) {
        diagnostics.push({
            severity: 'error',
            code: 'TW2_NO_ROUTES',
            message: 'No compilable HTTP request handlers were found.'
        });
    }
    rejectDuplicateRoutes(routes, diagnostics);
    return {
        ir: {
            version: DEPLOY_IR_V2_VERSION,
            name: 'turbowarp-worker',
            auth: { kind: 'none' },
            capabilities: deduplicateCapabilities(capabilities),
            routes
        },
        diagnostics
    };
}
function compileMethodGuard(context, guardId, path, hatSource, routeIndex, structured) {
    const guard = context.blocks[guardId];
    if (guard === undefined)
        return null;
    const inputs = inputMap(guard.inputs);
    const conditionId = inputBlockId(inputs.CONDITION);
    const bodyId = inputBlockId(inputs.SUBSTACK);
    const method = conditionId === null ? null : readMethodCondition(context.blocks, conditionId);
    if (method === null || bodyId === null) {
        report(context, 'TW2_UNSUPPORTED_GUARD', 'Top-level control_if must compare current HTTP method with GET, POST, PUT, PATCH, DELETE, or OPTIONS.', sourceRef(context, guardId, 'control_if'));
        return null;
    }
    if (blockId(guard.next) !== null) {
        report(context, 'TW2_UNSUPPORTED_CONTROL_FLOW', 'A method guard must be the only command after the HTTP request hat.', sourceRef(context, guardId, 'control_if'));
        return null;
    }
    return compileRouteBody(context, bodyId, method, path, hatSource, routeIndex, structured);
}
function compileRouteBody(context, firstId, method, path, hatSource, routeIndex, structured) {
    const body = compileStack(context, firstId, structured, true);
    if (body === null)
        return null;
    return {
        id: routeId(context.targetName, method.toLowerCase(), routeIndex),
        method,
        path,
        auth: 'public',
        body,
        sourceRef: hatSource
    };
}
function compileStack(context, firstId, structured, requireResponse) {
    const statements = [];
    const visited = new Set();
    let id = firstId;
    while (id !== null) {
        if (visited.has(id)) {
            report(context, 'TW2_BLOCK_CYCLE', 'Handler block chain contains a cycle.', blockSource(context, id));
            return null;
        }
        visited.add(id);
        const block = context.blocks[id];
        if (block === undefined || typeof block.opcode !== 'string') {
            report(context, 'TW2_MISSING_BLOCK', `Handler references missing block ${id}.`, sourceRef(context, id, '<missing>'));
            return null;
        }
        const statement = compileStatement(context, id, block, structured);
        if (statement === null)
            return null;
        statements.push(statement);
        id = blockId(block.next);
    }
    const responseIndex = statements.findIndex(isTerminalResponse);
    if (requireResponse && responseIndex < 0) {
        report(context, 'TW2_MISSING_RESPONSE', 'Every handler must end with a response block.', blockSource(context, firstId));
        return null;
    }
    if (responseIndex >= 0 && responseIndex !== statements.length - 1) {
        report(context, 'TW2_RESPONSE_NOT_LAST', 'The response block must be the final command.', blockSource(context, firstId));
        return null;
    }
    return statements;
}
function compileStatement(context, id, block, structured) {
    const opcode = block.opcode;
    const inputs = inputMap(block.inputs);
    const source = sourceRef(context, id, opcode);
    if (opcode === 'control_repeat') {
        const count = integerLiteral(inputs.TIMES);
        const bodyId = inputBlockId(inputs.SUBSTACK);
        if (count === null || count < 0 || count > 1000) {
            report(context, 'TW2_LOOP_BOUND_INVALID', 'repeat requires an integer literal from 0 to 1000.', source);
            return null;
        }
        const body = bodyId === null ? [] : compileStack(context, bodyId, structured, false);
        return body === null ? null : { kind: 'bounded-loop', maxIterations: count, body, sourceRef: source };
    }
    const manifestEntry = context.registry?.byProjectOpcode.get(opcode);
    if (manifestEntry?.block.blockType === 'LOOP') {
        const bodyId = inputBlockId(inputs.SUBSTACK);
        const args = compileManifestArguments(context, manifestEntry, inputs, id, structured);
        if (args === null)
            return null;
        let bodyFailed = false;
        const statement = structured.lowerForEach(manifestEntry, args, source, (nested) => {
            const body = bodyId === null ? [] : compileStack(context, bodyId, nested, false);
            if (body === null) {
                bodyFailed = true;
                return [];
            }
            return body;
        });
        return bodyFailed || statement === undefined ? null : statement;
    }
    if (opcode === `${PREFIX}setHttpStatus`) {
        const status = Number(literalValue(inputs.STATUS));
        if (!Number.isInteger(status) || status < 100 || status > 599) {
            report(context, 'TW2_DYNAMIC_STATUS', 'HTTP status must be a literal integer from 100 to 599.', source);
            return null;
        }
        return { kind: 'set-status', status, sourceRef: source };
    }
    if (opcode === `${PREFIX}setResponseHeader`) {
        const name = literalValue(inputs.NAME).trim().toLowerCase();
        if (!safeHeader(name)) {
            report(context, 'TW2_UNSAFE_HEADER', `Unsafe or runtime-owned response header: ${name}`, source);
            return null;
        }
        const value = compileExpression(context, inputs.VALUE, id, structured);
        return value === null ? null : { kind: 'set-header', name, value, sourceRef: source };
    }
    if (opcode === `${PREFIX}removeResponseHeader`) {
        const name = literalValue(inputs.NAME).trim().toLowerCase();
        if (!safeHeader(name)) {
            report(context, 'TW2_UNSAFE_HEADER', `Unsafe or runtime-owned response header: ${name}`, source);
            return null;
        }
        return { kind: 'remove-header', name, sourceRef: source };
    }
    if (opcode === `${PREFIX}setHandlerVariable` || opcode === `${PREFIX}changeHandlerVariable`) {
        const name = compileExpression(context, inputs.NAME, id, structured);
        const value = compileExpression(context, opcode === `${PREFIX}setHandlerVariable` ? inputs.VALUE : inputs.AMOUNT, id, structured);
        if (name === null || value === null)
            return null;
        return {
            kind: opcode === `${PREFIX}setHandlerVariable` ? 'set-handler-variable' : 'change-handler-variable',
            name,
            value,
            sourceRef: source
        };
    }
    if (opcode === `${PREFIX}deleteHandlerVariable`) {
        const name = compileExpression(context, inputs.NAME, id, structured);
        return name === null ? null : { kind: 'delete-handler-variable', name, sourceRef: source };
    }
    if (opcode === `${PREFIX}clearHandlerVariables`)
        return { kind: 'clear-handler-variables', sourceRef: source };
    if (opcode === NAMED_RESPONSE_OPCODE) {
        const lowered = lowerNamedBodyResponse(namedArguments(inputs, source), source);
        context.diagnostics.push(...lowered.diagnostics);
        if (lowered.statement !== undefined)
            addCapability(context, { kind: 'named-body-provider' });
        return lowered.statement ?? null;
    }
    const responseFormats = {
        [`${PREFIX}respondWithText`]: 'text',
        [`${PREFIX}respondWithHtml`]: 'html',
        [`${PREFIX}respondWithJson`]: 'json',
        [`${PREFIX}sendResponse`]: 'text'
    };
    const format = responseFormats[opcode];
    if (format !== undefined) {
        const body = compileExpression(context, inputs.BODY, id, structured);
        return body === null ? null : { kind: 'respond', format, body, sourceRef: source };
    }
    report(context, 'TW2_UNSUPPORTED_COMMAND', `Unsupported command block: ${opcode}`, source);
    return null;
}
function compileExpression(context, input, ownerId, structured) {
    const reporterId = inputBlockId(input);
    if (reporterId === null)
        return literal('string', literalValue(input), blockSource(context, ownerId));
    const reporter = context.blocks[reporterId];
    if (reporter === undefined || typeof reporter.opcode !== 'string') {
        report(context, 'TW2_MISSING_REPORTER', `Expression references missing block ${reporterId}.`, blockSource(context, ownerId));
        return null;
    }
    const source = sourceRef(context, reporterId, reporter.opcode);
    const inputs = inputMap(reporter.inputs);
    const simpleSources = {
        [`${PREFIX}currentHttpMethod`]: 'method',
        [`${PREFIX}currentRequestPath`]: 'path',
        [`${PREFIX}currentRequestUrl`]: 'url',
        [`${PREFIX}currentRequestBody`]: 'body-text',
        [`${PREFIX}currentRequestContentType`]: 'content-type',
        [`${PREFIX}currentRequestClientAddress`]: 'client-address'
    };
    const requestSource = simpleSources[reporter.opcode];
    if (requestSource !== undefined) {
        if (requestSource === 'client-address')
            addCapability(context, { kind: 'request-metadata', field: 'client-address' });
        return { kind: 'request', valueType: 'string', source: requestSource, sourceRef: source };
    }
    const namedSources = {
        [`${PREFIX}queryParameter`]: 'query',
        [`${PREFIX}pathParameter`]: 'path-param',
        [`${PREFIX}requestHeader`]: 'header'
    };
    const namedSource = namedSources[reporter.opcode];
    if (namedSource !== undefined) {
        if (inputBlockId(inputs.NAME) !== null) {
            report(context, 'TW2_DYNAMIC_LOOKUP_NAME', 'Request lookup names must be non-empty literals.', source);
            return null;
        }
        const name = literalValue(inputs.NAME);
        if (name.length === 0) {
            report(context, 'TW2_DYNAMIC_LOOKUP_NAME', 'Request lookup names must be non-empty literals.', source);
            return null;
        }
        return { kind: 'request-value', valueType: 'string', source: namedSource, name, sourceRef: source };
    }
    if (reporter.opcode === 'operator_join') {
        const left = compileExpression(context, inputs.STRING1, reporterId, structured);
        const right = compileExpression(context, inputs.STRING2, reporterId, structured);
        return left === null || right === null
            ? null
            : { kind: 'concat', valueType: 'string', left, right, sourceRef: source };
    }
    if (reporter.opcode === `${PREFIX}handlerVariable` || reporter.opcode === `${PREFIX}handlerVariableExists`) {
        const name = compileExpression(context, inputs.NAME, reporterId, structured);
        if (name === null)
            return null;
        return reporter.opcode === `${PREFIX}handlerVariable`
            ? { kind: 'handler-variable', valueType: { kind: 'union', members: ['number', 'string'] }, name, sourceRef: source }
            : { kind: 'handler-variable-exists', valueType: 'boolean', name, sourceRef: source };
    }
    if (reporter.opcode === `${PREFIX}listHandlerVariables`) {
        return { kind: 'handler-variable-names', valueType: 'string', sourceRef: source };
    }
    const manifestEntry = context.registry?.byProjectOpcode.get(reporter.opcode);
    if (manifestEntry !== undefined) {
        const args = compileManifestArguments(context, manifestEntry, inputs, reporterId, structured);
        return args === null ? null : (structured.lowerReporter(manifestEntry, args, source) ?? null);
    }
    report(context, 'TW2_UNSUPPORTED_REPORTER', `Unsupported reporter block: ${reporter.opcode}`, source);
    return null;
}
function compileManifestArguments(context, entry, inputs, ownerId, structured) {
    const args = {};
    for (const argument of entry.block.arguments) {
        const input = inputs[argument.id];
        if (argument.type === 'NUMBER' && inputBlockId(input) === null) {
            args[argument.id] = literal('number', Number(literalValue(input)), undefined);
            continue;
        }
        const expression = compileExpression(context, input, ownerId, structured);
        if (expression === null)
            return null;
        args[argument.id] = expression;
    }
    return args;
}
function readMethodCondition(blocks, id) {
    const condition = blocks[id];
    if (condition?.opcode !== 'operator_equals')
        return null;
    const inputs = inputMap(condition.inputs);
    for (const [reporterInput, literalInput] of [
        [inputs.OPERAND1, inputs.OPERAND2],
        [inputs.OPERAND2, inputs.OPERAND1]
    ]) {
        const reporterId = inputBlockId(reporterInput);
        const reporter = reporterId === null ? undefined : blocks[reporterId];
        if (reporter?.opcode !== `${PREFIX}currentHttpMethod`)
            continue;
        const method = literalValue(literalInput).toUpperCase();
        if (METHODS.has(method))
            return method;
    }
    return null;
}
function namedArguments(inputs, source) {
    return {
        NAMESPACE: scratchLiteral(inputs.NAMESPACE, 'string', source),
        NAME: scratchLiteral(inputs.NAME, 'string', source),
        KIND: scratchLiteral(inputs.KIND, 'string', source),
        SCOPE: scratchLiteral(inputs.SCOPE, 'string', source),
        TARGET_ID: scratchLiteral(inputs.TARGET_ID, 'string', source),
        REPRESENTATION: scratchLiteral(inputs.REPRESENTATION, 'string', source),
        MAX_BYTES: scratchLiteral(inputs.MAX_BYTES, 'number', source)
    };
}
function scratchLiteral(input, expected, source) {
    if (inputBlockId(input) !== null)
        return { kind: 'request', valueType: 'string', source: 'path', sourceRef: source };
    const raw = literalValue(input);
    return expected === 'number' ? literal('number', Number(raw), source) : literal('string', raw, source);
}
function literal(valueType, value, source) {
    return { kind: 'literal', valueType, value, ...(source === undefined ? {} : { sourceRef: source }) };
}
function integerLiteral(input) {
    if (inputBlockId(input) !== null)
        return null;
    const raw = literalValue(input);
    if (!/^-?\d+$/u.test(raw))
        return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : null;
}
function isTerminalResponse(statement) {
    return statement.kind === 'respond' || statement.kind === 'respond-binary' || statement.kind === 'respond-named-body';
}
function rejectDuplicateRoutes(routes, diagnostics) {
    const seen = new Set();
    for (const route of routes) {
        const key = `${route.method} ${route.path}`;
        if (seen.has(key)) {
            diagnostics.push({
                severity: 'error',
                code: 'TW2_DUPLICATE_ROUTE',
                message: `Duplicate route: ${key}`,
                ...(route.sourceRef === undefined ? {} : { sourceRef: route.sourceRef })
            });
        }
        seen.add(key);
    }
}
function deduplicateCapabilities(capabilities) {
    const entries = new Map();
    for (const capability of capabilities)
        entries.set(capabilityKey(capability), capability);
    return [...entries.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, capability]) => capability);
}
function addCapability(context, capability) {
    context.capabilities.push(capability);
}
function report(context, code, message, source) {
    context.diagnostics.push({ severity: 'error', code, message, ...(source === undefined ? {} : { sourceRef: source }) });
}
function sourceRef(context, blockIdValue, opcode) {
    return { targetIndex: context.targetIndex, targetName: context.targetName, blockId: blockIdValue, opcode };
}
function blockSource(context, id) {
    const opcode = context.blocks[id]?.opcode;
    return sourceRef(context, id, typeof opcode === 'string' ? opcode : '<missing>');
}
function emptyIr() {
    return { version: DEPLOY_IR_V2_VERSION, name: 'turbowarp-worker', auth: { kind: 'none' }, capabilities: [], routes: [] };
}
function capabilityKey(value) {
    return JSON.stringify(value);
}
function safeHeader(name) {
    return (/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name) &&
        !['connection', 'content-length', 'transfer-encoding', 'upgrade'].includes(name));
}
function routeSegment(name) {
    const normalized = name.normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, '-');
    return normalized.replace(/^-+|-+$/gu, '') || 'sprite';
}
function routeId(target, method, index) {
    return `${routeSegment(target)}-${method}-${index + 1}`;
}
function inputBlockId(value) {
    if (!Array.isArray(value))
        return null;
    return typeof value[1] === 'string' ? value[1] : null;
}
function literalValue(value) {
    if (!Array.isArray(value))
        return '';
    const primary = value[1];
    if (Array.isArray(primary))
        return String(primary[1] ?? '');
    const shadow = value[2];
    if (Array.isArray(shadow))
        return String(shadow[1] ?? '');
    return typeof primary === 'number' || typeof primary === 'boolean' ? String(primary) : '';
}
function inputMap(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
function blockMap(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}
function blockId(value) {
    return typeof value === 'string' ? value : null;
}
function object(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('TurboWarp project value must be an object.');
    }
    return value;
}
function toCompilerDiagnostic(diagnostic) {
    return {
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        ...(diagnostic.sourceRef === undefined ? {} : { sourceRef: diagnostic.sourceRef })
    };
}
//# sourceMappingURL=turbowarp-v2.js.map