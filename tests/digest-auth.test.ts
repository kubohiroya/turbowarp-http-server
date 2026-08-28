import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';
import {
  DIGEST_AUTH_USER_HEADER,
  createHa1,
  isLocalAddress,
  parseDigestAuthorization
} from '../src/auth/digest.js';
import {
  deleteHtdigestUser,
  readHtdigestFile,
  setHtdigestPassword,
  updateHtdigestPassword
} from '../src/auth/digest-file.js';
import {createApp} from '../src/server.js';
import type {BridgeRequestMessage} from '../src/protocol.js';
import type {HttpRequestBridge} from '../src/server.js';

describe('HTTP Digest authentication', () => {
  it('challenges unauthenticated requests and accepts a valid Digest response', async () => {
    const app = createDigestTestApp();

    const challengeResponse = await app.request('/anything');
    const challenge = challengeResponse.headers.get('www-authenticate') ?? '';
    const authorization = createAuthorizationHeader({
      challenge,
      method: 'GET',
      uri: '/anything',
      username: 'alice',
      realm: 'turbowarp-lan',
      password: 'secret'
    });

    const response = await app.request('/anything', {
      headers: {Authorization: authorization}
    });

    expect(challengeResponse.status).toBe(401);
    expect(challenge).toContain('Digest realm="turbowarp-lan"');
    expect(response.status).toBe(503);
  });

  it('rejects invalid passwords', async () => {
    const app = createDigestTestApp();
    const challengeResponse = await app.request('/anything');
    const authorization = createAuthorizationHeader({
      challenge: challengeResponse.headers.get('www-authenticate') ?? '',
      method: 'GET',
      uri: '/anything',
      username: 'alice',
      realm: 'turbowarp-lan',
      password: 'wrong'
    });

    const response = await app.request('/anything', {
      headers: {Authorization: authorization}
    });

    expect(response.status).toBe(401);
  });

  it('accepts the Digest scheme case-insensitively', async () => {
    const app = createDigestTestApp();
    const challengeResponse = await app.request('/anything');
    const authorization = createAuthorizationHeader({
      challenge: challengeResponse.headers.get('www-authenticate') ?? '',
      method: 'GET',
      uri: '/anything',
      username: 'alice',
      realm: 'turbowarp-lan',
      password: 'secret'
    }).replace(/^Digest/, 'digest');

    const response = await app.request('/anything', {
      headers: {Authorization: authorization}
    });

    expect(response.status).toBe(503);
  });

  it('exposes the authenticated username to bridge handlers with a runtime-owned header', async () => {
    const forwardedHeaders: Record<string, string[]>[] = [];
    const forwardedAuth: Array<BridgeRequestMessage['auth']> = [];
    const bridge: HttpRequestBridge = {
      async forward(message) {
        forwardedHeaders.push(message.headers);
        forwardedAuth.push(message.auth);
        return new Response('ok');
      }
    };
    const app = createDigestTestApp(bridge);
    const challengeResponse = await app.request('/users/42');
    const authorization = createAuthorizationHeader({
      challenge: challengeResponse.headers.get('www-authenticate') ?? '',
      method: 'GET',
      uri: '/users/42',
      username: 'alice',
      realm: 'turbowarp-lan',
      password: 'secret'
    });

    const response = await app.request('/users/42', {
      headers: {
        Authorization: authorization,
        [DIGEST_AUTH_USER_HEADER]: 'spoofed'
      }
    });

    expect(response.status).toBe(200);
    expect(forwardedHeaders[0]?.[DIGEST_AUTH_USER_HEADER]).toEqual(['alice']);
    expect(forwardedAuth[0]).toEqual({
      type: 'digest',
      username: 'alice'
    });
  });

  it('recognizes only loopback addresses as local WebSocket peers', () => {
    expect(isLocalAddress('127.0.0.1')).toBe(true);
    expect(isLocalAddress('127.12.34.56')).toBe(true);
    expect(isLocalAddress('::1')).toBe(true);
    expect(isLocalAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLocalAddress('192.168.1.20')).toBe(false);
    expect(isLocalAddress('::ffff:192.168.1.20')).toBe(false);
  });
});

describe('htdigest file management', () => {
  it('adds, updates, and deletes users', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tw-http-digest-'));
    const file = join(dir, 'users.htdigest');
    try {
      await expect(setHtdigestPassword(file, 'alice', 'turbowarp-lan', 'first')).resolves.toBe(
        'created'
      );
      await expect(setHtdigestPassword(file, 'alice', 'turbowarp-lan', 'second')).resolves.toBe(
        'updated'
      );
      await expect(setHtdigestPassword(file, 'bob', 'turbowarp-lan', 'secret')).resolves.toBe(
        'created'
      );

      const entries = await readHtdigestFile(file);
      expect(entries).toHaveLength(2);
      expect(entries.find((entry) => entry.username === 'alice')?.ha1).toBe(
        createHa1('alice', 'turbowarp-lan', 'second')
      );
      expect(await readFile(file, 'utf8')).toContain('bob:turbowarp-lan:');
      await expect(updateHtdigestPassword(file, 'missing', 'turbowarp-lan', 'secret')).resolves.toBe(
        false
      );
      await expect(updateHtdigestPassword(file, 'bob', 'turbowarp-lan', 'changed')).resolves.toBe(
        true
      );

      await expect(deleteHtdigestUser(file, 'alice', 'turbowarp-lan')).resolves.toBe(true);
      await expect(deleteHtdigestUser(file, 'alice', 'turbowarp-lan')).resolves.toBe(false);
      await expect(readHtdigestFile(file)).resolves.toHaveLength(1);
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
});

function createDigestTestApp(bridge?: HttpRequestBridge): ReturnType<typeof createApp> {
  const options: Parameters<typeof createApp>[0] = {
    digestAuth: {
      realm: 'turbowarp-lan',
      nonceSecret: 'test-secret',
      credentials: {
        getHa1(username, realm) {
          if (username !== 'alice' || realm !== 'turbowarp-lan') return undefined;
          return createHa1('alice', 'turbowarp-lan', 'secret');
        }
      }
    }
  };
  if (bridge) options.bridge = bridge;
  return createApp(options);
}

function createAuthorizationHeader(options: {
  challenge: string;
  method: string;
  uri: string;
  username: string;
  realm: string;
  password: string;
}): string {
  const params = parseDigestAuthorization(options.challenge.replace(/^Digest\s+/i, ''));
  const nonce = params.nonce ?? '';
  const nc = '00000001';
  const cnonce = 'test-client-nonce';
  const ha1 = createHa1(options.username, options.realm, options.password);
  const ha2 = md5(`${options.method}:${options.uri}`);
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
  return [
    `Digest username="${options.username}"`,
    `realm="${options.realm}"`,
    `nonce="${nonce}"`,
    `uri="${options.uri}"`,
    `response="${response}"`,
    'qop=auth',
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    'algorithm=MD5'
  ].join(', ');
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}
