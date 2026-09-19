import { IrRuntimeError } from '../runtime/error.js';
import { DEFAULT_MAX_BINARY_BYTES } from './types.js';
import { validateBinaryLocator, validateBinaryMetadata } from './codec.js';
import { binaryError } from './error.js';
export class BinaryBodyHandle {
    constructor(source) {
        this.source = source;
        this.consumed = false;
    }
    take() {
        if (this.consumed)
            binaryError('BINARY_BODY_CONSUMED', 'Binary body has already been consumed.');
        this.consumed = true;
        return this.source;
    }
}
export function effectiveBinaryLimit(operationLimit, compilerLimit = DEFAULT_MAX_BINARY_BYTES, targetLimit = Number.MAX_SAFE_INTEGER) {
    for (const limit of [operationLimit, compilerLimit, targetLimit]) {
        if (!Number.isSafeInteger(limit) || limit < 1)
            binaryError('BINARY_INVALID_REF', 'Binary limit is invalid.');
    }
    return Math.min(operationLimit, compilerLimit, targetLimit);
}
export async function collectBinaryBody(source, maxBytes) {
    if (source.size !== undefined && (!Number.isSafeInteger(source.size) || source.size < 0)) {
        binaryError('BINARY_INVALID_REF', 'Binary body size is invalid.');
    }
    if (source.size !== undefined && source.size > maxBytes) {
        binaryError('BINARY_TOO_LARGE', 'Binary body exceeds the configured limit.');
    }
    const chunks = [];
    let total = 0;
    const iterator = source.chunks[Symbol.asyncIterator]();
    try {
        while (true) {
            const item = await iterator.next();
            if (item.done)
                break;
            total += item.value.byteLength;
            if (total > maxBytes) {
                await iterator.return?.();
                binaryError('BINARY_TOO_LARGE', 'Binary body exceeds the configured limit.');
            }
            chunks.push(item.value.slice());
        }
    }
    catch (error) {
        if (error instanceof IrRuntimeError)
            throw error;
        binaryError('BINARY_STORAGE_FAILURE', 'Binary stream failed.');
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}
export class InMemoryBinaryObjectStore {
    constructor() {
        this.objects = new Map();
        this.revision = 0;
    }
    async resolve(locator) {
        return this.objects.get(locatorKey(validateBinaryLocator(locator)))?.ref ?? null;
    }
    async get(ref) {
        validateBinaryLocator(ref);
        validateBinaryMetadata(ref);
        const object = this.objects.get(locatorKey(ref));
        if (object === undefined || (ref.revision !== undefined && object.ref.revision !== ref.revision))
            return null;
        const bytes = object.bytes.slice();
        const source = { chunks: chunksOf(bytes), size: bytes.byteLength };
        return object.ref.contentType === undefined ? source : { ...source, contentType: object.ref.contentType };
    }
    async put(locator, source, metadata, maxBytes) {
        validateBinaryLocator(locator);
        validateBinaryMetadata(metadata);
        const bytes = await collectBinaryBody(source, maxBytes);
        if (metadata.size !== undefined && metadata.size !== bytes.byteLength) {
            binaryError('BINARY_INTEGRITY_MISMATCH', 'Binary size does not match.');
        }
        const integrity = await sha256Integrity(bytes);
        if (metadata.integrity !== undefined && metadata.integrity !== integrity) {
            binaryError('BINARY_INTEGRITY_MISMATCH', 'Binary integrity does not match.');
        }
        this.revision += 1;
        const ref = {
            ...locator,
            size: bytes.byteLength,
            integrity,
            revision: String(this.revision),
            ...(metadata.contentType === undefined ? {} : { contentType: metadata.contentType })
        };
        this.objects.set(locatorKey(locator), { bytes: bytes.slice(), ref });
        return ref;
    }
    async delete(target) {
        validateBinaryLocator(target);
        const key = locatorKey(target);
        const current = this.objects.get(key);
        if (current === undefined)
            return false;
        if ('revision' in target && target.revision !== undefined && target.revision !== current.ref.revision)
            return false;
        return this.objects.delete(key);
    }
}
async function sha256Integrity(bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer));
    return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
function locatorKey(locator) {
    return `${locator.namespace}\u0000${locator.key}`;
}
async function* chunksOf(bytes) {
    yield bytes;
}
//# sourceMappingURL=runtime.js.map