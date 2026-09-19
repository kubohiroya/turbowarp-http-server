import { extensionConfig } from '../config.js';
import { DEPLOY_IR_VERSION } from './ir.js';
const EXTENSION_PREFIX = `${extensionConfig.id}_`;
const HAT_OPCODE = `${EXTENSION_PREFIX}whenHttpRequestReceived`;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
export function compileTurboWarpProject(value) {
    const project = requireObject(value, 'TurboWarp project');
    if (!Array.isArray(project.targets))
        throw new Error('TurboWarp project.targets must be an array.');
    const diagnostics = [];
    const routes = [];
    const projectName = 'turbowarp-worker';
    for (const rawTarget of project.targets) {
        const target = requireObject(rawTarget, 'project target');
        const targetName = typeof target.name === 'string' ? target.name : 'unnamed';
        const blocks = requireBlockMap(target.blocks, targetName);
        const path = target.isStage === true ? '/' : `/${routeSegment(targetName)}`;
        const hats = Object.entries(blocks).filter(([, block]) => block.opcode === HAT_OPCODE && block.topLevel === true);
        for (const [hatId, hat] of hats) {
            const firstId = blockId(hat.next);
            if (firstId === null) {
                diagnostics.push(error('TW_EMPTY_HANDLER', 'HTTP request hat has no handler body.', targetName, hatId));
                continue;
            }
            const first = blocks[firstId];
            if (first?.opcode === 'control_if') {
                const route = compileMethodGuard(blocks, firstId, path, targetName, diagnostics, routes.length);
                if (route)
                    routes.push(route);
            }
            else {
                const actions = compileStack(blocks, firstId, targetName, diagnostics);
                if (actions) {
                    routes.push({
                        id: routeId(targetName, 'all', routes.length),
                        method: 'ALL',
                        path,
                        auth: 'public',
                        actions
                    });
                }
            }
        }
    }
    if (routes.length === 0) {
        diagnostics.push({
            severity: 'error',
            code: 'TW_NO_ROUTES',
            message: 'No compilable HTTP request handlers were found.'
        });
    }
    rejectDuplicateRoutes(routes, diagnostics);
    const ir = { version: DEPLOY_IR_VERSION, name: projectName, auth: 'none', routes };
    return { ir, diagnostics };
}
function compileMethodGuard(blocks, blockIdValue, path, target, diagnostics, index) {
    const block = blocks[blockIdValue];
    if (!block)
        return null;
    const inputs = inputMap(block.inputs);
    const conditionId = inputBlockId(inputs.CONDITION);
    const bodyId = inputBlockId(inputs.SUBSTACK);
    const method = conditionId === null ? null : readMethodCondition(blocks, conditionId);
    if (method === null || bodyId === null) {
        diagnostics.push(error('TW_UNSUPPORTED_GUARD', 'Top-level control_if must compare current HTTP method with GET, POST, PUT, PATCH, DELETE, or OPTIONS.', target, blockIdValue));
        return null;
    }
    if (blockId(block.next) !== null) {
        diagnostics.push(error('TW_UNSUPPORTED_CONTROL_FLOW', 'A method guard must be the only command after the HTTP request hat.', target, blockIdValue));
        return null;
    }
    const actions = compileStack(blocks, bodyId, target, diagnostics);
    if (!actions)
        return null;
    return { id: routeId(target, method.toLowerCase(), index), method, path, auth: 'public', actions };
}
function readMethodCondition(blocks, id) {
    const condition = blocks[id];
    if (condition?.opcode !== 'operator_equals')
        return null;
    const inputs = inputMap(condition.inputs);
    const pairs = [
        [inputs.OPERAND1, inputs.OPERAND2],
        [inputs.OPERAND2, inputs.OPERAND1]
    ];
    for (const [reporterInput, literalInput] of pairs) {
        const reporterId = inputBlockId(reporterInput);
        const reporter = reporterId === null ? undefined : blocks[reporterId];
        if (reporter?.opcode !== `${EXTENSION_PREFIX}currentHttpMethod`)
            continue;
        const method = literalValue(literalInput).toUpperCase();
        if (METHODS.has(method))
            return method;
    }
    return null;
}
function compileStack(blocks, firstId, target, diagnostics) {
    const actions = [];
    const visited = new Set();
    let id = firstId;
    while (id !== null) {
        if (visited.has(id)) {
            diagnostics.push(error('TW_BLOCK_CYCLE', 'Handler block chain contains a cycle.', target, id));
            return null;
        }
        visited.add(id);
        const block = blocks[id];
        if (!block || typeof block.opcode !== 'string') {
            diagnostics.push(error('TW_MISSING_BLOCK', `Handler references missing block ${id}.`, target, id));
            return null;
        }
        const action = compileAction(blocks, block, target, id, diagnostics);
        if (action === null)
            return null;
        actions.push(action);
        id = blockId(block.next);
    }
    if (!actions.some((action) => action.kind === 'respond')) {
        diagnostics.push(error('TW_MISSING_RESPONSE', 'Every handler must end with a response block.', target, firstId));
        return null;
    }
    if (actions.findIndex((action) => action.kind === 'respond') !== actions.length - 1) {
        diagnostics.push(error('TW_RESPONSE_NOT_LAST', 'The response block must be the final command.', target, firstId));
        return null;
    }
    return actions;
}
function compileAction(blocks, block, target, id, diagnostics) {
    const opcode = block.opcode;
    const inputs = inputMap(block.inputs);
    if (opcode === `${EXTENSION_PREFIX}setHttpStatus`) {
        const status = Number(literalValue(inputs.STATUS));
        if (!Number.isInteger(status) || status < 100 || status > 599) {
            diagnostics.push(error('TW_DYNAMIC_STATUS', 'HTTP status must be a literal integer from 100 to 599.', target, id));
            return null;
        }
        return { kind: 'set-status', status };
    }
    if (opcode === `${EXTENSION_PREFIX}setResponseHeader`) {
        const name = literalValue(inputs.NAME).trim().toLowerCase();
        if (!safeHeader(name)) {
            diagnostics.push(error('TW_UNSAFE_HEADER', `Unsafe or runtime-owned response header: ${name}`, target, id));
            return null;
        }
        const value = compileExpression(blocks, inputs.VALUE, target, id, diagnostics);
        return value ? { kind: 'set-header', name, value } : null;
    }
    if (opcode === `${EXTENSION_PREFIX}removeResponseHeader`) {
        const name = literalValue(inputs.NAME).trim().toLowerCase();
        if (!safeHeader(name)) {
            diagnostics.push(error('TW_UNSAFE_HEADER', `Unsafe or runtime-owned response header: ${name}`, target, id));
            return null;
        }
        return { kind: 'remove-header', name };
    }
    if (opcode === `${EXTENSION_PREFIX}setHandlerVariable`) {
        const name = compileExpression(blocks, inputs.NAME, target, id, diagnostics);
        const value = compileExpression(blocks, inputs.VALUE, target, id, diagnostics);
        return name && value ? { kind: 'set-handler-variable', name, value } : null;
    }
    if (opcode === `${EXTENSION_PREFIX}changeHandlerVariable`) {
        const name = compileExpression(blocks, inputs.NAME, target, id, diagnostics);
        const value = compileExpression(blocks, inputs.AMOUNT, target, id, diagnostics);
        return name && value ? { kind: 'change-handler-variable', name, value } : null;
    }
    if (opcode === `${EXTENSION_PREFIX}deleteHandlerVariable`) {
        const name = compileExpression(blocks, inputs.NAME, target, id, diagnostics);
        return name ? { kind: 'delete-handler-variable', name } : null;
    }
    if (opcode === `${EXTENSION_PREFIX}clearHandlerVariables`) {
        return { kind: 'clear-handler-variables' };
    }
    const responseFormats = {
        [`${EXTENSION_PREFIX}respondWithText`]: 'text',
        [`${EXTENSION_PREFIX}respondWithHtml`]: 'html',
        [`${EXTENSION_PREFIX}respondWithJson`]: 'json',
        [`${EXTENSION_PREFIX}sendResponse`]: 'text'
    };
    const format = responseFormats[opcode];
    if (format) {
        const body = compileExpression(blocks, inputs.BODY, target, id, diagnostics);
        return body ? { kind: 'respond', format, body } : null;
    }
    diagnostics.push(error('TW_UNSUPPORTED_COMMAND', `Unsupported command block: ${opcode}`, target, id));
    return null;
}
function compileExpression(blocks, input, target, ownerId, diagnostics) {
    const reporterId = inputBlockId(input);
    if (reporterId === null)
        return { kind: 'literal', value: literalValue(input) };
    const reporter = blocks[reporterId];
    if (!reporter || typeof reporter.opcode !== 'string') {
        diagnostics.push(error('TW_MISSING_REPORTER', `Expression references missing block ${reporterId}.`, target, ownerId));
        return null;
    }
    const simpleSources = {
        [`${EXTENSION_PREFIX}currentHttpMethod`]: 'method',
        [`${EXTENSION_PREFIX}currentRequestPath`]: 'path',
        [`${EXTENSION_PREFIX}currentRequestUrl`]: 'url',
        [`${EXTENSION_PREFIX}currentRequestBody`]: 'body',
        [`${EXTENSION_PREFIX}currentRequestContentType`]: 'content-type',
        [`${EXTENSION_PREFIX}currentRequestClientAddress`]: 'client-address'
    };
    const source = simpleSources[reporter.opcode];
    if (source)
        return { kind: 'request', source };
    const namedSources = {
        [`${EXTENSION_PREFIX}queryParameter`]: 'query',
        [`${EXTENSION_PREFIX}pathParameter`]: 'path-param',
        [`${EXTENSION_PREFIX}requestHeader`]: 'header'
    };
    const namedSource = namedSources[reporter.opcode];
    if (namedSource) {
        const name = literalValue(inputMap(reporter.inputs).NAME);
        if (name.length === 0) {
            diagnostics.push(error('TW_DYNAMIC_LOOKUP_NAME', 'Request lookup names must be non-empty literals.', target, reporterId));
            return null;
        }
        return { kind: 'request-value', source: namedSource, name };
    }
    if (reporter.opcode === 'operator_join') {
        const inputs = inputMap(reporter.inputs);
        const left = compileExpression(blocks, inputs.STRING1, target, reporterId, diagnostics);
        const right = compileExpression(blocks, inputs.STRING2, target, reporterId, diagnostics);
        return left && right ? { kind: 'concat', left, right } : null;
    }
    if (reporter.opcode === `${EXTENSION_PREFIX}handlerVariable` ||
        reporter.opcode === `${EXTENSION_PREFIX}handlerVariableExists`) {
        const name = compileExpression(blocks, inputMap(reporter.inputs).NAME, target, reporterId, diagnostics);
        if (!name)
            return null;
        return reporter.opcode === `${EXTENSION_PREFIX}handlerVariable`
            ? { kind: 'handler-variable', name }
            : { kind: 'handler-variable-exists', name };
    }
    if (reporter.opcode === `${EXTENSION_PREFIX}listHandlerVariables`) {
        return { kind: 'handler-variable-names' };
    }
    diagnostics.push(error('TW_UNSUPPORTED_REPORTER', `Unsupported reporter block: ${reporter.opcode}`, target, reporterId));
    return null;
}
function inputBlockId(value) {
    if (!Array.isArray(value))
        return null;
    const candidate = value[1];
    return typeof candidate === 'string' ? candidate : null;
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
function routeSegment(name) {
    const normalized = name.normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return normalized.replace(/^-+|-+$/g, '') || 'sprite';
}
function routeId(target, method, index) {
    return `${routeSegment(target)}-${method}-${index + 1}`;
}
function rejectDuplicateRoutes(routes, diagnostics) {
    const seen = new Set();
    for (const route of routes) {
        const key = `${route.method} ${route.path}`;
        if (seen.has(key)) {
            diagnostics.push({ severity: 'error', code: 'TW_DUPLICATE_ROUTE', message: `Duplicate route: ${key}` });
        }
        seen.add(key);
    }
}
function safeHeader(name) {
    return (/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) &&
        !['connection', 'content-length', 'transfer-encoding', 'upgrade'].includes(name));
}
function requireBlockMap(value, target) {
    return requireObject(value, `blocks for target ${target}`);
}
function requireObject(value, location) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${location} must be an object.`);
    }
    return value;
}
function inputMap(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return {};
    return value;
}
function blockId(value) {
    return typeof value === 'string' ? value : null;
}
function error(code, message, target, blockIdValue) {
    return { severity: 'error', code, message, target, blockId: blockIdValue };
}
//# sourceMappingURL=turbowarp.js.map