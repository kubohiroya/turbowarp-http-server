export class IrRuntimeError extends Error {
    constructor(code, message, httpStatus) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.name = 'IrRuntimeError';
    }
}
//# sourceMappingURL=error.js.map