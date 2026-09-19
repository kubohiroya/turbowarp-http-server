export const DEFAULT_COMPILER_FEATURE_FLAGS = Object.freeze({
    compilerIrV2: false
});
export function compilerFeatureFlagsForIrVersion(version) {
    return { compilerIrV2: version === 2 };
}
//# sourceMappingURL=feature-flags.js.map