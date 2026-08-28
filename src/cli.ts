import {readFileSync} from 'node:fs';
import {HtdigestFile} from './auth/digest-file.js';
import {startServer} from './server.js';
import type {CommunityServerOptions} from './community.js';
import type {DigestAuthOptions} from './auth/digest.js';

interface CliOptions {
  hostname: string;
  port: number;
  community?: false | CommunityServerOptions;
  authDigestFile?: string;
  authRealm?: string;
  tlsCert?: string;
  tlsKey?: string;
}

const options = parseArgs(process.argv.slice(2));
const server = startServer(toServerOptions(options));

console.log(
  `turbowarp-http-server listening on ${options.tlsCert ? 'https' : 'http'}://${server.hostname}:${server.port}`
);

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  server
    .close()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit();
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    hostname: process.env.HOST ?? '127.0.0.1',
    port: parsePort(process.env.PORT ?? '8787'),
    community: isTruthy(process.env.COMMUNITY) ? {} : false
  };
  if (process.env.TURBOWARP_HTTP_DIGEST_FILE) {
    options.authDigestFile = process.env.TURBOWARP_HTTP_DIGEST_FILE;
  }
  if (process.env.TURBOWARP_HTTP_DIGEST_REALM) {
    options.authRealm = process.env.TURBOWARP_HTTP_DIGEST_REALM;
  }
  if (process.env.TURBOWARP_HTTP_TLS_CERT) {
    options.tlsCert = process.env.TURBOWARP_HTTP_TLS_CERT;
  }
  if (process.env.TURBOWARP_HTTP_TLS_KEY) {
    options.tlsKey = process.env.TURBOWARP_HTTP_TLS_KEY;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') {
      options.hostname = requireValue(args, index, '--host');
      index += 1;
    } else if (arg === '--port') {
      options.port = parsePort(requireValue(args, index, '--port'));
      index += 1;
    } else if (arg === '--community') {
      options.community = {};
    } else if (arg === '--auth-digest') {
      options.authDigestFile = requireValue(args, index, '--auth-digest');
      index += 1;
    } else if (arg === '--auth-realm') {
      options.authRealm = requireValue(args, index, '--auth-realm');
      index += 1;
    } else if (arg === '--tls-cert') {
      options.tlsCert = requireValue(args, index, '--tls-cert');
      index += 1;
    } else if (arg === '--tls-key') {
      options.tlsKey = requireValue(args, index, '--tls-key');
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.authDigestFile && !options.authRealm) {
    throw new Error('--auth-realm is required when --auth-digest is specified.');
  }
  if (!options.authDigestFile && options.authRealm) {
    throw new Error('--auth-digest is required when --auth-realm is specified.');
  }
  if (Boolean(options.tlsCert) !== Boolean(options.tlsKey)) {
    throw new Error('--tls-cert and --tls-key must be specified together.');
  }

  return options;
}

function toServerOptions(options: CliOptions): Parameters<typeof startServer>[0] {
  const serverOptions: Parameters<typeof startServer>[0] = {
    hostname: options.hostname,
    port: options.port
  };
  if (options.community !== undefined) serverOptions.community = options.community;
  const digestAuth = toDigestAuthOptions(options);
  if (digestAuth) serverOptions.digestAuth = digestAuth;
  if (options.tlsCert && options.tlsKey) {
    serverOptions.tls = {
      cert: readFileSync(options.tlsCert),
      key: readFileSync(options.tlsKey)
    };
  }
  return serverOptions;
}

function toDigestAuthOptions(options: CliOptions): DigestAuthOptions | undefined {
  if (!options.authDigestFile || !options.authRealm) return undefined;
  return {
    realm: options.authRealm,
    credentials: new HtdigestFile(options.authDigestFile)
  };
}

function requireValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function printHelp(): void {
  console.log(`Usage: turbowarp-http-server [--host <host>] [--port <port>]

Starts the companion HTTP/WebSocket bridge for the TurboWarp extension.

Options:
  --host <host>  Hostname or address to bind. Defaults to HOST or 127.0.0.1.
  --port <port>  TCP port to bind. Defaults to PORT or 8787.
  --community    Enable the learning-only Scratch-like community routes.
  --auth-digest <file>
                 Enable HTTP Digest authentication using an htdigest file.
  --auth-realm <realm>
                 HTTP Digest authentication realm.
  --tls-cert <file>
                 Enable HTTPS with the certificate file.
  --tls-key <file>
                 Enable HTTPS with the private key file.
  -h, --help     Show this help.

Environment:
  TURBOWARP_HTTP_DIGEST_FILE
  TURBOWARP_HTTP_DIGEST_REALM
  TURBOWARP_HTTP_TLS_CERT
  TURBOWARP_HTTP_TLS_KEY
`);
}
