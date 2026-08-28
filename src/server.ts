import {serve} from '@hono/node-server';
import {getConnInfo} from '@hono/node-server/conninfo';
import type {ServerType} from '@hono/node-server';
import {createServer as createHttpsServer} from 'node:https';
import type {ServerOptions as HttpsServerOptions} from 'node:https';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {secureHeaders} from 'hono/secure-headers';
import type {WebSocket} from 'ws';
import {WebSocketServer} from 'ws';
import {DIGEST_AUTH_USER_HEADER, isLocalAddress, verifyDigestAuth} from './auth/digest.js';
import type {DigestAuthOptions} from './auth/digest.js';
import {createCommunityApp} from './community.js';
import type {CommunityServerOptions} from './community.js';
import {
  HTTP_BRIDGE_PROTOCOL,
  HTTP_BRIDGE_PROTOCOL_VERSION,
  isBodyForbidden,
  isForbiddenResponseHeader,
  isValidHttpStatus,
  normalizeHeaderName,
  parseBridgeClientMessage,
  validateHeaderName,
  validateHeaderValue
} from './protocol.js';
import type {BridgeBody, BridgeRequestMessage, BridgeResponseMessage} from './protocol.js';

export interface ServerOptions {
  hostname: string;
  port: number;
  resources?: ResourceCapability;
  maxResourceBodyBytes?: number;
  maxRequestBodyBytes?: number;
  logger?: ResourceLogger;
  authorizeResource?: ResourceAuthorizer;
  digestAuth?: DigestAuthOptions;
  tls?: HttpsServerOptions;
  requestTimeoutMs?: number;
  routes?: readonly string[];
  community?: false | CommunityServerOptions;
}

export interface RunningServer {
  hostname: string;
  port: number;
  close(): Promise<void>;
}

export interface ResourceSnapshot {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  byteLength?: number;
  etag?: string;
  replacementId?: string;
  lastModified?: Date;
  cacheControl?: string;
}

export interface ResourceMetadata {
  name: string;
  mimeType: string;
  byteLength?: number;
  etag?: string;
  replacementId?: string;
  lastModified?: Date;
  cacheControl?: string;
}

export interface ResourceWriteRequest {
  routeName: string;
  resourceName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ResourceWriteResult {
  created: boolean;
  snapshot?: ResourceSnapshot;
}

export interface ResourceCapability {
  isNamespacePublished?(routeName: string): boolean | Promise<boolean>;
  getResource(routeName: string, resourceName: string): ResourceSnapshot | null | Promise<ResourceSnapshot | null>;
  listResources?(routeName: string): readonly ResourceMetadata[] | Promise<readonly ResourceMetadata[]>;
  putResource?(request: ResourceWriteRequest): ResourceWriteResult | Promise<ResourceWriteResult>;
  deleteResource?(routeName: string, resourceName: string): boolean | Promise<boolean>;
  isSupportedResourceType?(mimeType: string): boolean | Promise<boolean>;
}

export interface ResourceLogEvent {
  event: 'resource.get' | 'resource.head' | 'resource.put' | 'resource.delete' | 'resource.list';
  routeName: string;
  resourceName?: string;
  mimeType?: string;
  byteLength?: number;
  status: number;
}

export interface ResourceLogger {
  info(event: ResourceLogEvent): void;
}

export type ResourceAuthorizer = (
  request: Request,
  operation: 'get' | 'head' | 'put' | 'delete' | 'list',
  routeName: string,
  resourceName?: string
) => boolean | Promise<boolean>;

export interface ServerAppOptions {
  resources?: ResourceCapability;
  maxResourceBodyBytes?: number;
  maxRequestBodyBytes?: number;
  logger?: ResourceLogger;
  authorizeResource?: ResourceAuthorizer;
  digestAuth?: DigestAuthOptions;
  bridge?: HttpRequestBridge;
  routes?: readonly string[];
  community?: false | CommunityServerOptions;
}

const DEFAULT_MAX_RESOURCE_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const TEXT_BODY_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'application/xml',
  'text/'
];
const authenticatedUsers = new WeakMap<Request, string>();

export interface HttpRequestBridge {
  forward(message: BridgeRequestMessage, method: string): Promise<Response>;
}

