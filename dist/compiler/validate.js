import { DEPLOY_IR_VERSION } from './ir.js';
const METHODS = new Set(['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const AUTH_MODES = new Set(['none', 'cloudflare-access', 'external-jwt']);
const FORBIDDEN_HEADERS = new Set(['connection', 'content-length', 'transfer-encoding', 'upgrade']);
const RESULT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COLLECTION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED_RESULT_NAMES = new Set([
    'authUser',
    'c',
    'handlerVariables',
    'headers',
    'requestBody',
    'status'
]);
export function parseDeployIr(value) {
    const root = record(value, 'IR');
    if (root.version !== DEPLOY_IR_VERSION)
        throw new Error(`IR.version must be ${DEPLOY_IR_VERSION}.`);
    const name = string(root.name, 'IR.name');
    const auth = string(root.auth, 'IR.auth');
    if (!AUTH_MODES.has(auth))
        throw new Error(`Unsupported auth mode: ${auth}`);
    if (!Array.isArray(root.routes) || root.routes.length === 0) {
        throw new Error('IR.routes must be a non-empty array.');
    }
    const routes = root.routes.map((route, index) => parseRoute(route, index));
    const keys = new Set();
    for (const route of routes) {
        const key = `${route.method} ${route.path}`;
        if (keys.has(key))
            throw new Error(`Duplicate route: ${key}`);
        keys.add(key);
        if (route.auth === 'required' && auth === 'none') {
            throw new Error(`Route ${route.id} requires authentication but IR.auth is none.`);
        }
    }
    return { version: DEPLOY_IR_VERSION, name, auth, routes };
}
function parseRoute(value, index) {
    const route = record(value, `IR.routes[${index}]`);
    const id = string(route.id, `IR.routes[${index}].id`);
    const method = string(route.method, `route ${id}.method`).toUpperCase();
    if (!METHODS.has(method))
        throw new Error(`Unsupported method in route ${id}: ${method}`);
    const path = string(route.path, `route ${id}.path`);
    validatePath(path, id);
    const auth = string(route.auth, `route ${id}.auth`);
    if (auth !== 'public' && auth !== 'required')
        throw new Error(`Invalid auth guard in route ${id}.`);
    if (!Array.isArray(route.actions) || route.actions.length === 0) {
        throw new Error(`Route ${id} must contain at least one action.`);
    }
    const actions = route.actions.map((action, actionIndex) => parseAction(action, `route ${id}.actions[${actionIndex}]`));
    validateResultBindings(actions, id);
    if (!actions.some((action) => action.kind === 'respond')) {
        throw new Error(`Route ${id} must contain a respond action.`);
    }
    return { id, method, path, auth, actions };
}
function parseAction(value, location) {
    const action = record(value, location);
    const kind = string(action.kind, `${location}.kind`);
    if (kind === 'set-status') {
        const status = number(action.status, `${location}.status`);
        if (!Number.isInteger(status) || status < 100 || status > 599) {
            throw new Error(`${location}.status must be an integer from 100 to 599.`);
        }
        return { kind, status };
    }
    if (kind === 'set-header') {
        const name = headerName(action.name, location);
        return { kind, name, value: parseExpression(action.value, `${location}.value`) };
    }
    if (kind === 'remove-header')
        return { kind, name: headerName(action.name, location) };
    if (kind === 'set-handler-variable' || kind === 'change-handler-variable') {
        return {
            kind,
            name: parseExpression(action.name, `${location}.name`),
            value: parseExpression(action.value, `${location}.value`)
        };
    }
    if (kind === 'delete-handler-variable') {
        return { kind, name: parseExpression(action.name, `${location}.name`) };
    }
    if (kind === 'clear-handler-variables')
        return { kind };
    if (kind === 'respond') {
        const format = string(action.format, `${location}.format`);
        if (format !== 'text' && format !== 'html' && format !== 'json') {
            throw new Error(`${location}.format must be text, html, or json.`);
        }
        return { kind, format, body: parseExpression(action.body, `${location}.body`) };
    }
    if (kind === 'record-create') {
        return {
            kind,
            collection: collection(action.collection, location),
            data: parseExpression(action.data, `${location}.data`),
            result: resultName(action.result, location)
        };
    }
    if (kind === 'record-list') {
        return {
            kind,
            collection: collection(action.collection, location),
            result: resultName(action.result, location)
        };
    }
    if (kind === 'record-get' || kind === 'record-delete') {
        return {
            kind,
            id: parseExpression(action.id, `${location}.id`),
            result: resultName(action.result, location)
        };
    }
    throw new Error(`Unsupported action at ${location}: ${kind}`);
}
function parseExpression(value, location) {
    const expression = record(value, location);
    const kind = string(expression.kind, `${location}.kind`);
    if (kind === 'literal')
        return { kind, value: string(expression.value, `${location}.value`) };
    if (kind === 'request') {
        const source = string(expression.source, `${location}.source`);
        if (!['method', 'path', 'url', 'body', 'content-type', 'client-address'].includes(source)) {
            throw new Error(`Unsupported request source at ${location}: ${source}`);
        }
        return { kind, source: source };
    }
    if (kind === 'request-value') {
        const source = string(expression.source, `${location}.source`);
        if (source !== 'query' && source !== 'path-param' && source !== 'header') {
            throw new Error(`Unsupported request value source at ${location}: ${source}`);
        }
        return { kind, source, name: string(expression.name, `${location}.name`) };
    }
    if (kind === 'concat') {
        return {
            kind,
            left: parseExpression(expression.left, `${location}.left`),
            right: parseExpression(expression.right, `${location}.right`)
        };
    }
    if (kind === 'handler-variable' || kind === 'handler-variable-exists') {
        return { kind, name: parseExpression(expression.name, `${location}.name`) };
    }
    if (kind === 'handler-variable-names')
        return { kind };
    if (kind === 'result')
        return { kind, name: resultName(expression.name, location) };
    throw new Error(`Unsupported expression at ${location}: ${kind}`);
}
function validatePath(path, id) {
    if (!path.startsWith('/') || path.includes('?') || path.includes('#') || /[\r\n]/.test(path)) {
        throw new Error(`Route ${id} has an invalid path: ${path}`);
    }
    if (path === '/@assets' || path.startsWith('/@assets/') || path.startsWith('/_tw-http/')) {
        throw new Error(`Route ${id} uses a reserved path: ${path}`);
    }
}
function headerName(value, location) {
    const name = string(value, `${location}.name`).trim().toLowerCase();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || FORBIDDEN_HEADERS.has(name)) {
        throw new Error(`Unsafe response header at ${location}: ${name}`);
    }
    return name;
}
function collection(value, location) {
    const name = string(value, `${location}.collection`);
    if (!COLLECTION_NAME.test(name))
        throw new Error(`Invalid collection name at ${location}: ${name}`);
    return name;
}
function resultName(value, location) {
    const name = string(value, `${location}.result`);
    if (!RESULT_NAME.test(name) || RESERVED_RESULT_NAMES.has(name)) {
        throw new Error(`Invalid or reserved result name at ${location}: ${name}`);
    }
    return name;
}
function validateResultBindings(actions, routeId) {
    const available = new Set();
    for (const action of actions) {
        for (const expression of actionExpressions(action))
            validateExpressionResults(expression, available, routeId);
        if ('result' in action) {
            if (available.has(action.result)) {
                throw new Error(`Route ${routeId} declares result ${action.result} more than once.`);
            }
            available.add(action.result);
        }
    }
}
function actionExpressions(action) {
    if (action.kind === 'set-header')
        return [action.value];
    if (action.kind === 'set-handler-variable' || action.kind === 'change-handler-variable') {
        return [action.name, action.value];
    }
    if (action.kind === 'delete-handler-variable')
        return [action.name];
    if (action.kind === 'respond')
        return [action.body];
    if (action.kind === 'record-create')
        return [action.data];
    if (action.kind === 'record-get' || action.kind === 'record-delete')
        return [action.id];
    return [];
}
function validateExpressionResults(expression, available, routeId) {
    if (expression.kind === 'result' && !available.has(expression.name)) {
        throw new Error(`Route ${routeId} references result ${expression.name} before it is assigned.`);
    }
    if (expression.kind === 'concat') {
        validateExpressionResults(expression.left, available, routeId);
        validateExpressionResults(expression.right, available, routeId);
    }
    if (expression.kind === 'handler-variable' || expression.kind === 'handler-variable-exists') {
        validateExpressionResults(expression.name, available, routeId);
    }
}
function record(value, location) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${location} must be an object.`);
    }
    return value;
}
function string(value, location) {
    if (typeof value !== 'string' || value.length === 0)
        throw new Error(`${location} must be a non-empty string.`);
    return value;
}
function number(value, location) {
    if (typeof value !== 'number')
        throw new Error(`${location} must be a number.`);
    return value;
}
//# sourceMappingURL=validate.js.map