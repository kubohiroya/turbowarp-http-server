export type CompilerManifestDiagnosticCode = 'TW2_MANIFEST_JSON_SYNTAX' | 'TW2_MANIFEST_DUPLICATE_KEY' | 'TW2_MANIFEST_SCHEMA' | 'TW2_MANIFEST_UNSUPPORTED_VERSION' | 'TW2_MANIFEST_TOO_LARGE' | 'TW2_MANIFEST_TOO_DEEP' | 'TW2_MANIFEST_TOO_MANY_BLOCKS' | 'TW2_MANIFEST_DUPLICATE_OPCODE' | 'TW2_MANIFEST_DUPLICATE_EXTENSION' | 'TW2_MANIFEST_LOCK_REQUIRED' | 'TW2_MANIFEST_LOCK_MISMATCH' | 'TW2_MANIFEST_INTEGRITY_MISMATCH' | 'TW2_MANIFEST_SOURCE_UNSAFE' | 'TW2_MANIFEST_SOURCE_NOT_FOUND' | 'TW2_MANIFEST_OPERATION_MISMATCH' | 'TW2_MANIFEST_UNKNOWN_OPCODE';
export declare class CompilerManifestError extends Error {
    readonly code: CompilerManifestDiagnosticCode;
    readonly cause?: unknown | undefined;
    readonly name = "CompilerManifestError";
    constructor(code: CompilerManifestDiagnosticCode, message: string, cause?: unknown | undefined);
}