export function createApp(options: ServerAppOptions = {}): Hono {
  const app = new Hono();

  app.use('*', secureHeaders());

  if (options.digestAuth) {
    app.use('*', async (c, next) => {
      const result = await verifyDigestAuth(c.req.raw, c.req.method, options.digestAuth!);
      if (!result.ok) {
        return c.json(
          {
            error: 'authentication_required',
            message: 'HTTP Digest authentication is required.'
          },
          401,
          {'WWW-Authenticate': result.challenge ?? ''}
        );
      }
      if (result.username) authenticatedUsers.set(c.req.raw, result.username);
      await next();
    });
  }

  if (options.community) {
    app.route('/', createCommunityApp(options.community));
  }

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'turbowarp-http-server'
    })
  );

  app.get('/ws', (c) =>
    c.json(
      {
        error: 'upgrade_required',
        message: 'Connect to this endpoint with WebSocket.'
      },
      426
    )
  );

  app.all('*', async (c) => {
    const resourceResponse = await handleResourceRequest(c, options);
    if (resourceResponse) return resourceResponse;

    if (options.bridge) {
      const bridgeRequestOptions: BridgeRequestOptions = {
        routes: options.routes ?? [],
        maxBodyBytes: options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES,
        clientAddress: readClientAddress(c)
      };
      const authenticatedUser = authenticatedUsers.get(c.req.raw);
      if (authenticatedUser) bridgeRequestOptions.authenticatedUser = authenticatedUser;
      return options.bridge.forward(
        await createBridgeRequestMessage(c.req.raw, bridgeRequestOptions),
        c.req.method
      );
    }

    return c.json(
      {
        error: 'not_connected',
        message: 'HTTP-to-TurboWarp request forwarding has not been implemented yet.'
      },
      503
    );
  });

  return app;
}

export function startServer(options: ServerOptions): RunningServer {
  const bridge = new WebSocketHttpRequestBridge(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const app = createApp({...options, bridge});
  const wss = new WebSocketServer({noServer: true});
  const sockets = new Set<WebSocket>();
  const server: ServerType = serve({
    fetch: app.fetch,
    hostname: options.hostname,
    port: options.port,
    ...(options.tls ? {createServer: createHttpsServer, serverOptions: options.tls} : {})
  });

  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isLocalAddress(socket.remoteAddress)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.add(ws);
      bridge.attach(ws);
      ws.on('close', () => {
        sockets.delete(ws);
        bridge.detach(ws);
      });
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: HTTP_BRIDGE_PROTOCOL,
          version: 1
        })
      );
      ws.on('message', (message) => {
        bridge.receive(ws, String(message));
      });
    });
  });

  return {
    hostname: options.hostname,
    port: options.port,
    close: async () => {
      const socketClosePromises = Array.from(sockets, (socket) => closeSocket(socket));
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
        new Promise<void>((resolve, reject) => {
          wss.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
        ...socketClosePromises
      ]);
      sockets.clear();
    }
  };
}

class WebSocketHttpRequestBridge implements HttpRequestBridge {
  private socket: WebSocket | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<
    string,
    {
      method: string;
      resolve(response: Response): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  public constructor(private readonly requestTimeoutMs: number) {}

  public attach(socket: WebSocket): void {
    const previousSocket = this.socket;
    this.socket = socket;
    if (previousSocket && previousSocket !== socket) {
      this.failPending('bridge_replaced');
      if (previousSocket.readyState === previousSocket.OPEN) previousSocket.close();
    }
  }

  public detach(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.failPending('bridge_disconnected');
  }

  private failPending(error: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.resolve(jsonResponse({error}, 502));
      this.pending.delete(id);
    }
  }

  public async forward(message: BridgeRequestMessage, method: string): Promise<Response> {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      return jsonResponse({error: 'not_connected'}, 503);
    }

    const id = `req-${this.nextRequestId}`;
    this.nextRequestId += 1;
    const requestMessage = {...message, id};

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve(jsonResponse({error: 'gateway_timeout'}, 504));
      }, this.requestTimeoutMs);

      this.pending.set(id, {method, resolve, timeout});
      try {
        this.socket?.send(JSON.stringify(requestMessage));
      } catch {
        clearTimeout(timeout);
        this.pending.delete(id);
        resolve(jsonResponse({error: 'bridge_send_failed'}, 502));
      }
    });
  }

  public receive(socket: WebSocket, message: string): void {
    if (socket !== this.socket) return;
    const parsed = parseBridgeClientMessage(message);
    if (!parsed) return;
    if (parsed.type === 'error') {
      if (!parsed.id) return;
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(parsed.id);
      pending.resolve(jsonResponse({error: 'bridge_error', message: parsed.message}, 502));
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(parsed.id);
    pending.resolve(toHttpResponse(parsed, pending.method));
  }
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === socket.CLOSED) {
      resolve();
      return;
    }
    socket.once('close', () => resolve());
    socket.terminate();
  });
}

