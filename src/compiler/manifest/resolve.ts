import {createHash} from 'node:crypto';
import {lstat, readFile, realpath, stat} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {CompilerManifestError} from './error.js';
import {
  DEFAULT_COMPILER_MANIFEST_LIMITS,
  parseCompilerExtensionManifestJson,
  parseCompilerManifestLockJson,
  type CompilerManifestLimits
} from './parse.js';
import {buildCompilerOpcodeRegistry} from './registry.js';
import type {
  CompilerManifestLock,
  CompilerOpcodeRegistry,
  ResolvedCompilerManifest
} from './types.js';

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

export async function resolveCompilerManifestLock(
  lockPath: string | undefined,
  options: ResolveCompilerManifestOptions = {}
): Promise<ResolvedCompilerManifestLock> {
  if (lockPath === undefined || lockPath.length === 0) {
    throw new CompilerManifestError(
      'TW2_MANIFEST_LOCK_REQUIRED',
      'IR v2 compilation with extension blocks requires an explicit manifest lock path.'
    );
  }
  const limits = options.limits ?? DEFAULT_COMPILER_MANIFEST_LIMITS;
  const absoluteLockPath = resolve(lockPath);
  const lockBytes = await readLimitedFile(absoluteLockPath, limits.maxBytes, 'manifest lock');
  const lock = parseCompilerManifestLockJson(decodeUtf8(lockBytes, 'manifest lock'), limits);
  const lockDirectory = dirname(await realpathOrSourceError(absoluteLockPath));
  const manifests: ResolvedCompilerManifest[] = [];
  for (const entry of lock.extensions) {
    const bytes =
      entry.source.kind === 'bundled'
        ? bundledBytes(entry.source.id, options.bundled)
        : await readSafeLocalManifest(lockDirectory, entry.source.path, limits.maxBytes);
    const exactIntegrity = manifestIntegrity(bytes);
    if (exactIntegrity !== entry.integrity) {
      throw new CompilerManifestError(
        'TW2_MANIFEST_INTEGRITY_MISMATCH',
        `Manifest integrity mismatch for ${entry.extensionId}: expected ${entry.integrity}, received ${exactIntegrity}.`
      );
    }
    const manifest = parseCompilerExtensionManifestJson(decodeUtf8(bytes, entry.extensionId), limits);
    if (manifest.id !== entry.extensionId || manifest.formatVersion !== entry.manifestFormatVersion) {
      throw new CompilerManifestError(
        'TW2_MANIFEST_LOCK_MISMATCH',
        `Manifest ${entry.extensionId} does not match the extension ID and format version pinned by the lock.`
      );
    }
    manifests.push({lock: entry, manifest, exactIntegrity});
  }
  manifests.sort((left, right) => lexicalCompare(left.manifest.id, right.manifest.id));
  return {lock, manifests, registry: buildCompilerOpcodeRegistry(manifests)};
}

export function manifestIntegrity(bytes: string | Uint8Array): `sha256-${string}` {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
}

async function readSafeLocalManifest(root: string, sourcePath: string, maxBytes: number): Promise<Uint8Array> {
  if (isAbsolute(sourcePath) || sourcePath.includes('\0')) unsafeSource(sourcePath, 'path must be relative');
  const candidate = resolve(root, sourcePath);
  assertContained(root, candidate, sourcePath);
  const segments = relative(root, candidate).split(sep).filter((segment) => segment.length > 0);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      sourceNotFound(sourcePath, error);
    }
    if (info.isSymbolicLink()) unsafeSource(sourcePath, `symbolic link component is not allowed: ${segment}`);
  }
  const resolvedCandidate = await realpathOrSourceError(candidate);
  assertContained(root, resolvedCandidate, sourcePath);
  return readLimitedFile(resolvedCandidate, maxBytes, `manifest ${sourcePath}`);
}

function bundledBytes(id: string, bundled: BundledCompilerManifests | undefined): Uint8Array {
  const value = bundled?.[id];
  if (value === undefined) {
    throw new CompilerManifestError('TW2_MANIFEST_SOURCE_NOT_FOUND', `Bundled manifest is not registered: ${id}`);
  }
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

async function readLimitedFile(path: string, maxBytes: number, label: string): Promise<Uint8Array> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    sourceNotFound(path, error);
  }
  if (size > maxBytes) {
    throw new CompilerManifestError('TW2_MANIFEST_TOO_LARGE', `${label} is ${size} bytes; limit is ${maxBytes}.`);
  }
  try {
    return await readFile(path);
  } catch (error) {
    sourceNotFound(path, error);
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch (error) {
    throw new CompilerManifestError('TW2_MANIFEST_JSON_SYNTAX', `${label} is not valid UTF-8.`, error);
  }
}

function assertContained(root: string, candidate: string, sourcePath: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    unsafeSource(sourcePath, 'path escapes the manifest lock directory');
  }
}

async function realpathOrSourceError(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    sourceNotFound(path, error);
  }
}

function unsafeSource(sourcePath: string, reason: string): never {
  throw new CompilerManifestError('TW2_MANIFEST_SOURCE_UNSAFE', `Unsafe local manifest source ${sourcePath}: ${reason}.`);
}

function sourceNotFound(sourcePath: string, cause: unknown): never {
  throw new CompilerManifestError(
    'TW2_MANIFEST_SOURCE_NOT_FOUND',
    `Manifest source could not be read: ${sourcePath}`,
    cause
  );
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
