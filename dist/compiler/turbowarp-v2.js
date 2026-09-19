import { extensionConfig } from '../config.js';
import { DEPLOY_IR_V2_VERSION } from './ir-v2/types.js';
import { upgradeDeployIrV1 } from './ir-v2/upgrade-v1.js';
import { lowerNamedBodyResponse } from './named-body/lowering.js';
import { compileTurboWarpProject } from './turbowarp.js';
import { validateTurboWarpServerSubset } from './validator/turbowarp-subset.js';
const PREFIX = `${extensionConfig.id}_`;
const HAT_OPCODE = `${PREFIX}whenHttpRequestReceived`;
const NAMED_RESPONSE_OPCODE = `${PREFIX}respondWithNamedBody`;
const LEGACY_RESPONSE_OPCODE = `${PREFIX}respondWithText`;
/** Compiles the current built-in HTTP block subset through the v1 compatibility frontend into IR v2. */
export function compileTurboWarpProjectV2(value) {
    const subsetDiagnostics = validateTurboWarpServerSubset(value).map(toCompilerDiagnostic);
    if (subsetDiagnostics.length > 0) {
        return { ir: emptyIr(), diagnostics: subsetDiagnostics };
    }
    const routeSources = collectRouteSources(value);
    const legacyProject = replaceNamedResponses(value);
    const legacy = compileTurboWarpProject(legacyProject);
    const upgraded = upgradeDeployIrV1(legacy.ir);
    const diagnostics = [
        ...legacy.diagnostics.map((diagnostic) => legacyDiagnostic(diagnostic, value)),
        ...upgraded.diagnostics
    ];
    if (diagnostics.some(({ severity }) => severity === 'error')) {
        return { ir: upgraded.ir, diagnostics };
    }
    if (routeSources.length !== upgraded.ir.routes.length) {
        return {
            ir: upgraded.ir,
            diagnostics: [
                {
                    severity: 'error',
                    code: 'TW2_FRONTEND_ROUTE_MISMATCH',
                    message: 'TurboWarp route discovery did not match the compatibility frontend output.'
                }
            ]
        };
    }
    let requiresNamedBodies = false;
    upgraded.ir.routes.forEach((route, index) => {
        const source = routeSources[index];
        route.sourceRef = source.hat;
        if (source.named === undefined)
            return;
        const lowered = lowerNamedBodyResponse(namedArguments(source.named.inputs, source.named.sourceRef), source.named.sourceRef);
        diagnostics.push(...lowered.diagnostics);
        if (lowered.statement === undefined)
            return;
        route.body[route.body.length - 1] = lowered.statement;
        requiresNamedBodies = true;
    });
    if (requiresNamedBodies && !upgraded.ir.capabilities.some(({ kind }) => kind === 'named-body-provider')) {
        upgraded.ir.capabilities.push({ kind: 'named-body-provider' });
        upgraded.ir.capabilities.sort((left, right) => capabilityKey(left).localeCompare(capabilityKey(right)));
    }
    return { ir: upgraded.ir, diagnostics };
}
function collectRouteSources(value) {
    const project = object(value);
    if (!Array.isArray(project.targets))
        throw new Error('TurboWarp project.targets must be an array.');
    const result = [];
    project.targets.forEach((rawTarget, targetIndex) => {
        const target = object(rawTarget);
        const targetName = typeof target.name === 'string' ? target.name : 'unnamed';
        const blocks = blockMap(target.blocks);
        for (const [hatId, hat] of Object.entries(blocks)) {
            if (hat.opcode !== HAT_OPCODE || hat.topLevel !== true || typeof hat.next !== 'string')
                continue;
            const source = {
                hat: { targetIndex, targetName, blockId: hatId, opcode: HAT_OPCODE }
            };
            let commandId = hat.next;
            const first = blocks[commandId];
            if (first?.opcode === 'control_if')
                commandId = inputBlockId(inputMap(first.inputs).SUBSTACK);
            const visited = new Set();
            while (commandId !== null && !visited.has(commandId)) {
                visited.add(commandId);
                const block = blocks[commandId];
                if (block === undefined)
                    break;
                if (block.opcode === NAMED_RESPONSE_OPCODE) {
                    source.named = {
                        sourceRef: { targetIndex, targetName, blockId: commandId, opcode: NAMED_RESPONSE_OPCODE },
                        inputs: inputMap(block.inputs)
                    };
                }
                commandId = typeof block.next === 'string' ? block.next : null;
            }
            result.push(source);
        }
    });
    return result;
}
function replaceNamedResponses(value) {
    const clone = structuredClone(value);
    if (!Array.isArray(clone.targets))
        return clone;
    for (const rawTarget of clone.targets) {
        const target = object(rawTarget);
        const blocks = blockMap(target.blocks);
        for (const block of Object.values(blocks)) {
            if (block.opcode !== NAMED_RESPONSE_OPCODE)
                continue;
            block.opcode = LEGACY_RESPONSE_OPCODE;
            block.inputs = { BODY: [1, [10, '']] };
        }
    }
    return clone;
}
function namedArguments(inputs, sourceRef) {
    return {
        NAMESPACE: scratchLiteral(inputs.NAMESPACE, 'string', sourceRef),
        NAME: scratchLiteral(inputs.NAME, 'string', sourceRef),
        KIND: scratchLiteral(inputs.KIND, 'string', sourceRef),
        SCOPE: scratchLiteral(inputs.SCOPE, 'string', sourceRef),
        TARGET_ID: scratchLiteral(inputs.TARGET_ID, 'string', sourceRef),
        REPRESENTATION: scratchLiteral(inputs.REPRESENTATION, 'string', sourceRef),
        MAX_BYTES: scratchLiteral(inputs.MAX_BYTES, 'number', sourceRef)
    };
}
function scratchLiteral(input, expected, sourceRef) {
    if (inputBlockId(input) !== null) {
        return { kind: 'request', valueType: 'string', source: 'path', sourceRef };
    }
    const raw = literalValue(input);
    if (expected === 'number') {
        return { kind: 'literal', valueType: 'number', value: Number(raw), sourceRef };
    }
    return { kind: 'literal', valueType: 'string', value: raw, sourceRef };
}
function legacyDiagnostic(diagnostic, value) {
    const sourceRef = findSourceRef(value, diagnostic.target, diagnostic.blockId);
    const suffix = diagnostic.code.startsWith('TW_') ? diagnostic.code.slice(3) : diagnostic.code;
    return {
        severity: diagnostic.severity,
        code: `TW2_${suffix}`,
        message: diagnostic.message,
        ...(sourceRef === undefined ? {} : { sourceRef })
    };
}
function findSourceRef(value, targetName, blockId) {
    if (targetName === undefined || blockId === undefined)
        return undefined;
    const project = object(value);
    if (!Array.isArray(project.targets))
        return undefined;
    for (let targetIndex = 0; targetIndex < project.targets.length; targetIndex += 1) {
        const target = object(project.targets[targetIndex]);
        if (target.name !== targetName)
            continue;
        const block = blockMap(target.blocks)[blockId];
        if (typeof block?.opcode !== 'string')
            return undefined;
        return { targetIndex, targetName, blockId, opcode: block.opcode };
    }
}
function toCompilerDiagnostic(diagnostic) {
    return {
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        ...(diagnostic.sourceRef === undefined ? {} : { sourceRef: diagnostic.sourceRef })
    };
}
function emptyIr() {
    return { version: DEPLOY_IR_V2_VERSION, name: 'turbowarp-worker', auth: { kind: 'none' }, capabilities: [], routes: [] };
}
function capabilityKey(value) {
    return JSON.stringify(value);
}
function inputBlockId(value) {
    if (!Array.isArray(value))
        return null;
    return typeof value[1] === 'string' ? value[1] : null;
}
function literalValue(value) {
    if (!Array.isArray(value))
        return '';
    const primary = value[1];
    if (Array.isArray(primary))
        return String(primary[1] ?? '');
    const shadow = value[2];
    if (Array.isArray(shadow))
        return String(shadow[1] ?? '');
    return typeof primary === 'number' || typeof primary === 'boolean' ? String(primary) : '';
}
function inputMap(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
function blockMap(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}
function object(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('TurboWarp project value must be an object.');
    }
    return value;
}
//# sourceMappingURL=turbowarp-v2.js.map