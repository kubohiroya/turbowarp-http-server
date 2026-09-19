export class CompilerManifestError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = 'CompilerManifestError';
    }
}
//# sourceMappingURL=error.js.map