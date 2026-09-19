import { type CompilerManifestLimits } from './parse.js';
import type { CompilerManifestLock, CompilerOpcodeRegistry, ResolvedCompilerManifest } from './types.js';
export type BundledCompilerManifests = Readonly<Record<string, string | Uint8Array>>;
export interface ResolveCompilerManifestOptions {
    bundled?: BundledCompilerManifests;
    limits?: Readonly<CompilerManifestLimits>;
}
export interface ResolvedCompilerManifestLock {
    lock: CompilerManifestLock;
    manifests: readonly ResolvedCompilerManifest[];
    registry: CompilerOpcodeRegistry;
}
export declare function resolveCompilerManifestLock(lockPath: string | undefined, options?: ResolveCompilerManifestOptions): Promise<ResolvedCompilerManifestLock>;
export declare function manifestIntegrity(bytes: string | Uint8Array): `sha256-${string}`;
