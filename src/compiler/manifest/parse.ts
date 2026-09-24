import {parseJsonWithoutDuplicateKeys} from '../ir-v2/strict-json.js';
import {CompilerManifestError} from './error.js';
import {
  COMPILER_MANIFEST_LOCK_VERSION,
  type CompilerExtensionManifest,
  type CompilerManifestArgument,
  type CompilerManifestBlock,
  type CompilerManifestFormatVersion,
  type CompilerManifestLock,
  type CompilerManifestLockEntry,
  type CompilerManifestServerHint,
  type CompilerManifestSource,
  type ManifestArgumentType,
  type ManifestBlockType,
  type ManifestEffect,
  type ManifestResultType
} from './types.js';

export interface CompilerManifestLimits {
  maxBytes: number;
  maxDepth: number;
  maxBlocks: number;
}

export const DEFAULT_COMPILER_MANIFEST_LIMITS: Readonly<CompilerManifestLimits> = {
  maxBytes: 1024 * 1024,
  maxDepth: 64,
  maxBlocks: 2048
};

const BLOCK_TYPES = new Set<ManifestBlockType>(['COMMAND', 'REPORTER', 'BOOLEAN', 'HAT', 'LOOP']);
const ARGUMENT_TYPES = new Set<ManifestArgumentType>(['STRING', 'NUMBER', 'BOOLEAN']);
const RESULT_TYPES = new Set<ManifestResultType>(['json', 'boolean', 'number', 'string', 'void', 'jsonText', 'yamlText']);
const EFFECTS = new Set<ManifestEffect>([
  'pure',
  'immutable',
  'control',
  'request-read',
  'response-write',
  'storage-read',
  'storage-write',
  'binary-read',
  'binary-write',
  'state'
]);
const EXTENSION_ID = /^[a-z0-9]+$/;
const OPCODE = /^[A-Za-z][A-Za-z0-9_]*$/;
const EXACT_PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const INTEGRITY = /^sha256-([A-Za-z0-9+/]{43}=)$/;

export function parseCompilerExtensionManifestJson(
  text: string,
  limits: Readonly<CompilerManifestLimits> = DEFAULT_COMPILER_MANIFEST_LIMITS
): CompilerExtensionManifest {
  assertByteLimit(text, limits.maxBytes, 'manifest');
  const value = parseStrictJson(text, limits.maxDepth);
  const root = object(value, 'manifest');
  exactKeys(root, ['formatVersion', 'id', 'pathSegmentType', 'dataReferenceType', 'blocks', 'menus'], 'manifest');
  const formatVersion = manifestFormatVersion(root.formatVersion, 'manifest.formatVersion');
  const id = extensionId(root.id, 'manifest.id');
  const rawBlocks = array(root.blocks, 'manifest.blocks');
  if (rawBlocks.length === 0) schemaError('manifest.blocks must not be empty.');
  if (rawBlocks.length > limits.maxBlocks) {
    throw new CompilerManifestError(
      'TW2_MANIFEST_TOO_MANY_BLOCKS',
      `manifest.blocks exceeds the ${limits.maxBlocks} block limit.`
    );
  }
  const blocks = rawBlocks.map((block, index) => parseBlock(block, `manifest.blocks[${index}]`, formatVersion));
  rejectDuplicates(blocks.map((block) => block.opcode), 'TW2_MANIFEST_DUPLICATE_OPCODE', 'manifest opcode');

  const pathSegmentType =
    root.pathSegmentType === undefined
      ? undefined
      : parsePathSegmentType(root.pathSegmentType, 'manifest.pathSegmentType');
  const dataReferenceType =
    root.dataReferenceType === undefined
      ? undefined
      : parseDataReferenceType(root.dataReferenceType, 'manifest.dataReferenceType');
  const menus = root.menus === undefined ? undefined : array(root.menus, 'manifest.menus');
  return optional(
    optional(
      optional({formatVersion, id, blocks}, 'pathSegmentType', pathSegmentType),
      'dataReferenceType',
      dataReferenceType
    ),
    'menus',
    menus
  );
}

