import type {BinaryLocatorV2, BinaryMetadataV2, BinaryRefDescriptorV2} from '../ir-v2/types.js';

export const DEFAULT_MAX_BINARY_BYTES = 16 * 1024 * 1024;

export interface BinaryBodySource {
  readonly chunks: AsyncIterable<Uint8Array>;
  readonly contentType?: string;
  readonly size?: number;
}

export interface BinaryObjectStore {
  resolve(locator: BinaryLocatorV2): Promise<BinaryRefDescriptorV2 | null>;
  get(ref: BinaryRefDescriptorV2): Promise<BinaryBodySource | null>;
  put(
    locator: BinaryLocatorV2,
    source: BinaryBodySource,
    metadata: BinaryMetadataV2,
    maxBytes: number
  ): Promise<BinaryRefDescriptorV2>;
  delete(target: BinaryLocatorV2 | BinaryRefDescriptorV2): Promise<boolean>;
}

export interface BinaryTargetLimits {
  maxBinaryBytes: number;
  supportsStreaming: boolean;
}
