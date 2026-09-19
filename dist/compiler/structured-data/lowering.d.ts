import type { CompilerOpcodeRegistryEntry } from '../manifest/types.js';
import { type ExpressionIrV2, type SourceRefV2, type StatementIrV2 } from '../ir-v2/types.js';
export type StructuredDataLoweringDiagnosticCode = 'TW2_STRUCTURED_INVALID_LITERAL' | 'TW2_STRUCTURED_DYNAMIC_PATH' | 'TW2_STRUCTURED_INVALID_PATH' | 'TW2_STRUCTURED_INVALID_MAX' | 'TW2_STRUCTURED_TYPE_MISMATCH' | 'TW2_ITERATION_CONTEXT_REQUIRED' | 'TW2_UNSUPPORTED_OPERATION';
export interface StructuredDataLoweringDiagnostic {
    severity: 'error';
    code: StructuredDataLoweringDiagnosticCode;
    message: string;
    reason: string;
    suggestion: string;
    sourceRef: SourceRefV2;
}
export type StructuredDataArguments = Readonly<Record<string, ExpressionIrV2>>;
export declare const STRUCTURED_DATA_PACKAGE_NAME = "@kubohiroya/turbowarp-structured-data";
export declare const STRUCTURED_DATA_PACKAGE_VERSION = "0.4.0";
export declare class StructuredDataLoweringContext {
    private readonly loopIds;
    readonly diagnostics: StructuredDataLoweringDiagnostic[];
    constructor(diagnostics?: StructuredDataLoweringDiagnostic[], loopIds?: readonly string[]);
    lowerReporter(entry: CompilerOpcodeRegistryEntry, args: StructuredDataArguments, sourceRef: SourceRefV2): ExpressionIrV2 | undefined;
    lowerForEach(entry: CompilerOpcodeRegistryEntry, args: StructuredDataArguments, sourceRef: SourceRefV2, lowerBody: (context: StructuredDataLoweringContext) => StatementIrV2[]): StatementIrV2 | undefined;
    private operation;
    private current;
    private parseJsonArgument;
    private jsonText;
    private literalPath;
    private literalMaximum;
    private missingArgument;
    private unsupported;
    private report;
}
