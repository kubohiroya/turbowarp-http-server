import { type DeployIrV2 } from './types.js';
export type DeployIrV2ParseErrorCode = 'TW2_IR_JSON_SYNTAX' | 'TW2_IR_DUPLICATE_KEY' | 'TW2_IR_VERSION' | 'TW2_IR_UNKNOWN_FIELD' | 'TW2_IR_UNKNOWN_NODE' | 'TW2_IR_INVALID_VALUE';
export declare class DeployIrV2ParseError extends Error {
    readonly code: DeployIrV2ParseErrorCode;
    readonly cause?: unknown | undefined;
    readonly name = "DeployIrV2ParseError";
    constructor(code: DeployIrV2ParseErrorCode, message: string, cause?: unknown | undefined);
}
export declare function parseDeployIrV2Json(text: string): DeployIrV2;
export declare function parseDeployIrV2(value: unknown): DeployIrV2;
