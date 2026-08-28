import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const DIGEST_AUTH_USER_HEADER = 'x-turbowarp-http-auth-user';

export interface DigestCredentialStore {
  getHa1(username: string, realm: string): string | undefined | Promise<string | undefined>;
}

export interface DigestAuthOptions {
  realm: string;
  credentials: DigestCredentialStore;
  nonceMaxAgeMs?: number;
  nonceSecret?: string;
}

export interface DigestAuthResult {
  ok: boolean;
  username?: string;
  challenge?: string;
}

const DEFAULT_NONCE_MAX_AGE_MS = 5 * 60 * 1000;
const QOP = 'auth';
const ALGORITHM = 'MD5';

export function createHa1(username: string, realm: string, password: string): string {
  return md5(`${username}:${realm}:${password}`);
}

export function createDigestChallenge(options: DigestAuthOptions): string {
  const nonce = createNonce(options.nonceSecret ?? defaultNonceSecret(), Date.now());
  const opaque = md5(options.realm);
  return `Digest realm="${escapeQuoted(options.realm)}", qop="${QOP}", algorithm=${ALGORITHM}, nonce="${nonce}", opaque="${opaque}"`;
}

export async function verifyDigestAuth(
  request: Request,
  method: string,
  options: DigestAuthOptions
): Promise<DigestAuthResult> {
  const challenge = createDigestChallenge(options);
  const authorization = request.headers.get('authorization');
  if (!authorization) return {ok: false, challenge};
  const schemeMatch = authorization.match(/^Digest\s+/i);
  if (!schemeMatch) return {ok: false, challenge};

  const params = parseDigestAuthorization(authorization.slice(schemeMatch[0].length));
  const username = params.username;
  const realm = params.realm;
  const nonce = params.nonce;
  const uri = params.uri;
  const response = params.response;
  if (!username || realm !== options.realm || !nonce || !uri || !response) {
    return {ok: false, challenge};
  }

  if (!verifyNonce(nonce, options.nonceSecret ?? defaultNonceSecret(), options.nonceMaxAgeMs)) {
    return {ok: false, challenge};
  }

  const ha1 = await options.credentials.getHa1(username, realm);
  if (!ha1 || !/^[0-9a-f]{32}$/i.test(ha1)) return {ok: false, challenge};

  const requestUrl = new URL(request.url);
  if (uri !== `${requestUrl.pathname}${requestUrl.search}`) return {ok: false, challenge};

  const ha2 = md5(`${method.toUpperCase()}:${uri}`);
  const expected =
    params.qop === QOP && params.nc && params.cnonce
      ? md5(`${ha1}:${nonce}:${params.nc}:${params.cnonce}:${QOP}:${ha2}`)
      : md5(`${ha1}:${nonce}:${ha2}`);

  if (!safeEqualHex(response, expected)) return {ok: false, challenge};

  return {ok: true, username};
}

export function parseDigestAuthorization(value: string): Record<string, string> {
  const params: Record<string, string> = {};
  let index = 0;

  while (index < value.length) {
    while (value[index] === ' ' || value[index] === ',') index += 1;
    const keyStart = index;
    while (index < value.length && value[index] !== '=' && value[index] !== ',') index += 1;
    const key = value.slice(keyStart, index).trim();
    if (!key || value[index] !== '=') break;
    index += 1;

    let paramValue = '';
    if (value[index] === '"') {
      index += 1;
      while (index < value.length) {
        const char = value[index];
        if (char === '\\') {
          index += 1;
          if (index < value.length) paramValue += value[index];
        } else if (char === '"') {
          index += 1;
          break;
        } else {
          paramValue += char;
        }
        index += 1;
      }
    } else {
      const valueStart = index;
      while (index < value.length && value[index] !== ',') index += 1;
      paramValue = value.slice(valueStart, index).trim();
    }
    params[key] = paramValue;
  }

  return params;
}

export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  );
}

function createNonce(secret: string, timestamp: number): string {
  const payload = `${timestamp.toString(36)}:${randomBytes(12).toString('base64url')}`;
  const signature = md5(`${payload}:${secret}`);
  return Buffer.from(`${payload}:${signature}`, 'utf8').toString('base64url');
}

function verifyNonce(nonce: string, secret: string, maxAgeMs = DEFAULT_NONCE_MAX_AGE_MS): boolean {
  try {
    const decoded = Buffer.from(nonce, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;
    const [timestampText, randomText, signature] = parts;
    if (!timestampText || !randomText || !signature) return false;
    const timestamp = Number.parseInt(timestampText, 36);
    if (!Number.isFinite(timestamp) || Date.now() - timestamp > maxAgeMs) return false;
    return safeEqualHex(signature, md5(`${timestampText}:${randomText}:${secret}`));
  } catch {
    return false;
  }
}

function defaultNonceSecret(): string {
  globalThis.__turbowarpHttpDigestNonceSecret ??= randomBytes(32).toString('base64url');
  return globalThis.__turbowarpHttpDigestNonceSecret;
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left.toLowerCase(), 'hex');
  const rightBuffer = Buffer.from(right.toLowerCase(), 'hex');
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

declare global {
  var __turbowarpHttpDigestNonceSecret: string | undefined;
}
