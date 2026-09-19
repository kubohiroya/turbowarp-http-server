import type { ExpressionIrV2, SourceRefV2, StatementIrV2 } from '../ir-v2/types.js';
export type NamedBodyLoweringDiagnosticCode = 'TW2_NAMED_DYNAMIC_DESCRIPTOR' | 'TW2_NAMED_INVALID_DESCRIPTOR' | 'TW2_NAMED_INVALID_MAX';
export interface NamedBodyLoweringDiagnostic {
    severity: 'error';
    code: NamedBodyLoweringDiagnosticCode;
    message: string;
    reason: string;
    suggestion: string;
    sourceRef: SourceRefV2;
}
export interface NamedBodyLoweringResult {
    statement?: Extract<StatementIrV2, {
        kind: 'respond-named-body';
    }>;
    diagnostics: NamedBodyLoweringDiagnostic[];
}
export type NamedBodyArguments = Readonly<Record<string, ExpressionIrV2>>;
export declare function lowerNamedBodyResponse(args: NamedBodyArguments, sourceRef: SourceRefV2): NamedBodyLoweringResult;
