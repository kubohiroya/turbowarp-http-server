import { DEFAULT_MAX_BINARY_BYTES } from '../binary/types.js';
import { isNamedDataNamespace } from '../../named-data-namespace.js';
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const KINDS = ['structured', 'document', 'binary', 'asset'];
const SCOPES = ['target', 'project'];
const REPRESENTATIONS = ['json', 'yaml', 'html', 'markdown', 'raw'];
export function lowerNamedBodyResponse(args, sourceRef) {
    const diagnostics = [];
    const namespace = literalString(args.NAMESPACE, 'NAMESPACE', sourceRef, diagnostics);
    const name = literalString(args.NAME, 'NAME', sourceRef, diagnostics);
    const kind = literalMember(args.KIND, 'KIND', KINDS, sourceRef, diagnostics);
    const scope = literalMember(args.SCOPE, 'SCOPE', SCOPES, sourceRef, diagnostics);
    const representation = literalMember(args.REPRESENTATION, 'REPRESENTATION', REPRESENTATIONS, sourceRef, diagnostics);
    const maxBytes = literalMaximum(args.MAX_BYTES, sourceRef, diagnostics);
    if (namespace === undefined ||
        name === undefined ||
        kind === undefined ||
        scope === undefined ||
        representation === undefined ||
        maxBytes === undefined) {
        return { diagnostics };
    }
    if (!isNamedDataNamespace(namespace) || name.length < 1 || name.length > 256 || hasControlCharacter(name)) {
        report(diagnostics, 'TW2_NAMED_INVALID_DESCRIPTOR', 'Named response namespace or name is invalid.', 'The canonical descriptor requires a safe logical namespace and a bounded non-control name.', 'Use a canonical namespace such as asset and a name from 1 to 256 characters.', sourceRef);
        return { diagnostics };
    }
    let targetId;
    if (scope === 'target') {
        targetId = literalString(args.TARGET_ID, 'TARGET_ID', sourceRef, diagnostics);
        if (targetId === undefined)
            return { diagnostics };
        if (!TARGET_ID.test(targetId)) {
            report(diagnostics, 'TW2_NAMED_INVALID_DESCRIPTOR', 'Target-scoped named response has an invalid target ID.', 'Target scope requires a stable runtime-local identity.', 'Use a non-empty target ID containing only letters, digits, dot, underscore, colon, or hyphen.', inputSource(sourceRef, 'TARGET_ID'));
            return { diagnostics };
        }
    }
    return {
        statement: {
            kind: 'respond-named-body',
            reference: { namespace, name, kind, scope },
            representation,
            ...(targetId === undefined ? {} : { targetId }),
            maxBytes,
            sourceRef
        },
        diagnostics
    };
}
function literalString(expression, input, sourceRef, diagnostics) {
    if (expression?.kind === 'literal' && expression.valueType === 'string' && typeof expression.value === 'string') {
        return expression.value;
    }
    report(diagnostics, 'TW2_NAMED_DYNAMIC_DESCRIPTOR', `Named response ${input} must be a compile-time string literal.`, 'Static descriptors are required to validate provider capability and scope before generation.', 'Replace the input with a literal value.', inputSource(sourceRef, input));
}
function literalMember(expression, input, values, sourceRef, diagnostics) {
    const value = literalString(expression, input, sourceRef, diagnostics);
    if (value === undefined)
        return undefined;
    const normalized = value.toLowerCase();
    if (values.includes(normalized))
        return normalized;
    report(diagnostics, 'TW2_NAMED_INVALID_DESCRIPTOR', `Named response ${input} is not supported.`, `Accepted values are: ${values.join(', ')}.`, 'Use one of the canonical descriptor values.', inputSource(sourceRef, input));
}
function literalMaximum(expression, sourceRef, diagnostics) {
    const value = expression?.kind === 'literal' && expression.valueType === 'number' ? expression.value : undefined;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= DEFAULT_MAX_BINARY_BYTES) {
        return value;
    }
    report(diagnostics, 'TW2_NAMED_INVALID_MAX', `Named response MAX_BYTES must be an integer literal from 1 to ${DEFAULT_MAX_BINARY_BYTES}.`, 'A static byte bound is required for target planning and runtime enforcement.', 'Use a numeric literal within the compiler-wide binary limit.', inputSource(sourceRef, 'MAX_BYTES'));
}
function hasControlCharacter(value) {
    return [...value].some((character) => {
        const point = character.codePointAt(0);
        return point <= 0x1f || point === 0x7f;
    });
}
function inputSource(sourceRef, input) {
    return { ...sourceRef, input };
}
function report(diagnostics, code, message, reason, suggestion, sourceRef) {
    diagnostics.push({ severity: 'error', code, message, reason, suggestion, sourceRef });
}
//# sourceMappingURL=lowering.js.map