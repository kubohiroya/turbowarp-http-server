import { JSON_VALUE_TYPE_V2 } from '../ir-v2/types.js';
import { IrRuntimeError } from '../runtime/error.js';
import { decodeStructuredJson, parseApplicationJson } from './runtime.js';
import { parseStructuredDataPath } from './path.js';
export const STRUCTURED_DATA_EXTENSION_ID = 'kubohiroyastructureddata';
export const STRUCTURED_DATA_PACKAGE_NAME = '@kubohiroya/turbowarp-structured-data';
/**
 * Exact package versions whose manifest signatures and block semantics this lowering was checked
 * against. Any other locked version stops at the first Structured Data block; nothing falls back.
 */
export const STRUCTURED_DATA_PACKAGE_VERSIONS = ['0.11.0-rc.1'];
/** Server-supported operations of the manifest that later phases of the named-values design lower. */
const LATER_PHASE_OPERATIONS = {
    'structuredData.parseYaml': 'phase 2 (YAML)',
    'structuredData.toYaml': 'phase 2 (YAML)',
    'structuredData.defineSchema': 'phase 3 (schema)',
    'structuredData.beginSchema': 'phase 3 (schema)',
    'structuredData.addSchemaProperty': 'phase 3 (schema)',
    'structuredData.commitSchema': 'phase 3 (schema)',
    'structuredData.deleteSchema': 'phase 3 (schema)',
    'structuredData.hasSchema': 'phase 3 (schema)',
    'structuredData.schemaOf': 'phase 3 (schema)',
    'structuredData.parseJsonWithSchema': 'phase 3 (schema)',
    'structuredData.parseYamlWithSchema': 'phase 3 (schema)'
};
export function isStructuredDataEntry(entry) {
    return entry.extensionId === STRUCTURED_DATA_EXTENSION_ID;
}
/**
 * Lowers Structured Data 0.11 blocks. Named values become request-local IR state: reads go through
 * `named-value`, writes through `named-value-set`, and every path operation is one of the existing
 * immutable json nodes between them.
 */
