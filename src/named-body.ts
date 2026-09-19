export type NamedDataKind = 'structured' | 'document' | 'binary' | 'asset';

export type NamedDataScope = 'target' | 'project';

/** Stable provider error namespace shared with structured/document/binary data extensions. */
export const NAMED_DATA_ERROR_CODES = [
  'NAMED_DATA_INVALID_REF',
  'NAMED_DATA_PROVIDER_NOT_FOUND',
  'NAMED_DATA_NOT_FOUND',
  'NAMED_DATA_KIND_MISMATCH',
  'NAMED_DATA_SCOPE_MISMATCH',
  'NAMED_DATA_REPRESENTATION_UNSUPPORTED',
  'NAMED_DATA_BODY_TOO_LARGE',
  'NAMED_DATA_ABORTED',
  'NAMED_DATA_PROVIDER_RELEASED'
] as const;

export type NamedDataErrorCode = (typeof NAMED_DATA_ERROR_CODES)[number];
export type NamedBodyErrorCode =
  | NamedDataErrorCode
  | 'NAMED_RESPONSE_BODY_DISABLED'
  | 'NAMED_RESPONSE_INVALID_METADATA';

export interface NamedDataReference {
  namespace: string;
  name: string;
  kind: NamedDataKind;
  scope: NamedDataScope;
}

export type NamedBodyRepresentation = 'json' | 'yaml' | 'html' | 'markdown' | 'raw';

export interface NamedBodyRequest {
  reference: NamedDataReference;
  representation: NamedBodyRepresentation;
  /** Runtime-local identity used only when reference.scope is target. */
  targetId?: string;
}

export interface NamedBodyMetadata {
  mediaType: string;
  byteLength?: number;
  etag?: string;
  revision?: string;
}

export type NamedBodyReleaseReason = 'complete' | 'cancel' | 'abort' | 'error';

export interface NamedBodyHandle {
  metadata: NamedBodyMetadata;
  body: Uint8Array | ReadableStream<Uint8Array>;
  release(reason: NamedBodyReleaseReason): void | Promise<void>;
}

export interface NamedBodyProvider {
  canResolve(request: NamedBodyRequest): boolean;
  stat(request: NamedBodyRequest, signal: AbortSignal): NamedBodyMetadata | null | Promise<NamedBodyMetadata | null>;
  openBody(request: NamedBodyRequest, signal: AbortSignal): NamedBodyHandle | null | Promise<NamedBodyHandle | null>;
}

export interface NamedResponseBodyFeatureFlags {
  namedResponseBody: boolean;
}

export const DEFAULT_NAMED_RESPONSE_BODY_FEATURE_FLAGS: Readonly<NamedResponseBodyFeatureFlags> = Object.freeze({
  namedResponseBody: false
});

export interface NamedBodyResponseOptions {
  method?: string;
  status?: number;
  headers?: HeadersInit;
  signal?: AbortSignal;
  maxBodyBytes?: number;
  featureFlags?: Readonly<NamedResponseBodyFeatureFlags>;
}

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const NAMED_NAMESPACE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u;
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REPRESENTATIONS: readonly NamedBodyRepresentation[] = ['json', 'yaml', 'html', 'markdown', 'raw'];
const KINDS: readonly NamedDataKind[] = ['structured', 'document', 'binary', 'asset'];
const SCOPES: readonly NamedDataScope[] = ['target', 'project'];
const MEDIA_TYPE_ESSENCE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

export class NamedBodyResolver {
  public constructor(private readonly providers: readonly NamedBodyProvider[]) {}

  public async stat(request: NamedBodyRequest, signal: AbortSignal): Promise<NamedBodyMetadata | null> {
    const provider = this.providerFor(request);
    return provider ? provider.stat(request, signal) : null;
  }

  public async openBody(request: NamedBodyRequest, signal: AbortSignal): Promise<NamedBodyHandle | null> {
    const provider = this.providerFor(request);
    return provider ? provider.openBody(request, signal) : null;
  }

  public canResolve(request: NamedBodyRequest): boolean {
    return this.providerFor(request) !== undefined;
  }

  private providerFor(request: NamedBodyRequest): NamedBodyProvider | undefined {
    return this.providers.find((provider) => provider.canResolve(request));
  }
}

