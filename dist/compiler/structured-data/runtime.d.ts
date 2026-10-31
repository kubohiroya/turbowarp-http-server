import type { JsonValue, PathSegmentV2 } from '../ir-v2/types.js';
export declare const STRUCTURED_DATA_HTTP_STATUS = 422;
export declare const STRUCTURED_DATA_RUNTIME_ERROR_CODES: readonly ["INVALID_JSON", "INVALID_NAME", "DATA_NOT_FOUND", "INVALID_PATH", "PATH_NOT_FOUND", "TYPE_MISMATCH", "INDEX_OUT_OF_RANGE", "ITERATION_LIMIT_EXCEEDED", "ITERATION_CONTEXT_REQUIRED", "PARSE_LIMIT_EXCEEDED"];
/**
 * The limits `@kubohiroya/turbowarp-yaml-json`'s codec applies when Structured Data parses text. The
 * root value is at depth 0 and each nested value one deeper; every value counts toward the node limit,
 * object keys do not.
 */
export declare const STRUCTURED_DECODE_LIMITS: {
    readonly maxInputBytes: number;
    readonly maxDepth: 64;
    readonly maxNodes: 50000;
};
export type StructuredDataRuntimeErrorCode = (typeof STRUCTURED_DATA_RUNTIME_ERROR_CODES)[number];
export interface StructuredIterationEntry {
    key: string;
    index: number;
    value: JsonValue;
}
export declare function parseApplicationJson(text: unknown): JsonValue;
/**
 * Decodes JSON text the way Structured Data's `parse JSON` block does: the UTF-8 size is checked before
 * parsing, a syntax error is INVALID_JSON, and the depth and node limits are then checked in the same
 * depth-first order as the codec, so a non-finite number met first is INVALID_JSON and a limit met
 * first is PARSE_LIMIT_EXCEEDED.
 */
export declare function decodeStructuredJson(text: string): JsonValue;
/** The name a Structured Data block reads: Scratch's Cast.toString, then trimmed; empty is INVALID_NAME. */
export declare function structuredDataName(value: unknown): string;
/** A scalar as reporter text: a string as is, a number or boolean as JSON; null and containers fail. */
export declare function jsonScalarText(value: JsonValue): string;
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
