import { type CompilerExtensionManifest, type CompilerManifestLock } from './types.js';
export interface CompilerManifestLimits {
    maxBytes: number;
    maxDepth: number;
    maxBlocks: number;
}
export declare const DEFAULT_COMPILER_MANIFEST_LIMITS: Readonly<CompilerManifestLimits>;
export declare function parseCompilerExtensionManifestJson(text: string, limits?: Readonly<CompilerManifestLimits>): CompilerExtensionManifest;
export declare function parseCompilerManifestLockJson(text: string, limits?: Readonly<Pick<CompilerManifestLimits, 'maxBytes' | 'maxDepth'>>): CompilerManifestLock;
