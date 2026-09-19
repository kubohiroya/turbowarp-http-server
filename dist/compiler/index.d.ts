import { type CompilerDiagnosticV2, type DeployIrV2 } from './ir-v2/index.js';
import { type PipelineDiagnostic } from './pipeline/index.js';
export * from './feature-flags.js';
export * from './adapters/index.js';
export * from './binary/index.js';
export * from './ir-v2/index.js';
export * from './manifest/index.js';
export * from './named-body/index.js';
export * from './pipeline/index.js';
export * from './runtime/index.js';
export * from './structured-data/index.js';
export * from './turbowarp-v2.js';
export * from './validator/index.js';
export type CompilerInputFormat = 'turbowarp-json' | 'ir';
export interface CompileOptions {
    input: string;
    output: string;
    format: CompilerInputFormat;
    force?: boolean;
    target: string;
    targetConfig?: string;
    manifestLock?: string;
    namedResponseBody?: boolean;
}
export interface CompilerOutput {
    ir: DeployIrV2;
    diagnostics: Array<CompilerDiagnosticV2 | PipelineDiagnostic>;
    files: string[];
}
export declare function compileToDirectory(options: CompileOptions): Promise<CompilerOutput>;
type AnyCompilerDiagnostic = CompilerDiagnosticV2 | PipelineDiagnostic;
export declare class CompilerDiagnosticsError extends Error {
    readonly diagnostics: AnyCompilerDiagnostic[];
    constructor(diagnostics: AnyCompilerDiagnostic[]);
}
