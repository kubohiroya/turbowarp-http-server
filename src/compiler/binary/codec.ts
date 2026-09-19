import type {
  BinaryContentDispositionV2,
  BinaryLocatorV2,
  BinaryMetadataV2
} from '../ir-v2/types.js';
import {binaryError} from './error.js';

export function validateBinaryLocator(locator: BinaryLocatorV2): BinaryLocatorV2 {
  if (
    locator.namespace.length < 1 ||
    locator.namespace.length > 64 ||
    !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(locator.namespace)
  ) {
    binaryError('BINARY_INVALID_REF', 'Binary namespace is invalid.');
  }
  if (
    locator.key.length < 1 ||
    locator.key.length > 512 ||
    locator.key.includes('\0') ||
    locator.key.includes('\\') ||
    locator.key.startsWith('/') ||
    locator.key.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    binaryError('BINARY_INVALID_REF', 'Binary key is invalid.');
  }
  return {namespace: locator.namespace, key: locator.key};
}

export function validateBinaryMetadata(metadata: BinaryMetadataV2): BinaryMetadataV2 {
  if (
    metadata.contentType !== undefined &&
    (metadata.contentType.length > 255 ||
      !/^[^\s/;]+\/[^\s;]+(?:\s*;.*)?$/u.test(metadata.contentType) ||
      /[\r\n]/u.test(metadata.contentType))
  ) {
    binaryError('BINARY_INVALID_REF', 'Binary content type is invalid.');
  }
  if (metadata.size !== undefined && (!Number.isSafeInteger(metadata.size) || metadata.size < 0)) {
    binaryError('BINARY_INVALID_REF', 'Binary size is invalid.');
  }
  if (metadata.integrity !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(metadata.integrity)) {
    binaryError('BINARY_INVALID_REF', 'Binary integrity is invalid.');
  }
  if (metadata.revision !== undefined && (metadata.revision.length < 1 || metadata.revision.length > 256)) {
    binaryError('BINARY_INVALID_REF', 'Binary revision is invalid.');
  }
  return {...metadata};
}

export function encodeContentDisposition(disposition: BinaryContentDispositionV2): string {
  if (disposition.kind === 'inline') return 'inline';
  if (
    disposition.filename.length < 1 ||
    disposition.filename.length > 255 ||
    /[\r\n\0]/u.test(disposition.filename)
  ) {
    binaryError('BINARY_INVALID_REF', 'Binary response filename is invalid.');
  }
  return `attachment; filename*=UTF-8''${encodeURIComponent(disposition.filename).replace(/['()*]/gu, (value) =>
    `%${value.codePointAt(0)!.toString(16).toUpperCase()}`
  )}`;
}
