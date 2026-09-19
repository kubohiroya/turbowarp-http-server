import type { DeployIrV2, SourceRefV2 } from '../ir-v2/types.js';
import { type CompilerFeatureFlags } from '../feature-flags.js';
import { type ServerSubsetPolicy, type TargetCapabilityDiagnostic, type TargetNeutralDiagnostic } from './types.js';
export declare function validateDeployIrV2Subset(ir: DeployIrV2, policy?: Readonly<ServerSubsetPolicy>, featureFlags?: Readonly<CompilerFeatureFlags>): TargetNeutralDiagnostic[];
export declare function targetCapabilityDiagnostic(input: {
    targetId: string;
    routeId: string;
    capability: string;
    sourceRef?: SourceRefV2;
}): TargetCapabilityDiagnostic;
