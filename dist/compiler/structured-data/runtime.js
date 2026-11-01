import { IrRuntimeError } from '../runtime/error.js';
export const STRUCTURED_DATA_HTTP_STATUS = 422;
export const STRUCTURED_DATA_RUNTIME_ERROR_CODES = [
    'INVALID_JSON',
    'INVALID_NAME',
    'DATA_NOT_FOUND',
    'INVALID_PATH',
    'PATH_NOT_FOUND',
    'TYPE_MISMATCH',
    'INDEX_OUT_OF_RANGE',
    'ITERATION_LIMIT_EXCEEDED',
    'ITERATION_CONTEXT_REQUIRED',
    'PARSE_LIMIT_EXCEEDED'
];
/**
 * The limits `@kubohiroya/turbowarp-yaml-json`'s codec applies when Structured Data parses text. The
 * root value is at depth 0 and each nested value one deeper; every value counts toward the node limit,
 * object keys do not.
 */
export const STRUCTURED_DECODE_LIMITS = {
    maxInputBytes: 256 * 1024,
    maxDepth: 64,
    maxNodes: 50000
};
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
/**
 * Decodes JSON text the way Structured Data's `parse JSON` block does: the UTF-8 size is checked before
 * parsing, a syntax error is INVALID_JSON, and the depth and node limits are then checked in the same
 * depth-first order as the codec, so a non-finite number met first is INVALID_JSON and a limit met
 * first is PARSE_LIMIT_EXCEEDED.
 */
export function decodeStructuredJson(text) {
    if (exceedsInputBytes(text)) {
        runtimeError('PARSE_LIMIT_EXCEEDED', 'Input exceeds the Structured Data size limit.');
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        runtimeError('INVALID_JSON', 'Input must be valid JSON.');
    }
    let nodes = 0;
    const visit = (item, depth) => {
        if (depth > STRUCTURED_DECODE_LIMITS.maxDepth) {
            runtimeError('PARSE_LIMIT_EXCEEDED', 'Data exceeds the Structured Data nesting limit.');
        }
        nodes += 1;
        if (nodes > STRUCTURED_DECODE_LIMITS.maxNodes) {
            runtimeError('PARSE_LIMIT_EXCEEDED', 'Data exceeds the Structured Data node limit.');
        }
        if (item === null || typeof item === 'string' || typeof item === 'boolean')
            return;
        if (typeof item === 'number') {
            if (Number.isFinite(item))
                return;
            runtimeError('INVALID_JSON', 'JSON contains an unsupported value.');
        }
        if (Array.isArray(item)) {
            for (const child of item)
                visit(child, depth + 1);
            return;
        }
        const record = item;
        for (const key of Object.keys(record))
            visit(record[key], depth + 1);
    };
    visit(value, 0);
    return value;
}
/** The name a Structured Data block reads: Scratch's Cast.toString, then trimmed; empty is INVALID_NAME. */
export function structuredDataName(value) {
    const name = String(value).trim();
    if (name.length === 0)
        runtimeError('INVALID_NAME', 'Structured data name cannot be empty.');
    return name;
}
/** A scalar as reporter text: a string as is, a number or boolean as JSON; null and containers fail. */
export function jsonScalarText(value) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return stringifyApplicationJson(value);
    runtimeError('TYPE_MISMATCH', 'Text requires a string, number, or boolean.');
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
/**
 * Counts with TextEncoder as the codec does, so a lone surrogate is the three bytes of U+FFFD. Every
 * UTF-16 code unit encodes to at least one byte, so a longer string is over the limit without encoding.
 */
function exceedsInputBytes(text) {
    const limit = STRUCTURED_DECODE_LIMITS.maxInputBytes;
    return text.length > limit || new TextEncoder().encode(text).byteLength > limit;
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