import { parseJsonWithoutDuplicateKeys } from './strict-json.js';
import { isNamedDataNamespace } from '../../named-data-namespace.js';
import { DEPLOY_IR_V2_VERSION, JSON_VALUE_TYPE_V2 } from './types.js';
const METHODS = new Set(['ALL', 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const NAMED_TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ATOMIC_TYPES = new Set([
    'null',
    'boolean',
    'number',
    'string',
    'json-text',
    'json-array',
    'json-object',
    'binary-ref'
]);
const BINDING_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ATOMIC_TYPE_ORDER = [
    'null',
    'boolean',
    'number',
    'string',
    'json-text',
    'json-array',
    'json-object',
    'binary-ref'
];
export class DeployIrV2ParseError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = 'DeployIrV2ParseError';
    }
}
export function parseDeployIrV2Json(text) {
    return withParseDiagnostic(() => parseDeployIrV2Value(parseJsonWithoutDuplicateKeys(text)));
}
export function parseDeployIrV2(value) {
    return withParseDiagnostic(() => parseDeployIrV2Value(value));
}
function parseDeployIrV2Value(value) {
    const root = object(value, 'IR');
    exactKeys(root, ['version', 'name', 'auth', 'capabilities', 'routes'], 'IR');
    if (root.version !== DEPLOY_IR_V2_VERSION)
        throw new Error('IR.version must be 2.');
    const name = nonEmptyString(root.name, 'IR.name');
    const auth = parseAuth(root.auth, 'IR.auth');
    const capabilities = normalizeCapabilities(array(root.capabilities, 'IR.capabilities').map((item, index) => parseCapability(item, `IR.capabilities[${index}]`)));
    const routes = array(root.routes, 'IR.routes').map((item, index) => parseRoute(item, `IR.routes[${index}]`));
    if (routes.length === 0)
        throw new Error('IR.routes must not be empty.');
    return { version: DEPLOY_IR_V2_VERSION, name, auth, capabilities, routes };
}
function withParseDiagnostic(operation) {
    try {
        return operation();
    }
    catch (error) {
        if (error instanceof DeployIrV2ParseError)
            throw error;
        const message = error instanceof Error ? error.message : String(error);
        let code = 'TW2_IR_INVALID_VALUE';
        if (error instanceof SyntaxError) {
            code = message.startsWith('Duplicate object key:') ? 'TW2_IR_DUPLICATE_KEY' : 'TW2_IR_JSON_SYNTAX';
        }
        else if (message === 'IR.version must be 2.') {
            code = 'TW2_IR_VERSION';
        }
        else if (message.includes('contains unknown field:')) {
            code = 'TW2_IR_UNKNOWN_FIELD';
        }
        else if (message.includes('.kind is unsupported:')) {
            code = 'TW2_IR_UNKNOWN_NODE';
        }
        throw new DeployIrV2ParseError(code, message, error);
    }
}
function parseAuth(value, location) {
    const auth = object(value, location);
    const kind = nonEmptyString(auth.kind, `${location}.kind`);
    if (kind === 'none') {
        exactKeys(auth, ['kind'], location);
        return { kind };
    }
    if (kind === 'jwt') {
        exactKeys(auth, ['kind', 'scheme'], location);
        const scheme = nonEmptyString(auth.scheme, `${location}.scheme`);
        if (scheme !== 'external-jwt' && scheme !== 'trusted-access-jwt') {
            throw new Error(`${location}.scheme is unsupported: ${scheme}`);
        }
        return { kind, scheme };
    }
    throw new Error(`${location}.kind is unsupported: ${kind}`);
}
function parseCapability(value, location) {
    const capability = object(value, location);
    const kind = nonEmptyString(capability.kind, `${location}.kind`);
    if (kind === 'record-store' || kind === 'key-value-store') {
        exactKeys(capability, ['kind'], location);
        return { kind };
    }
    if (kind === 'object-storage' || kind === 'streaming-body' || kind === 'named-body-provider') {
        exactKeys(capability, ['kind'], location);
        return { kind };
    }
    if (kind === 'request-metadata') {
        exactKeys(capability, ['kind', 'field'], location);
        if (capability.field !== 'client-address')
            throw new Error(`${location}.field is unsupported.`);
        return { kind, field: 'client-address' };
    }
    if (kind === 'auth') {
        exactKeys(capability, ['kind', 'scheme'], location);
        const scheme = capability.scheme;
        if (scheme !== 'external-jwt' && scheme !== 'trusted-access-jwt') {
            throw new Error(`${location}.scheme is unsupported.`);
        }
        return { kind, scheme };
    }
    throw new Error(`${location}.kind is unsupported: ${kind}`);
}
function parseRoute(value, location) {
    const route = object(value, location);
    exactKeys(route, ['id', 'method', 'path', 'auth', 'body', 'sourceRef'], location);
    const id = nonEmptyString(route.id, `${location}.id`);
    const method = nonEmptyString(route.method, `${location}.method`);
    if (!METHODS.has(method))
        throw new Error(`${location}.method is unsupported: ${method}`);
    const path = nonEmptyString(route.path, `${location}.path`);
    const auth = route.auth;
    if (auth !== 'public' && auth !== 'required')
        throw new Error(`${location}.auth is invalid.`);
    const body = array(route.body, `${location}.body`).map((item, index) => parseStatement(item, `${location}.body[${index}]`));
    if (body.length === 0)
        throw new Error(`${location}.body must not be empty.`);
    const sourceRef = optionalSourceRef(route.sourceRef, `${location}.sourceRef`);
    return optional({ id, method, path, auth, body }, 'sourceRef', sourceRef);
}
function parseStatement(value, location) {
    const statement = object(value, location);
    const kind = nonEmptyString(statement.kind, `${location}.kind`);
    const sourceRef = optionalSourceRef(statement.sourceRef, `${location}.sourceRef`);
    if (kind === 'set-status') {
        exactKeys(statement, ['kind', 'status', 'sourceRef'], location);
        const status = integer(statement.status, `${location}.status`);
        if (status < 100 || status > 599)
            throw new Error(`${location}.status must be from 100 to 599.`);
        return optional({ kind, status }, 'sourceRef', sourceRef);
    }
    if (kind === 'set-header') {
        exactKeys(statement, ['kind', 'name', 'value', 'sourceRef'], location);
        return optional({ kind, name: nonEmptyString(statement.name, `${location}.name`), value: parseExpression(statement.value, `${location}.value`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'remove-header') {
        exactKeys(statement, ['kind', 'name', 'sourceRef'], location);
        return optional({ kind, name: nonEmptyString(statement.name, `${location}.name`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'set-handler-variable' || kind === 'change-handler-variable') {
        exactKeys(statement, ['kind', 'name', 'value', 'sourceRef'], location);
        return optional({
            kind,
            name: parseExpression(statement.name, `${location}.name`),
            value: parseExpression(statement.value, `${location}.value`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'delete-handler-variable') {
        exactKeys(statement, ['kind', 'name', 'sourceRef'], location);
        return optional({ kind, name: parseExpression(statement.name, `${location}.name`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'clear-handler-variables') {
        exactKeys(statement, ['kind', 'sourceRef'], location);
        return optional({ kind }, 'sourceRef', sourceRef);
    }
    if (kind === 'kvs-set-text') {
        exactKeys(statement, ['kind', 'namespace', 'key', 'value', 'sourceRef'], location);
        return optional({
            kind,
            namespace: parseExpression(statement.namespace, `${location}.namespace`),
            key: parseExpression(statement.key, `${location}.key`),
            value: parseExpression(statement.value, `${location}.value`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'kvs-delete') {
        exactKeys(statement, ['kind', 'namespace', 'key', 'sourceRef'], location);
        return optional({
            kind,
            namespace: parseExpression(statement.namespace, `${location}.namespace`),
            key: parseExpression(statement.key, `${location}.key`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'record-create') {
        exactKeys(statement, ['kind', 'collection', 'data', 'result', 'sourceRef'], location);
        return optional({
            kind,
            collection: nonEmptyString(statement.collection, `${location}.collection`),
            data: parseExpression(statement.data, `${location}.data`),
            result: parseBinding(statement.result, `${location}.result`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'record-list') {
        exactKeys(statement, ['kind', 'collection', 'result', 'sourceRef'], location);
        return optional({
            kind,
            collection: nonEmptyString(statement.collection, `${location}.collection`),
            result: parseBinding(statement.result, `${location}.result`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'record-get' || kind === 'record-delete') {
        exactKeys(statement, ['kind', 'id', 'result', 'sourceRef'], location);
        return optional({ kind, id: parseExpression(statement.id, `${location}.id`), result: parseBinding(statement.result, `${location}.result`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'asset-resolve') {
        exactKeys(statement, ['kind', 'locator', 'result', 'sourceRef'], location);
        return optional({
            kind,
            locator: parseBinaryLocator(statement.locator, `${location}.locator`),
            result: parseBinding(statement.result, `${location}.result`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'request-body-binary') {
        exactKeys(statement, ['kind', 'maxBytes', 'result', 'sourceRef'], location);
        return optional({
            kind,
            maxBytes: binaryLimit(statement.maxBytes, `${location}.maxBytes`),
            result: parseBinding(statement.result, `${location}.result`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'asset-object-get') {
        exactKeys(statement, ['kind', 'ref', 'maxBytes', 'result', 'sourceRef'], location);
        return optional({
            kind,
            ref: parseExpression(statement.ref, `${location}.ref`),
            maxBytes: binaryLimit(statement.maxBytes, `${location}.maxBytes`),
            result: parseBinding(statement.result, `${location}.result`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'asset-object-put') {
        exactKeys(statement, ['kind', 'locator', 'body', 'metadata', 'maxBytes', 'result', 'sourceRef'], location);
        return optional({
            kind,
            locator: parseBinaryLocator(statement.locator, `${location}.locator`),
            body: bindingId(statement.body, `${location}.body`),
            metadata: parseBinaryMetadata(statement.metadata, `${location}.metadata`),
            maxBytes: binaryLimit(statement.maxBytes, `${location}.maxBytes`),
            result: parseBinding(statement.result, `${location}.result`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'asset-object-delete') {
        exactKeys(statement, ['kind', 'target', 'result', 'sourceRef'], location);
        return optional({
            kind,
            target: parseBinaryDeleteTarget(statement.target, `${location}.target`),
            result: parseBinding(statement.result, `${location}.result`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'if') {
        exactKeys(statement, ['kind', 'condition', 'then', 'else', 'sourceRef'], location);
        const condition = parseExpression(statement.condition, `${location}.condition`);
        const then = parseStatements(statement.then, `${location}.then`);
        const otherwise = statement.else === undefined ? undefined : parseStatements(statement.else, `${location}.else`);
        return optional(optional({ kind, condition, then }, 'else', otherwise), 'sourceRef', sourceRef);
    }
    if (kind === 'bounded-loop') {
        exactKeys(statement, ['kind', 'maxIterations', 'body', 'sourceRef'], location);
        const maxIterations = integer(statement.maxIterations, `${location}.maxIterations`);
        if (maxIterations < 0 || maxIterations > 1000) {
            throw new Error(`${location}.maxIterations must be from 0 to 1000.`);
        }
        return optional({ kind, maxIterations, body: parseStatements(statement.body, `${location}.body`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'json-for-each') {
        exactKeys(statement, ['kind', 'loopId', 'root', 'path', 'maxIterations', 'body', 'sourceRef'], location);
        const maxIterations = integer(statement.maxIterations, `${location}.maxIterations`);
        if (maxIterations < 1 || maxIterations > 1000) {
            throw new Error(`${location}.maxIterations must be from 1 to 1000.`);
        }
        return optional({
            kind,
            loopId: bindingId(statement.loopId, `${location}.loopId`),
            root: parseExpression(statement.root, `${location}.root`),
            path: parsePath(statement.path, `${location}.path`),
            maxIterations,
            body: parseStatements(statement.body, `${location}.body`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'respond') {
        exactKeys(statement, ['kind', 'format', 'body', 'sourceRef'], location);
        const format = statement.format;
        if (format !== 'text' && format !== 'html' && format !== 'json') {
            throw new Error(`${location}.format is invalid.`);
        }
        return optional({ kind, format, body: parseExpression(statement.body, `${location}.body`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'respond-binary') {
        exactKeys(statement, ['kind', 'body', 'disposition', 'sourceRef'], location);
        const disposition = statement.disposition === undefined
            ? undefined
            : parseBinaryDisposition(statement.disposition, `${location}.disposition`);
        return optional(optional({ kind, body: bindingId(statement.body, `${location}.body`) }, 'disposition', disposition), 'sourceRef', sourceRef);
    }
    if (kind === 'respond-named-body') {
        exactKeys(statement, ['kind', 'reference', 'representation', 'targetId', 'maxBytes', 'sourceRef'], location);
        const referenceValue = object(statement.reference, `${location}.reference`);
        exactKeys(referenceValue, ['namespace', 'name', 'kind', 'scope'], `${location}.reference`);
        const namespace = nonEmptyString(referenceValue.namespace, `${location}.reference.namespace`);
        if (!isNamedDataNamespace(namespace))
            throw new Error(`${location}.reference.namespace is invalid.`);
        const name = nonEmptyString(referenceValue.name, `${location}.reference.name`);
        if (name.length > 256 || [...name].some(isControlCharacter)) {
            throw new Error(`${location}.reference.name is invalid.`);
        }
        const dataKind = referenceValue.kind;
        if (dataKind !== 'structured' && dataKind !== 'document' && dataKind !== 'binary' && dataKind !== 'asset') {
            throw new Error(`${location}.reference.kind is invalid.`);
        }
        const scope = referenceValue.scope;
        if (scope !== 'target' && scope !== 'project')
            throw new Error(`${location}.reference.scope is invalid.`);
        const representation = statement.representation;
        if (representation !== 'json' &&
            representation !== 'yaml' &&
            representation !== 'html' &&
            representation !== 'markdown' &&
            representation !== 'raw') {
            throw new Error(`${location}.representation is invalid.`);
        }
        const targetId = optionalString(statement.targetId, `${location}.targetId`);
        if (scope === 'target' && (targetId === undefined || !NAMED_TARGET_ID.test(targetId))) {
            throw new Error(`${location}.targetId is required for target scope.`);
        }
        if (scope === 'project' && targetId !== undefined) {
            throw new Error(`${location}.targetId is not allowed for project scope.`);
        }
        return optional(optional({
            kind,
            reference: { namespace, name, kind: dataKind, scope },
            representation,
            maxBytes: binaryLimit(statement.maxBytes, `${location}.maxBytes`)
        }, 'targetId', targetId), 'sourceRef', sourceRef);
    }
    throw new Error(`${location}.kind is unsupported: ${kind}`);
}
function parseStatements(value, location) {
    return array(value, location).map((item, index) => parseStatement(item, `${location}[${index}]`));
}
function parseExpression(value, location) {
    const expression = object(value, location);
    const kind = nonEmptyString(expression.kind, `${location}.kind`);
    const sourceRef = optionalSourceRef(expression.sourceRef, `${location}.sourceRef`);
    if (kind === 'literal') {
        exactKeys(expression, ['kind', 'valueType', 'value', 'sourceRef'], location);
        const valueType = atomicType(expression.valueType, `${location}.valueType`);
        if (valueType === 'binary-ref') {
            const binaryRef = parseBinaryRef(expression.value, `${location}.value`);
            return optional({ kind, valueType, value: binaryRef }, 'sourceRef', sourceRef);
        }
        const literal = jsonValue(expression.value, `${location}.value`);
        assertLiteralType(valueType, literal, location);
        return optional({ kind, valueType, value: literal }, 'sourceRef', sourceRef);
    }
    if (kind === 'request') {
        exactKeys(expression, ['kind', 'valueType', 'source', 'sourceRef'], location);
        if (expression.valueType !== 'string')
            throw new Error(`${location}.valueType must be string.`);
        const source = expression.source;
        if (!['method', 'path', 'url', 'body-text', 'content-type', 'client-address'].includes(String(source))) {
            throw new Error(`${location}.source is unsupported.`);
        }
        return optional({ kind, valueType: 'string', source: source }, 'sourceRef', sourceRef);
    }
    if (kind === 'request-value') {
        exactKeys(expression, ['kind', 'valueType', 'source', 'name', 'sourceRef'], location);
        if (expression.valueType !== 'string')
            throw new Error(`${location}.valueType must be string.`);
        const source = expression.source;
        if (source !== 'query' && source !== 'path-param' && source !== 'header') {
            throw new Error(`${location}.source is unsupported.`);
        }
        return optional({ kind, valueType: 'string', source, name: nonEmptyString(expression.name, `${location}.name`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'concat') {
        exactKeys(expression, ['kind', 'valueType', 'left', 'right', 'sourceRef'], location);
        if (expression.valueType !== 'string')
            throw new Error(`${location}.valueType must be string.`);
        return optional({
            kind,
            valueType: 'string',
            left: parseExpression(expression.left, `${location}.left`),
            right: parseExpression(expression.right, `${location}.right`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'handler-variable') {
        exactKeys(expression, ['kind', 'valueType', 'name', 'sourceRef'], location);
        const valueType = parseValueType(expression.valueType, `${location}.valueType`);
        if (!isStringNumberUnion(valueType))
            throw new Error(`${location}.valueType must be the number|string union.`);
        return optional({ kind, valueType: { kind: 'union', members: ['number', 'string'] }, name: parseExpression(expression.name, `${location}.name`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'handler-variable-exists') {
        exactKeys(expression, ['kind', 'valueType', 'name', 'sourceRef'], location);
        if (expression.valueType !== 'boolean')
            throw new Error(`${location}.valueType must be boolean.`);
        return optional({ kind, valueType: 'boolean', name: parseExpression(expression.name, `${location}.name`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'handler-variable-names') {
        exactKeys(expression, ['kind', 'valueType', 'sourceRef'], location);
        if (expression.valueType !== 'string')
            throw new Error(`${location}.valueType must be string.`);
        return optional({ kind, valueType: 'string' }, 'sourceRef', sourceRef);
    }
    if (kind === 'kvs-get-text' || kind === 'kvs-has') {
        exactKeys(expression, ['kind', 'valueType', 'namespace', 'key', 'sourceRef'], location);
        const valueType = kind === 'kvs-get-text' ? 'string' : 'boolean';
        requireValueType(expression.valueType, valueType, `${location}.valueType`);
        const namespace = parseExpression(expression.namespace, `${location}.namespace`);
        const key = parseExpression(expression.key, `${location}.key`);
        return kind === 'kvs-get-text'
            ? optional({ kind, valueType: 'string', namespace, key }, 'sourceRef', sourceRef)
            : optional({ kind, valueType: 'boolean', namespace, key }, 'sourceRef', sourceRef);
    }
    if (kind === 'kvs-list-keys') {
        exactKeys(expression, ['kind', 'valueType', 'namespace', 'sourceRef'], location);
        requireValueType(expression.valueType, 'json-text', `${location}.valueType`);
        return optional({ kind, valueType: 'json-text', namespace: parseExpression(expression.namespace, `${location}.namespace`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'binding') {
        exactKeys(expression, ['kind', 'valueType', 'binding', 'sourceRef'], location);
        return optional({
            kind,
            valueType: parseValueType(expression.valueType, `${location}.valueType`),
            binding: bindingId(expression.binding, `${location}.binding`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'json-text-coerce') {
        exactKeys(expression, ['kind', 'valueType', 'input', 'sourceRef'], location);
        requireValueType(expression.valueType, 'json-text', `${location}.valueType`);
        return optional({ kind, valueType: 'json-text', input: parseExpression(expression.input, `${location}.input`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'json-parse') {
        exactKeys(expression, ['kind', 'valueType', 'text', 'sourceRef'], location);
        requireJsonValueType(expression.valueType, `${location}.valueType`);
        return optional({ kind, valueType: JSON_VALUE_TYPE_V2, text: parseExpression(expression.text, `${location}.text`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'json-stringify') {
        exactKeys(expression, ['kind', 'valueType', 'value', 'sourceRef'], location);
        requireValueType(expression.valueType, 'json-text', `${location}.valueType`);
        return optional({ kind, valueType: 'json-text', value: parseExpression(expression.value, `${location}.value`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'json-is-valid') {
        exactKeys(expression, ['kind', 'valueType', 'text', 'sourceRef'], location);
        requireValueType(expression.valueType, 'boolean', `${location}.valueType`);
        return optional({ kind, valueType: 'boolean', text: parseExpression(expression.text, `${location}.text`) }, 'sourceRef', sourceRef);
    }
    if (kind === 'json-get' ||
        kind === 'json-has' ||
        kind === 'json-delete' ||
        kind === 'json-keys' ||
        kind === 'json-length') {
        exactKeys(expression, ['kind', 'valueType', 'root', 'path', 'sourceRef'], location);
        const root = parseExpression(expression.root, `${location}.root`);
        const path = parsePath(expression.path, `${location}.path`);
        if (kind === 'json-get' || kind === 'json-delete') {
            requireJsonValueType(expression.valueType, `${location}.valueType`);
            return optional({ kind, valueType: JSON_VALUE_TYPE_V2, root, path }, 'sourceRef', sourceRef);
        }
        if (kind === 'json-has') {
            requireValueType(expression.valueType, 'boolean', `${location}.valueType`);
            return optional({ kind, valueType: 'boolean', root, path }, 'sourceRef', sourceRef);
        }
        if (kind === 'json-keys') {
            requireValueType(expression.valueType, 'json-array', `${location}.valueType`);
            return optional({ kind, valueType: 'json-array', root, path }, 'sourceRef', sourceRef);
        }
        requireValueType(expression.valueType, 'number', `${location}.valueType`);
        return optional({ kind, valueType: 'number', root, path }, 'sourceRef', sourceRef);
    }
    if (kind === 'json-set') {
        exactKeys(expression, ['kind', 'valueType', 'root', 'path', 'value', 'sourceRef'], location);
        requireJsonValueType(expression.valueType, `${location}.valueType`);
        return optional({
            kind,
            valueType: JSON_VALUE_TYPE_V2,
            root: parseExpression(expression.root, `${location}.root`),
            path: parsePath(expression.path, `${location}.path`),
            value: parseExpression(expression.value, `${location}.value`)
        }, 'sourceRef', sourceRef);
    }
    if (kind === 'iteration-key' || kind === 'iteration-index' || kind === 'iteration-value') {
        exactKeys(expression, ['kind', 'valueType', 'loopId', 'sourceRef'], location);
        const loopId = bindingId(expression.loopId, `${location}.loopId`);
        if (kind === 'iteration-key') {
            requireValueType(expression.valueType, 'string', `${location}.valueType`);
            return optional({ kind, valueType: 'string', loopId }, 'sourceRef', sourceRef);
        }
        if (kind === 'iteration-index') {
            requireValueType(expression.valueType, 'number', `${location}.valueType`);
            return optional({ kind, valueType: 'number', loopId }, 'sourceRef', sourceRef);
        }
        requireJsonValueType(expression.valueType, `${location}.valueType`);
        return optional({ kind, valueType: JSON_VALUE_TYPE_V2, loopId }, 'sourceRef', sourceRef);
    }
    throw new Error(`${location}.kind is unsupported: ${kind}`);
}
function parseBinding(value, location) {
    const binding = object(value, location);
    exactKeys(binding, ['id', 'type'], location);
    return { id: bindingId(binding.id, `${location}.id`), type: parseBindingType(binding.type, `${location}.type`) };
}
function parseBindingType(value, location) {
    const type = object(value, location);
    const kind = nonEmptyString(type.kind, `${location}.kind`);
    if (kind === 'value') {
        exactKeys(type, ['kind', 'valueType'], location);
        return { kind, valueType: parseValueType(type.valueType, `${location}.valueType`) };
    }
    if (kind === 'resource') {
        exactKeys(type, ['kind', 'resourceType'], location);
        if (type.resourceType !== 'binary-body')
            throw new Error(`${location}.resourceType is unsupported.`);
        return { kind, resourceType: 'binary-body' };
    }
    throw new Error(`${location}.kind is unsupported: ${kind}`);
}
function parseValueType(value, location) {
    if (typeof value === 'string')
        return atomicType(value, location);
    const type = object(value, location);
    exactKeys(type, ['kind', 'members'], location);
    if (type.kind !== 'union')
        throw new Error(`${location}.kind must be union.`);
    const members = array(type.members, `${location}.members`).map((member, index) => atomicType(member, `${location}.members[${index}]`));
    if (members.length < 2 || new Set(members).size !== members.length) {
        throw new Error(`${location}.members must contain at least two unique atomic types.`);
    }
    return {
        kind: 'union',
        members: members.sort((left, right) => ATOMIC_TYPE_ORDER.indexOf(left) - ATOMIC_TYPE_ORDER.indexOf(right))
    };
}
function requireValueType(value, expected, location) {
    if (value !== expected)
        throw new Error(`${location} must be ${expected}.`);
}
function requireJsonValueType(value, location) {
    const parsed = parseValueType(value, location);
    if (JSON.stringify(parsed) !== JSON.stringify(JSON_VALUE_TYPE_V2)) {
        throw new Error(`${location} must be the canonical JSON value union.`);
    }
}
function parsePath(value, location) {
    return array(value, location).map((item, index) => {
        const segmentLocation = `${location}[${index}]`;
        const segment = object(item, segmentLocation);
        exactKeys(segment, ['kind', 'value'], segmentLocation);
        if (segment.kind === 'key') {
            if (typeof segment.value !== 'string')
                throw new Error(`${segmentLocation}.value must be a string.`);
            return { kind: 'key', value: segment.value };
        }
        if (segment.kind === 'index') {
            const indexValue = integer(segment.value, `${segmentLocation}.value`);
            if (indexValue < 0)
                throw new Error(`${segmentLocation}.value must not be negative.`);
            return { kind: 'index', value: indexValue };
        }
        throw new Error(`${segmentLocation}.kind is unsupported: ${String(segment.kind)}`);
    });
}
function normalizeCapabilities(capabilities) {
    const entries = capabilities.map((capability) => [JSON.stringify(capability), capability]);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
        throw new Error('IR.capabilities must not contain duplicates.');
    }
    return entries
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, capability]) => capability);
}
function optionalSourceRef(value, location) {
    if (value === undefined)
        return undefined;
    const source = object(value, location);
    exactKeys(source, ['targetIndex', 'targetName', 'blockId', 'opcode', 'input'], location);
    const result = {
        targetIndex: integer(source.targetIndex, `${location}.targetIndex`),
        targetName: nonEmptyString(source.targetName, `${location}.targetName`),
        blockId: nonEmptyString(source.blockId, `${location}.blockId`),
        opcode: nonEmptyString(source.opcode, `${location}.opcode`)
    };
    if (result.targetIndex < 0)
        throw new Error(`${location}.targetIndex must not be negative.`);
    const input = source.input === undefined ? undefined : nonEmptyString(source.input, `${location}.input`);
    return optional(result, 'input', input);
}
function jsonValue(value, location) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error(`${location} must be a finite JSON number.`);
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value))
        return value.map((item, index) => jsonValue(item, `${location}[${index}]`));
    const record = object(value, location);
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, jsonValue(item, `${location}.${key}`)]));
}
function parseBinaryRef(value, location) {
    const descriptor = object(value, location);
    exactKeys(descriptor, ['namespace', 'key', 'contentType', 'size', 'integrity', 'revision'], location);
    return {
        ...parseBinaryLocator(descriptor, location, true),
        ...parseBinaryMetadata(descriptor, location, true)
    };
}
function parseBinaryLocator(value, location, includesMetadata = false) {
    const locator = object(value, location);
    exactKeys(locator, includesMetadata
        ? ['namespace', 'key', 'contentType', 'size', 'integrity', 'revision']
        : ['namespace', 'key'], location);
    const namespace = nonEmptyString(locator.namespace, `${location}.namespace`);
    if (!isNamedDataNamespace(namespace)) {
        throw new Error(`${location}.namespace must be a logical namespace identifier of at most 64 characters.`);
    }
    const key = nonEmptyString(locator.key, `${location}.key`);
    if (key.length > 512 || key.includes('\0') || key.includes('\\') || key.startsWith('/')) {
        throw new Error(`${location}.key is not a safe logical key.`);
    }
    const segments = key.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error(`${location}.key contains an unsafe path segment.`);
    }
    return { namespace, key };
}
function parseBinaryMetadata(value, location, includesLocator = false) {
    const metadata = object(value, location);
    exactKeys(metadata, includesLocator
        ? ['namespace', 'key', 'contentType', 'size', 'integrity', 'revision']
        : ['contentType', 'size', 'integrity', 'revision'], location);
    const contentType = optionalString(metadata.contentType, `${location}.contentType`);
    if (contentType !== undefined && (contentType.length > 255 || !/^[^\s/;]+\/[^\s;]+(?:\s*;.*)?$/u.test(contentType) || /[\r\n]/u.test(contentType))) {
        throw new Error(`${location}.contentType must be a safe media type.`);
    }
    const size = metadata.size === undefined ? undefined : integer(metadata.size, `${location}.size`);
    if (size !== undefined && size < 0)
        throw new Error(`${location}.size must not be negative.`);
    const integrityValue = optionalString(metadata.integrity, `${location}.integrity`);
    if (integrityValue !== undefined && !/^sha256:[0-9a-f]{64}$/.test(integrityValue)) {
        throw new Error(`${location}.integrity must use sha256:<64 lowercase hexadecimal characters>.`);
    }
    const integrity = integrityValue;
    const revision = optionalString(metadata.revision, `${location}.revision`);
    if (revision !== undefined && revision.length > 256)
        throw new Error(`${location}.revision is too long.`);
    return optional(optional(optional(optional({}, 'contentType', contentType), 'size', size), 'integrity', integrity), 'revision', revision);
}
function parseBinaryDeleteTarget(value, location) {
    const target = object(value, location);
    const kind = nonEmptyString(target.kind, `${location}.kind`);
    if (kind === 'ref') {
        exactKeys(target, ['kind', 'ref'], location);
        return { kind, ref: parseExpression(target.ref, `${location}.ref`) };
    }
    if (kind === 'locator') {
        exactKeys(target, ['kind', 'locator'], location);
        return { kind, locator: parseBinaryLocator(target.locator, `${location}.locator`) };
    }
    throw new Error(`${location}.kind is unsupported: ${kind}`);
}
function parseBinaryDisposition(value, location) {
    const disposition = object(value, location);
    const kind = nonEmptyString(disposition.kind, `${location}.kind`);
    if (kind === 'inline') {
        exactKeys(disposition, ['kind'], location);
        return { kind };
    }
    if (kind === 'attachment') {
        exactKeys(disposition, ['kind', 'filename'], location);
        const filename = nonEmptyString(disposition.filename, `${location}.filename`);
        if (filename.length > 255 || /[\r\n\0]/u.test(filename))
            throw new Error(`${location}.filename is unsafe.`);
        return { kind, filename };
    }
    throw new Error(`${location}.kind is unsupported: ${kind}`);
}
function binaryLimit(value, location) {
    const limit = integer(value, location);
    if (limit < 1 || limit > 16 * 1024 * 1024)
        throw new Error(`${location} must be from 1 to 16777216.`);
    return limit;
}
function assertLiteralType(type, value, location) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'json-array' : typeof value === 'object' ? 'json-object' : typeof value;
    if (type === 'json-text') {
        if (actual !== 'string')
            throw new Error(`${location}.value must be a JSON text string.`);
        return;
    }
    if (type !== actual)
        throw new Error(`${location}.valueType ${type} does not match ${actual}.`);
}
function isStringNumberUnion(type) {
    return typeof type !== 'string' && type.members.length === 2 && type.members[0] === 'number' && type.members[1] === 'string';
}
function atomicType(value, location) {
    if (typeof value !== 'string' || !ATOMIC_TYPES.has(value)) {
        throw new Error(`${location} is not an atomic IR value type.`);
    }
    return value;
}
function bindingId(value, location) {
    const id = nonEmptyString(value, location);
    if (!BINDING_ID.test(id))
        throw new Error(`${location} is not a valid binding ID.`);
    return id;
}
function object(value, location) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${location} must be an object.`);
    }
    return value;
}
function array(value, location) {
    if (!Array.isArray(value))
        throw new Error(`${location} must be an array.`);
    return value;
}
function nonEmptyString(value, location) {
    if (typeof value !== 'string' || value.length === 0)
        throw new Error(`${location} must be a non-empty string.`);
    return value;
}
function optionalString(value, location) {
    return value === undefined ? undefined : nonEmptyString(value, location);
}
function integer(value, location) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
        throw new Error(`${location} must be a safe integer.`);
    return value;
}
function isControlCharacter(character) {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
}
function exactKeys(record, allowed, location) {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
    if (unknown.length > 0)
        throw new Error(`${location} contains unknown field: ${unknown.sort()[0]}`);
}
function optional(base, key, value) {
    return value === undefined ? base : { ...base, [key]: value };
}
//# sourceMappingURL=parse.js.map