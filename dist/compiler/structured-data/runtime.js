import { IrRuntimeError } from '../runtime/error.js';
export const STRUCTURED_DATA_HTTP_STATUS = 422;
export const STRUCTURED_DATA_RUNTIME_ERROR_CODES = [
    'INVALID_JSON',
    'INVALID_PATH',
    'PATH_NOT_FOUND',
    'TYPE_MISMATCH',
    'INDEX_OUT_OF_RANGE',
    'ITERATION_LIMIT_EXCEEDED',
    'ITERATION_CONTEXT_REQUIRED'
];
export function parseApplicationJson(text) {
    try {
        const value = JSON.parse(String(text));
        assertJsonValue(value);
        return value;
    }
    catch (error) {
        if (error instanceof IrRuntimeError)
            throw error;
        runtimeError('INVALID_JSON', 'Input must be valid application JSON.');
    }
}
export function isValidApplicationJson(text) {
    try {
        parseApplicationJson(text);
        return true;
    }
    catch {
        return false;
    }
}
export function stringifyApplicationJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stringifyApplicationJson).join(',')}]`;
    if (isJsonObject(value)) {
        return `{${Object.keys(value)
            .sort(compareUnicodeCodePoints)
            .map((key) => `${JSON.stringify(key)}:${stringifyApplicationJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
export function getJsonAtPath(root, path) {
    let current = root;
    for (const segment of path)
        current = readSegment(current, segment);
    return current;
}
export function hasJsonAtPath(root, path) {
    try {
        getJsonAtPath(root, path);
        return true;
    }
    catch (error) {
        if (error instanceof IrRuntimeError &&
            (error.code === 'PATH_NOT_FOUND' || error.code === 'INDEX_OUT_OF_RANGE')) {
            return false;
        }
        throw error;
    }
}
export function setJsonAtPath(root, path, replacement) {
    if (path.length === 0)
        return cloneJson(replacement);
    return updateParent(root, path, (parent, segment) => {
        if (segment.kind === 'key') {
            if (!isJsonObject(parent))
                runtimeError('TYPE_MISMATCH', 'Object path segment requires an object.');
            return { ...parent, [segment.value]: cloneJson(replacement) };
        }
        if (!Array.isArray(parent))
            runtimeError('TYPE_MISMATCH', 'Index path segment requires an array.');
        if (segment.value >= parent.length)
            runtimeError('INDEX_OUT_OF_RANGE', 'Array index is out of range.');
        const result = parent.slice();
        result[segment.value] = cloneJson(replacement);
        return result;
    });
}
export function deleteJsonAtPath(root, path) {
    if (path.length === 0)
        runtimeError('INVALID_PATH', 'The root value cannot be deleted.');
    return updateParent(root, path, (parent, segment) => {
        if (segment.kind === 'key') {
            if (!isJsonObject(parent))
                runtimeError('TYPE_MISMATCH', 'Object path segment requires an object.');
            if (!hasOwn(parent, segment.value))
                runtimeError('PATH_NOT_FOUND', 'Path does not exist.');
            const result = { ...parent };
            delete result[segment.value];
            return result;
        }
        if (!Array.isArray(parent))
            runtimeError('TYPE_MISMATCH', 'Index path segment requires an array.');
        if (segment.value >= parent.length)
            runtimeError('INDEX_OUT_OF_RANGE', 'Array index is out of range.');
        const result = parent.slice();
        result.splice(segment.value, 1);
        return result;
    });
}
export function jsonKeysAtPath(root, path) {
    const value = getJsonAtPath(root, path);
    if (!isJsonObject(value))
        runtimeError('TYPE_MISMATCH', 'Keys require an object.');
    return Object.keys(value).sort(compareUnicodeCodePoints);
}
export function jsonLengthAtPath(root, path) {
    const value = getJsonAtPath(root, path);
    if (!Array.isArray(value))
        runtimeError('TYPE_MISMATCH', 'Length requires an array.');
    return value.length;
}
export function structuredIterationEntries(root, path, maximum) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000) {
        runtimeError('ITERATION_LIMIT_EXCEEDED', 'Maximum must be from 1 to 1000.');
    }
    const value = getJsonAtPath(root, path);
    const entries = Array.isArray(value)
        ? value.map((item, index) => ({ key: String(index), index, value: item }))
        : isJsonObject(value)
            ? Object.keys(value)
                .sort(compareUnicodeCodePoints)
                .map((key, index) => ({ key, index, value: value[key] }))
            : runtimeError('TYPE_MISMATCH', 'Iteration requires an array or object.');
    if (entries.length > maximum) {
        runtimeError('ITERATION_LIMIT_EXCEEDED', 'Collection exceeds the declared iteration maximum.');
    }
    return entries;
}
export function compareUnicodeCodePoints(left, right) {
    const leftPoints = Array.from(left, (character) => character.codePointAt(0));
    const rightPoints = Array.from(right, (character) => character.codePointAt(0));
    const length = Math.min(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
        const difference = leftPoints[index] - rightPoints[index];
        if (difference !== 0)
            return difference;
    }
    return leftPoints.length - rightPoints.length;
}
function updateParent(root, path, update) {
    const [segment, ...remaining] = path;
    if (segment === undefined)
        return root;
    if (remaining.length === 0)
        return update(root, segment);
    const child = readSegment(root, segment);
    const next = updateParent(child, remaining, update);
    if (segment.kind === 'key') {
        if (!isJsonObject(root))
            runtimeError('TYPE_MISMATCH', 'Object path segment requires an object.');
        return { ...root, [segment.value]: next };
    }
    if (!Array.isArray(root))
        runtimeError('TYPE_MISMATCH', 'Index path segment requires an array.');
    const result = root.slice();
    result[segment.value] = next;
    return result;
}
function readSegment(value, segment) {
    if (segment.kind === 'key') {
        if (!isJsonObject(value))
            runtimeError('TYPE_MISMATCH', 'Object path segment requires an object.');
        if (!hasOwn(value, segment.value))
            runtimeError('PATH_NOT_FOUND', 'Path does not exist.');
        return value[segment.value];
    }
    if (!Array.isArray(value))
        runtimeError('TYPE_MISMATCH', 'Index path segment requires an array.');
    if (segment.value >= value.length)
        runtimeError('INDEX_OUT_OF_RANGE', 'Array index is out of range.');
    return value[segment.value];
}
function cloneJson(value) {
    if (Array.isArray(value))
        return value.map(cloneJson);
    if (isJsonObject(value)) {
        return Object.fromEntries(Object.keys(value).map((key) => [key, cloneJson(value[key])]));
    }
    return value;
}
function assertJsonValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number' && Number.isFinite(value))
        return;
    if (Array.isArray(value)) {
        for (const item of value)
            assertJsonValue(item);
        return;
    }
    if (typeof value === 'object') {
        for (const item of Object.values(value))
            assertJsonValue(item);
        return;
    }
    runtimeError('INVALID_JSON', 'JSON contains an unsupported value.');
}
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function runtimeError(code, message) {
    throw new IrRuntimeError(code, message, STRUCTURED_DATA_HTTP_STATUS);
}
//# sourceMappingURL=runtime.js.map