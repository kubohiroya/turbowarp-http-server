import { type CompilerFeatureFlags } from '../feature-flags.js';
import type { DeployIrV2 } from '../ir-v2/types.js';
import type { GeneratedProject, GeneratorOutputManifest, PipelineDiagnostic, PlatformAdapter } from './types.js';
export interface CompileDeployIrV2Options {
    target: string;
    targetConfig?: unknown;
    adapters?: readonly PlatformAdapter[];
    featureFlags?: Partial<CompilerFeatureFlags>;
}
export type CompileDeployIrV2Result = {
    ok: true;
    files: GeneratedProject;
    manifest: GeneratorOutputManifest;
} | {
    ok: false;
    diagnostics: PipelineDiagnostic[];
};
export declare function compileDeployIrV2(ir: DeployIrV2, options: CompileDeployIrV2Options): CompileDeployIrV2Result;
