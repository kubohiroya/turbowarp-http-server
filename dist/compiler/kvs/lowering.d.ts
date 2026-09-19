import type { CompilerDiagnosticV2, ExpressionIrV2, SourceRefV2, StatementIrV2 } from '../ir-v2/types.js';
import type { CompilerOpcodeRegistryEntry } from '../manifest/types.js';
export type KvsArguments = Readonly<Record<string, ExpressionIrV2>>;
export declare class KvsLoweringContext {
    readonly diagnostics: CompilerDiagnosticV2[];
    constructor(diagnostics?: CompilerDiagnosticV2[]);
    lowerStatement(entry: CompilerOpcodeRegistryEntry, args: KvsArguments, sourceRef: SourceRefV2): StatementIrV2 | undefined;
    lowerReporter(entry: CompilerOpcodeRegistryEntry, args: KvsArguments, sourceRef: SourceRefV2): ExpressionIrV2 | undefined;
    private operation;
    private missingArgument;
    private unsupported;
}
export declare function isKvsEntry(entry: CompilerOpcodeRegistryEntry): boolean;
