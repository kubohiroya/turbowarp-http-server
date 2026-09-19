import { findCapabilityOrigin } from '../pipeline/requirements.js';
export const cloudflareWorkersAdapter = {
    id: 'cloudflare-workers',
    version: '1.0.0',
    capabilities: () => ({ keys: ['record-store', 'request-metadata:client-address'] }),
    plan({ ir, requirements, config }) {
        const unsupported = requirements.keys.filter((requirement) => !cloudflareWorkersAdapter.capabilities().keys.includes(requirement));
        if (unsupported.length > 0) {
            return {
                ok: false,
                diagnostics: unsupported.map((requirement) => capabilityDiagnostic(requirement, ir))
            };
        }
        const parsed = parseConfig(config);
        if ('diagnostic' in parsed)
            return { ok: false, diagnostics: [parsed.diagnostic] };
        return {
            ok: true,
            plan: {
                targetId: cloudflareWorkersAdapter.id,
                adapterVersion: cloudflareWorkersAdapter.version,
                requirements: requirements.keys,
                bindings: { recordDatabase: parsed.recordDatabaseBinding }
            }
        };
    },
    generate({ ir, plan, core }) {
        return {
            ...core.files,
            'package.json': packageJson(ir),
            'tsconfig.json': tsconfig(),
            'src/index.ts': indexSource(plan),
            'src/platform.ts': platformSource(),
            'src/cloudflare.generated.d.ts': cloudflareTypes(),
            'wrangler.jsonc': wrangler(ir, plan),
            'migrations/0001_init.sql': migration()
        };
    }
};
function parseConfig(config) {
    if (config === undefined || config === null)
        return { recordDatabaseBinding: 'DB' };
    if (typeof config !== 'object' || Array.isArray(config))
        return { diagnostic: configDiagnostic() };
    const record = config;
    if (Object.keys(record).some((key) => key !== 'recordDatabaseBinding'))
        return { diagnostic: configDiagnostic() };
    const value = record.recordDatabaseBinding ?? 'DB';
    if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(value))
        return { diagnostic: configDiagnostic() };
    return { recordDatabaseBinding: value };
}
function capabilityDiagnostic(requirement, ir) {
    const origin = findCapabilityOrigin(ir, requirement);
    return {
        severity: 'error',
        code: 'TW2_TARGET_CAPABILITY_UNSUPPORTED',
        message: `Target cloudflare-workers does not support capability ${requirement}.`,
        reason: 'The selected adapter cannot satisfy a target-neutral IR requirement.',
        suggestion: 'Choose a registered capable target or remove the requiring operation.',
        targetId: 'cloudflare-workers',
        ...(origin === undefined ? {} : { routeId: origin.routeId }),
        ...(origin?.sourceRef === undefined ? {} : { sourceRef: origin.sourceRef })
    };
}
function configDiagnostic() {
    return {
        severity: 'error',
        code: 'TW2_TARGET_CONFIG_INVALID',
        message: 'Cloudflare target config is invalid.',
        reason: 'Only a non-secret recordDatabaseBinding identifier is accepted.',
        suggestion: 'Use {"recordDatabaseBinding":"DB"}.',
        targetId: 'cloudflare-workers'
    };
}
function indexSource(plan) {
    const binding = plan.bindings.recordDatabase ?? 'DB';
    return `import {Hono} from 'hono';
import {registerCoreRoutes} from './core.generated.js';
import {createRecordStore} from './platform.js';

type Bindings = {${binding}: D1Database};
const app = new Hono<{Bindings: Bindings}>();
registerCoreRoutes(app, {
  records: (context) => createRecordStore((context as {env: Bindings}).env.${binding}),
  clientAddress: (context) => (context as {req: {header(name: string): string | undefined}}).req.header('cf-connecting-ip') ?? ''
});
export default app;
`;
}
function platformSource() {
    return `import type {RecordStore} from './core.generated.js';

type RecordRow = {id: string; collection: string; data_json: string; created_at: string; updated_at: string};
export function createRecordStore(database: D1Database): RecordStore {
  return {
    async create(collection, data) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await database.prepare('INSERT INTO records (id, collection, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, collection, JSON.stringify(data), now, now).run();
      return {id, collection, data, createdAt: now, updatedAt: now};
    },
    async list(collection) {
      const result = await database.prepare('SELECT id, collection, data_json, created_at, updated_at FROM records WHERE collection = ? ORDER BY created_at DESC LIMIT 100').bind(collection).all<RecordRow>();
      return result.results.map(fromRow);
    },
    async get(id) {
      const row = await database.prepare('SELECT id, collection, data_json, created_at, updated_at FROM records WHERE id = ?').bind(id).first<RecordRow>();
      return row ? fromRow(row) : null;
    },
    async delete(id) {
      const result = await database.prepare('DELETE FROM records WHERE id = ?').bind(id).run();
      return result.meta.changes > 0;
    }
  };
}
function fromRow(row: RecordRow): Record<string, unknown> {
  return {id: row.id, collection: row.collection, data: JSON.parse(row.data_json), createdAt: row.created_at, updatedAt: row.updated_at};
}
`;
}
function packageJson(ir) {
    return `${JSON.stringify({
        name: ir.name.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-'),
        private: true,
        type: 'module',
        scripts: { dev: 'wrangler dev', deploy: 'wrangler deploy', typecheck: 'tsc --noEmit' },
        dependencies: { hono: '^4.10.7' },
        devDependencies: { '@cloudflare/workers-types': '^5.20260918.1', typescript: '^5.9.3', wrangler: '^4.40.2' }
    }, null, 2)}\n`;
}
function tsconfig() {
    return `${JSON.stringify({
        compilerOptions: {
            target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'WebWorker'],
            strict: true, noEmit: true, skipLibCheck: true
        },
        include: ['src/**/*.ts']
    }, null, 2)}\n`;
}
function cloudflareTypes() {
    return `interface D1ResultMeta {changes: number}
interface D1Result<T> {results: T[]; meta: D1ResultMeta}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result<unknown>>;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
}
interface D1Database {prepare(query: string): D1PreparedStatement}
`;
}
function wrangler(ir, plan) {
    const binding = plan.bindings.recordDatabase ?? 'DB';
    return `// Generated by turbowarp-http-server.\n${JSON.stringify({ name: ir.name, main: 'src/index.ts', compatibility_date: '2025-09-01', d1_databases: [{ binding, database_name: `${ir.name}-db`, database_id: 'replace-me' }] }, null, 2)}\n`;
}
function migration() {
    return `CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, collection TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);\n`;
}
//# sourceMappingURL=cloudflare.js.map