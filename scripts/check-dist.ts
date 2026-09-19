import {stat} from 'node:fs/promises';

const requiredArtifacts = [
  'dist/turbowarp-http-server.js',
  'dist/extension-manifest.json',
  'dist/cli.js',
  'dist/digest-cli.js',
  'dist/server.js'
];
const missing: string[] = [];

for (const artifact of requiredArtifacts) {
  try {
    const metadata = await stat(artifact);
    if (!metadata.isFile() || metadata.size === 0) missing.push(artifact);
  } catch {
    missing.push(artifact);
  }
}

if (missing.length > 0) {
  throw new Error(`Missing generated dist artifacts:\n- ${missing.join('\n- ')}`);
}

process.stdout.write('Generated dist artifacts are present.\n');
