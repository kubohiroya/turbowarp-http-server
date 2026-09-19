import type { BinaryContentDispositionV2, BinaryLocatorV2, BinaryMetadataV2 } from '../ir-v2/types.js';
export declare function validateBinaryLocator(locator: BinaryLocatorV2): BinaryLocatorV2;
export declare function validateBinaryMetadata(metadata: BinaryMetadataV2): BinaryMetadataV2;
export declare function encodeContentDisposition(disposition: BinaryContentDispositionV2): string;
