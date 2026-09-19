import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, extname, join, resolve} from 'node:path';
import {generateCloudflareWorker, type GeneratedFiles} from './generator.js';
import type {CompilerDiagnostic, DeployIr} from './ir.js';
import {compileTurboWarpProject} from './turbowarp.js';
import {parseDeployIr} from './validate.js';

export * from './feature-flags.js';
export * from './binary/index.js';
export * from './ir-v2/index.js';
export * from './manifest/index.js';
export * from './runtime/index.js';
export * from './structured-data/index.js';
export * from './validator/index.js';

export type CompilerInputFormat = 'turbowarp-json' | 'ir';

export interface CompileOptions {
  input: string;
  output: string;
  format: CompilerInputFormat;
  force?: boolean;
}

export interface CompilerOutput {
  ir: DeployIr;
  diagnostics: CompilerDiagnostic[];
  files: string[];
}

export async function compileToDirectory(options: CompileOptions): Promise<CompilerOutput> {
  if (extname(options.input).toLowerCase() === '.sb3') {
    throw new Error('Direct .sb3 input is not supported yet. Export or extract project.json first.');
  }
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output);
  const raw = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const compiled =
    options.format === 'ir'
      ? {ir: parseDeployIr(raw), diagnostics: []}
      : compileTurboWarpProject(raw);
  const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) throw new CompilerDiagnosticsError(errors);
  const ir = parseDeployIr(compiled.ir);
  const files = generateCloudflareWorker(ir);
  await writeGeneratedFiles(outputPath, files, options.force === true);
  return {ir, diagnostics: compiled.diagnostics, files: Object.keys(files).sort()};
}

async function writeGeneratedFiles(output: string, files: GeneratedFiles, force: boolean): Promise<void> {
  await mkdir(output, {recursive: true});
  const existing = await readdir(output);
  if (existing.length > 0 && !force) {
    throw new Error(`Output directory is not empty: ${output}. Use --force to replace generated files.`);
  }
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = join(output, relativePath);
    await mkdir(dirname(destination), {recursive: true});
    await writeFile(destination, contents, 'utf8');
  }
}

export class CompilerDiagnosticsError extends Error {
  public constructor(public readonly diagnostics: CompilerDiagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join('\n'));
    this.name = 'CompilerDiagnosticsError';
  }
}

function formatDiagnostic(diagnostic: CompilerDiagnostic): string {
  const location = [diagnostic.target, diagnostic.blockId].filter(Boolean).join(':');
  return `[${diagnostic.code}]${location ? ` ${location}` : ''} ${diagnostic.message}`;
}
