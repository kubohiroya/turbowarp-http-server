import type { SourceRefV2 } from '../ir-v2/types.js';
export type ServerSubsetDiagnosticCode = 'TW2_GLOBAL_STATE_UNSUPPORTED' | 'TW2_MESSAGE_UNSUPPORTED' | 'TW2_UNBOUNDED_LOOP' | 'TW2_CLONE_UNSUPPORTED' | 'TW2_RUNTIME_DEPENDENCY_UNSUPPORTED' | 'TW2_UNSUPPORTED_BLOCK' | 'TW2_UNSUPPORTED_OPERATION' | 'TW2_CONTROL_FLOW_UNSUPPORTED' | 'TW2_LOOP_BOUND_INVALID' | 'TW2_LOOP_NESTING_EXCEEDED' | 'TW2_WORK_BUDGET_EXCEEDED' | 'TW2_MISSING_RESPONSE' | 'TW2_MULTIPLE_RESPONSE' | 'TW2_RESPONSE_AFTER_TERMINAL' | 'TW2_RESPONSE_IN_LOOP' | 'TW2_HANDLER_VARIABLE_TYPE' | 'TW2_BINDING_UNDECLARED' | 'TW2_BINDING_TYPE_MISMATCH' | 'TW2_BINDING_DUPLICATE' | 'TW2_BRANCH_BINDING_MISMATCH' | 'TW2_CAPABILITY_MISSING' | 'TW2_CONDITION_TYPE' | 'TW2_ITERATION_CONTEXT_REQUIRED' | 'TW2_BINARY_BODY_CONSUMED' | 'TW2_BINARY_BODY_SCOPE' | 'TW2_BINARY_BODY_UNDECLARED';
export interface TargetNeutralDiagnostic {
    severity: 'error';
    phase: 'target-neutral';
    code: ServerSubsetDiagnosticCode;
    message: string;
    routeId: string;
    reason: string;
    suggestion: string;
    sourceRef?: SourceRefV2;
}
export interface TargetCapabilityDiagnostic {
    severity: 'error';
    phase: 'target-capability';
    code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED';
    message: string;
    routeId: string;
    reason: string;
    suggestion: string;
    targetId: string;
    sourceRef?: SourceRefV2;
}
export interface ServerSubsetPolicy {
    maxLoopIterations: number;
    maxLoopNesting: number;
    maxRouteWork: number;
}
export declare const DEFAULT_SERVER_SUBSET_POLICY: Readonly<ServerSubsetPolicy>;
