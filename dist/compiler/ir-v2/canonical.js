export function canonicalizeDeployIrV2(ir) {
    return canonicalizeJson(ir);
}
export function canonicalizeJson(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'boolean')
        return JSON.stringify(value);
    if (typeof value === 'string') {
        assertWellFormedUnicode(value);
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new Error('JCS numbers must be finite.');
        return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value))
        return `[${value.map(canonicalizeJson).join(',')}]`;
    const keys = Object.keys(value);
    for (const key of keys)
        assertWellFormedUnicode(key);
    return `{${keys
        .sort(compareUtf16)
        .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
        .join(',')}}`;
}
function assertWellFormedUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                throw new Error('JCS strings must not contain lone surrogates.');
            }
            index += 1;
        }
        else if (code >= 0xdc00 && code <= 0xdfff) {
            throw new Error('JCS strings must not contain lone surrogates.');
        }
    }
}
function compareUtf16(left, right) {
    if (left < right)
        return -1;
    if (left > right)
        return 1;
    return 0;
}
//# sourceMappingURL=canonical.js.map