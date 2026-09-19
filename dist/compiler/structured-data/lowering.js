import { JSON_VALUE_TYPE_V2 } from '../ir-v2/types.js';
import { IrRuntimeError } from '../runtime/error.js';
import { isValidApplicationJson, parseApplicationJson } from './runtime.js';
import { parseStructuredDataPath } from './path.js';
export const STRUCTURED_DATA_PACKAGE_NAME = '@kubohiroya/turbowarp-structured-data';
export const STRUCTURED_DATA_PACKAGE_VERSION = '0.4.0';
export class StructuredDataLoweringContext {
    constructor(diagnostics = [], loopIds = []) {
        this.loopIds = loopIds;
        this.diagnostics = diagnostics;
    }
    lowerReporter(entry, args, sourceRef) {
        const operation = this.operation(entry, sourceRef);
        if (operation === undefined)
            return undefined;
        if (operation === 'structuredData.currentKey')
            return this.current('key', sourceRef);
        if (operation === 'structuredData.currentIndex')
            return this.current('index', sourceRef);
        if (operation === 'structuredData.currentValue') {
            const value = this.current('value', sourceRef);
            return value === undefined ? undefined : jsonStringify(value, sourceRef);
        }
        const jsonArgument = requireArgument(args, 'JSON');
        if (jsonArgument === undefined)
            return this.missingArgument('JSON', sourceRef);
        if (operation === 'structuredData.isValidJson') {
            if (isLiteralText(jsonArgument))
                return literal('boolean', isValidApplicationJson(jsonArgument.value), sourceRef);
            const text = this.jsonText(jsonArgument, sourceRef);
            return text === undefined ? undefined : { kind: 'json-is-valid', valueType: 'boolean', text, sourceRef };
        }
        const root = this.parseJsonArgument(jsonArgument, inputSource(sourceRef, 'JSON'));
        if (root === undefined)
            return undefined;
        if (operation === 'structuredData.normalizeJson')
            return jsonStringify(root, sourceRef);
        const path = this.literalPath(args.PATH, inputSource(sourceRef, 'PATH'));
        if (path === undefined)
            return undefined;
        if (operation === 'structuredData.get') {
            return jsonStringify({ kind: 'json-get', valueType: JSON_VALUE_TYPE_V2, root, path, sourceRef }, sourceRef);
        }
        if (operation === 'structuredData.has')
            return { kind: 'json-has', valueType: 'boolean', root, path, sourceRef };
        if (operation === 'structuredData.delete') {
            if (path.length === 0) {
                this.report('TW2_STRUCTURED_INVALID_PATH', 'Structured Data delete cannot target the root path.', 'The browser extension rejects deleting the root value.', 'Delete a child key/index or use a different root value.', inputSource(sourceRef, 'PATH'));
                return undefined;
            }
            return jsonStringify({ kind: 'json-delete', valueType: JSON_VALUE_TYPE_V2, root, path, sourceRef }, sourceRef);
        }
        if (operation === 'structuredData.keys') {
            return jsonStringify({ kind: 'json-keys', valueType: 'json-array', root, path, sourceRef }, sourceRef);
        }
        if (operation === 'structuredData.length') {
            return { kind: 'json-length', valueType: 'number', root, path, sourceRef };
        }
        if (operation === 'structuredData.set') {
            const valueArgument = requireArgument(args, 'VALUE');
            if (valueArgument === undefined)
                return this.missingArgument('VALUE', sourceRef);
            const value = this.parseJsonArgument(valueArgument, inputSource(sourceRef, 'VALUE'));
            return value === undefined
                ? undefined
                : jsonStringify({ kind: 'json-set', valueType: JSON_VALUE_TYPE_V2, root, path, value, sourceRef }, sourceRef);
        }
        this.unsupported(operation, sourceRef);
    }
    lowerForEach(entry, args, sourceRef, lowerBody) {
        const operation = this.operation(entry, sourceRef);
        if (operation !== 'structuredData.forEach') {
            if (operation !== undefined)
                this.unsupported(operation, sourceRef);
            return undefined;
        }
        const jsonArgument = requireArgument(args, 'JSON');
        if (jsonArgument === undefined)
            return this.missingArgument('JSON', sourceRef);
        const root = this.parseJsonArgument(jsonArgument, inputSource(sourceRef, 'JSON'));
        const path = this.literalPath(args.PATH, inputSource(sourceRef, 'PATH'));
        const maxIterations = this.literalMaximum(args.MAX, inputSource(sourceRef, 'MAX'));
        if (root === undefined || path === undefined || maxIterations === undefined)
            return undefined;
        const loopId = `structured_${sourceRef.targetIndex}_${sanitizeId(sourceRef.blockId)}`;
        const nested = new StructuredDataLoweringContext(this.diagnostics, [...this.loopIds, loopId]);
        const body = lowerBody(nested);
        return { kind: 'json-for-each', loopId, root, path, maxIterations, body, sourceRef };
    }
    operation(entry, sourceRef) {
        if (entry.extensionId !== 'kubohiroyastructureddata' ||
            entry.packageName !== STRUCTURED_DATA_PACKAGE_NAME ||
            entry.packageVersion !== STRUCTURED_DATA_PACKAGE_VERSION ||
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
            this.report('TW2_STRUCTURED_DYNAMIC_PATH', 'Structured Data path must be a compile-time string literal.', 'The MVP accepts only the locked tw-structured-path grammar and does not evaluate dynamic paths.', 'Replace the path input with a literal such as $.items[0].', sourceRef);
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
    unsupported(operation, sourceRef) {
        this.report('TW2_UNSUPPORTED_OPERATION', `Structured Data operation is not supported by this lowering phase: ${operation}`, 'Only compiler-allowlisted operations from the locked manifest may be lowered.', 'Use a supported manifest version and opcode.', sourceRef);
    }
    report(code, message, reason, suggestion, sourceRef) {
        this.diagnostics.push({ severity: 'error', code, message, reason, suggestion, sourceRef });
    }
}
function requireArgument(args, name) {
    return args[name];
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
function jsonStringify(value, sourceRef) {
    return { kind: 'json-stringify', valueType: 'json-text', value, sourceRef };
}
function inputSource(sourceRef, input) {
    return { ...sourceRef, input };
}
function sanitizeId(value) {
    const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}
//# sourceMappingURL=lowering.js.map