export async function createNamedBodyResponse(
  resolver: NamedBodyResolver,
  request: NamedBodyRequest,
  options: NamedBodyResponseOptions = {}
): Promise<Response> {
  const method = options.method?.toUpperCase() ?? 'GET';
  if (!(options.featureFlags ?? DEFAULT_NAMED_RESPONSE_BODY_FEATURE_FLAGS).namedResponseBody) {
    return errorResponse('NAMED_RESPONSE_BODY_DISABLED', 501, method);
  }

  if (!isValidRequest(request)) return errorResponse('NAMED_DATA_INVALID_REF', 400, method);
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) return errorResponse('NAMED_DATA_ABORTED', 499, method);
  if (!resolver.canResolve(request)) return errorResponse('NAMED_DATA_PROVIDER_NOT_FOUND', 501, method);
  const status = options.status ?? 200;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    return errorResponse('NAMED_RESPONSE_INVALID_METADATA', 500, method);
  }

  if (method === 'HEAD') {
    let metadata: NamedBodyMetadata | null;
    try {
      metadata = await resolver.stat(request, signal);
    } catch (error) {
      const response = providerErrorResponse(error);
      if (response) return withoutResponseBody(response);
      throw error;
    }
    if (!metadata) return errorResponse('NAMED_DATA_NOT_FOUND', 404, method);
    const metadataError = validateMetadata(metadata, request.representation, maxBodyBytes);
    if (metadataError) return withoutResponseBody(metadataError);
    return new Response(null, {status, headers: responseHeaders(options.headers, metadata)});
  }
  if (isBodyForbidden(status)) return new Response(null, {status, headers: new Headers(options.headers)});

  let handle: NamedBodyHandle | null;
  try {
    handle = await resolver.openBody(request, signal);
  } catch (error) {
    const response = providerErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (!handle) return errorResponse('NAMED_DATA_NOT_FOUND', 404);
  const release = releaseOnce(handle);

  if (signal.aborted) {
    const releaseError = await releaseErrorResponse(release, 'abort');
    if (releaseError) return releaseError;
    return errorResponse('NAMED_DATA_ABORTED', 499);
  }

  const metadataError = validateMetadata(handle.metadata, request.representation, maxBodyBytes);
  if (metadataError) {
    return (await releaseErrorResponse(release, 'error')) ?? metadataError;
  }

  const headers = responseHeaders(options.headers, handle.metadata);
  if (handle.body instanceof Uint8Array) {
    if (handle.body.byteLength > maxBodyBytes) {
      return (await releaseErrorResponse(release, 'error')) ?? errorResponse('NAMED_DATA_BODY_TOO_LARGE', 413);
    }
    if (handle.metadata.byteLength !== undefined && handle.metadata.byteLength !== handle.body.byteLength) {
      return (await releaseErrorResponse(release, 'error')) ?? errorResponse('NAMED_RESPONSE_INVALID_METADATA', 502);
    }
    headers.set('Content-Length', String(handle.body.byteLength));
    const bytes = handle.body.slice();
    const releaseError = await releaseErrorResponse(release, 'complete');
    if (releaseError) return releaseError;
    return new Response(toArrayBuffer(bytes), {status, headers});
  }

  const body = managedBodyStream(handle.body, signal, maxBodyBytes, release);
  return new Response(body, {status, headers});
}

function managedBodyStream(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  maxBodyBytes: number,
  release: (reason: NamedBodyReleaseReason) => Promise<void>
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let total = 0;
  let finished = false;

  const finish = async (reason: NamedBodyReleaseReason): Promise<void> => {
    if (finished) return;
    finished = true;
    signal.removeEventListener('abort', onAbort);
    await release(reason);
  };
  const onAbort = (): void => {
    void finish('abort').catch(() => undefined);
    void reader.cancel(signal.reason);
  };
  signal.addEventListener('abort', onAbort, {once: true});

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (signal.aborted) throw namedBodyError('NAMED_DATA_ABORTED');
        const chunk = await reader.read();
        if (chunk.done) {
          await finish('complete');
          controller.close();
          return;
        }
        total += chunk.value.byteLength;
        if (total > maxBodyBytes) {
          await reader.cancel('named_body_too_large');
          throw namedBodyError('NAMED_DATA_BODY_TOO_LARGE');
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        let failure = signal.aborted ? namedBodyError('NAMED_DATA_ABORTED') : error;
        try {
          await finish(signal.aborted ? 'abort' : 'error');
        } catch (releaseError) {
          failure = releaseError;
        }
        controller.error(failure);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await finish(signal.aborted ? 'abort' : 'cancel');
    }
  });
}

function validateMetadata(
  metadata: NamedBodyMetadata,
  representation: NamedBodyRepresentation,
  maxBodyBytes?: number
): Response | null {
  if (hasControlCharacter(metadata.mediaType) || metadata.mediaType.length > 255) {
    return errorResponse('NAMED_RESPONSE_INVALID_METADATA', 502);
  }
  if (!isMediaTypeForRepresentation(metadata.mediaType, representation)) {
    return errorResponse('NAMED_DATA_REPRESENTATION_UNSUPPORTED', 415);
  }
  if (metadata.byteLength !== undefined) {
    if (!Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 0) {
      return errorResponse('NAMED_RESPONSE_INVALID_METADATA', 502);
    }
    if (maxBodyBytes !== undefined && metadata.byteLength > maxBodyBytes) {
      return errorResponse('NAMED_DATA_BODY_TOO_LARGE', 413);
    }
  }
  for (const identity of [metadata.etag, metadata.revision]) {
    if (identity !== undefined && (identity.length < 1 || identity.length > 256 || hasControlCharacter(identity))) {
      return errorResponse('NAMED_RESPONSE_INVALID_METADATA', 502);
    }
  }
  return null;
}

