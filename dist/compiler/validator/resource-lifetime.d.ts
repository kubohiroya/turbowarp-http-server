import type { SourceRefV2 } from '../ir-v2/types.js';
import type { TargetNeutralDiagnostic } from './types.js';
export declare class BinaryBodyLifetimeTracker {
    private readonly routeId;
    private readonly diagnostics;
    private readonly scopes;
    private readonly retired;
    constructor(routeId: string, diagnostics: TargetNeutralDiagnostic[]);
    enterScope(): void;
    leaveScope(): void;
    declare(id: string, sourceRef?: SourceRefV2): void;
    consume(id: string, sourceRef?: SourceRefV2): boolean;
    private find;
    private report;
}
