const DEFAULT_NAMESPACE = 'asset-manager';
const NAMESPACE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u;
/** Adapts the public Asset Manager resource capability without reading extension-private state. */
export function createAssetManagerNamedBodyProvider(resources, options = {}) {
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const projectRouteName = options.projectRouteName ?? '';
    if (!NAMESPACE.test(namespace))
        throw new TypeError('Asset Manager provider namespace is invalid.');
    return {
        canResolve: (request) => request.reference.namespace === namespace,
        async stat(request, signal) {
            assertSupportedRequest(request);
            throwIfAborted(signal);
            const routeName = routeNameFor(request, projectRouteName);
            if ((await resources.isNamespacePublished?.(routeName)) === false)
                return null;
            throwIfAborted(signal);
            if (resources.listResources !== undefined) {
                const items = await resources.listResources(routeName);
                throwIfAborted(signal);
                const metadata = items.find((item) => item.name === request.reference.name);
                return metadata === undefined ? null : namedMetadata(metadata);
            }
            const snapshot = await resources.getResource(routeName, request.reference.name);
            throwIfAborted(signal);
            return snapshot === null ? null : snapshotMetadata(snapshot);
        },
        async openBody(request, signal) {
            assertSupportedRequest(request);
            throwIfAborted(signal);
            const routeName = routeNameFor(request, projectRouteName);
            if ((await resources.isNamespacePublished?.(routeName)) === false)
                return null;
            throwIfAborted(signal);
            const snapshot = await resources.getResource(routeName, request.reference.name);
            throwIfAborted(signal);
            if (snapshot === null)
                return null;
            const bytes = snapshot.bytes.slice();
            return {
                metadata: { ...snapshotMetadata(snapshot), byteLength: bytes.byteLength },
                body: bytes,
                release: () => undefined
            };
        }
    };
}
function assertSupportedRequest(request) {
    if (request.reference.kind !== 'asset' && request.reference.kind !== 'binary') {
        throw namedDataError('NAMED_DATA_KIND_MISMATCH');
    }
    if (request.representation !== 'raw') {
        throw namedDataError('NAMED_DATA_REPRESENTATION_UNSUPPORTED');
    }
}
function routeNameFor(request, projectRouteName) {
    if (request.reference.scope === 'project')
        return projectRouteName;
    if (request.targetId === undefined)
        throw namedDataError('NAMED_DATA_SCOPE_MISMATCH');
    return request.targetId;
}
function snapshotMetadata(snapshot) {
    return namedMetadata({ ...snapshot, byteLength: snapshot.bytes.byteLength });
}
function namedMetadata(resource) {
    return {
        mediaType: resource.mimeType,
        ...(resource.byteLength === undefined ? {} : { byteLength: resource.byteLength }),
        ...(resource.etag === undefined ? {} : { etag: resource.etag }),
        ...(resource.replacementId === undefined ? {} : { revision: resource.replacementId })
    };
}
function throwIfAborted(signal) {
    if (signal.aborted)
        throw namedDataError('NAMED_DATA_ABORTED');
}
function namedDataError(code) {
    return Object.assign(new Error(code), { code });
}
//# sourceMappingURL=resource-named-body-provider.js.map