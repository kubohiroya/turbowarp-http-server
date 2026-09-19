import {describe, expect, it, vi} from 'vitest';
import {createNamedBodyResponse, NamedBodyResolver} from '../src/named-body.js';
import {createAssetManagerNamedBodyProvider} from '../src/resource-named-body-provider.js';
import type {
  ResourceCapability,
  ResourceMetadata,
  ResourceSnapshot
} from '../src/server.js';

const enabled = {namedResponseBody: true} as const;

describe('Asset Manager named body provider', () => {
  it('serves a project-scoped raw snapshot and keeps opened bytes isolated from replacement', async () => {
    const resources = new MemoryResources();
    resources.seed('', snapshot('avatar', 'image/png', [1, 2], 'v1'));
    const provider = createAssetManagerNamedBodyProvider(resources);
    const response = await createNamedBodyResponse(new NamedBodyResolver([provider]), request('avatar'), {
      featureFlags: enabled
    });
    resources.seed('', snapshot('avatar', 'image/png', [9], 'v2'));

    expect(response.headers.get('etag')).toBe('"v1"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it('uses listing metadata for HEAD without loading resource bytes', async () => {
    const resources = new MemoryResources();
    resources.seed('', snapshot('avatar', 'image/png', [1, 2, 3], 'v1'));
    const getResource = vi.spyOn(resources, 'getResource');
    const response = await createNamedBodyResponse(
      new NamedBodyResolver([createAssetManagerNamedBodyProvider(resources)]),
      request('avatar'),
      {featureFlags: enabled, method: 'HEAD'}
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('3');
    expect(await response.text()).toBe('');
    expect(getResource).not.toHaveBeenCalled();
  });

  it('maps target scope to the target resource namespace', async () => {
    const resources = new MemoryResources();
    resources.seed('Stage:1', snapshot('avatar', 'image/png', [4, 5], 'target-v1'));
    const response = await createNamedBodyResponse(
      new NamedBodyResolver([createAssetManagerNamedBodyProvider(resources)]),
      request('avatar', 'target', 'Stage:1'),
      {featureFlags: enabled}
    );

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5]));
  });

  it('returns stable errors for kind, representation, publication, and abort checks', async () => {
    const resources = new MemoryResources(new Set());
    resources.seed('', snapshot('avatar', 'image/png', [1], 'v1'));
    const resolver = new NamedBodyResolver([createAssetManagerNamedBodyProvider(resources)]);

    const wrongKind = await createNamedBodyResponse(
      resolver,
      {...request('avatar'), reference: {...request('avatar').reference, kind: 'binary'}},
      {featureFlags: enabled}
    );
    const wrongRepresentation = await createNamedBodyResponse(
      resolver,
      {...request('avatar'), representation: 'json'},
      {featureFlags: enabled}
    );
    const unpublished = await createNamedBodyResponse(resolver, request('avatar'), {featureFlags: enabled});
    const abort = new AbortController();
    abort.abort();
    const aborted = await createNamedBodyResponse(
      new NamedBodyResolver([createAssetManagerNamedBodyProvider(new MemoryResources())]),
      request('avatar'),
      {featureFlags: enabled, signal: abort.signal}
    );

    await expect(wrongKind.json()).resolves.toEqual({error: 'NAMED_DATA_KIND_MISMATCH'});
    await expect(wrongRepresentation.json()).resolves.toEqual({error: 'NAMED_DATA_REPRESENTATION_UNSUPPORTED'});
    await expect(unpublished.json()).resolves.toEqual({error: 'NAMED_DATA_NOT_FOUND'});
    await expect(aborted.json()).resolves.toEqual({error: 'NAMED_DATA_ABORTED'});
  });

  it('rejects resources that cannot provide a content revision', async () => {
    const resources = new MemoryResources();
    resources.seed('', {
      name: 'unstable',
      mimeType: 'application/octet-stream',
      bytes: new Uint8Array([1])
    });
    const response = await createNamedBodyResponse(
      new NamedBodyResolver([createAssetManagerNamedBodyProvider(resources)]),
      request('unstable'),
      {featureFlags: enabled}
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({error: 'NAMED_DATA_INVALID_METADATA'});
  });
});

class MemoryResources implements ResourceCapability {
  private readonly values = new Map<string, ResourceSnapshot>();

  public constructor(private readonly published?: ReadonlySet<string>) {}

  public isNamespacePublished(routeName: string): boolean {
    return this.published?.has(routeName) ?? true;
  }

  public getResource(routeName: string, resourceName: string): ResourceSnapshot | null {
    return this.values.get(key(routeName, resourceName)) ?? null;
  }

  public listResources(routeName: string): readonly ResourceMetadata[] {
    return [...this.values.entries()]
      .filter(([entryKey]) => entryKey.startsWith(`${routeName}\0`))
      .map(([, value]) => ({
        name: value.name,
        mimeType: value.mimeType,
        byteLength: value.bytes.byteLength,
        ...(value.replacementId === undefined ? {} : {replacementId: value.replacementId})
      }));
  }

  public seed(routeName: string, value: ResourceSnapshot): void {
    this.values.set(key(routeName, value.name), value);
  }
}

function request(name: string, scope: 'project' | 'target' = 'project', targetId?: string) {
  return {
    reference: {namespace: 'asset', name, kind: 'asset' as const, scope},
    representation: 'raw' as const,
    ...(targetId === undefined ? {} : {targetId})
  };
}

function snapshot(
  name: string,
  mimeType: string,
  bytes: readonly number[],
  replacementId: string
): ResourceSnapshot {
  return {name, mimeType, bytes: new Uint8Array(bytes), replacementId};
}

function key(routeName: string, resourceName: string): string {
  return `${routeName}\0${resourceName}`;
}
