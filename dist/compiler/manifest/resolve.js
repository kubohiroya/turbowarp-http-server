import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { CompilerManifestError } from './error.js';
import { DEFAULT_COMPILER_MANIFEST_LIMITS, parseCompilerExtensionManifestJson, parseCompilerManifestLockJson } from './parse.js';
import { buildCompilerOpcodeRegistry } from './registry.js';
export async function resolveCompilerManifestLock(lockPath, options = {}) {
    if (lockPath === undefined || lockPath.length === 0) {
        throw new CompilerManifestError('TW2_MANIFEST_LOCK_REQUIRED', 'IR v2 compilation with extension blocks requires an explicit manifest lock path.');
    }
    const limits = options.limits ?? DEFAULT_COMPILER_MANIFEST_LIMITS;
    const absoluteLockPath = resolve(lockPath);
    const lockBytes = await readLimitedFile(absoluteLockPath, limits.maxBytes, 'manifest lock');
    const lock = parseCompilerManifestLockJson(decodeUtf8(lockBytes, 'manifest lock'), limits);
    const lockDirectory = dirname(await realpathOrSourceError(absoluteLockPath));
    const manifests = [];
    for (const entry of lock.extensions) {
        const bytes = entry.source.kind === 'bundled'
            ? bundledBytes(entry.source.id, options.bundled)
            : await readSafeLocalManifest(lockDirectory, entry.source.path, limits.maxBytes);
        const exactIntegrity = manifestIntegrity(bytes);
        if (exactIntegrity !== entry.integrity) {
            throw new CompilerManifestError('TW2_MANIFEST_INTEGRITY_MISMATCH', `Manifest integrity mismatch for ${entry.extensionId}: expected ${entry.integrity}, received ${exactIntegrity}.`);
        }
        const manifest = parseCompilerExtensionManifestJson(decodeUtf8(bytes, entry.extensionId), limits);
        if (manifest.id !== entry.extensionId || manifest.formatVersion !== entry.manifestFormatVersion) {
            throw new CompilerManifestError('TW2_MANIFEST_LOCK_MISMATCH', `Manifest ${entry.extensionId} does not match the extension ID and format version pinned by the lock.`);
        }
        manifests.push({ lock: entry, manifest, exactIntegrity });
    }
    manifests.sort((left, right) => lexicalCompare(left.manifest.id, right.manifest.id));
    return { lock, manifests, registry: buildCompilerOpcodeRegistry(manifests) };
}
export function manifestIntegrity(bytes) {
    return `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
}
async function readSafeLocalManifest(root, sourcePath, maxBytes) {
    if (isAbsolute(sourcePath) || sourcePath.includes('\0'))
        unsafeSource(sourcePath, 'path must be relative');
    const candidate = resolve(root, sourcePath);
    assertContained(root, candidate, sourcePath);
    const segments = relative(root, candidate).split(sep).filter((segment) => segment.length > 0);
    let current = root;
    for (const segment of segments) {
        current = resolve(current, segment);
        let info;
        try {
            info = await lstat(current);
        }
        catch (error) {
            sourceNotFound(sourcePath, error);
        }
        if (info.isSymbolicLink())
            unsafeSource(sourcePath, `symbolic link component is not allowed: ${segment}`);
    }
    const resolvedCandidate = await realpathOrSourceError(candidate);
    assertContained(root, resolvedCandidate, sourcePath);
    return readLimitedFile(resolvedCandidate, maxBytes, `manifest ${sourcePath}`);
}
function bundledBytes(id, bundled) {
    const value = bundled?.[id];
    if (value === undefined) {
        throw new CompilerManifestError('TW2_MANIFEST_SOURCE_NOT_FOUND', `Bundled manifest is not registered: ${id}`);
    }
    return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}
async function readLimitedFile(path, maxBytes, label) {
    let size;
    try {
        size = (await stat(path)).size;
    }
    catch (error) {
        sourceNotFound(path, error);
    }
    if (size > maxBytes) {
        throw new CompilerManifestError('TW2_MANIFEST_TOO_LARGE', `${label} is ${size} bytes; limit is ${maxBytes}.`);
    }
    try {
        return await readFile(path);
    }
    catch (error) {
        sourceNotFound(path, error);
    }
}
function decodeUtf8(bytes, label) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch (error) {
        throw new CompilerManifestError('TW2_MANIFEST_JSON_SYNTAX', `${label} is not valid UTF-8.`, error);
    }
}
function assertContained(root, candidate, sourcePath) {
    const pathFromRoot = relative(root, candidate);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
        unsafeSource(sourcePath, 'path escapes the manifest lock directory');
    }
}
async function realpathOrSourceError(path) {
    try {
        return await realpath(path);
    }
    catch (error) {
        sourceNotFound(path, error);
    }
}
function unsafeSource(sourcePath, reason) {
    throw new CompilerManifestError('TW2_MANIFEST_SOURCE_UNSAFE', `Unsafe local manifest source ${sourcePath}: ${reason}.`);
}
function sourceNotFound(sourcePath, cause) {
    throw new CompilerManifestError('TW2_MANIFEST_SOURCE_NOT_FOUND', `Manifest source could not be read: ${sourcePath}`, cause);
}
function lexicalCompare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=resolve.js.map