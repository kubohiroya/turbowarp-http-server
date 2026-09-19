import type { CapabilityRequirementV2, DeployIrV2, SourceRefV2 } from '../ir-v2/types.js';
import type { CapabilityRequirements } from './types.js';
export interface CapabilityOrigin {
    routeId: string;
    sourceRef?: SourceRefV2;
}
export declare function extractCapabilityRequirements(ir: DeployIrV2): CapabilityRequirements;
export declare function capabilityKey(capability: CapabilityRequirementV2): string;
export declare function findCapabilityOrigin(ir: DeployIrV2, key: string): CapabilityOrigin | undefined;
