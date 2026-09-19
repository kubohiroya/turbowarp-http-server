export const DEFAULT_COMPILER_FEATURE_FLAGS = Object.freeze({
    compilerIrV2: false,
    namedResponseBody: false
});
export function compilerFeatureFlagsForIrVersion(version) {
    return { compilerIrV2: version === 2, namedResponseBody: false };
}
//# sourceMappingURL=feature-flags.js.map