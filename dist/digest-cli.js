import { stdin as input, stdout as output } from 'node:process';
import { deleteHtdigestUser, readHtdigestFile, setHtdigestPassword, updateHtdigestPassword, validateField, writeHtdigestFile } from './auth/digest-file.js';
try {
    await main(process.argv.slice(2));
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
async function main(args) {
    const options = parseArgs(args);
    if (options.command === 'help') {
        printHelp();
        return;
    }
    const file = requireOption(options.file, 'file');
    const realm = requireOption(options.realm ?? process.env.TURBOWARP_HTTP_DIGEST_REALM, '--realm');
    validateField('realm', realm);
    if (options.command === 'init') {
        const entries = await readHtdigestFile(file);
        await writeHtdigestFile(file, entries);
        console.log(`Initialized ${file}.`);
        return;
    }
    const username = requireOption(options.username, 'username');
    validateField('username', username);
    if (options.command === 'delete') {
        const deleted = await deleteHtdigestUser(file, username, realm);
        console.log(deleted ? `Deleted ${username}.` : `User ${username} was not found.`);
        return;
    }
    const password = options.password ??
        process.env.TURBOWARP_HTTP_DIGEST_PASSWORD ??
        (await promptPassword(`Password for ${username}: `));
    if (options.command === 'passwd') {
        const updated = await updateHtdigestPassword(file, username, realm, password);
        if (!updated)
            throw new Error(`User ${username} was not found.`);
        console.log(`Updated ${username}.`);
        return;
    }
    const result = await setHtdigestPassword(file, username, realm, password);
    console.log(`${result === 'created' ? 'Added' : 'Updated'} ${username}.`);
}
function parseArgs(args) {
    const command = args[0];
    if (command === undefined || command === '--help' || command === '-h')
        return { command: 'help' };
    if (command !== 'init' && command !== 'add' && command !== 'passwd' && command !== 'delete') {
        throw new Error(`Unknown command: ${command}`);
    }
    const options = { command };
    let positionalIndex = 0;
    for (let index = 1; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === undefined)
            break;
        if (arg === '--realm') {
            options.realm = requireValue(args, index, '--realm');
            index += 1;
        }
        else if (arg === '--password') {
            options.password = requireValue(args, index, '--password');
            index += 1;
        }
        else if (arg === '--help' || arg === '-h') {
            return { command: 'help' };
        }
        else if (arg.startsWith('--')) {
            throw new Error(`Unknown option: ${arg}`);
        }
        else if (positionalIndex === 0) {
            options.file = arg;
            positionalIndex += 1;
        }
        else if (positionalIndex === 1) {
            options.username = arg;
            positionalIndex += 1;
        }
        else {
            throw new Error(`Unexpected argument: ${arg}`);
        }
    }
    if (command === 'init' && options.username) {
        throw new Error('init does not accept a username.');
    }
    return options;
}
function requireValue(args, index, name) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${name} requires a value.`);
    }
    return value;
}
function requireOption(value, name) {
    if (!value)
        throw new Error(`${name} is required.`);
    return value;
}
async function promptPassword(prompt) {
    if (!input.isTTY || !output.isTTY) {
        throw new Error('Password is required. Use --password or TURBOWARP_HTTP_DIGEST_PASSWORD.');
    }
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    return new Promise((resolve, reject) => {
        let value = '';
        const cleanup = () => {
            input.setRawMode(false);
            input.pause();
            input.off('data', onData);
        };
        const onData = (chunk) => {
            for (const char of chunk) {
                if (char === '\u0003') {
                    cleanup();
                    reject(new Error('Canceled.'));
                    return;
                }
                if (char === '\r' || char === '\n') {
                    cleanup();
                    output.write('\n');
                    resolve(value);
                    return;
                }
                if (char === '\b' || char === '\u007f') {
                    value = value.slice(0, -1);
                }
                else {
                    value += char;
                }
            }
        };
        input.on('data', onData);
    });
}
function printHelp() {
    console.log(`Usage: turbowarp-http-digest <command> <file> [username] --realm <realm>

Commands:
  init <file>                 Create or normalize an htdigest file.
  add <file> <username>       Add a user or update an existing user.
  passwd <file> <username>    Update a user's password.
  delete <file> <username>    Delete a user.

Options:
  --realm <realm>             Digest authentication realm.
  --password <password>       Password value. Prefer interactive input when possible.
  -h, --help                  Show this help.

Environment:
  TURBOWARP_HTTP_DIGEST_REALM
  TURBOWARP_HTTP_DIGEST_PASSWORD
`);
}
//# sourceMappingURL=digest-cli.js.map