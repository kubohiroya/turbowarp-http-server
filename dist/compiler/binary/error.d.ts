export declare const BINARY_RUNTIME_ERROR_CODES: readonly ["BINARY_INVALID_REF", "BINARY_NOT_FOUND", "BINARY_TOO_LARGE", "BINARY_INTEGRITY_MISMATCH", "BINARY_BODY_CONSUMED", "BINARY_STORAGE_FAILURE"];
export type BinaryRuntimeErrorCode = (typeof BINARY_RUNTIME_ERROR_CODES)[number];
export declare function binaryError(code: BinaryRuntimeErrorCode, message: string): never;
