import {startServer} from './server.js';
import type {CommunityServerOptions} from './community.js';
import {compileToDirectory, type CompilerInputFormat} from './compiler/index.js';

interface CliOptions {
  hostname: string;
  port: number;
  community?: false | CommunityServerOptions;
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main(args: readonly string[]): Promise<void> {
  if (args[0] === 'compile') {
    const options = parseCompileArgs(args.slice(1));
    const result = await compileToDirectory(options);
    for (const diagnostic of result.diagnostics) {
      console.warn(`[${diagnostic.code}] ${diagnostic.message}`);
    }
    console.log(`Generated ${result.files.length} files in ${options.output}.`);
    return;
  }

  const options = parseArgs(args);
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
}

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

function parseCompileArgs(args: readonly string[]): {
  input: string;
  output: string;
  format: CompilerInputFormat;
  force: boolean;
} {
  let input = '';
  let output = '';
  let format: CompilerInputFormat = 'turbowarp-json';
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') {
      input = requireValue(args, index, '--input');
      index += 1;
    } else if (arg === '--output') {
      output = requireValue(args, index, '--output');
      index += 1;
    } else if (arg === '--format') {
      const value = requireValue(args, index, '--format');
      if (value !== 'turbowarp-json' && value !== 'ir') throw new Error(`Invalid format: ${value}`);
      format = value;
      index += 1;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--help' || arg === '-h') {
      printCompileHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown compile argument: ${arg}`);
    }
  }
  if (!input) throw new Error('compile requires --input <file>.');
  if (!output) throw new Error('compile requires --output <directory>.');
  return {input, output, format, force};
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
  console.log(`Usage:
  turbowarp-http-server [--host <host>] [--port <port>]
  turbowarp-http-server compile --input <file> --output <directory> [options]

Starts the companion HTTP/WebSocket bridge for the TurboWarp extension.

Options:
  --host <host>  Hostname or address to bind. Defaults to HOST or 127.0.0.1.
  --port <port>  TCP port to bind. Defaults to PORT or 8787.
  --community    Enable the learning-only Scratch-like community routes.
  -h, --help     Show this help.
`);
}

function printCompileHelp(): void {
  console.log(`Usage: turbowarp-http-server compile --input <file> --output <directory> [options]

Compiles an accepted TurboWarp project.json subset or deploy IR to Cloudflare Workers + Hono.

Options:
  --input <file>       TurboWarp project.json or deploy IR JSON.
  --output <directory> Generated project directory.
  --format <format>    turbowarp-json (default) or ir.
  --force              Replace generated files in a non-empty output directory.
  -h, --help           Show this help.
`);
}
