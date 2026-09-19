export interface StrictJsonParseOptions {
    maxDepth?: number;
}
export declare function parseJsonWithoutDuplicateKeys(text: string, options?: StrictJsonParseOptions): unknown;
