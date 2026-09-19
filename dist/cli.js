import { startServer } from './server.js';
import { compileToDirectory } from './compiler/index.js';
void main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
async function main(args) {
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
    function shutdown(signal) {
        console.log(`Received ${signal}; shutting down.`);
        server
            .close()
            .catch((error) => {
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
function parseArgs(args) {
    const options = {
        hostname: process.env.HOST ?? '127.0.0.1',
        port: parsePort(process.env.PORT ?? '8787'),
        community: isTruthy(process.env.COMMUNITY) ? {} : false
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--host') {
            options.hostname = requireValue(args, index, '--host');
            index += 1;
        }
        else if (arg === '--port') {
            options.port = parsePort(requireValue(args, index, '--port'));
            index += 1;
        }
        else if (arg === '--community') {
            options.community = {};
        }
        else if (arg === '--enable-named-response-body') {
            options.namedResponseBody = true;
        }
        else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
        else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}
function parseCompileArgs(args) {
    let input = '';
    let output = '';
    let format = 'turbowarp-json';
    let force = false;
    let irVersion = 1;
    let target;
    let targetConfig;
    let namedResponseBody = false;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--input') {
            input = requireValue(args, index, '--input');
            index += 1;
        }
        else if (arg === '--output') {
            output = requireValue(args, index, '--output');
            index += 1;
        }
        else if (arg === '--format') {
            const value = requireValue(args, index, '--format');
            if (value !== 'turbowarp-json' && value !== 'ir')
                throw new Error(`Invalid format: ${value}`);
            format = value;
            index += 1;
        }
        else if (arg === '--force') {
            force = true;
        }
        else if (arg === '--ir-version') {
            const value = requireValue(args, index, '--ir-version');
            if (value !== '1' && value !== '2')
                throw new Error(`Invalid IR version: ${value}`);
            irVersion = Number(value);
            index += 1;
        }
        else if (arg === '--target') {
            target = requireValue(args, index, '--target');
            index += 1;
        }
        else if (arg === '--target-config') {
            targetConfig = requireValue(args, index, '--target-config');
            index += 1;
        }
        else if (arg === '--enable-named-response-body') {
            namedResponseBody = true;
        }
        else if (arg === '--help' || arg === '-h') {
            printCompileHelp();
            process.exit(0);
        }
        else {
            throw new Error(`Unknown compile argument: ${arg}`);
        }
    }
    if (!input)
        throw new Error('compile requires --input <file>.');
    if (!output)
        throw new Error('compile requires --output <directory>.');
    if (irVersion === 2 && target === undefined)
        throw new Error('IR v2 compilation requires --target <id>.');
    if (namedResponseBody && irVersion !== 2) {
        throw new Error('--enable-named-response-body requires --ir-version 2.');
    }
    return {
        input,
        output,
        format,
        force,
        irVersion,
        namedResponseBody,
        ...(target === undefined ? {} : { target }),
        ...(targetConfig === undefined ? {} : { targetConfig })
    };
}
function requireValue(args, index, name) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${name} requires a value.`);
    }
    return value;
}
function parsePort(value) {
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${value}`);
    }
    return port;
}
function isTruthy(value) {
    return value === '1' || value === 'true' || value === 'yes';
}
function printHelp() {
    console.log(`Usage:
  turbowarp-http-server [--host <host>] [--port <port>]
  turbowarp-http-server compile --input <file> --output <directory> [options]

Starts the companion HTTP/WebSocket bridge for the TurboWarp extension.

Options:
  --host <host>  Hostname or address to bind. Defaults to HOST or 127.0.0.1.
  --port <port>  TCP port to bind. Defaults to PORT or 8787.
  --community    Enable the learning-only Scratch-like community routes.
  --enable-named-response-body Enable experimental named response blocks (default OFF).
  -h, --help     Show this help.
`);
}
function printCompileHelp() {
    console.log(`Usage: turbowarp-http-server compile --input <file> --output <directory> [options]

Compiles an accepted TurboWarp project.json subset or deploy IR to Hono deployment artifacts.

Options:
  --input <file>       TurboWarp project.json or deploy IR JSON.
  --output <directory> Generated project directory.
  --format <format>    turbowarp-json (default) or ir.
  --ir-version <1|2>  Select compiler pipeline. Defaults to 1.
  --target <id>        Required for IR v2; for example cloudflare-workers.
  --target-config <file> Adapter config containing binding names, never secrets.
  --enable-named-response-body Enable the experimental named body IR operation (default OFF).
  --force              Replace generated files in a non-empty output directory.
  -h, --help           Show this help.
`);
}
//# sourceMappingURL=cli.js.map