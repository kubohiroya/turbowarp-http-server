export interface CompilerFeatureFlags {
  compilerIrV2: boolean;
  namedResponseBody: boolean;
}

export const DEFAULT_COMPILER_FEATURE_FLAGS: Readonly<CompilerFeatureFlags> = Object.freeze({
  compilerIrV2: false,
  namedResponseBody: false
});

export function compilerFeatureFlagsForIrVersion(version: 1 | 2): CompilerFeatureFlags {
  return {compilerIrV2: version === 2, namedResponseBody: false};
}
