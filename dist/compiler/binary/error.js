import { IrRuntimeError } from '../runtime/error.js';
export const BINARY_RUNTIME_ERROR_CODES = [
    'BINARY_INVALID_REF',
    'BINARY_NOT_FOUND',
    'BINARY_TOO_LARGE',
    'BINARY_INTEGRITY_MISMATCH',
    'BINARY_BODY_CONSUMED',
    'BINARY_STORAGE_FAILURE'
];
const BINARY_STATUS = {
    BINARY_INVALID_REF: 422,
    BINARY_NOT_FOUND: 404,
    BINARY_TOO_LARGE: 413,
    BINARY_INTEGRITY_MISMATCH: 502,
    BINARY_BODY_CONSUMED: 500,
    BINARY_STORAGE_FAILURE: 502
};
export function binaryError(code, message) {
    throw new IrRuntimeError(code, message, BINARY_STATUS[code]);
}
//# sourceMappingURL=error.js.map