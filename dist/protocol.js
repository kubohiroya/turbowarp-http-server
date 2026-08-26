export const HTTP_BRIDGE_PROTOCOL = 'turbowarp-http-server';
export const HTTP_BRIDGE_PROTOCOL_VERSION = 1;
export function normalizeHeaderName(name) {
    return name.trim().toLowerCase();
}
export function isValidHttpStatus(status) {
    return Number.isInteger(status) && status >= 100 && status <= 599;
}
export function isBodyForbidden(method, status) {
    return method.toUpperCase() === 'HEAD' || status === 204 || status === 205 || status === 304;
}
export function isForbiddenResponseHeader(name) {
    return ['connection', 'content-length', 'transfer-encoding', 'upgrade'].includes(normalizeHeaderName(name));
}
export function validateHeaderName(name) {
    return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}
export function validateHeaderValue(value) {
    return !/[\r\n]/.test(value);
}
export function firstValue(values) {
    return values?.[0] ?? '';
}
export function parseBridgeClientMessage(value) {
    try {
        const parsed = JSON.parse(value);
        if (parsed.type === 'response' && typeof parsed.id === 'string') {
            return {
                type: 'response',
                id: parsed.id,
                status: typeof parsed.status === 'number' ? parsed.status : 200,
                headers: requireHeaderRecord(parsed.headers),
                body: requireBridgeBody(parsed.body)
            };
        }
        if (parsed.type === 'error') {
            const error = {
                type: 'error',
                message: typeof parsed.message === 'string' ? parsed.message : 'Bridge error.'
            };
            if (typeof parsed.id === 'string')
                error.id = parsed.id;
            return error;
        }
    }
    catch {
        return null;
    }
    return null;
}
export function requireHeaderRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return {};
    const result = {};
    for (const [name, rawValues] of Object.entries(value)) {
        const values = Array.isArray(rawValues) ? rawValues : [rawValues];
        result[name] = values.map((item) => String(item));
    }
    return result;
}
export function requireBridgeBody(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return { kind: 'empty' };
    const record = value;
    if (record.kind === 'text')
        return { kind: 'text', text: String(record.text ?? '') };
    if (record.kind === 'unsupported')
        return { kind: 'unsupported', reason: String(record.reason ?? '') };
    return { kind: 'empty' };
}
//# sourceMappingURL=protocol.js.map