import {CompilerManifestError} from './error.js';
import {validateServerOperationHint} from './operations.js';
import type {
  CompilerOpcodeRegistry,
  CompilerOpcodeRegistryEntry,
  ResolvedCompilerManifest
} from './types.js';

export function buildCompilerOpcodeRegistry(
  resolvedManifests: readonly ResolvedCompilerManifest[]
): CompilerOpcodeRegistry {
  const extensionIds = new Set<string>();
  const entries: CompilerOpcodeRegistryEntry[] = [];
  for (const resolved of resolvedManifests) {
    const {manifest, lock} = resolved;
    if (extensionIds.has(manifest.id)) {
      throw new CompilerManifestError(
        'TW2_MANIFEST_DUPLICATE_EXTENSION',
        `Duplicate resolved extension ID: ${manifest.id}`
      );
    }
    extensionIds.add(manifest.id);
    if (
      manifest.blocks.some((block) => block.server?.irOperation?.startsWith('structuredData.')) &&
      manifest.pathSegmentType === undefined
    ) {
      throw new CompilerManifestError(
        'TW2_MANIFEST_OPERATION_MISMATCH',
        `Structured Data manifest ${manifest.id} must declare the supported typed path segment format.`
      );
    }
    for (const block of manifest.blocks) {
      validateServerOperationHint(block);
      entries.push({
        extensionId: manifest.id,
        opcode: block.opcode,
        projectOpcode: `${manifest.id}_${block.opcode}`,
        packageName: lock.packageName,
        packageVersion: lock.packageVersion,
        block
      });
    }
  }
  entries.sort((left, right) => lexicalCompare(left.projectOpcode, right.projectOpcode));
  const byProjectOpcode = new Map<string, CompilerOpcodeRegistryEntry>();
  for (const entry of entries) {
    if (byProjectOpcode.has(entry.projectOpcode)) {
      throw new CompilerManifestError(
        'TW2_MANIFEST_DUPLICATE_OPCODE',
        `Duplicate project opcode: ${entry.projectOpcode}`
      );
    }
    byProjectOpcode.set(entry.projectOpcode, entry);
  }
  return {entries, byProjectOpcode};
}

export function resolveCompilerProjectOpcode(
  registry: CompilerOpcodeRegistry,
  projectOpcode: string
): CompilerOpcodeRegistryEntry {
  const entry = registry.byProjectOpcode.get(projectOpcode);
  if (entry === undefined) {
    throw new CompilerManifestError(
      'TW2_MANIFEST_UNKNOWN_OPCODE',
      `Project opcode is not present in the locked compiler registry: ${projectOpcode}`
    );
  }
  return entry;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
