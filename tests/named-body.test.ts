import {describe, expect, it, vi} from 'vitest';
import {NamedDataRegistry, type NamedDataResolveContext} from '@kubohiroya/turbowarp-named-data/composition';
import {
  createNamedBodyResponse,
  NamedBodyResolver,
  NamedDataRegistryResolver
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
  it('serves canonical registry providers while retaining type metadata', async () => {
    const target = {};
    const registry = new NamedDataRegistry();
    const contexts: NamedDataResolveContext[] = [];
    registry.registerProvider({
      namespace: 'structured',
      kind: 'structured',
      canResolve: (reference, representation) =>
        reference.namespace === 'structured' && representation === 'json',
      stat: (reference, representation, context) => {
        contexts.push(context);
        return canonicalMetadata(reference, representation);
      },
      openBody: (reference, representation, context) => {
        contexts.push(context);
        return {
          ...canonicalMetadata(reference, representation),
          body: encoder.encode('{"ok":true}'),
          release: () => undefined
        };
      },
      release: () => undefined
    }, {lifetime: 'persistent'});
    const resolver = new NamedDataRegistryResolver(registry, () => ({target}));
    const response = await createNamedBodyResponse(resolver, {
      reference: {namespace: 'structured', name: 'profile', kind: 'structured', scope: 'target'},
      representation: 'json',
      targetId: 'Stage:1'
    }, {featureFlags: enabled});

    expect(await response.json()).toEqual({ok: true});
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.target).toBe(target);
  });

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

  it('dispatches structured and asset namespaces through one resolver contract', async () => {
    const structured = new FakeNamedBodyProvider('structured');
    const assets = new FakeNamedBodyProvider('asset');
    structured.seed('profile', 'json', {mediaType: 'application/json'}, encoder.encode('{"name":"Ada"}'));
    assets.seed('avatar', 'raw', {mediaType: 'image/png'}, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const resolver = new NamedBodyResolver([structured, assets]);

    const jsonResponse = await createNamedBodyResponse(
      resolver,
      request('profile', 'json', {namespace: 'structured', kind: 'structured'}),
      {featureFlags: enabled}
    );
    const assetResponse = await createNamedBodyResponse(
      resolver,
      request('avatar', 'raw', {namespace: 'asset', kind: 'asset'}),
      {featureFlags: enabled}
    );

    expect(await jsonResponse.text()).toBe('{"name":"Ada"}');
    expect(new Uint8Array(await assetResponse.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(structured.openCount).toBe(1);
    expect(assets.openCount).toBe(1);
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

    await expect(response.arrayBuffer()).rejects.toMatchObject({
      code: 'NAMED_DATA_BODY_TOO_LARGE',
      message: 'NAMED_DATA_BODY_TOO_LARGE'
    });
    expect(cancel).toHaveBeenCalledWith('named_body_too_large');
    expect(provider.releases).toEqual(['error']);
  });

  it.each([
    ['invalid namespace', {...request('profile', 'json'), reference: {...request('profile', 'json').reference, namespace: '../test'}}],
    ['control character', {...request('bad\nname', 'json')}],
    ['missing target identity', {...request('profile', 'json'), reference: {...request('profile', 'json').reference, scope: 'target'}}],
    ['project identity ambiguity', {...request('profile', 'json'), targetId: 'Stage:1'}]
  ] as const)('rejects an %s before provider access', async (_label, invalidRequest) => {
    const provider = new FakeNamedBodyProvider();

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      invalidRequest as NamedBodyRequest,
      {featureFlags: enabled}
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({error: 'NAMED_DATA_INVALID_REF'});
    expect(provider.openCount).toBe(0);
    expect(provider.statCount).toBe(0);
  });

  it('requires HEAD metadata to satisfy the same size limit as GET', async () => {
    const provider = new FakeNamedBodyProvider();
    provider.seed('large', 'raw', {mediaType: 'application/octet-stream', byteLength: 4}, new Uint8Array(4));

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('large', 'raw'),
      {featureFlags: enabled, method: 'HEAD', maxBodyBytes: 3}
    );

    expect(response.status).toBe(413);
    expect(await response.text()).toBe('');
    expect(provider.openCount).toBe(0);
  });

  it('rejects a buffered body whose declared length does not match its snapshot', async () => {
    const provider = new FakeNamedBodyProvider();
    provider.seed('profile', 'json', {mediaType: 'application/json', byteLength: 99}, encoder.encode('{}'));

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('profile', 'json'),
      {featureFlags: enabled}
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({error: 'NAMED_RESPONSE_INVALID_METADATA'});
    expect(provider.releases).toEqual(['error']);
  });

  it('keeps an opened stream snapshot isolated from same-name replacement', async () => {
    const provider = new FakeNamedBodyProvider();
    provider.seed('snapshot', 'raw', {mediaType: 'application/octet-stream'}, streamOf([1, 2]));
    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('snapshot', 'raw'),
      {featureFlags: enabled}
    );

    provider.seed('snapshot', 'raw', {mediaType: 'application/octet-stream'}, streamOf([9]));

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(provider.releases).toEqual(['complete']);
  });

  it('maps release failure without exposing the provider message', async () => {
    const provider = new FakeNamedBodyProvider();
    provider.releaseFailure = true;
    provider.seed('profile', 'json', {mediaType: 'application/json'}, encoder.encode('{}'));

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('profile', 'json'),
      {featureFlags: enabled}
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({error: 'NAMED_DATA_PROVIDER_RELEASED'});
    expect(body).not.toContain('private release detail');
  });

  it('classifies canonical provider metadata failures as an upstream error', async () => {
    const error = Object.assign(new Error('private metadata detail'), {
      code: 'NAMED_DATA_INVALID_METADATA' as const
    });
    const provider: NamedBodyProvider = {
      canResolve: () => true,
      stat: async () => {
        throw error;
      },
      openBody: async () => {
        throw error;
      }
    };

    const response = await createNamedBodyResponse(
      new NamedBodyResolver([provider]),
      request('profile', 'json'),
      {featureFlags: enabled}
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({error: 'NAMED_DATA_INVALID_METADATA'});
  });
});

