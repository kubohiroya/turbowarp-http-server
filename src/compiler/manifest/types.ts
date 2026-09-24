export const COMPILER_MANIFEST_FORMAT_VERSIONS = [1, 2] as const;
export const COMPILER_MANIFEST_LOCK_VERSION = 1 as const;

export type CompilerManifestFormatVersion = (typeof COMPILER_MANIFEST_FORMAT_VERSIONS)[number];

export type ManifestBlockType = 'COMMAND' | 'REPORTER' | 'BOOLEAN' | 'HAT' | 'LOOP';
export type ManifestArgumentType = 'STRING' | 'NUMBER' | 'BOOLEAN';
export type ManifestResultType =
  | 'json'
  | 'boolean'
  | 'number'
  | 'string'
  | 'void'
  /** A string whose content is serialized JSON or YAML, which 'string' alone would not record. */
  | 'jsonText'
  | 'yamlText';
export type ManifestEffect =
  | 'pure'
  | 'immutable'
  | 'control'
  | 'request-read'
  | 'response-write'
  | 'storage-read'
  | 'storage-write'
  | 'binary-read'
  | 'binary-write'
  /** Mutates extension-held data scoped to a target; storage-* means persistent storage instead. */
  | 'state';

export interface CompilerManifestArgument {
  id: string;
  type: ManifestArgumentType;
  menu?: string;
  normalizesTo?: 'pathSegments';
  staticLiteral?: boolean;
  minimum?: number;
  maximum?: number;
}

export interface CompilerManifestServerHint {
  supported: boolean;
  irOperation?: string;
}

export interface CompilerManifestBlock {
  opcode: string;
  blockType: ManifestBlockType;
  arguments: CompilerManifestArgument[];
  resultType?: ManifestResultType;
  effect?: ManifestEffect;
  immutable?: boolean;
  errors?: string[];
  server?: CompilerManifestServerHint;
}

export interface CompilerExtensionManifest {
  formatVersion: CompilerManifestFormatVersion;
  id: string;
  blocks: CompilerManifestBlock[];
  pathSegmentType?: {
    kind: 'discriminatedUnion';
    variants: [
      {kind: 'key'; valueType: 'string'},
      {kind: 'index'; valueType: 'nonNegativeInteger'}
    ];
  };
  dataReferenceType?: {
    kind: string;
    scope: string;
    lifetime: string;
    valueType: string;
  };
  menus?: unknown[];
}

export type CompilerManifestSource =
  | {kind: 'bundled'; id: string}
  | {kind: 'local'; path: string};

export interface CompilerManifestLockEntry {
  extensionId: string;
  packageName: string;
  packageVersion: string;
  manifestFormatVersion: CompilerManifestFormatVersion;
  integrity: `sha256-${string}`;
  source: CompilerManifestSource;
}

export interface CompilerManifestLock {
  lockVersion: typeof COMPILER_MANIFEST_LOCK_VERSION;
  extensions: CompilerManifestLockEntry[];
}

export interface ResolvedCompilerManifest {
  lock: CompilerManifestLockEntry;
  manifest: CompilerExtensionManifest;
  exactIntegrity: `sha256-${string}`;
}

export interface CompilerOpcodeRegistryEntry {
  extensionId: string;
  opcode: string;
  projectOpcode: string;
  packageName: string;
  packageVersion: string;
  block: CompilerManifestBlock;
}

export interface CompilerOpcodeRegistry {
  entries: readonly CompilerOpcodeRegistryEntry[];
  byProjectOpcode: ReadonlyMap<string, CompilerOpcodeRegistryEntry>;
}