interface BridgeRequestOptions {
  routes: readonly string[];
  maxBodyBytes: number;
  clientAddress: string;
  authenticatedUser?: string;
}

async function createBridgeRequestMessage(request: Request, options: BridgeRequestOptions): Promise<BridgeRequestMessage> {
  const url = new URL(request.url);
  const routeMatch = matchRoute(url.pathname, options.routes);
  const headers = collectHeaders(request.headers);
  delete headers[DIGEST_AUTH_USER_HEADER];
  if (options.authenticatedUser) headers[DIGEST_AUTH_USER_HEADER] = [options.authenticatedUser];
  const message: BridgeRequestMessage = {
    type: 'request',
    protocol: HTTP_BRIDGE_PROTOCOL,
    version: HTTP_BRIDGE_PROTOCOL_VERSION,
    id: '',
    method: request.method.toUpperCase(),
    url: request.url,
    path: url.pathname,
    route: routeMatch.route,
    pathParams: routeMatch.pathParams,
    query: collectQuery(url.searchParams),
    headers,
    body: await readTextBridgeBody(request, options.maxBodyBytes),
    clientAddress: options.clientAddress
  };
  if (options.authenticatedUser) {
    message.auth = {
      type: 'digest',
      username: options.authenticatedUser
    };
  }
  return message;
}

function toHttpResponse(message: BridgeResponseMessage, method: string): Response {
  const status = isValidHttpStatus(message.status) ? message.status : 502;
  if (!isValidHttpStatus(message.status)) {
    return jsonResponse({error: 'invalid_bridge_status'}, 502);
  }

  const headers = new Headers();
  for (const [name, values] of Object.entries(message.headers)) {
    const normalized = normalizeHeaderName(name);
    if (
      !validateHeaderName(normalized) ||
      isForbiddenResponseHeader(normalized) ||
      values.some((value) => !validateHeaderValue(value))
    ) {
      return jsonResponse({error: 'invalid_bridge_header'}, 502);
    }
    for (const value of values) {
      headers.append(normalized, value);
    }
  }

  if (isBodyForbidden(method, status)) {
    return new Response(null, {status, headers});
  }

  if (message.body.kind === 'text') {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8');
    return new Response(message.body.text, {status, headers});
  }
  return new Response(null, {status, headers});
}

function collectQuery(params: URLSearchParams): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  for (const [name, value] of params) {
    query[name] ??= [];
    query[name].push(value);
  }
  return query;
}

function collectHeaders(headers: Headers): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  headers.forEach((value, name) => {
    const normalized = normalizeHeaderName(name);
    result[normalized] ??= [];
    result[normalized].push(value);
  });
  return result;
}

async function readTextBridgeBody(request: Request, maxBytes: number): Promise<BridgeBody> {
  if (request.method.toUpperCase() === 'GET' || request.method.toUpperCase() === 'HEAD') {
    return {kind: 'empty'};
  }
  const contentLength = parseContentLength(request.headers.get('content-length'));
  if (contentLength !== null && contentLength > maxBytes) {
    return {kind: 'unsupported', reason: 'request_body_too_large'};
  }
  const contentType = request.headers.get('content-type') ?? '';
  const lowerContentType = contentType.toLowerCase();
  if (!TEXT_BODY_TYPES.some((type) => lowerContentType.startsWith(type))) {
    return {kind: 'unsupported', reason: 'non_text_body'};
  }
  const text = await readTextWithLimit(request, maxBytes);
  return text === null ? {kind: 'unsupported', reason: 'request_body_too_large'} : {kind: 'text', text};
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytesRead += result.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(result.value, {stream: true});
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const length = Number.parseInt(value, 10);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

function readClientAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? '';
  } catch {
    return '';
  }
}

interface RouteMatch {
  route: string;
  pathParams: Record<string, string>;
}