function isValidRequest(request: NamedBodyRequest): boolean {
  if (typeof request !== 'object' || request === null) return false;
  const reference = request.reference;
  if (
    typeof reference !== 'object' ||
    reference === null ||
    !NAMED_NAMESPACE.test(reference.namespace) ||
    typeof reference.name !== 'string' ||
    reference.name.length < 1 ||
    reference.name.length > 256 ||
    hasControlCharacter(reference.name) ||
    !KINDS.includes(reference.kind) ||
    !SCOPES.includes(reference.scope) ||
    !REPRESENTATIONS.includes(request.representation)
  ) {
    return false;
  }
  if (reference.scope === 'target') return typeof request.targetId === 'string' && TARGET_ID.test(request.targetId);
  return request.targetId === undefined;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isMediaTypeForRepresentation(mediaType: string, representation: NamedBodyRepresentation): boolean {
  const essence = mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!MEDIA_TYPE_ESSENCE.test(essence)) return false;
  if (representation === 'raw') return true;
  if (representation === 'json') return essence === 'application/json' || essence.endsWith('+json');
  if (representation === 'yaml') {
    return essence === 'application/yaml' || essence === 'application/x-yaml' || essence === 'text/yaml';
  }
  if (representation === 'html') return essence === 'text/html';
  return essence === 'text/markdown' || essence === 'text/x-markdown';
}

function responseHeaders(existing: HeadersInit | undefined, metadata: NamedBodyMetadata): Headers {
  const headers = new Headers(existing);
  headers.delete('Content-Length');
  headers.set('Content-Type', metadata.mediaType);
  if (metadata.byteLength !== undefined) headers.set('Content-Length', String(metadata.byteLength));
  const identity = metadata.etag ?? metadata.revision;
  if (identity) headers.set('ETag', quoteEtag(identity));
  return headers;
}

function releaseOnce(handle: NamedBodyHandle): (reason: NamedBodyReleaseReason) => Promise<void> {
  let released = false;
  return async (reason) => {
    if (released) return;
    released = true;
    try {
      await handle.release(reason);
    } catch {
      throw namedBodyError('NAMED_DATA_PROVIDER_RELEASED');
    }
  };
}

async function releaseErrorResponse(
  release: (reason: NamedBodyReleaseReason) => Promise<void>,
  reason: NamedBodyReleaseReason
): Promise<Response | null> {
  try {
    await release(reason);
    return null;
  } catch {
    return errorResponse('NAMED_DATA_PROVIDER_RELEASED', 503);
  }
}

function quoteEtag(value: string): string {
  if (/^(W\/)?"[^"]*"$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isBodyForbidden(status: number): boolean {
  return status === 204 || status === 205 || status === 304;
}

function errorResponse(error: NamedBodyErrorCode, status: number, method = 'GET'): Response {
  return new Response(method === 'HEAD' ? null : JSON.stringify({error}), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8'}
  });
}

function withoutResponseBody(response: Response): Response {
  return new Response(null, {status: response.status, statusText: response.statusText, headers: response.headers});
}

function providerErrorResponse(error: unknown): Response | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as {code?: unknown}).code;
  if (typeof code !== 'string' || !isNamedDataErrorCode(code)) return null;
  return errorResponse(code, statusForNamedDataError(code));
}

function namedBodyError(code: NamedDataErrorCode): Error & {code: NamedDataErrorCode} {
  return Object.assign(new Error(code), {code});
}

function isNamedDataErrorCode(value: string): value is NamedDataErrorCode {
  return (NAMED_DATA_ERROR_CODES as readonly string[]).includes(value);
}

function statusForNamedDataError(code: NamedDataErrorCode): number {
  if (code === 'NAMED_DATA_NOT_FOUND') return 404;
  if (code === 'NAMED_DATA_PROVIDER_NOT_FOUND') return 501;
  if (code === 'NAMED_DATA_REPRESENTATION_UNSUPPORTED') return 415;
  if (code === 'NAMED_DATA_BODY_TOO_LARGE') return 413;
  if (code === 'NAMED_DATA_ABORTED') return 499;
  if (code === 'NAMED_DATA_PROVIDER_RELEASED') return 503;
  return 400;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
