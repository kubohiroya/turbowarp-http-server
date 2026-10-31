import { CompilerManifestError } from './error.js';
const STRING = 'STRING';
const NUMBER = 'NUMBER';
export const KNOWN_SERVER_OPERATIONS = {
    'kvs.delete': signature('deleteKey', 'COMMAND', [{ id: 'KEY', type: STRING }, { id: 'NAMESPACE', type: STRING }], 'void', 'storage-write', false),
    'kvs.getText': signature('getValue', 'REPORTER', [{ id: 'KEY', type: STRING }, { id: 'NAMESPACE', type: STRING }], 'string', 'storage-read'),
    'kvs.has': signature('hasKey', 'BOOLEAN', [{ id: 'KEY', type: STRING }, { id: 'NAMESPACE', type: STRING }], 'boolean', 'storage-read'),
    'kvs.listKeys': signature('listKeys', 'REPORTER', [{ id: 'NAMESPACE', type: STRING }], 'json', 'storage-read'),
    'kvs.setText': signature('setValue', 'COMMAND', [{ id: 'KEY', type: STRING }, { id: 'NAMESPACE', type: STRING }, { id: 'VALUE', type: STRING }], 'void', 'storage-write', false),
    // Structured Data 0.11.0-rc.1: every server-supported block of the published manifest. Phases 2
    // (YAML) and 3 (schema) are listed so the whole manifest registers; their lowering still stops.
    'structuredData.addSchemaProperty': signature('addSchemaProperty', 'COMMAND', [stringArgument('PROPERTY'), stringArgument('REQUIRED'), stringArgument('TYPE')], 'void', 'state'),
    'structuredData.beginSchema': signature('beginSchema', 'COMMAND', [stringArgument('EXTRA'), stringArgument('SCHEMA_ID'), stringArgument('VERSION')], 'void', 'state'),
    'structuredData.commitSchema': signature('commitSchema', 'COMMAND', [], 'void', 'state'),
    'structuredData.currentGet': signature('currentJsonAtPath', 'REPORTER', [pathArgument()], 'jsonText', 'control'),
    'structuredData.currentGetText': signature('currentTextAtPath', 'REPORTER', [pathArgument()], 'string', 'control'),
    'structuredData.currentIndex': signature('currentIndex', 'REPORTER', [], 'number', 'control'),
    'structuredData.currentKey': signature('currentKey', 'REPORTER', [], 'string', 'control'),
    'structuredData.currentValue': signature('currentValueJson', 'REPORTER', [], 'jsonText', 'control'),
    'structuredData.defineSchema': signature('defineSchema', 'COMMAND', [stringArgument('SCHEMA_ID'), stringArgument('TEXT'), stringArgument('VERSION')], 'void', 'state'),
    'structuredData.delete': signature('deleteAtPath', 'COMMAND', [nameArgument(), pathArgument()], 'void', 'state'),
    'structuredData.deleteData': signature('deleteStructuredData', 'COMMAND', [nameArgument()], 'void', 'state'),
    'structuredData.deleteSchema': signature('deleteSchema', 'COMMAND', [stringArgument('SCHEMA_ID'), stringArgument('VERSION')], 'void', 'state'),
    'structuredData.forEach': signature('forEachAtPath', 'LOOP', [{ id: 'MAX', type: NUMBER, staticLiteral: true, minimum: 1, maximum: 1000 }, nameArgument(), pathArgument()], 'void', 'control'),
    'structuredData.get': signature('getJsonAtPath', 'REPORTER', [nameArgument(), pathArgument()], 'jsonText', 'pure'),
    'structuredData.getText': signature('getTextAtPath', 'REPORTER', [nameArgument(), pathArgument()], 'string', 'pure'),
    'structuredData.has': signature('hasPath', 'BOOLEAN', [nameArgument(), pathArgument()], 'boolean', 'pure'),
    'structuredData.hasData': signature('hasStructuredData', 'BOOLEAN', [nameArgument()], 'boolean', 'pure'),
    'structuredData.hasSchema': signature('hasSchema', 'BOOLEAN', [stringArgument('SCHEMA_ID'), stringArgument('VERSION')], 'boolean', 'pure'),
    'structuredData.keys': signature('keysAtPath', 'REPORTER', [nameArgument(), pathArgument()], 'jsonText', 'pure'),
    'structuredData.length': signature('lengthAtPath', 'REPORTER', [nameArgument(), pathArgument()], 'number', 'pure'),
    'structuredData.parseJson': signature('parseJson', 'COMMAND', [nameArgument(), stringArgument('TEXT')], 'void', 'state'),
    'structuredData.parseJsonWithSchema': signature('parseJsonWithSchema', 'COMMAND', [nameArgument(), stringArgument('SCHEMA_ID'), stringArgument('TEXT'), stringArgument('VERSION')], 'void', 'state'),
    'structuredData.parseYaml': signature('parseYaml', 'COMMAND', [nameArgument(), stringArgument('TEXT')], 'void', 'state'),
    'structuredData.parseYamlWithSchema': signature('parseYamlWithSchema', 'COMMAND', [nameArgument(), stringArgument('SCHEMA_ID'), stringArgument('TEXT'), stringArgument('VERSION')], 'void', 'state'),
    'structuredData.schemaOf': signature('schemaOf', 'REPORTER', [nameArgument()], 'jsonText', 'pure'),
    'structuredData.set': signature('setJsonAtPath', 'COMMAND', [nameArgument(), pathArgument(), stringArgument('VALUE')], 'void', 'state'),
    'structuredData.toJson': signature('toJson', 'REPORTER', [nameArgument()], 'jsonText', 'pure'),
    'structuredData.toYaml': signature('toYaml', 'REPORTER', [nameArgument()], 'yamlText', 'pure')
};
export function validateServerOperationHint(block) {
    const operation = block.server?.irOperation;
    if (block.server?.supported !== true) {
        if (operation !== undefined)
            operationMismatch(block, operation, 'unsupported blocks must not declare an operation');
        return;
    }
    if (operation === undefined)
        operationMismatch(block, '<missing>', 'supported blocks require an operation');
    const expected = KNOWN_SERVER_OPERATIONS[operation];
    if (expected === undefined)
        operationMismatch(block, operation, 'operation is not in the compiler allowlist');
    const actual = {
        opcode: block.opcode,
        blockType: block.blockType,
        arguments: block.arguments,
        resultType: block.resultType,
        effect: block.effect,
        immutable: block.immutable
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        operationMismatch(block, operation, 'block signature does not match the compiler allowlist');
    }
}
function signature(opcode, blockType, argumentsValue, resultType, effect, immutable = true) {
    return { opcode, blockType, arguments: argumentsValue, resultType, effect, immutable };
}
/** Argument objects keep the manifest parser's key order, because signatures compare as JSON text. */
function stringArgument(id) {
    return { id, type: STRING };
}
function nameArgument() {
    return stringArgument('NAME');
}
function pathArgument() {
    return { id: 'PATH', type: STRING, normalizesTo: 'pathSegments' };
}
function operationMismatch(block, operation, reason) {
    throw new CompilerManifestError('TW2_MANIFEST_OPERATION_MISMATCH', `Manifest operation ${operation} on block ${block.opcode} is invalid: ${reason}.`);
}
//# sourceMappingURL=operations.js.map