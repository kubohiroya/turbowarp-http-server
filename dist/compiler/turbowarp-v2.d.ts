import { type CompilerDiagnosticV2, type DeployIrV2 } from './ir-v2/types.js';
import type { CompilerOpcodeRegistry } from './manifest/types.js';
export interface CompileTurboWarpProjectV2Result {
    ir: DeployIrV2;
    diagnostics: CompilerDiagnosticV2[];
}
/** Compiles the locked server-executable TurboWarp subset directly into typed IR v2. */
export declare function compileTurboWarpProjectV2(value: unknown, registry?: CompilerOpcodeRegistry): CompileTurboWarpProjectV2Result;
