import { cloudflareWorkersAdapter } from '../adapters/cloudflare.js';
import { firebaseFunctionsAdapter } from '../adapters/firebase.js';
import { DEFAULT_COMPILER_FEATURE_FLAGS } from '../feature-flags.js';
import { validateDeployIrV2Subset } from '../validator/ir-validator.js';
import { generateHonoCore } from './core-generator.js';
import { PlatformAdapterRegistry } from './registry.js';
import { extractCapabilityRequirements } from './requirements.js';
export function compileDeployIrV2(ir, options) {
    const featureFlags = {
        ...DEFAULT_COMPILER_FEATURE_FLAGS,
        ...options.featureFlags
    };
    const targetNeutral = validateDeployIrV2Subset(ir, undefined, featureFlags);
    if (targetNeutral.length > 0)
        return { ok: false, diagnostics: targetNeutral };
    const registry = new PlatformAdapterRegistry();
    for (const adapter of options.adapters ?? [cloudflareWorkersAdapter, firebaseFunctionsAdapter]) {
        registry.register(adapter);
    }
    const adapter = registry.resolve(options.target);
    if (adapter === undefined) {
        return {
            ok: false,
            diagnostics: [
                {
                    severity: 'error',
                    code: 'TW2_UNKNOWN_TARGET',
                    message: `Target ${options.target} is not registered.`,
                    reason: 'IR v2 never guesses a deployment target.',
                    suggestion: `Choose one of: ${registry.ids().join(', ') || '<none>'}.`,
                    targetId: options.target
                }
            ]
        };
    }
    const targetLimitDiagnostics = validateTargetBinaryLimits(ir, adapter);
    if (targetLimitDiagnostics.length > 0)
        return { ok: false, diagnostics: targetLimitDiagnostics };
    const requirements = extractCapabilityRequirements(ir);
    const planned = adapter.plan({ ir, requirements, config: options.targetConfig });
    if (!planned.ok)
        return planned;
    const core = generateHonoCore(ir);
    const generated = normalizeGeneratedProject(adapter.generate({ ir, plan: planned.plan, core }));
    const filePath = 'turbowarp-server.generated.json';
    const fileNames = [...Object.keys(generated), filePath].sort();
    const manifest = {
        formatVersion: 1,
        irVersion: 2,
        adapter: { id: adapter.id, version: adapter.version },
        requirements: requirements.keys,
        plan: {
            requirements: [...planned.plan.requirements].sort(),
            bindings: Object.fromEntries(Object.entries(planned.plan.bindings).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
        },
        files: fileNames
    };
    const files = normalizeGeneratedProject({
        ...generated,
        [filePath]: `${JSON.stringify(manifest, null, 2)}\n`
    });
    return { ok: true, files, manifest };
}
function validateTargetBinaryLimits(ir, adapter) {
    const maximum = adapter.capabilities().maxBinaryBytes;
    if (maximum === undefined)
        return [];
    const diagnostics = [];
    for (const route of ir.routes)
        visitStatements(route.body, route.id, maximum, adapter.id, diagnostics);
    return diagnostics;
}
function visitStatements(statements, routeId, maximum, targetId, diagnostics) {
    for (const statement of statements) {
        if ((statement.kind === 'request-body-binary' ||
            statement.kind === 'asset-object-get' ||
            statement.kind === 'asset-object-put' ||
            statement.kind === 'respond-named-body') &&
            statement.maxBytes > maximum) {
            diagnostics.push({
                severity: 'error',
                code: 'TW2_TARGET_BINARY_LIMIT_EXCEEDED',
                message: `Binary limit ${statement.maxBytes} exceeds the ${targetId} target limit ${maximum}.`,
                reason: 'The selected platform cannot safely satisfy this binary operation limit.',
                suggestion: `Set maxBytes to ${maximum} or less, or choose a target with a larger declared limit.`,
                targetId,
                routeId,
                ...(statement.sourceRef === undefined ? {} : { sourceRef: statement.sourceRef })
            });
        }
        if (statement.kind === 'if') {
            visitStatements(statement.then, routeId, maximum, targetId, diagnostics);
            visitStatements(statement.else ?? [], routeId, maximum, targetId, diagnostics);
        }
        else if (statement.kind === 'bounded-loop' || statement.kind === 'json-for-each') {
            visitStatements(statement.body, routeId, maximum, targetId, diagnostics);
        }
    }
}
function normalizeGeneratedProject(files) {
    return Object.fromEntries(Object.entries(files)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([path, source]) => [path, `${source.replace(/\r\n?/gu, '\n').replace(/\n*$/u, '')}\n`]));
}
//# sourceMappingURL=compiler.js.map