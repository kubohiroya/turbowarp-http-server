import {describe, expect, it} from 'vitest';
import {
  BinaryBodyHandle,
  DEFAULT_MAX_BINARY_BYTES,
  InMemoryBinaryObjectStore,
  IrRuntimeError,
  collectBinaryBody,
  encodeContentDisposition,
  effectiveBinaryLimit,
  parseDeployIrV2,
  validateDeployIrV2Subset,
  type BinaryBodySource,
  type BinaryRefDescriptorV2,
  type DeployIrV2,
  type StatementIrV2
} from '../src/compiler/index.js';

const binaryBodyBinding = {id: 'body', type: {kind: 'resource', resourceType: 'binary-body'}} as const;
const binaryRefBinding = {id: 'stored', type: {kind: 'value', valueType: 'binary-ref'}} as const;

describe('IR v2 binary resource contract', () => {
  it('parses the closed producer/consumer statement set without inline bytes', () => {
    const ir = parseDeployIrV2(
      fixture([
        {kind: 'request-body-binary', maxBytes: DEFAULT_MAX_BINARY_BYTES, result: binaryBodyBinding},
        {
          kind: 'asset-object-put',
          locator: {namespace: 'asset', key: 'images/hero'},
          body: 'body',
          metadata: {contentType: 'image/png'},
          maxBytes: DEFAULT_MAX_BINARY_BYTES,
          result: binaryRefBinding
        },
        {kind: 'respond', format: 'text', body: {kind: 'literal', valueType: 'string', value: 'stored'}}
      ])
    );
    expect(ir.routes[0]!.body.map(({kind}) => kind)).toEqual([
      'request-body-binary',
      'asset-object-put',
      'respond'
    ]);

    const invalid = fixture([
      {
        kind: 'respond',
        format: 'json',
        body: {
          kind: 'literal',
          valueType: 'binary-ref',
          value: {namespace: 'asset', key: 'hero', base64: 'AA=='}
        } as never
      }
    ]);
    expect(() => parseDeployIrV2(invalid)).toThrow(/base64/);
  });

  it('validates logical locators, metadata, and the 16 MiB operation limit', () => {
    const validRef: BinaryRefDescriptorV2 = {
      namespace: 'asset.images',
      key: 'camera/latest.jpg',
      contentType: 'image/jpeg',
      size: 12,
      integrity: `sha256:${'a'.repeat(64)}`,
      revision: 'opaque'
    };
    expect(
      parseDeployIrV2(
        fixture([{kind: 'respond', format: 'json', body: {kind: 'literal', valueType: 'binary-ref', value: validRef}}])
      )
    ).toBeTruthy();
    expect(() =>
      parseDeployIrV2(
        fixture([
          {
            kind: 'asset-resolve',
            locator: {namespace: 'asset', key: '../secret'},
            result: {id: 'ref', type: {kind: 'value', valueType: {kind: 'union', members: ['null', 'binary-ref']}}}
          },
          textResponse()
        ])
      )
    ).toThrow(/unsafe path segment/);
    expect(() =>
      parseDeployIrV2(
        fixture([{kind: 'request-body-binary', maxBytes: DEFAULT_MAX_BINARY_BYTES + 1, result: binaryBodyBinding}, textResponse()])
      )
    ).toThrow(/16777216/);
  });

  it('requires capabilities and enforces affine consume-once semantics', () => {
    const ir = fixture([
      {kind: 'request-body-binary', maxBytes: 1024, result: binaryBodyBinding},
      put('first'),
      put('second'),
      textResponse()
    ]);
    const withoutCapabilities = validateDeployIrV2Subset(ir);
    expect(withoutCapabilities.map(({code}) => code)).toEqual(
      expect.arrayContaining(['TW2_CAPABILITY_MISSING', 'TW2_BINARY_BODY_CONSUMED'])
    );

    ir.capabilities = [{kind: 'object-storage'}, {kind: 'streaming-body'}];
    expect(validateDeployIrV2Subset(ir).map(({code}) => code)).toContain('TW2_BINARY_BODY_CONSUMED');
  });

  it('merges branch consumption safely and rejects repeated loop consumption', () => {
    const branch = fixture([
      {kind: 'request-body-binary', maxBytes: 1024, result: binaryBodyBinding},
      {
        kind: 'if',
        condition: {kind: 'literal', valueType: 'boolean', value: true},
        then: [put('thenRef')],
        else: [put('elseRef')]
      },
      textResponse()
    ]);
    branch.capabilities = [{kind: 'object-storage'}, {kind: 'streaming-body'}];
    expect(validateDeployIrV2Subset(branch).map(({code}) => code)).not.toContain('TW2_BINARY_BODY_CONSUMED');

    const loop = fixture([
      {kind: 'request-body-binary', maxBytes: 1024, result: binaryBodyBinding},
      {kind: 'bounded-loop', maxIterations: 2, body: [put('loopRef')]},
      textResponse()
    ]);
    loop.capabilities = [{kind: 'object-storage'}, {kind: 'streaming-body'}];
    expect(validateDeployIrV2Subset(loop).map(({code}) => code)).toContain('TW2_BINARY_BODY_CONSUMED');
  });

  it('treats respond-binary as a terminal resource consumer', () => {
    const ir = fixture([
      {kind: 'asset-object-get', ref: binaryRef(), maxBytes: 1024, result: binaryBodyBinding},
      {kind: 'respond-binary', body: 'body', disposition: {kind: 'attachment', filename: 'image.jpg'}}
    ]);
    ir.capabilities = [{kind: 'object-storage'}, {kind: 'streaming-body'}];
    expect(validateDeployIrV2Subset(parseDeployIrV2(ir))).toEqual([]);

    const useAfterResponse = fixture([
      {kind: 'request-body-binary', maxBytes: 1024, result: binaryBodyBinding},
      {kind: 'respond-binary', body: 'body'},
      put('tooLate')
    ]);
    useAfterResponse.capabilities = [{kind: 'object-storage'}, {kind: 'streaming-body'}];
    expect(validateDeployIrV2Subset(useAfterResponse).map(({code}) => code)).toContain(
      'TW2_RESPONSE_AFTER_TERMINAL'
    );
  });
});

