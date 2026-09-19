import type {DeployIrV2, SourceRefV2} from '../ir-v2/types.js';

export type GeneratedProject = Record<string, string>;

export interface GeneratedCore {
  files: GeneratedProject;
  entryModule: string;
}

export interface CapabilityRequirements {
  keys: readonly string[];
}

export interface PlatformCapabilities {
  keys: readonly string[];
  maxBinaryBytes?: number;
}

export interface PlatformPlan {
  targetId: string;
  adapterVersion: string;
  requirements: readonly string[];
  bindings: Readonly<Record<string, string>>;
}

export interface PipelineDiagnostic {
  severity: 'error';
  code: `TW2_${string}`;
  message: string;
  reason: string;
  suggestion: string;
  targetId?: string;
  routeId?: string;
  sourceRef?: SourceRefV2;
}

export type PlanResult =
  | {ok: true; plan: PlatformPlan}
  | {ok: false; diagnostics: PipelineDiagnostic[]};

export interface PlatformAdapter {
  readonly id: string;
  readonly version: string;
  capabilities(): PlatformCapabilities;
  plan(input: {ir: DeployIrV2; requirements: CapabilityRequirements; config: unknown}): PlanResult;
  generate(input: {ir: DeployIrV2; plan: PlatformPlan; core: GeneratedCore}): GeneratedProject;
}

export interface GeneratorOutputManifest {
  formatVersion: 1;
  irVersion: 2;
  adapter: {id: string; version: string};
  requirements: readonly string[];
  plan: {
    requirements: readonly string[];
    bindings: Readonly<Record<string, string>>;
  };
  files: readonly string[];
}