/** The counterpart of pathSegmentType: what the values an extension hands out refer to. */
function parseDataReferenceType(
  value: unknown,
  location: string
): NonNullable<CompilerExtensionManifest['dataReferenceType']> {
  const reference = object(value, location);
  exactKeys(reference, ['kind', 'scope', 'lifetime', 'valueType'], location);
  return {
    kind: nonEmptyString(reference.kind, `${location}.kind`),
    scope: nonEmptyString(reference.scope, `${location}.scope`),
    lifetime: nonEmptyString(reference.lifetime, `${location}.lifetime`),
    valueType: nonEmptyString(reference.valueType, `${location}.valueType`)
  };
}

export function parseCompilerManifestLockJson(
  text: string,
  limits: Readonly<Pick<CompilerManifestLimits, 'maxBytes' | 'maxDepth'>> = DEFAULT_COMPILER_MANIFEST_LIMITS
): CompilerManifestLock {
  assertByteLimit(text, limits.maxBytes, 'manifest lock');
  const root = object(parseStrictJson(text, limits.maxDepth), 'manifest lock');
  exactKeys(root, ['lockVersion', 'extensions'], 'manifest lock');
  if (root.lockVersion !== COMPILER_MANIFEST_LOCK_VERSION) {
    throw new CompilerManifestError(
      'TW2_MANIFEST_UNSUPPORTED_VERSION',
      `manifest lock.lockVersion must be ${COMPILER_MANIFEST_LOCK_VERSION}.`
    );
  }
  const extensions = array(root.extensions, 'manifest lock.extensions').map((entry, index) =>
    parseLockEntry(entry, `manifest lock.extensions[${index}]`)
  );
  rejectDuplicates(
    extensions.map((entry) => entry.extensionId),
    'TW2_MANIFEST_DUPLICATE_EXTENSION',
    'locked extension ID'
  );
  return {
    lockVersion: COMPILER_MANIFEST_LOCK_VERSION,
    extensions: extensions.sort((left, right) => lexicalCompare(left.extensionId, right.extensionId))
  };
}

function parseBlock(value: unknown, location: string, formatVersion: CompilerManifestFormatVersion): CompilerManifestBlock {
  const block = object(value, location);
  exactKeys(
    block,
    ['opcode', 'blockType', 'arguments', 'resultType', 'effect', 'immutable', 'errors', 'server'],
    location
  );
  const opcode = matches(block.opcode, OPCODE, `${location}.opcode`);
  const blockType = enumValue(block.blockType, BLOCK_TYPES, `${location}.blockType`);
  const args = array(block.arguments, `${location}.arguments`).map((argument, index) =>
    parseArgument(argument, `${location}.arguments[${index}]`)
  );
  rejectDuplicates(
    args.map((argument) => argument.id),
    'TW2_MANIFEST_SCHEMA',
    `${location} argument ID`
  );
  const resultType = optionalEnum(block.resultType, RESULT_TYPES, `${location}.resultType`);
  const effect = optionalEnum(block.effect, EFFECTS, `${location}.effect`);
  const immutable = optionalBoolean(block.immutable, `${location}.immutable`);
  const errors = optionalStringArray(block.errors, `${location}.errors`);
  const server = block.server === undefined ? undefined : parseServerHint(block.server, `${location}.server`);
  if (formatVersion === 2 && [resultType, effect, immutable, errors, server].some((item) => item === undefined)) {
    schemaError(`${location} is missing formatVersion 2 compiler metadata.`);
  }
  return optional(
    optional(
      optional(optional(optional({opcode, blockType, arguments: args}, 'resultType', resultType), 'effect', effect), 'immutable', immutable),
      'errors',
      errors
    ),
    'server',
    server
  );
}

