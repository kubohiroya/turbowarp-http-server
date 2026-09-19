import type { CompilerOpcodeRegistry } from '../manifest/types.js';
import { type ServerSubsetPolicy, type TargetNeutralDiagnostic } from './types.js';
export declare function validateTurboWarpServerSubset(value: unknown, registry?: CompilerOpcodeRegistry, policy?: Readonly<ServerSubsetPolicy>): TargetNeutralDiagnostic[];
