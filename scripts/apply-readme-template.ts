import {copyFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);

await copyFile(new URL('templates/README.md', root), new URL('README.md', root));
await copyFile(new URL('templates/README.ja.md', root), new URL('README.ja.md', root));

console.log('Applied templates/README.md and templates/README.ja.md to the repository root.');
console.log('Replace all <...> placeholders before committing.');