function parseArgument(value: unknown, location: string): CompilerManifestArgument {
  const argument = object(value, location);
  exactKeys(argument, ['id', 'type', 'menu', 'normalizesTo', 'staticLiteral', 'minimum', 'maximum'], location);
  const id = nonEmptyString(argument.id, `${location}.id`);
  const type = enumValue(argument.type, ARGUMENT_TYPES, `${location}.type`);
  const menu = optionalString(argument.menu, `${location}.menu`);
  const rawNormalizesTo = argument.normalizesTo;
  if (rawNormalizesTo !== undefined && rawNormalizesTo !== 'pathSegments') {
    schemaError(`${location}.normalizesTo must be pathSegments.`);
  }
  const normalizesTo: 'pathSegments' | undefined = rawNormalizesTo;
  const staticLiteral = optionalBoolean(argument.staticLiteral, `${location}.staticLiteral`);
  const minimum = optionalFiniteNumber(argument.minimum, `${location}.minimum`);
  const maximum = optionalFiniteNumber(argument.maximum, `${location}.maximum`);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    schemaError(`${location}.minimum must not exceed maximum.`);
  }
  return optional(
    optional(
      optional(
        optional(optional({id, type}, 'menu', menu), 'normalizesTo', normalizesTo),
        'staticLiteral',
        staticLiteral
      ),
      'minimum',
      minimum
    ),
    'maximum',
    maximum
  );
}

function parseServerHint(value: unknown, location: string): CompilerManifestServerHint {
  const server = object(value, location);
  exactKeys(server, ['supported', 'irOperation'], location);
  const supported = boolean(server.supported, `${location}.supported`);
  const irOperation = optionalString(server.irOperation, `${location}.irOperation`);
  if (supported && irOperation === undefined) schemaError(`${location}.irOperation is required when supported is true.`);
  return optional({supported}, 'irOperation', irOperation);
}

function parsePathSegmentType(
  value: unknown,
  location: string
): NonNullable<CompilerExtensionManifest['pathSegmentType']> {
  const pathType = object(value, location);
  exactKeys(pathType, ['kind', 'variants'], location);
  if (pathType.kind !== 'discriminatedUnion') schemaError(`${location}.kind must be discriminatedUnion.`);
  const variants = array(pathType.variants, `${location}.variants`);
  if (variants.length !== 2) schemaError(`${location}.variants must contain key and index in that order.`);
  const key = object(variants[0], `${location}.variants[0]`);
  const index = object(variants[1], `${location}.variants[1]`);
  exactKeys(key, ['kind', 'valueType'], `${location}.variants[0]`);
  exactKeys(index, ['kind', 'valueType'], `${location}.variants[1]`);
  if (key.kind !== 'key' || key.valueType !== 'string') schemaError(`${location}.variants[0] must be a string key.`);
  if (index.kind !== 'index' || index.valueType !== 'nonNegativeInteger') {
    schemaError(`${location}.variants[1] must be a non-negative integer index.`);
  }
  return {
    kind: 'discriminatedUnion',
    variants: [
      {kind: 'key', valueType: 'string'},
      {kind: 'index', valueType: 'nonNegativeInteger'}
    ]
  };
}

function parseLockEntry(value: unknown, location: string): CompilerManifestLockEntry {
  const entry = object(value, location);
  exactKeys(
    entry,
    ['extensionId', 'packageName', 'packageVersion', 'manifestFormatVersion', 'integrity', 'source'],
    location
  );
  const extensionIdValue = extensionId(entry.extensionId, `${location}.extensionId`);
  const packageName = nonEmptyString(entry.packageName, `${location}.packageName`);
  const packageVersion = matches(entry.packageVersion, EXACT_PACKAGE_VERSION, `${location}.packageVersion`);
  const manifestFormatVersion = manifestFormatVersionValue(
    entry.manifestFormatVersion,
    `${location}.manifestFormatVersion`
  );
  const integrity = matches(entry.integrity, INTEGRITY, `${location}.integrity`) as `sha256-${string}`;
  const source = parseSource(entry.source, `${location}.source`);
  return {extensionId: extensionIdValue, packageName, packageVersion, manifestFormatVersion, integrity, source};
}

