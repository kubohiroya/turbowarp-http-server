export interface CompilerFeatureFlags {
  namedResponseBody: boolean;
}

export const DEFAULT_COMPILER_FEATURE_FLAGS: Readonly<CompilerFeatureFlags> = Object.freeze({
  namedResponseBody: false
});