export class StructuredDataLoweringContext {
    constructor(diagnostics = [], loopIds = []) {
        this.loopIds = loopIds;
        this.diagnostics = diagnostics;
    }
    lowerReporter(entry, args, sourceRef) {
        const operation = this.operation(entry, sourceRef);
        if (operation === undefined)
            return undefined;
        switch (operation) {
            case 'structuredData.currentKey':
                return this.current('key', sourceRef);
            case 'structuredData.currentIndex':
                return this.current('index', sourceRef);
            case 'structuredData.currentValue': {
                const value = this.current('value', sourceRef);
                return value === undefined ? undefined : jsonStringify(value, sourceRef);
            }
            case 'structuredData.currentGet':
            case 'structuredData.currentGetText': {
                // The browser checks for an active loop before it parses the path, so a missing loop is the
                // only diagnostic even when the path is also invalid.
                const value = this.current('value', sourceRef);
                if (value === undefined)
                    return undefined;
                const path = this.literalPath(args.PATH, inputSource(sourceRef, 'PATH'));
                if (path === undefined)
                    return undefined;
                const read = jsonGet(value, path, sourceRef);
                return operation === 'structuredData.currentGet' ? jsonStringify(read, sourceRef) : scalarText(read, sourceRef);
            }
            case 'structuredData.hasData': {
                const name = this.name(args, sourceRef);
                return name === undefined ? undefined : { kind: 'named-value-exists', valueType: 'boolean', name, sourceRef };
            }
            case 'structuredData.toJson': {
                const name = this.name(args, sourceRef);
                return name === undefined ? undefined : jsonStringify(namedValue(name, sourceRef), sourceRef);
            }
            case 'structuredData.get':
            case 'structuredData.getText':
            case 'structuredData.has':
            case 'structuredData.keys':
            case 'structuredData.length': {
                const name = this.name(args, sourceRef);
                const path = this.literalPath(args.PATH, inputSource(sourceRef, 'PATH'));
                if (name === undefined || path === undefined)
                    return undefined;
                const root = namedValue(name, sourceRef);
                if (operation === 'structuredData.get')
                    return jsonStringify(jsonGet(root, path, sourceRef), sourceRef);
                if (operation === 'structuredData.getText')
                    return scalarText(jsonGet(root, path, sourceRef), sourceRef);
                if (operation === 'structuredData.has')
                    return { kind: 'json-has', valueType: 'boolean', root, path, sourceRef };
                if (operation === 'structuredData.keys') {
                    return jsonStringify({ kind: 'json-keys', valueType: 'json-array', root, path, sourceRef }, sourceRef);
                }
                return { kind: 'json-length', valueType: 'number', root, path, sourceRef };
            }
            default:
                return this.notLowered(operation, sourceRef);
        }
    }
    lowerStatement(entry, args, sourceRef) {
        const operation = this.operation(entry, sourceRef);
        if (operation === undefined)
            return undefined;
        switch (operation) {
            case 'structuredData.parseJson': {
                // The browser decodes TEXT before it checks NAME, so the TEXT diagnostic comes first.
                const text = args.TEXT;
                if (text === undefined)
                    return this.missingArgument('TEXT', sourceRef);
                const value = this.decodeText(text, inputSource(sourceRef, 'TEXT'));
                const name = this.name(args, sourceRef);
                if (value === undefined || name === undefined)
                    return undefined;
                return { kind: 'named-value-set', name, value, schema: 'drop', sourceRef };
            }
            case 'structuredData.set': {
                const name = this.name(args, sourceRef);
                const path = this.literalPath(args.PATH, inputSource(sourceRef, 'PATH'));
                const valueArgument = args.VALUE;
                if (valueArgument === undefined)
                    return this.missingArgument('VALUE', sourceRef);
                const replacement = this.parseJsonArgument(valueArgument, inputSource(sourceRef, 'VALUE'));
                if (name === undefined || path === undefined || replacement === undefined)
                    return undefined;
                return {
                    kind: 'named-value-set',
                    name,
                    value: {
                        kind: 'json-set',
                        valueType: JSON_VALUE_TYPE_V2,
                        root: namedValue(name, sourceRef),
                        path,
                        value: replacement,
                        sourceRef
                    },
                    schema: 'keep',
                    sourceRef
                };
            }
            case 'structuredData.delete': {
                const name = this.name(args, sourceRef);
                const path = this.literalPath(args.PATH, inputSource(sourceRef, 'PATH'));
                if (path !== undefined && path.length === 0) {
                    this.report('TW2_STRUCTURED_INVALID_PATH', 'Structured Data delete cannot target the root path.', 'The browser extension rejects deleting the root value.', 'Delete a child key/index, or use delete data to remove the whole value.', inputSource(sourceRef, 'PATH'));
                    return undefined;
                }
                if (name === undefined || path === undefined)
                    return undefined;
                return {
                    kind: 'named-value-set',
                    name,
                    value: { kind: 'json-delete', valueType: JSON_VALUE_TYPE_V2, root: namedValue(name, sourceRef), path, sourceRef },
                    schema: 'keep',
                    sourceRef
                };
            }
            case 'structuredData.deleteData': {
                const name = this.name(args, sourceRef);
                return name === undefined ? undefined : { kind: 'named-value-delete', name, sourceRef };
            }
            default:
                return this.notLowered(operation, sourceRef);
        }
    }
    lowerForEach(entry, args, sourceRef, lowerBody) {
        const operation = this.operation(entry, sourceRef);
        if (operation !== 'structuredData.forEach') {
            if (operation !== undefined)
                this.notLowered(operation, sourceRef);
            return undefined;
        }
        const name = this.name(args, sourceRef);
        const path = this.literalPath(args.PATH, inputSource(sourceRef, 'PATH'));
        const maxIterations = this.literalMaximum(args.MAX, inputSource(sourceRef, 'MAX'));
        if (name === undefined || path === undefined || maxIterations === undefined)
            return undefined;
        const loopId = `structured_${sourceRef.targetIndex}_${sanitizeId(sourceRef.blockId)}`;
        const nested = new StructuredDataLoweringContext(this.diagnostics, [...this.loopIds, loopId]);
        const body = lowerBody(nested);
        // json-for-each evaluates its root once, so the loop walks the value as it was when the loop
        // started, as the browser does by copying the entries out before the first iteration.
        return { kind: 'json-for-each', loopId, root: namedValue(name, sourceRef), path, maxIterations, body, sourceRef };
    }
    operation(entry, sourceRef) {
        if (entry.extensionId !== STRUCTURED_DATA_EXTENSION_ID ||
            entry.packageName !== STRUCTURED_DATA_PACKAGE_NAME ||
            !STRUCTURED_DATA_PACKAGE_VERSIONS.includes(entry.packageVersion) ||
            entry.block.server?.supported !== true ||
            entry.block.server.irOperation === undefined) {
            this.unsupported(entry.projectOpcode, sourceRef);
            return undefined;
        }
        return entry.block.server.irOperation;
    }
    current(field, sourceRef) {
        const loopId = this.loopIds[this.loopIds.length - 1];
        if (loopId === undefined) {
            this.report('TW2_ITERATION_CONTEXT_REQUIRED', `Structured Data current ${field} requires an enclosing for-each.`, 'Iteration reporters bind to the nearest lexical Structured Data loop.', 'Move the reporter into a for-each body.', sourceRef);
            return undefined;
        }
        if (field === 'key')
            return { kind: 'iteration-key', valueType: 'string', loopId, sourceRef };
        if (field === 'index')
            return { kind: 'iteration-index', valueType: 'number', loopId, sourceRef };
        return { kind: 'iteration-value', valueType: JSON_VALUE_TYPE_V2, loopId, sourceRef };
    }
    /** NAME may be any expression; only a literal that is empty after trimming is known to fail. */
    name(args, sourceRef) {
        const name = args.NAME;
        if (name === undefined)
            return this.missingArgument('NAME', sourceRef);
        if (isLiteralText(name) && name.value.trim().length === 0) {
            this.report('TW2_STRUCTURED_INVALID_NAME', 'Structured Data name literal is empty.', 'The browser extension trims the name and rejects an empty one with INVALID_NAME.', 'Give the value a non-empty name.', inputSource(sourceRef, 'NAME'));
            return undefined;
        }
        return name;
    }
    /** parse JSON TEXT: a literal is decoded now with the codec limits, anything else at runtime. */
    decodeText(expression, sourceRef) {
        if (!isLiteralText(expression)) {
            return { kind: 'structured-decode', valueType: JSON_VALUE_TYPE_V2, format: 'json', text: expression, sourceRef };
        }
        try {
            const value = decodeStructuredJson(expression.value);
            return literal(jsonLiteralType(value), value, sourceRef);
        }
        catch (error) {
            if (!(error instanceof IrRuntimeError))
                throw error;
            const overLimit = error.code === 'PARSE_LIMIT_EXCEEDED';
            this.report('TW2_STRUCTURED_INVALID_LITERAL', overLimit ? 'Structured Data JSON literal exceeds the parse limits.' : 'Structured Data JSON literal is invalid.', overLimit
                ? 'The browser codec rejects text over 256 KiB, deeper than 64 levels, or with more than 50,000 values.'
                : 'Literal JSON is validated during compilation instead of deferring a known failure to runtime.', overLimit ? 'Shrink the literal or read the text from the request.' : 'Provide valid JSON text.', sourceRef);
            return undefined;
        }
    }
    /** set VALUE: the browser only JSON.parses it, so neither literal nor dynamic VALUE has codec limits. */
    parseJsonArgument(expression, sourceRef) {
        if (isLiteralText(expression)) {
            try {
                const value = parseApplicationJson(expression.value);
                return literal(jsonLiteralType(value), value, sourceRef);
            }
            catch (error) {
                if (!(error instanceof IrRuntimeError))
                    throw error;
                this.report('TW2_STRUCTURED_INVALID_LITERAL', 'Structured Data JSON literal is invalid.', 'Literal JSON is validated during compilation instead of deferring a known failure to runtime.', 'Provide valid JSON text.', sourceRef);
                return undefined;
            }
        }
        const text = this.jsonText(expression, sourceRef);
        return text === undefined ? undefined : { kind: 'json-parse', valueType: JSON_VALUE_TYPE_V2, text, sourceRef };
    }
    jsonText(expression, sourceRef) {
        if (expression.valueType === 'json-text')
            return expression;
        if (expression.valueType === 'string') {
            return { kind: 'json-text-coerce', valueType: 'json-text', input: expression, sourceRef };
        }
        this.report('TW2_STRUCTURED_TYPE_MISMATCH', 'Structured Data JSON input must be string or json-text.', 'Application JSON text is a nominal boundary and is not interchangeable with typed JSON values.', 'Serialize the typed JSON value or pass a string expression.', sourceRef);
        return undefined;
    }
    literalPath(expression, sourceRef) {
        if (!isLiteralText(expression)) {
            this.report('TW2_STRUCTURED_DYNAMIC_PATH', 'Structured Data path must be a compile-time string literal.', 'The compiler accepts only the locked tw-structured-path grammar and does not evaluate dynamic paths.', 'Replace the path input with a literal such as $.items[0].', sourceRef);
            return undefined;
        }
        try {
            return parseStructuredDataPath(expression.value);
        }
        catch {
            this.report('TW2_STRUCTURED_INVALID_PATH', 'Structured Data path literal is invalid.', 'The path does not match $, .identifier, [index], or ["key"].', 'Correct the literal path syntax.', sourceRef);
            return undefined;
        }
    }
    literalMaximum(expression, sourceRef) {
        const value = expression?.kind === 'literal' && expression.valueType === 'number' ? expression.value : undefined;
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1000)
            return value;
        this.report('TW2_STRUCTURED_INVALID_MAX', 'Structured Data for-each maximum must be an integer literal from 1 to 1000.', 'A static maximum is required to prove the route work bound.', 'Use a numeric literal within the supported range.', sourceRef);
        return undefined;
    }
    missingArgument(name, sourceRef) {
        this.report('TW2_STRUCTURED_TYPE_MISMATCH', `Structured Data argument ${name} is missing.`, 'The project block does not match its locked manifest signature.', 'Recreate the block with the locked extension version.', inputSource(sourceRef, name));
    }
    /** An allowlisted operation this phase does not lower, or one used in the wrong block position. */
    notLowered(operation, sourceRef) {
        const phase = LATER_PHASE_OPERATIONS[operation];
        if (phase === undefined)
            return this.unsupported(operation, sourceRef);
        this.report('TW2_UNSUPPORTED_OPERATION', `Structured Data operation ${operation} is not lowered for the server until ${phase}.`, `Phase 1 lowers only the JSON operations; ${phase} of the named-values design adds this one, and the compiler never substitutes a similar operation.`, 'Run this block in the browser or through the WebSocket bridge, or remove it from the HTTP handler.', sourceRef);
    }
    unsupported(operation, sourceRef) {
        this.report('TW2_UNSUPPORTED_OPERATION', `Structured Data operation is not supported by this lowering phase: ${operation}`, 'Only compiler-allowlisted operations from a verified locked manifest version may be lowered.', 'Lock a verified Structured Data version and use its blocks.', sourceRef);
    }
    report(code, message, reason, suggestion, sourceRef) {
        this.diagnostics.push({ severity: 'error', code, message, reason, suggestion, sourceRef });
    }
}
function isLiteralText(expression) {
    return (expression?.kind === 'literal' &&
        (expression.valueType === 'string' || expression.valueType === 'json-text') &&
        typeof expression.value === 'string');
}
function jsonLiteralType(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'json-array';
    if (typeof value === 'object')
        return 'json-object';
    if (typeof value === 'boolean')
        return 'boolean';
    if (typeof value === 'number')
        return 'number';
    return 'string';
}
function literal(valueType, value, sourceRef) {
    return { kind: 'literal', valueType, value, sourceRef };
}
/** Each read gets its own copy of the name, so no IR node is shared between two parents. */
function namedValue(name, sourceRef) {
    return { kind: 'named-value', valueType: JSON_VALUE_TYPE_V2, name: structuredClone(name), sourceRef };
}
function jsonGet(root, path, sourceRef) {
    return { kind: 'json-get', valueType: JSON_VALUE_TYPE_V2, root, path, sourceRef };
}
function jsonStringify(value, sourceRef) {
    return { kind: 'json-stringify', valueType: 'json-text', value, sourceRef };
}
function scalarText(value, sourceRef) {
    return { kind: 'json-scalar-text', valueType: 'string', value, sourceRef };
}
function inputSource(sourceRef, input) {
    return { ...sourceRef, input };
}
function sanitizeId(value) {
    const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}
//# sourceMappingURL=lowering.js.map