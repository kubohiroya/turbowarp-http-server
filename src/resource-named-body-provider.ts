import type {
  NamedBodyMetadata,
  NamedBodyProvider,
  NamedBodyRequest,
  NamedDataErrorCode
} from './named-body.js';
import {isNamedDataNamespace} from './named-data-namespace.js';
import type {ResourceCapability, ResourceMetadata, ResourceSnapshot} from './server.js';

export interface AssetManagerNamedBodyProviderOptions {
  namespace?: string;
  projectRouteName?: string;
}

const DEFAULT_NAMESPACE = 'asset';

/** Adapts the public Asset Manager resource capability without reading extension-private state. */
export function createAssetManagerNamedBodyProvider(
  resources: ResourceCapability,
  options: AssetManagerNamedBodyProviderOptions = {}
): NamedBodyProvider {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const projectRouteName = options.projectRouteName ?? '';
  if (!isNamedDataNamespace(namespace)) throw new TypeError('Asset Manager provider namespace is invalid.');

  return {
    canResolve: (request) =>
      request.reference.namespace === namespace && request.reference.kind === 'asset',
    async stat(request, signal) {
      assertSupportedRequest(request);
      throwIfAborted(signal);
      const routeName = routeNameFor(request, projectRouteName);
      if ((await resources.isNamespacePublished?.(routeName)) === false) return null;
      throwIfAborted(signal);

      if (resources.listResources !== undefined) {
        const items = await resources.listResources(routeName);
        throwIfAborted(signal);
        const metadata = items.find((item) => item.name === request.reference.name);
        return metadata === undefined ? null : namedMetadata(metadata, request);
      }

      const snapshot = await resources.getResource(routeName, request.reference.name);
      throwIfAborted(signal);
      return snapshot === null ? null : snapshotMetadata(snapshot, request);
    },
    async openBody(request, signal) {
      assertSupportedRequest(request);
      throwIfAborted(signal);
      const routeName = routeNameFor(request, projectRouteName);
      if ((await resources.isNamespacePublished?.(routeName)) === false) return null;
      throwIfAborted(signal);
      const snapshot = await resources.getResource(routeName, request.reference.name);
      throwIfAborted(signal);
      if (snapshot === null) return null;
      const bytes = snapshot.bytes.slice();
      return {
        metadata: {...snapshotMetadata(snapshot, request), byteLength: bytes.byteLength},
        body: bytes,
        release: () => undefined
      };
    }
  };
}

function assertSupportedRequest(request: NamedBodyRequest): void {
  if (request.reference.kind !== 'asset') {
    throw namedDataError('NAMED_DATA_KIND_MISMATCH');
  }
  if (request.representation !== 'raw') {
    throw namedDataError('NAMED_DATA_REPRESENTATION_UNSUPPORTED');
  }
}

function routeNameFor(request: NamedBodyRequest, projectRouteName: string): string {
  if (request.reference.scope === 'project') return projectRouteName;
  if (request.targetId === undefined) throw namedDataError('NAMED_DATA_SCOPE_MISMATCH');
  return request.targetId;
}

function snapshotMetadata(snapshot: ResourceSnapshot, request: NamedBodyRequest): NamedBodyMetadata {
  return namedMetadata({...snapshot, byteLength: snapshot.bytes.byteLength}, request);
}

function namedMetadata(resource: ResourceMetadata, request: NamedBodyRequest): NamedBodyMetadata {
  const revision = resource.replacementId ?? resource.etag;
  if (revision === undefined) throw namedDataError('NAMED_DATA_INVALID_METADATA');
  return {
    reference: {...request.reference},
    nativeRepresentation: 'raw',
    representation: 'raw',
    mediaType: resource.mimeType,
    ...(resource.byteLength === undefined ? {} : {byteLength: resource.byteLength}),
    ...(resource.etag === undefined ? {} : {etag: resource.etag}),
    revision,
    replayable: true
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw namedDataError('NAMED_DATA_ABORTED');
}

function namedDataError(code: NamedDataErrorCode): Error & {code: NamedDataErrorCode} {
  return Object.assign(new Error(code), {code});
}
