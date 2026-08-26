import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { WebSocketServer } from 'ws';
const DEFAULT_MAX_RESOURCE_BODY_BYTES = 10 * 1024 * 1024;
export function createApp(options = {}) {
    const app = new Hono();
    app.use('*', secureHeaders());
    app.get('/health', (c) => c.json({
        ok: true,
        service: 'turbowarp-http-server'
    }));
    app.get('/ws', (c) => c.json({
        error: 'upgrade_required',
        message: 'Connect to this endpoint with WebSocket.'
    }, 426));
    app.all('*', async (c) => {
        const resourceResponse = await handleResourceRequest(c, options);
        if (resourceResponse)
            return resourceResponse;
        return c.json({
            error: 'not_connected',
            message: 'HTTP-to-TurboWarp request forwarding has not been implemented yet.'
        }, 503);
    });
    return app;
}
export function startServer(options) {
    const app = createApp(options);
    const wss = new WebSocketServer({ noServer: true });
    const server = serve({
        fetch: app.fetch,
        hostname: options.hostname,
        port: options.port
    });
    server.on('upgrade', (request, socket, head) => {
        if (request.url !== '/ws') {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            ws.send(JSON.stringify({
                type: 'hello',
                protocol: 'turbowarp-http-server',
                version: 1
            }));
            ws.on('message', (message) => {
                ws.send(message);
            });
        });
    });
    return {
        hostname: options.hostname,
        port: options.port,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        })
    };
}
async function handleResourceRequest(c, options) {
    const route = parseResourceRoute(new URL(c.req.url).pathname);
    if (!route)
        return null;
    if (route.managementNamespace) {
        return jsonResponse({ error: 'not_found' }, 404);
    }
    const resources = options.resources;
    if (!resources)
        return null;
    const published = await resources.isNamespacePublished?.(route.routeName);
    if (published === false) {
        return jsonResponse({ error: 'not_found' }, 404);
    }
    const method = c.req.method.toUpperCase();
    if (route.listing) {
        if (method !== 'GET' && method !== 'HEAD')
            return methodNotAllowed(['GET', 'HEAD']);
        return handleResourceList(c.req.raw, route.routeName, resources, options, method === 'HEAD');
    }
    if (method === 'GET' || method === 'HEAD') {
        return handleResourceGet(c.req.raw, route.routeName, route.resourceName, resources, options, method);
    }
    if (method === 'PUT') {
        return handleResourcePut(c.req.raw, route.routeName, route.resourceName, resources, options);
    }
    if (method === 'DELETE') {
        return handleResourceDelete(c.req.raw, route.routeName, route.resourceName, resources, options);
    }
    return methodNotAllowed(['GET', 'HEAD', 'PUT', 'DELETE']);
}
async function handleResourceGet(request, routeName, resourceName, resources, options, method) {
    if (!(await authorize(options, request, method.toLowerCase(), routeName, resourceName))) {
        return jsonResponse({ error: 'forbidden' }, 403);
    }
    const snapshot = await resources.getResource(routeName, resourceName);
    if (!snapshot) {
        logResource(options, {
            event: method === 'GET' ? 'resource.get' : 'resource.head',
            routeName,
            resourceName,
            status: 404
        });
        return jsonResponse({ error: 'not_found' }, 404);
    }
    const headers = resourceHeaders(snapshot);
    const notModified = isNotModified(request, headers);
    const status = notModified ? 304 : 200;
    logResource(options, {
        event: method === 'GET' ? 'resource.get' : 'resource.head',
        routeName,
        resourceName,
        mimeType: snapshot.mimeType,
        byteLength: getByteLength(snapshot),
        status
    });
    if (notModified)
        return new Response(null, { status, headers });
    return new Response(method === 'HEAD' ? null : toArrayBuffer(snapshot.bytes), { status, headers });
}
async function handleResourceList(request, routeName, resources, options, headOnly) {
    if (!(await authorize(options, request, headOnly ? 'head' : 'list', routeName))) {
        return jsonResponse({ error: 'forbidden' }, 403);
    }
    if (!resources.listResources)
        return jsonResponse({ error: 'not_supported' }, 405, { Allow: 'GET, HEAD' });
    const resourcesList = await resources.listResources(routeName);
    const body = JSON.stringify({
        routeName,
        resources: resourcesList.map((resource) => metadataWithoutBody(resource))
    });
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(new TextEncoder().encode(body).byteLength),
        'Cache-Control': 'no-store'
    });
    logResource(options, {
        event: 'resource.list',
        routeName,
        status: 200
    });
    return new Response(headOnly ? null : body, { status: 200, headers });
}
async function handleResourcePut(request, routeName, resourceName, resources, options) {
    if (!resources.putResource)
        return jsonResponse({ error: 'not_supported' }, 405, { Allow: 'GET, HEAD' });
    if (!(await authorize(options, request, 'put', routeName, resourceName))) {
        return jsonResponse({ error: 'forbidden' }, 403);
    }
    const mimeType = request.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'application/octet-stream';
    const supported = await resources.isSupportedResourceType?.(mimeType);
    if (supported === false)
        return jsonResponse({ error: 'unsupported_media_type' }, 415);
    const maxBytes = options.maxResourceBodyBytes ?? DEFAULT_MAX_RESOURCE_BODY_BYTES;
    const contentLength = request.headers.get('content-length');
    if (contentLength !== null && Number.parseInt(contentLength, 10) > maxBytes) {
        return jsonResponse({ error: 'payload_too_large' }, 413);
    }
    const bytes = await readBodyWithLimit(request, maxBytes);
    if (bytes === null)
        return jsonResponse({ error: 'payload_too_large' }, 413);
    const result = await resources.putResource({ routeName, resourceName, mimeType, bytes });
    logResource(options, {
        event: 'resource.put',
        routeName,
        resourceName,
        mimeType,
        byteLength: bytes.byteLength,
        status: result.created ? 201 : 204
    });
    if (result.created) {
        return new Response(null, {
            status: 201,
            headers: { Location: resourceLocation(routeName, resourceName) }
        });
    }
    return new Response(null, { status: 204 });
}
async function handleResourceDelete(request, routeName, resourceName, resources, options) {
    if (!resources.deleteResource)
        return jsonResponse({ error: 'not_supported' }, 405, { Allow: 'GET, HEAD, PUT' });
    if (!(await authorize(options, request, 'delete', routeName, resourceName))) {
        return jsonResponse({ error: 'forbidden' }, 403);
    }
    const removed = await resources.deleteResource(routeName, resourceName);
    logResource(options, {
        event: 'resource.delete',
        routeName,
        resourceName,
        status: removed ? 204 : 404
    });
    return removed ? new Response(null, { status: 204 }) : jsonResponse({ error: 'not_found' }, 404);
}
function parseResourceRoute(pathname) {
    const rawSegments = pathname.split('/').filter((segment) => segment.length > 0);
    const segments = rawSegments.map(decodePathSegment);
    if (segments[0] === '_tw-http') {
        return { routeName: '', resourceName: '', listing: false, managementNamespace: true };
    }
    const assetIndex = segments.indexOf('@assets');
    if (assetIndex < 0)
        return null;
    if (assetIndex !== 0) {
        return { routeName: '', resourceName: '', listing: false, managementNamespace: true };
    }
    const routeName = '';
    const resourceSegments = segments.slice(1);
    const listing = resourceSegments.length === 0;
    const resourceName = resourceSegments.join('/');
    if (!listing && resourceName.length === 0)
        return null;
    return { routeName, resourceName, listing, managementNamespace: false };
}
function decodePathSegment(segment) {
    try {
        return decodeURIComponent(segment);
    }
    catch {
        return segment;
    }
}
function resourceHeaders(snapshot) {
    const headers = new Headers({
        'Content-Type': snapshot.mimeType,
        'Content-Length': String(getByteLength(snapshot)),
        'Cache-Control': snapshot.cacheControl ?? defaultCacheControl(snapshot)
    });
    const etag = getEtag(snapshot);
    if (etag)
        headers.set('ETag', etag);
    if (snapshot.lastModified)
        headers.set('Last-Modified', snapshot.lastModified.toUTCString());
    return headers;
}
function getByteLength(snapshot) {
    return snapshot.byteLength ?? snapshot.bytes.byteLength;
}
function getEtag(snapshot) {
    const identity = snapshot.etag ?? snapshot.replacementId;
    if (!identity)
        return undefined;
    if (/^(W\/)?"[^"]*"$/.test(identity))
        return identity;
    return `"${identity.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function defaultCacheControl(snapshot) {
    return snapshot.etag || snapshot.replacementId || snapshot.lastModified ? 'no-cache' : 'no-store';
}
function isNotModified(request, headers) {
    const responseEtag = headers.get('ETag');
    const requestEtags = request.headers.get('if-none-match');
    if (responseEtag && requestEtags) {
        return requestEtags
            .split(',')
            .map((value) => value.trim())
            .some((value) => value === '*' || value === responseEtag);
    }
    const lastModified = headers.get('Last-Modified');
    const ifModifiedSince = request.headers.get('if-modified-since');
    if (!lastModified || !ifModifiedSince)
        return false;
    return Date.parse(ifModifiedSince) >= Date.parse(lastModified);
}
async function readBodyWithLimit(request, maxBytes) {
    if (!request.body)
        return new Uint8Array();
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}
async function authorize(options, request, operation, routeName, resourceName) {
    return (await options.authorizeResource?.(request, operation, routeName, resourceName)) !== false;
}
function metadataWithoutBody(resource) {
    const metadata = {
        name: resource.name,
        mimeType: resource.mimeType
    };
    if (resource.byteLength !== undefined)
        metadata.byteLength = resource.byteLength;
    if (resource.etag !== undefined)
        metadata.etag = resource.etag;
    if (resource.replacementId !== undefined)
        metadata.replacementId = resource.replacementId;
    if (resource.lastModified !== undefined)
        metadata.lastModified = resource.lastModified;
    if (resource.cacheControl !== undefined)
        metadata.cacheControl = resource.cacheControl;
    return metadata;
}
function resourceLocation(routeName, resourceName) {
    const encodedName = resourceName.split('/').map(encodeURIComponent).join('/');
    return routeName === '' ? `/@assets/${encodedName}` : `/${encodeURIComponent(routeName)}/${encodedName}`;
}
function methodNotAllowed(methods) {
    return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: methods.join(', ') });
}
function jsonResponse(body, status, headers) {
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
function logResource(options, event) {
    options.logger?.info(event);
}
function toArrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
//# sourceMappingURL=server.js.map