function matchRoute(pathname: string, routes: readonly string[]): RouteMatch {
  for (const route of routes) {
    const params = matchRoutePattern(pathname, route);
    if (params) return {route, pathParams: params};
  }
  return {route: pathname, pathParams: {}};
}

function matchRoutePattern(pathname: string, route: string): Record<string, string> | null {
  const pathSegments = splitRoute(pathname);
  const routeSegments = splitRoute(route);
  if (pathSegments.length !== routeSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const pathSegment = pathSegments[index] ?? '';
    if (routeSegment?.startsWith(':')) {
      params[routeSegment.slice(1)] = pathSegment;
    } else if (routeSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}

function splitRoute(value: string): string[] {
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodePathSegment);
}

async function handleResourceRequest(
  c: Context,
  options: ServerAppOptions
): Promise<Response | null> {
  const route = parseResourceRoute(new URL(c.req.url).pathname);
  if (!route) return null;

  if (route.managementNamespace) {
    return jsonResponse({error: 'not_found'}, 404);
  }

  const resources = options.resources;
  if (!resources) return null;

  const published = await resources.isNamespacePublished?.(route.routeName);
  if (published === false) {
    return jsonResponse({error: 'not_found'}, 404);
  }

  const method = c.req.method.toUpperCase();
  if (route.listing) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD']);
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

async function handleResourceGet(
  request: Request,
  routeName: string,
  resourceName: string,
  resources: ResourceCapability,
  options: ServerAppOptions,
  method: 'GET' | 'HEAD'
): Promise<Response> {
  if (!(await authorize(options, request, method.toLowerCase() as 'get' | 'head', routeName, resourceName))) {
    return jsonResponse({error: 'forbidden'}, 403);
  }

  const snapshot = await resources.getResource(routeName, resourceName);
  if (!snapshot) {
    logResource(options, {
      event: method === 'GET' ? 'resource.get' : 'resource.head',
      routeName,
      resourceName,
      status: 404
    });
    return jsonResponse({error: 'not_found'}, 404);
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

  if (notModified) return new Response(null, {status, headers});
  return new Response(method === 'HEAD' ? null : toArrayBuffer(snapshot.bytes), {status, headers});
}

async function handleResourceList(
  request: Request,
  routeName: string,
  resources: ResourceCapability,
  options: ServerAppOptions,
  headOnly: boolean
): Promise<Response> {
  if (!(await authorize(options, request, headOnly ? 'head' : 'list', routeName))) {
    return jsonResponse({error: 'forbidden'}, 403);
  }
  if (!resources.listResources) return jsonResponse({error: 'not_supported'}, 405, {Allow: 'GET, HEAD'});

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
  return new Response(headOnly ? null : body, {status: 200, headers});
}

async function handleResourcePut(
  request: Request,
  routeName: string,
  resourceName: string,
  resources: ResourceCapability,
  options: ServerAppOptions
): Promise<Response> {
  if (!resources.putResource) return jsonResponse({error: 'not_supported'}, 405, {Allow: 'GET, HEAD'});
  if (!(await authorize(options, request, 'put', routeName, resourceName))) {
    return jsonResponse({error: 'forbidden'}, 403);
  }

  const mimeType = request.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'application/octet-stream';
  const supported = await resources.isSupportedResourceType?.(mimeType);
  if (supported === false) return jsonResponse({error: 'unsupported_media_type'}, 415);

  const maxBytes = options.maxResourceBodyBytes ?? DEFAULT_MAX_RESOURCE_BODY_BYTES;
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number.parseInt(contentLength, 10) > maxBytes) {
    return jsonResponse({error: 'payload_too_large'}, 413);
  }

  const bytes = await readBodyWithLimit(request, maxBytes);
  if (bytes === null) return jsonResponse({error: 'payload_too_large'}, 413);

  const result = await resources.putResource({routeName, resourceName, mimeType, bytes});
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
      headers: {Location: resourceLocation(routeName, resourceName)}
    });
  }
  return new Response(null, {status: 204});
}

