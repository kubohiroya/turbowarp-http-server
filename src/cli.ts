import {startServer} from './server.js';
import type {CommunityServerOptions} from './community.js';

interface CliOptions {
  hostname: string;
  port: number;
  community?: false | CommunityServerOptions;
}

const options = parseArgs(process.argv.slice(2));
const server = startServer(options);

console.log(`turbowarp-http-server listening on http://${server.hostname}:${server.port}`);

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
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
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
  -h, --help     Show this help.
`);
}
