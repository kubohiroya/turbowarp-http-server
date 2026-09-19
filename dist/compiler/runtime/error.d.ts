export declare class IrRuntimeError extends Error {
    readonly code: string;
    readonly httpStatus: number;
    readonly name = "IrRuntimeError";
    constructor(code: string, message: string, httpStatus: number);
}