function parseSource(value: unknown, location: string): CompilerManifestSource {
  const source = object(value, location);
  const kind = nonEmptyString(source.kind, `${location}.kind`);
  if (kind === 'bundled') {
    exactKeys(source, ['kind', 'id'], location);
    return {kind, id: nonEmptyString(source.id, `${location}.id`)};
  }
  if (kind === 'local') {
    exactKeys(source, ['kind', 'path'], location);
    return {kind, path: nonEmptyString(source.path, `${location}.path`)};
  }
  schemaError(`${location}.kind is unsupported: ${kind}`);
}

function manifestFormatVersion(value: unknown, location: string): CompilerManifestFormatVersion {
  return manifestFormatVersionValue(value, location);
}

function manifestFormatVersionValue(value: unknown, location: string): CompilerManifestFormatVersion {
  if (value !== 1 && value !== 2) {
    throw new CompilerManifestError('TW2_MANIFEST_UNSUPPORTED_VERSION', `${location} must be 1 or 2.`);
  }
  return value;
}

function parseStrictJson(text: string, maxDepth: number): unknown {
  try {
    return parseJsonWithoutDuplicateKeys(text, {maxDepth});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.startsWith('Duplicate object key:')
      ? 'TW2_MANIFEST_DUPLICATE_KEY'
      : message.startsWith('JSON nesting depth exceeds')
        ? 'TW2_MANIFEST_TOO_DEEP'
        : 'TW2_MANIFEST_JSON_SYNTAX';
    throw new CompilerManifestError(code, message, error);
  }
}

function assertByteLimit(text: string, maxBytes: number, label: string): void {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) {
    throw new CompilerManifestError('TW2_MANIFEST_TOO_LARGE', `${label} is ${bytes} bytes; limit is ${maxBytes}.`);
  }
}

function rejectDuplicates(
  values: readonly string[],
  code: ConstructorParameters<typeof CompilerManifestError>[0],
  label: string
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new CompilerManifestError(code, `Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function object(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) schemaError(`${location} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) schemaError(`${location} must be an array.`);
  return value;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], location: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key)).sort()[0];
  if (unknown !== undefined) schemaError(`${location} contains unknown field: ${unknown}`);
}

function extensionId(value: unknown, location: string): string {
  return matches(value, EXTENSION_ID, location);
}

function matches(value: unknown, pattern: RegExp, location: string): string {
  const text = nonEmptyString(value, location);
  if (!pattern.test(text)) schemaError(`${location} has an invalid format.`);
  return text;
}

function nonEmptyString(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.length === 0) schemaError(`${location} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, location: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, location);
}

function boolean(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') schemaError(`${location} must be a boolean.`);
  return value;
}

function optionalBoolean(value: unknown, location: string): boolean | undefined {
  return value === undefined ? undefined : boolean(value, location);
}

function optionalFiniteNumber(value: unknown, location: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) schemaError(`${location} must be a finite number.`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, location: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) schemaError(`${location} is unsupported.`);
  return value as T;
}

function optionalEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, location: string): T | undefined {
  return value === undefined ? undefined : enumValue(value, allowed, location);
}

function optionalStringArray(value: unknown, location: string): string[] | undefined {
  if (value === undefined) return undefined;
  const values = array(value, location).map((item, index) => matches(item, /^[A-Z][A-Z0-9_]*$/, `${location}[${index}]`));
  rejectDuplicates(values, 'TW2_MANIFEST_SCHEMA', `${location} value`);
  return values;
}

function schemaError(message: string): never {
  throw new CompilerManifestError('TW2_MANIFEST_SCHEMA', message);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function optional<T extends object, K extends string, V>(base: T, key: K, value: V | undefined): T & Partial<Record<K, V>> {
  return value === undefined ? base : {...base, [key]: value};
}
