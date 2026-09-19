import type { CompilerOpcodeRegistry, CompilerOpcodeRegistryEntry, ResolvedCompilerManifest } from './types.js';
export declare function buildCompilerOpcodeRegistry(resolvedManifests: readonly ResolvedCompilerManifest[]): CompilerOpcodeRegistry;
export declare function resolveCompilerProjectOpcode(registry: CompilerOpcodeRegistry, projectOpcode: string): CompilerOpcodeRegistryEntry;
