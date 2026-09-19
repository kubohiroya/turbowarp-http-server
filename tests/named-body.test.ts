import {describe, expect, it, vi} from 'vitest';
import {
  createNamedBodyResponse,
  NamedBodyResolver
} from '../src/named-body.js';
import type {
  NamedBodyHandle,
  NamedBodyMetadata,
  NamedBodyProvider,
  NamedBodyReleaseReason,
  NamedBodyRequest
} from '../src/named-body.js';

const enabled = {namedResponseBody: true} as const;
const encoder = new TextEncoder();

describe('named response body', () => {
  it.each([
    ['json', 'profile', 'application/json; charset=utf-8', '{"name":"Ada"}'],
    ['yaml', 'profile', 'application/yaml; charset=utf-8', 'name: Ada\n'],
    ['raw', 'photo', 'image/png', '\u0089PNG']
  ] as const)('serves %s and raw bytes through the same response builder', async (representation, name, mediaType, text) => {
    const bytes = representation === 'raw' ? new Uint8Array([0x89, 0x50, 0x4e, 0x47]) : encoder.encode(text);
    const provider = new FakeNamedBodyProvider();
    provider.seed(name, representation, {mediaType, byteLength: bytes.byteLength}, bytes);

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request(name, representation),
      {featureFlags: enabled}
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(mediaType);
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(provider.releases).toEqual(['complete']);
  });

  it('is disabled by default without consulting providers', async () => {
    const provider = new FakeNamedBodyProvider();

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('profile', 'json')
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({error: 'NAMED_RESPONSE_BODY_DISABLED'});
    expect(provider.openCount).toBe(0);
  });

  it('reports the shared stable code when no namespace provider is registered', async () => {
    const response = await createNamedBodyResponse(
      new NamedBodyResolver([]),
      request('profile', 'json'),
      {featureFlags: enabled}
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({error: 'NAMED_DATA_PROVIDER_NOT_FOUND'});
  });

  it('uses stat for HEAD and does not open or release a body', async () => {
    const bytes = encoder.encode('{"ok":true}');
    const provider = new FakeNamedBodyProvider();
    provider.seed('status', 'json', {
      mediaType: 'application/json',
      byteLength: bytes.byteLength,
      revision: 'v1'
    }, bytes);

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('status', 'json'),
      {featureFlags: enabled, method: 'HEAD'}
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(response.headers.get('etag')).toBe('"v1"');
    expect(await response.text()).toBe('');
    expect(provider.statCount).toBe(1);
    expect(provider.openCount).toBe(0);
    expect(provider.releases).toEqual([]);
  });

  it('rejects a representation and media type mismatch and releases the snapshot', async () => {
    const provider = new FakeNamedBodyProvider();
    provider.seed('profile', 'json', {mediaType: 'text/html'}, encoder.encode('<p>Ada</p>'));

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('profile', 'json'),
      {featureFlags: enabled}
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({error: 'NAMED_DATA_REPRESENTATION_UNSUPPORTED'});
    expect(provider.releases).toEqual(['error']);
  });

  it('counts an unknown-length stream and releases it after completion', async () => {
    const provider = new FakeNamedBodyProvider();
    provider.seed(
      'stream',
      'raw',
      {mediaType: 'application/octet-stream'},
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        }
      })
    );

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('stream', 'raw'),
      {featureFlags: enabled, maxBodyBytes: 3}
    );

    expect(response.headers.get('content-length')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(provider.releases).toEqual(['complete']);
  });

  it('cancels and releases an open body when the request is aborted', async () => {
    const cancel = vi.fn();
    const provider = new FakeNamedBodyProvider();
    provider.seed(
      'stream',
      'raw',
      {mediaType: 'application/octet-stream'},
      new ReadableStream<Uint8Array>({cancel})
    );
    const abortController = new AbortController();

    await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('stream', 'raw'),
      {featureFlags: enabled, signal: abortController.signal}
    );
    abortController.abort('client_disconnected');

    await vi.waitFor(() => expect(provider.releases).toEqual(['abort']));
    expect(cancel).toHaveBeenCalledWith('client_disconnected');
  });

  it('cancels an unknown-length stream when it exceeds the configured limit', async () => {
    const cancel = vi.fn();
    const provider = new FakeNamedBodyProvider();
    provider.seed(
      'large',
      'raw',
      {mediaType: 'application/octet-stream'},
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        },
        cancel
      })
    );

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('large', 'raw'),
      {featureFlags: enabled, maxBodyBytes: 3}
    );

    await expect(response.arrayBuffer()).rejects.toThrow('configured limit');
    expect(cancel).toHaveBeenCalledWith('named_body_too_large');
    expect(provider.releases).toEqual(['error']);
  });
});

interface SeededBody {
  metadata: NamedBodyMetadata;
  body: Uint8Array | ReadableStream<Uint8Array>;
}

class FakeNamedBodyProvider implements NamedBodyProvider {
  private readonly bodies = new Map<string, SeededBody>();
  public readonly releases: NamedBodyReleaseReason[] = [];
  public statCount = 0;
  public openCount = 0;

  public seed(
    name: string,
    representation: NamedBodyRequest['representation'],
    metadata: NamedBodyMetadata,
    body: SeededBody['body']
  ): void {
    this.bodies.set(`${name}\0${representation}`, {metadata, body});
  }

  public canResolve(requestValue: NamedBodyRequest): boolean {
    return requestValue.reference.namespace === 'test';
  }

  public stat(requestValue: NamedBodyRequest): NamedBodyMetadata | null {
    this.statCount += 1;
    return this.bodies.get(keyFor(requestValue))?.metadata ?? null;
  }

  public openBody(requestValue: NamedBodyRequest): NamedBodyHandle | null {
    this.openCount += 1;
    const seeded = this.bodies.get(keyFor(requestValue));
    if (!seeded) return null;
    return {
      metadata: seeded.metadata,
      body: seeded.body,
      release: (reason) => {
        this.releases.push(reason);
      }
    };
  }
}

function request(name: string, representation: NamedBodyRequest['representation']): NamedBodyRequest {
  return {
    reference: {
      namespace: 'test',
      name,
      kind: representation === 'raw' ? 'binary' : 'structured',
      scope: 'project'
    },
    representation
  };
}

function keyFor(requestValue: NamedBodyRequest): string {
  return `${requestValue.reference.name}\0${requestValue.representation}`;
}