async function handleResourceDelete(
  request: Request,
  routeName: string,
  resourceName: string,
  resources: ResourceCapability,
  options: ServerAppOptions
): Promise<Response> {
  if (!resources.deleteResource) return jsonResponse({error: 'not_supported'}, 405, {Allow: 'GET, HEAD, PUT'});
  if (!(await authorize(options, request, 'delete', routeName, resourceName))) {
    return jsonResponse({error: 'forbidden'}, 403);
  }

  const removed = await resources.deleteResource(routeName, resourceName);
  logResource(options, {
    event: 'resource.delete',
    routeName,
    resourceName,
    status: removed ? 204 : 404
  });
  return removed ? new Response(null, {status: 204}) : jsonResponse({error: 'not_found'}, 404);
}

interface ParsedResourceRoute {
  routeName: string;
  resourceName: string;
  listing: boolean;
  managementNamespace: boolean;
}

function parseResourceRoute(pathname: string): ParsedResourceRoute | null {
  const rawSegments = pathname.split('/').filter((segment) => segment.length > 0);
  const segments = rawSegments.map(decodePathSegment);
  if (segments[0] === '_tw-http') {
    return {routeName: '', resourceName: '', listing: false, managementNamespace: true};
  }

  const assetIndex = segments.indexOf('@assets');
  if (assetIndex < 0) return null;
  if (assetIndex !== 0) {
    return {routeName: '', resourceName: '', listing: false, managementNamespace: true};
  }

  const routeName = '';
  const resourceSegments = segments.slice(1);
  const listing = resourceSegments.length === 0;
  const resourceName = resourceSegments.join('/');
  if (!listing && resourceName.length === 0) return null;
  return {routeName, resourceName, listing, managementNamespace: false};
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function resourceHeaders(snapshot: ResourceSnapshot): Headers {
  const headers = new Headers({
    'Content-Type': snapshot.mimeType,
    'Content-Length': String(getByteLength(snapshot)),
    'Cache-Control': snapshot.cacheControl ?? defaultCacheControl(snapshot)
  });
  const etag = getEtag(snapshot);
  if (etag) headers.set('ETag', etag);
  if (snapshot.lastModified) headers.set('Last-Modified', snapshot.lastModified.toUTCString());
  return headers;
}

function getByteLength(snapshot: ResourceSnapshot): number {
  return snapshot.bytes.byteLength;
}

function getEtag(snapshot: ResourceSnapshot): string | undefined {
  const identity = snapshot.etag ?? snapshot.replacementId;
  if (!identity) return undefined;
  if (/^(W\/)?"[^"]*"$/.test(identity)) return identity;
  return `"${identity.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function defaultCacheControl(snapshot: ResourceSnapshot): string {
  return snapshot.etag || snapshot.replacementId || snapshot.lastModified ? 'no-cache' : 'no-store';
}

function isNotModified(request: Request, headers: Headers): boolean {
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
  if (!lastModified || !ifModifiedSince) return false;
  return Date.parse(ifModifiedSince) >= Date.parse(lastModified);
}

async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
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

async function authorize(
  options: ServerAppOptions,
  request: Request,
  operation: 'get' | 'head' | 'put' | 'delete' | 'list',
  routeName: string,
  resourceName?: string
): Promise<boolean> {
  return (await options.authorizeResource?.(request, operation, routeName, resourceName)) !== false;
}

function metadataWithoutBody(resource: ResourceMetadata): ResourceMetadata {
  const metadata: ResourceMetadata = {
    name: resource.name,
    mimeType: resource.mimeType
  };
  if (resource.byteLength !== undefined) metadata.byteLength = resource.byteLength;
  if (resource.etag !== undefined) metadata.etag = resource.etag;
  if (resource.replacementId !== undefined) metadata.replacementId = resource.replacementId;
  if (resource.lastModified !== undefined) metadata.lastModified = resource.lastModified;
  if (resource.cacheControl !== undefined) metadata.cacheControl = resource.cacheControl;
  return metadata;
}

function resourceLocation(routeName: string, resourceName: string): string {
  const encodedName = resourceName.split('/').map(encodeURIComponent).join('/');
  return routeName === '' ? `/@assets/${encodedName}` : `/${encodeURIComponent(routeName)}/${encodedName}`;
}

function methodNotAllowed(methods: readonly string[]): Response {
  return jsonResponse({error: 'method_not_allowed'}, 405, {Allow: methods.join(', ')});
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), {status, headers: responseHeaders});
}

function logResource(options: ServerAppOptions, event: ResourceLogEvent): void {
  options.logger?.info(event);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
