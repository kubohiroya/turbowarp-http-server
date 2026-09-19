import type { CompilerDiagnostic, DeployIr } from './ir.js';
import { type DeployIrV2 } from './ir-v2/index.js';
import { type PipelineDiagnostic } from './pipeline/index.js';
export * from './feature-flags.js';
export * from './adapters/index.js';
export * from './binary/index.js';
export * from './ir-v2/index.js';
export * from './manifest/index.js';
export * from './pipeline/index.js';
export * from './runtime/index.js';
export * from './structured-data/index.js';
export * from './validator/index.js';
export type CompilerInputFormat = 'turbowarp-json' | 'ir';
export interface CompileOptions {
    input: string;
    output: string;
    format: CompilerInputFormat;
    force?: boolean;
    irVersion?: 1 | 2;
    target?: string;
    targetConfig?: string;
    namedResponseBody?: boolean;
}
export interface CompilerOutput {
    ir: DeployIr | DeployIrV2;
    diagnostics: Array<CompilerDiagnostic | PipelineDiagnostic>;
    files: string[];
}
export declare function compileToDirectory(options: CompileOptions): Promise<CompilerOutput>;
type AnyCompilerDiagnostic = CompilerDiagnostic | PipelineDiagnostic;
export declare class CompilerDiagnosticsError extends Error {
    readonly diagnostics: AnyCompilerDiagnostic[];
    constructor(diagnostics: AnyCompilerDiagnostic[]);
}