describe('binary runtime and in-memory adapter', () => {
  it('supports put/get/resolve/delete without exposing or aliasing byte arrays', async () => {
    const store = new InMemoryBinaryObjectStore();
    const input = new Uint8Array([1, 2, 3]);
    const ref = await store.put(
      {namespace: 'asset', key: 'hero'},
      body(input, 'image/png'),
      {contentType: 'image/png'},
      10
    );
    input[0] = 9;
    expect(ref).toMatchObject({namespace: 'asset', key: 'hero', contentType: 'image/png', size: 3});
    expect(ref.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await store.resolve({namespace: 'asset', key: 'hero'})).toEqual(ref);
    const loaded = await store.get(ref);
    expect(Array.from(await collectBinaryBody(loaded!, 10))).toEqual([1, 2, 3]);
    expect(await store.delete(ref)).toBe(true);
    expect(await store.delete(ref)).toBe(false);
  });

  it('counts unknown-length streams, cancels on overflow, and consumes handles once', async () => {
    let cancelled = false;
    const source: BinaryBodySource = {
      chunks: (async function* () {
        try {
          yield new Uint8Array([1, 2]);
          yield new Uint8Array([3, 4]);
        } finally {
          cancelled = true;
        }
      })()
    };
    await expect(collectBinaryBody(source, 3)).rejects.toMatchObject({code: 'BINARY_TOO_LARGE', httpStatus: 413});
    expect(cancelled).toBe(true);

    const handle = new BinaryBodyHandle(body(new Uint8Array([1])));
    expect(handle.take()).toBeTruthy();
    expect(() => handle.take()).toThrow(expect.objectContaining({code: 'BINARY_BODY_CONSUMED'}));
  });

  it('uses the minimum effective limit and rejects integrity mismatches without byte leakage', async () => {
    expect(effectiveBinaryLimit(100, 80, 90)).toBe(80);
    const store = new InMemoryBinaryObjectStore();
    try {
      await store.put(
        {namespace: 'asset', key: 'secret-name'},
        body(new Uint8Array([115, 101, 99, 114, 101, 116])),
        {integrity: `sha256:${'0'.repeat(64)}`},
        10
      );
      throw new Error('Expected integrity mismatch.');
    } catch (error) {
      expect(error).toBeInstanceOf(IrRuntimeError);
      expect(error).toMatchObject({code: 'BINARY_INTEGRITY_MISMATCH', httpStatus: 502});
      expect((error as Error).message).not.toMatch(/secret-name|115|101/);
    }
  });

  it('encodes attachment filenames without permitting header injection', () => {
    expect(encodeContentDisposition({kind: 'inline'})).toBe('inline');
    expect(encodeContentDisposition({kind: 'attachment', filename: '日本語 image.jpg'})).toBe(
      "attachment; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E%20image.jpg"
    );
    expect(() => encodeContentDisposition({kind: 'attachment', filename: 'bad\r\nheader'})).toThrow(
      expect.objectContaining({code: 'BINARY_INVALID_REF'})
    );
  });
});

function fixture(bodyValue: StatementIrV2[]): DeployIrV2 {
  return {
    version: 2,
    name: 'binary',
    auth: {kind: 'none'},
    capabilities: [],
    routes: [{id: 'binary-route', method: 'PUT', path: '/asset', auth: 'public', body: bodyValue}]
  };
}

function put(resultId: string): StatementIrV2 {
  return {
    kind: 'asset-object-put',
    locator: {namespace: 'asset', key: resultId},
    body: 'body',
    metadata: {contentType: 'application/octet-stream'},
    maxBytes: 1024,
    result: {id: resultId, type: {kind: 'value', valueType: 'binary-ref'}}
  };
}

function textResponse(): StatementIrV2 {
  return {kind: 'respond', format: 'text', body: {kind: 'literal', valueType: 'string', value: 'ok'}};
}

function binaryRef() {
  return {
    kind: 'literal',
    valueType: 'binary-ref',
    value: {namespace: 'asset', key: 'hero'}
  } as const;
}

function body(bytes: Uint8Array, contentType?: string): BinaryBodySource {
  const chunks = (async function* () {
    yield bytes;
  })();
  return contentType === undefined
    ? {chunks, size: bytes.byteLength}
    : {chunks, size: bytes.byteLength, contentType};
}
