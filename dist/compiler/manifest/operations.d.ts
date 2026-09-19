import type { CompilerManifestArgument, CompilerManifestBlock, ManifestBlockType, ManifestEffect, ManifestResultType } from './types.js';
interface ServerOperationSignature {
    opcode: string;
    blockType: ManifestBlockType;
    arguments: readonly CompilerManifestArgument[];
    resultType: ManifestResultType;
    effect: ManifestEffect;
    immutable: boolean;
}
export declare const KNOWN_SERVER_OPERATIONS: Readonly<Record<string, ServerOperationSignature>>;
export declare function validateServerOperationHint(block: CompilerManifestBlock): void;
export {};