interface SeededBody {
  metadata: NamedBodyMetadata;
  body: Uint8Array | ReadableStream<Uint8Array>;
}

type SeedMetadata = Pick<NamedBodyMetadata, 'mediaType'> &
  Partial<Omit<NamedBodyMetadata, 'mediaType'>>;

class FakeNamedBodyProvider implements NamedBodyProvider {
  private readonly bodies = new Map<string, SeededBody>();
  public readonly releases: NamedBodyReleaseReason[] = [];
  public statCount = 0;
  public openCount = 0;
  public releaseFailure = false;

  public constructor(private readonly namespace = 'test') {}

  public seed(
    name: string,
    representation: NamedBodyRequest['representation'],
    metadata: SeedMetadata,
    body: SeededBody['body']
  ): void {
    const kind = this.namespace === 'asset' ? 'asset' : representation === 'raw' ? 'binary' : 'structured';
    this.bodies.set(`${name}\0${representation}`, {
      metadata: {
        reference: {namespace: this.namespace, name, kind, scope: 'project'},
        nativeRepresentation: representation,
        representation,
        revision: 'fixture:1',
        replayable: true,
        ...metadata
      },
      body
    });
  }

  public canResolve(requestValue: NamedBodyRequest): boolean {
    return requestValue.reference.namespace === this.namespace;
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
        if (this.releaseFailure) throw new Error('private release detail');
      }
    };
  }
}

function request(
  name: string,
  representation: NamedBodyRequest['representation'],
  overrides: {namespace?: string; kind?: NamedBodyRequest['reference']['kind']} = {}
): NamedBodyRequest {
  return {
    reference: {
      namespace: overrides.namespace ?? 'test',
      name,
      kind: overrides.kind ?? (representation === 'raw' ? 'binary' : 'structured'),
      scope: 'project'
    },
    representation
  };
}

function keyFor(requestValue: NamedBodyRequest): string {
  return `${requestValue.reference.name}\0${requestValue.representation}`;
}

function streamOf(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    }
  });
}

function canonicalMetadata(
  reference: NamedBodyRequest['reference'],
  representation: NamedBodyRequest['representation']
): NamedBodyMetadata {
  return {
    reference: {...reference},
    nativeRepresentation: 'json',
    representation,
    mediaType: 'application/json; charset=utf-8',
    byteLength: 11,
    revision: 'fixture:canonical:1',
    replayable: true
  };
}
