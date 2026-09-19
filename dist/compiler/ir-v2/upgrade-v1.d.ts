import type { DeployIr } from '../ir.js';
import type { CompilerDiagnosticV2, DeployIrV2 } from './types.js';
export interface LegacyTargetConfigV2 {
    target: 'cloudflare-workers';
    auth?: {
        provider: 'cloudflare-access';
    };
}
export interface UpgradeDeployIrV1Result {
    ir: DeployIrV2;
    diagnostics: CompilerDiagnosticV2[];
    targetConfig?: LegacyTargetConfigV2;
}
export declare function upgradeDeployIrV1(ir: DeployIr, target?: string): UpgradeDeployIrV1Result;
