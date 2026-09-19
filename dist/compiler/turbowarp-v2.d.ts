import type { CompilerDiagnosticV2, DeployIrV2 } from './ir-v2/types.js';
export interface CompileTurboWarpProjectV2Result {
    ir: DeployIrV2;
    diagnostics: CompilerDiagnosticV2[];
}
/** Compiles the current built-in HTTP block subset through the v1 compatibility frontend into IR v2. */
export declare function compileTurboWarpProjectV2(value: unknown): CompileTurboWarpProjectV2Result;
