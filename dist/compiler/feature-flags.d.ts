export interface CompilerFeatureFlags {
    compilerIrV2: boolean;
}
export declare const DEFAULT_COMPILER_FEATURE_FLAGS: Readonly<CompilerFeatureFlags>;
export declare function compilerFeatureFlagsForIrVersion(version: 1 | 2): CompilerFeatureFlags;
