import type { CompilerDiagnostic, DeployIr } from './ir.js';
export * from './feature-flags.js';
export * from './ir-v2/index.js';
export type CompilerInputFormat = 'turbowarp-json' | 'ir';
export interface CompileOptions {
    input: string;
    output: string;
    format: CompilerInputFormat;
    force?: boolean;
}
export interface CompilerOutput {
    ir: DeployIr;
    diagnostics: CompilerDiagnostic[];
    files: string[];
}
export declare function compileToDirectory(options: CompileOptions): Promise<CompilerOutput>;
export declare class CompilerDiagnosticsError extends Error {
    readonly diagnostics: CompilerDiagnostic[];
    constructor(diagnostics: CompilerDiagnostic[]);
}
