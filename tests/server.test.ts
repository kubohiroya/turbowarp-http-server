import {describe, expect, it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {WebSocket} from 'ws';
import {createApp, startServer} from '../src/server.js';
import type {
  HttpRequestBridge,
  ResourceCapability,
  ResourceLogEvent,
  ResourceMetadata,
  ResourceSnapshot,
  ResourceWriteRequest,
  ResourceWriteResult
} from '../src/server.js';
import type {BridgeRequestMessage} from '../src/protocol.js';

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('HTTP bridge server app', () => {
  it('reports health', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'turbowarp-http-server'
    });
  });

  it('returns a bridge placeholder for ordinary HTTP requests when no resource route matches', async () => {
    const response = await createApp().request('/anything', {method: 'POST'});

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'not_connected'
    });
  });

  it('serves GET and HEAD for a binary global asset resource with cache metadata', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'frame-1',
      lastModified: new Date('2026-08-26T00:00:00Z')
    });
    const app = createApp({resources});

    const getResponse = await app.request('/@assets/live-camera');
    const headResponse = await app.request('/@assets/live-camera', {method: 'HEAD'});

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(getResponse.headers.get('content-length')).toBe('4');
    expect(getResponse.headers.get('etag')).toBe('"frame-1"');
    expect(getResponse.headers.get('last-modified')).toBe('Wed, 26 Aug 2026 00:00:00 GMT');
    expect(getResponse.headers.get('cache-control')).toBe('no-cache');
    expect(new Uint8Array(await getResponse.arrayBuffer())).toEqual(jpegBytes);

    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(headResponse.headers.get('content-length')).toBe('4');
    expect(await headResponse.text()).toBe('');
  });

  it('uses the actual byte length for in-memory resource responses', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      byteLength: 999,
      replacementId: 'frame-1'
    });

    const response = await createApp({resources}).request('/@assets/live-camera');

    expect(response.headers.get('content-length')).toBe('4');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpegBytes);
  });

  it('supports conditional GET with ETag', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'frame-1'
    });

    const response = await createApp({resources}).request('/@assets/live-camera', {
      headers: {'If-None-Match': '"frame-1"'}
    });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('replaces resources atomically while keeping a stable URL', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'frame-1'
    });
    const app = createApp({resources});

    const inProgressGet = await app.request('/@assets/live-camera');
    const putResponse = await app.request('/@assets/live-camera', {
      method: 'PUT',
      headers: {'Content-Type': 'image/png'},
      body: pngBytes
    });
    const nextGet = await app.request('/@assets/live-camera');

    expect(putResponse.status).toBe(204);
    expect(new Uint8Array(await inProgressGet.arrayBuffer())).toEqual(jpegBytes);
    expect(nextGet.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await nextGet.arrayBuffer())).toEqual(pngBytes);
  });

  it('creates and replaces a global asset resource over PUT', async () => {
    const resources = new MemoryResources();
    const app = createApp({resources});

    const created = await app.request('/@assets/logo', {
      method: 'PUT',
      headers: {'Content-Type': 'image/png'},
      body: pngBytes
    });
    const replaced = await app.request('/@assets/logo', {
      method: 'PUT',
      headers: {'Content-Type': 'image/jpeg'},
      body: jpegBytes
    });
    const getResponse = await app.request('/@assets/logo');

    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toBe('/@assets/logo');
    expect(replaced.status).toBe(204);
    expect(getResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await getResponse.arrayBuffer())).toEqual(jpegBytes);
  });

  it('rejects PUT bodies over the configured size limit', async () => {
    const response = await createApp({
      resources: new MemoryResources(),
      maxResourceBodyBytes: 3
    }).request('/@assets/live-camera', {
      method: 'PUT',
      headers: {'Content-Type': 'image/jpeg'},
      body: jpegBytes
    });

    expect(response.status).toBe(413);
  });

  it('rejects unsupported resource types through the capability contract', async () => {
    const response = await createApp({
      resources: new MemoryResources({supportedMimeTypes: ['image/jpeg']})
    }).request('/@assets/live-camera', {
      method: 'PUT',
      headers: {'Content-Type': 'text/html'},
      body: '<script></script>'
    });

    expect(response.status).toBe(415);
  });

  it('lists metadata and omits binary payloads', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'photo-1'
    });

    const response = await createApp({resources}).request('/@assets/');
    const body = (await response.json()) as {resources: Array<Record<string, unknown>>};

    expect(response.status).toBe(200);
    expect(body.resources).toEqual([
      {
        name: 'photo',
        mimeType: 'image/jpeg',
        byteLength: 4,
        replacementId: 'photo-1'
      }
    ]);
    expect(JSON.stringify(body)).not.toContain(String(jpegBytes[0]));
  });

  it('deletes resources when the capability supports removal', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'photo-1'
    });
    const app = createApp({resources});

    const deleted = await app.request('/@assets/photo', {method: 'DELETE'});
    const getResponse = await app.request('/@assets/photo');

    expect(deleted.status).toBe(204);
    expect(getResponse.status).toBe(404);
  });

  it('honors global asset namespace publication policy', async () => {
    const hiddenResources = new MemoryResources({publishedRoutes: new Set()});
    hiddenResources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'frame-1'
    });
    const visibleResources = new MemoryResources({publishedRoutes: new Set([''])});
    visibleResources.seed('', {
      name: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'photo-1'
    });

    expect((await createApp({resources: hiddenResources}).request('/@assets/live-camera')).status).toBe(
      404
    );
    expect((await createApp({resources: visibleResources}).request('/@assets/photo')).status).toBe(
      200
    );
  });

  it('does not treat sprite-scoped @assets paths as generic Asset Manager routes', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'frame-1'
    });
    const app = createApp({resources});

    expect((await app.request('/camera/@assets/live-camera')).status).toBe(404);
    expect((await app.request('/@assets/live-camera')).status).toBe(200);
  });

  it('keeps the management namespace separate from asset resource routes', async () => {
    const response = await createApp({resources: new MemoryResources()}).request(
      '/_tw-http/@assets/live-camera'
    );

    expect(response.status).toBe(404);
  });

  it('applies authorization hooks consistently to resource methods', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'frame-1'
    });
    const app = createApp({
      resources,
      authorizeResource: (_request, operation) => operation === 'list'
    });

    expect((await app.request('/@assets/live-camera')).status).toBe(403);
    expect((await app.request('/@assets/live-camera', {method: 'PUT', body: jpegBytes})).status).toBe(
      403
    );
    expect((await app.request('/@assets/live-camera', {method: 'DELETE'})).status).toBe(403);
    expect((await app.request('/@assets/')).status).toBe(200);
  });

  it('does not include binary request or response bodies in structured resource logs', async () => {
    const events: ResourceLogEvent[] = [];
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'live-camera',
      mimeType: 'image/jpeg',
      bytes: jpegBytes,
      replacementId: 'frame-1'
    });
    const app = createApp({
      resources,
      logger: {
        info: (event) => events.push(event)
      }
    });

    await app.request('/@assets/live-camera');
    await app.request('/@assets/live-camera', {
      method: 'PUT',
      headers: {'Content-Type': 'image/png'},
      body: pngBytes
    });

    expect(events).toEqual([
      {
        event: 'resource.get',
        routeName: '',
        resourceName: 'live-camera',
        mimeType: 'image/jpeg',
        byteLength: 4,
        status: 200
      },
      {
        event: 'resource.put',
        routeName: '',
        resourceName: 'live-camera',
        mimeType: 'image/png',
        byteLength: 4,
        status: 204
      }
    ]);
    expect(JSON.stringify(events)).not.toContain(String(Array.from(jpegBytes)));
    expect(JSON.stringify(events)).not.toContain(String(Array.from(pngBytes)));
  });

  it('supports a low-frequency live-camera composition with stable URLs and no stale cache', async () => {
    const resources = new MemoryResources();
    const app = createApp({resources});
    const producer = new FakeSnapshotProducer(resources, '', 'live-camera');

    await producer.captureEveryTenSeconds(jpegBytes, 'frame-1');
    const first = await app.request('/@assets/live-camera');
    await producer.captureEveryTenSeconds(pngBytes, 'frame-2');
    const second = await app.request('/@assets/live-camera');

    expect(first.headers.get('cache-control')).toBe('no-cache');
    expect(first.headers.get('etag')).toBe('"frame-1"');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(jpegBytes);
    expect(second.headers.get('cache-control')).toBe('no-cache');
    expect(second.headers.get('etag')).toBe('"frame-2"');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(pngBytes);
  });

  it('does not depend directly on camera source or HTML builder packages', async () => {
    const packageMetadata = JSON.parse(await readFile('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...packageMetadata.dependencies,
      ...packageMetadata.devDependencies
    };

    expect(dependencies).not.toHaveProperty('turbowarp-camera-source');
    expect(dependencies).not.toHaveProperty('turbowarp-html');
  });

  it('closes upgraded WebSocket clients during server shutdown', async () => {
    const port = await getFreePort();
    const server = startServer({hostname: '127.0.0.1', port});
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await onceOpen(socket);
    const closed = onceClose(socket);
    await server.close();
    await closed;

    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it('forwards HTTP requests to the TurboWarp bridge protocol and returns bridge responses', async () => {
    const port = await getFreePort();
    const server = startServer({
      hostname: '127.0.0.1',
      port,
      routes: ['/users/:id']
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(socket);
    const nextRequest = onceRequestMessage(socket);

    const responsePromise = fetch(`http://127.0.0.1:${port}/users/42?tag=a&tag=b`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Test': 'one'},
      body: '{"hello":true}'
    });
    const request = await nextRequest;

    expect(request).toMatchObject({
      type: 'request',
      protocol: 'turbowarp-http-server',
      version: 1,
      method: 'POST',
      path: '/users/42',
      route: '/users/:id',
      pathParams: {id: '42'},
      query: {tag: ['a', 'b']},
      body: {kind: 'text', text: '{"hello":true}'}
    });
    expect(request.clientAddress).toBe('127.0.0.1');
    expect(request.headers['content-type']).toEqual(['application/json']);
    expect(request.headers['x-test']).toEqual(['one']);

    socket.send(
      JSON.stringify({
        type: 'response',
        id: request.id,
        status: 201,
        headers: {'content-type': ['text/plain; charset=utf-8'], 'x-reply': ['ok']},
        body: {kind: 'text', text: 'created'}
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(201);
    expect(response.headers.get('x-reply')).toBe('ok');
    expect(await response.text()).toBe('created');
    await server.close();
  });

  it('resolves named Asset Manager bridge responses on the server without transporting bytes', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'avatar',
      mimeType: 'image/png',
      bytes: pngBytes,
      replacementId: 'avatar-v1'
    });
    const port = await getFreePort();
    const server = startServer({
      hostname: '127.0.0.1',
      port,
      resources,
      namedResponseBody: true
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(socket);
    const nextRequest = onceRequestMessage(socket);
    const responsePromise = fetch(`http://127.0.0.1:${port}/avatar`);
    const request = await nextRequest;

    socket.send(
      JSON.stringify({
        type: 'response',
        id: request.id,
        status: 200,
        headers: {'x-source': ['named']},
        body: {
          kind: 'named',
          reference: {
            namespace: 'asset-manager',
            name: 'avatar',
            kind: 'asset',
            scope: 'project'
          },
          representation: 'raw',
          maxBytes: 1024
        }
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('etag')).toBe('"avatar-v1"');
    expect(response.headers.get('x-source')).toBe('named');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);

    const nextHeadRequest = onceRequestMessage(socket);
    const headPromise = fetch(`http://127.0.0.1:${port}/avatar`, {method: 'HEAD'});
    const headRequest = await nextHeadRequest;
    socket.send(
      JSON.stringify({
        type: 'response',
        id: headRequest.id,
        status: 200,
        headers: {},
        body: {
          kind: 'named',
          reference: {
            namespace: 'asset-manager',
            name: 'avatar',
            kind: 'asset',
            scope: 'project'
          },
          representation: 'raw',
          maxBytes: 1024
        }
      })
    );
    const head = await headPromise;
    expect(head.headers.get('content-length')).toBe('4');
    expect(await head.text()).toBe('');
    socket.close();
    await server.close();
  });

  it('keeps named bridge responses disabled by default', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'avatar',
      mimeType: 'image/png',
      bytes: pngBytes,
      replacementId: 'avatar-v1'
    });
    const port = await getFreePort();
    const server = startServer({hostname: '127.0.0.1', port, resources});
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(socket);
    const nextRequest = onceRequestMessage(socket);
    const responsePromise = fetch(`http://127.0.0.1:${port}/avatar`);
    const request = await nextRequest;
    socket.send(
      JSON.stringify({
        type: 'response',
        id: request.id,
        status: 200,
        headers: {},
        body: {
          kind: 'named',
          reference: {
            namespace: 'asset-manager',
            name: 'avatar',
            kind: 'asset',
            scope: 'project'
          },
          representation: 'raw',
          maxBytes: 1024
        }
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({error: 'NAMED_RESPONSE_BODY_DISABLED'});
    socket.close();
    await server.close();
  });

  it('does not read text bridge request bodies over the configured limit', async () => {
    const forwarded: BridgeRequestMessage[] = [];
    const bridge: HttpRequestBridge = {
      async forward(message) {
        forwarded.push(message);
        return new Response('accepted');
      }
    };
    const app = createApp({bridge, maxRequestBodyBytes: 3});

    const response = await app.request('/large-text', {
      method: 'POST',
      headers: {'Content-Type': 'text/plain'},
      body: 'abcd'
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('accepted');
    expect(forwarded[0]?.body).toEqual({
      kind: 'unsupported',
      reason: 'request_body_too_large'
    });
  });

  it('suppresses bridge response bodies for HEAD requests and no-content statuses', async () => {
    const port = await getFreePort();
    const server = startServer({hostname: '127.0.0.1', port});
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(socket);
    const nextRequest = onceRequestMessage(socket);

    const responsePromise = fetch(`http://127.0.0.1:${port}/anything`, {method: 'HEAD'});
    const request = await nextRequest;
    socket.send(
      JSON.stringify({
        type: 'response',
        id: request.id,
        status: 200,
        headers: {'content-type': ['text/plain; charset=utf-8']},
        body: {kind: 'text', text: 'must not be sent'}
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    await server.close();
  });

  it('rejects invalid bridge response status and headers before reaching HTTP output', async () => {
    const port = await getFreePort();
    const server = startServer({hostname: '127.0.0.1', port});
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(socket);
    const nextRequest = onceRequestMessage(socket);

    const responsePromise = fetch(`http://127.0.0.1:${port}/unsafe`);
    const request = await nextRequest;
    socket.send(
      JSON.stringify({
        type: 'response',
        id: request.id,
        status: 200,
        headers: {'x-bad': ['line\nbreak']},
        body: {kind: 'text', text: 'unsafe'}
      })
    );

    const response = await responsePromise;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({error: 'invalid_bridge_header'});
    await server.close();
  });

  it('times out pending bridge requests', async () => {
    const port = await getFreePort();
    const server = startServer({hostname: '127.0.0.1', port, requestTimeoutMs: 20});
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(socket);

    const response = await fetch(`http://127.0.0.1:${port}/slow`);

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({error: 'gateway_timeout'});
    await server.close();
  });

  it('fails pending bridge requests when the bridge disconnects', async () => {
    const port = await getFreePort();
    const server = startServer({hostname: '127.0.0.1', port, requestTimeoutMs: 1000});
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(socket);
    const nextRequest = onceRequestMessage(socket);

    const responsePromise = fetch(`http://127.0.0.1:${port}/disconnect`);
    await nextRequest;
    socket.close();

    const response = await responsePromise;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({error: 'bridge_disconnected'});
    await server.close();
  });

  it('fails pending bridge requests when a replacement bridge connects', async () => {
    const port = await getFreePort();
    const server = startServer({hostname: '127.0.0.1', port, requestTimeoutMs: 1000});
    const firstSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await onceOpen(firstSocket);
    const nextRequest = onceRequestMessage(firstSocket);

    const responsePromise = fetch(`http://127.0.0.1:${port}/replace`);
    await nextRequest;
    const secondSocket = new WebSocket(`ws://127.0.0.1:${port}/ws?client=next`);
    await onceOpen(secondSocket);

    const response = await responsePromise;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({error: 'bridge_replaced'});
    secondSocket.close();
    await server.close();
  });
});

interface MemoryResourceOptions {
  publishedRoutes?: ReadonlySet<string>;
  supportedMimeTypes?: readonly string[];
}

class MemoryResources implements ResourceCapability {
  private readonly resources = new Map<string, ResourceSnapshot>();
  private readonly publishedRoutes: ReadonlySet<string> | undefined;
  private readonly supportedMimeTypes: readonly string[] | undefined;

  public constructor(options: MemoryResourceOptions = {}) {
    this.publishedRoutes = options.publishedRoutes;
    this.supportedMimeTypes = options.supportedMimeTypes;
  }

  public isNamespacePublished(routeName: string): boolean {
    return this.publishedRoutes?.has(routeName) ?? true;
  }

  public getResource(routeName: string, resourceName: string): ResourceSnapshot | null {
    const resource = this.resources.get(keyFor(routeName, resourceName));
    return resource ? cloneSnapshot(resource) : null;
  }

  public listResources(routeName: string): readonly ResourceMetadata[] {
    return Array.from(this.resources.entries())
      .filter(([key]) => key.startsWith(`${routeName}\0`))
      .map(([, resource]) => snapshotMetadata(resource))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public putResource(request: ResourceWriteRequest): ResourceWriteResult {
    const key = keyFor(request.routeName, request.resourceName);
    const created = !this.resources.has(key);
    this.resources.set(key, {
      name: request.resourceName,
      mimeType: request.mimeType,
      bytes: request.bytes.slice(),
      replacementId: `write-${Date.now()}-${request.bytes.byteLength}`,
      cacheControl: 'no-cache'
    });
    return {created};
  }

  public deleteResource(routeName: string, resourceName: string): boolean {
    return this.resources.delete(keyFor(routeName, resourceName));
  }

  public isSupportedResourceType(mimeType: string): boolean {
    return this.supportedMimeTypes?.includes(mimeType) ?? true;
  }

  public seed(routeName: string, snapshot: ResourceSnapshot): void {
    this.resources.set(keyFor(routeName, snapshot.name), cloneSnapshot(snapshot));
  }
}

class FakeSnapshotProducer {
  public constructor(
    private readonly resources: MemoryResources,
    private readonly routeName: string,
    private readonly resourceName: string
  ) {}

  public async captureEveryTenSeconds(bytes: Uint8Array, replacementId: string): Promise<void> {
    this.resources.seed(this.routeName, {
      name: this.resourceName,
      mimeType: replacementId.endsWith('2') ? 'image/png' : 'image/jpeg',
      bytes,
      replacementId,
      cacheControl: 'no-cache'
    });
  }
}

function keyFor(routeName: string, resourceName: string): string {
  return `${routeName}\0${resourceName}`;
}

function cloneSnapshot(snapshot: ResourceSnapshot): ResourceSnapshot {
  const cloned: ResourceSnapshot = {
    name: snapshot.name,
    mimeType: snapshot.mimeType,
    bytes: snapshot.bytes.slice()
  };
  if (snapshot.byteLength !== undefined) cloned.byteLength = snapshot.byteLength;
  if (snapshot.etag !== undefined) cloned.etag = snapshot.etag;
  if (snapshot.replacementId !== undefined) cloned.replacementId = snapshot.replacementId;
  if (snapshot.lastModified !== undefined) cloned.lastModified = snapshot.lastModified;
  if (snapshot.cacheControl !== undefined) cloned.cacheControl = snapshot.cacheControl;
  return cloned;
}

function snapshotMetadata(snapshot: ResourceSnapshot): ResourceMetadata {
  const metadata: ResourceMetadata = {
    name: snapshot.name,
    mimeType: snapshot.mimeType,
    byteLength: snapshot.byteLength ?? snapshot.bytes.byteLength
  };
  if (snapshot.etag !== undefined) metadata.etag = snapshot.etag;
  if (snapshot.replacementId !== undefined) metadata.replacementId = snapshot.replacementId;
  if (snapshot.lastModified !== undefined) metadata.lastModified = snapshot.lastModified;
  if (snapshot.cacheControl !== undefined) metadata.cacheControl = snapshot.cacheControl;
  return metadata;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port);
        else reject(new Error('Unable to allocate a free port.'));
      });
    });
  });
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function onceClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
  });
}

function onceRequestMessage(socket: WebSocket): Promise<BridgeRequestMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: Buffer) => {
      try {
        const parsed = JSON.parse(String(message)) as BridgeRequestMessage;
        if (parsed.type === 'request') {
          socket.off('message', onMessage);
          resolve(parsed);
        }
      } catch {
        return;
      }
    };
    socket.on('message', onMessage);
    socket.once('error', reject);
  });
}
