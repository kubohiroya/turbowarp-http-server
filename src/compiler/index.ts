import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, extname, join, resolve} from 'node:path';
import {compileTurboWarpProjectV2} from './turbowarp-v2.js';
import {resolveCompilerManifestLock} from './manifest/resolve.js';
import {parseDeployIrV2Json, type CompilerDiagnosticV2, type DeployIrV2} from './ir-v2/index.js';
import {compileDeployIrV2, type PipelineDiagnostic} from './pipeline/index.js';

export * from './feature-flags.js';
export * from './adapters/index.js';
export * from './binary/index.js';
export * from './ir-v2/index.js';
export * from './manifest/index.js';
export * from './named-body/index.js';
export * from './pipeline/index.js';
export * from './runtime/index.js';
export * from './structured-data/index.js';
export * from './turbowarp-v2.js';
export * from './validator/index.js';

export type CompilerInputFormat = 'turbowarp-json' | 'ir';

export interface CompileOptions {
  input: string;
  output: string;
  format: CompilerInputFormat;
  force?: boolean;
  target: string;
  targetConfig?: string;
  manifestLock?: string;
  namedResponseBody?: boolean;
}

export interface CompilerOutput {
  ir: DeployIrV2;
  diagnostics: Array<CompilerDiagnosticV2 | PipelineDiagnostic>;
  files: string[];
}

export async function compileToDirectory(options: CompileOptions): Promise<CompilerOutput> {
  if (extname(options.input).toLowerCase() === '.sb3') {
    throw new Error('Direct .sb3 input is not supported yet. Export or extract project.json first.');
  }
  if (options.manifestLock !== undefined && options.format !== 'turbowarp-json') {
    throw new Error('manifestLock requires TurboWarp JSON input.');
  }
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output);
  const source = await readFile(inputPath, 'utf8');
  const registry =
    options.format === 'turbowarp-json' && options.manifestLock !== undefined
      ? (await resolveCompilerManifestLock(options.manifestLock)).registry
      : undefined;
  const frontend =
    options.format === 'ir'
      ? {ir: parseDeployIrV2Json(source), diagnostics: []}
      : compileTurboWarpProjectV2(JSON.parse(source) as unknown, registry);
  const frontendErrors = frontend.diagnostics.filter(({severity}) => severity === 'error');
  if (frontendErrors.length > 0) throw new CompilerDiagnosticsError(frontendErrors);
  const ir = frontend.ir;
  const targetConfig =
    options.targetConfig === undefined
      ? undefined
      : (JSON.parse(await readFile(resolve(options.targetConfig), 'utf8')) as unknown);
  const result = compileDeployIrV2(ir, {
    target: options.target,
    targetConfig,
    featureFlags: {namedResponseBody: options.namedResponseBody === true}
  });
  if (!result.ok) throw new CompilerDiagnosticsError(result.diagnostics);
  await writeGeneratedFiles(outputPath, result.files, options.force === true);
  return {ir, diagnostics: frontend.diagnostics, files: Object.keys(result.files).sort()};
}

async function writeGeneratedFiles(
  output: string,
  files: Readonly<Record<string, string>>,
  force: boolean
): Promise<void> {
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

type AnyCompilerDiagnostic = CompilerDiagnosticV2 | PipelineDiagnostic;

export class CompilerDiagnosticsError extends Error {
  public constructor(public readonly diagnostics: AnyCompilerDiagnostic[]) {
    super(diagnostics.map(formatDiagnostic).join('\n'));
    this.name = 'CompilerDiagnosticsError';
  }
}

function formatDiagnostic(diagnostic: AnyCompilerDiagnostic): string {
  const location = diagnosticLocation(diagnostic);
  return `[${diagnostic.code}]${location ? ` ${location}` : ''} ${diagnostic.message}`;
}

function diagnosticLocation(diagnostic: AnyCompilerDiagnostic): string {
  if ('reason' in diagnostic) {
    return [diagnostic.targetId, diagnostic.routeId, diagnostic.sourceRef?.blockId].filter(Boolean).join(':');
  }
  if (diagnostic.code.startsWith('TW2_')) {
    const sourceRef = (diagnostic as CompilerDiagnosticV2).sourceRef;
    return [sourceRef?.targetName, sourceRef?.blockId].filter(Boolean).join(':');
  }
  return '';
}
