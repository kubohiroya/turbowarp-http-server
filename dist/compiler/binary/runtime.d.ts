import type { BinaryLocatorV2, BinaryMetadataV2, BinaryRefDescriptorV2 } from '../ir-v2/types.js';
import { type BinaryBodySource, type BinaryObjectStore } from './types.js';
export declare class BinaryBodyHandle {
    private readonly source;
    private consumed;
    constructor(source: BinaryBodySource);
    take(): BinaryBodySource;
}
export declare function effectiveBinaryLimit(operationLimit: number, compilerLimit?: number, targetLimit?: number): number;
export declare function collectBinaryBody(source: BinaryBodySource, maxBytes: number): Promise<Uint8Array>;
export declare class InMemoryBinaryObjectStore implements BinaryObjectStore {
    private readonly objects;
    private revision;
    resolve(locator: BinaryLocatorV2): Promise<BinaryRefDescriptorV2 | null>;
    get(ref: BinaryRefDescriptorV2): Promise<BinaryBodySource | null>;
    put(locator: BinaryLocatorV2, source: BinaryBodySource, metadata: BinaryMetadataV2, maxBytes: number): Promise<BinaryRefDescriptorV2>;
    delete(target: BinaryLocatorV2 | BinaryRefDescriptorV2): Promise<boolean>;
}
