import type { JsonValue, PathSegmentV2 } from '../ir-v2/types.js';
export declare const STRUCTURED_DATA_HTTP_STATUS = 422;
export declare const STRUCTURED_DATA_RUNTIME_ERROR_CODES: readonly ["INVALID_JSON", "INVALID_PATH", "PATH_NOT_FOUND", "TYPE_MISMATCH", "INDEX_OUT_OF_RANGE", "ITERATION_LIMIT_EXCEEDED", "ITERATION_CONTEXT_REQUIRED"];
export type StructuredDataRuntimeErrorCode = (typeof STRUCTURED_DATA_RUNTIME_ERROR_CODES)[number];
export interface StructuredIterationEntry {
    key: string;
    index: number;
    value: JsonValue;
}
export declare function parseApplicationJson(text: unknown): JsonValue;
export declare function isValidApplicationJson(text: unknown): boolean;
export declare function stringifyApplicationJson(value: JsonValue): string;
export declare function getJsonAtPath(root: JsonValue, path: readonly PathSegmentV2[]): JsonValue;
export declare function hasJsonAtPath(root: JsonValue, path: readonly PathSegmentV2[]): boolean;
export declare function setJsonAtPath(root: JsonValue, path: readonly PathSegmentV2[], replacement: JsonValue): JsonValue;
export declare function deleteJsonAtPath(root: JsonValue, path: readonly PathSegmentV2[]): JsonValue;
export declare function jsonKeysAtPath(root: JsonValue, path: readonly PathSegmentV2[]): string[];
export declare function jsonLengthAtPath(root: JsonValue, path: readonly PathSegmentV2[]): number;
export declare function structuredIterationEntries(root: JsonValue, path: readonly PathSegmentV2[], maximum: number): StructuredIterationEntry[];
export declare function compareUnicodeCodePoints(left: string, right: string): number;
