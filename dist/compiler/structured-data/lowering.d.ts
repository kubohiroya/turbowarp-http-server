import type { CompilerOpcodeRegistryEntry } from '../manifest/types.js';
import { type ExpressionIrV2, type SourceRefV2, type StatementIrV2 } from '../ir-v2/types.js';
export type StructuredDataLoweringDiagnosticCode = 'TW2_STRUCTURED_INVALID_LITERAL' | 'TW2_STRUCTURED_INVALID_NAME' | 'TW2_STRUCTURED_DYNAMIC_PATH' | 'TW2_STRUCTURED_INVALID_PATH' | 'TW2_STRUCTURED_INVALID_MAX' | 'TW2_STRUCTURED_TYPE_MISMATCH' | 'TW2_ITERATION_CONTEXT_REQUIRED' | 'TW2_UNSUPPORTED_OPERATION';
export interface StructuredDataLoweringDiagnostic {
    severity: 'error';
    code: StructuredDataLoweringDiagnosticCode;
    message: string;
    reason: string;
    suggestion: string;
    sourceRef: SourceRefV2;
}
export type StructuredDataArguments = Readonly<Record<string, ExpressionIrV2>>;
export declare const STRUCTURED_DATA_EXTENSION_ID = "kubohiroyastructureddata";
export declare const STRUCTURED_DATA_PACKAGE_NAME = "@kubohiroya/turbowarp-structured-data";
/**
 * Exact package versions whose manifest signatures and block semantics this lowering was checked
 * against. Any other locked version stops at the first Structured Data block; nothing falls back.
 */
export declare const STRUCTURED_DATA_PACKAGE_VERSIONS: readonly string[];
export declare function isStructuredDataEntry(entry: CompilerOpcodeRegistryEntry): boolean;
/**
 * Lowers Structured Data 0.11 blocks. Named values become request-local IR state: reads go through
 * `named-value`, writes through `named-value-set`, and every path operation is one of the existing
 * immutable json nodes between them.
 */
export declare class StructuredDataLoweringContext {
    private readonly loopIds;
    readonly diagnostics: StructuredDataLoweringDiagnostic[];
    constructor(diagnostics?: StructuredDataLoweringDiagnostic[], loopIds?: readonly string[]);
    lowerReporter(entry: CompilerOpcodeRegistryEntry, args: StructuredDataArguments, sourceRef: SourceRefV2): ExpressionIrV2 | undefined;
    lowerStatement(entry: CompilerOpcodeRegistryEntry, args: StructuredDataArguments, sourceRef: SourceRefV2): StatementIrV2 | undefined;
    lowerForEach(entry: CompilerOpcodeRegistryEntry, args: StructuredDataArguments, sourceRef: SourceRefV2, lowerBody: (context: StructuredDataLoweringContext) => StatementIrV2[]): StatementIrV2 | undefined;
    private operation;
    private current;
    /** NAME may be any expression; only a literal that is empty after trimming is known to fail. */
    private name;
    /** parse JSON TEXT: a literal is decoded now with the codec limits, anything else at runtime. */
    private decodeText;
    /** set VALUE: the browser only JSON.parses it, so neither literal nor dynamic VALUE has codec limits. */
    private parseJsonArgument;
    private jsonText;
    private literalPath;
    private literalMaximum;
    private missingArgument;
    /** An allowlisted operation this phase does not lower, or one used in the wrong block position. */
    private notLowered;
    private unsupported;
    private report;
}
