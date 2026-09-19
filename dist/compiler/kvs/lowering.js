const EXTENSION_ID = 'kubohiroyakvs';
const PACKAGE_NAME = '@kubohiroya/turbowarp-kvs';
const PACKAGE_VERSION = '0.1.0';
export class KvsLoweringContext {
    constructor(diagnostics = []) {
        this.diagnostics = diagnostics;
    }
    lowerStatement(entry, args, sourceRef) {
        const operation = this.operation(entry, sourceRef);
        if (operation === undefined)
            return undefined;
        const namespace = args.NAMESPACE;
        const key = args.KEY;
        if (namespace === undefined || key === undefined)
            return this.missingArgument(sourceRef);
        if (operation === 'kvs.delete')
            return { kind: 'kvs-delete', namespace, key, sourceRef };
        if (operation === 'kvs.setText') {
            const value = args.VALUE;
            return value === undefined
                ? this.missingArgument(sourceRef)
                : { kind: 'kvs-set-text', namespace, key, value, sourceRef };
        }
        return this.unsupported(operation, sourceRef);
    }
    lowerReporter(entry, args, sourceRef) {
        const operation = this.operation(entry, sourceRef);
        if (operation === undefined)
            return undefined;
        const namespace = args.NAMESPACE;
        if (namespace === undefined)
            return this.missingArgument(sourceRef);
        if (operation === 'kvs.listKeys') {
            return { kind: 'kvs-list-keys', valueType: 'json-text', namespace, sourceRef };
        }
        const key = args.KEY;
        if (key === undefined)
            return this.missingArgument(sourceRef);
        if (operation === 'kvs.getText')
            return { kind: 'kvs-get-text', valueType: 'string', namespace, key, sourceRef };
        if (operation === 'kvs.has')
            return { kind: 'kvs-has', valueType: 'boolean', namespace, key, sourceRef };
        return this.unsupported(operation, sourceRef);
    }
    operation(entry, sourceRef) {
        if (entry.extensionId !== EXTENSION_ID ||
            entry.packageName !== PACKAGE_NAME ||
            entry.packageVersion !== PACKAGE_VERSION ||
            entry.block.server?.supported !== true ||
            entry.block.server.irOperation === undefined) {
            return this.unsupported(entry.projectOpcode, sourceRef);
        }
        return entry.block.server.irOperation;
    }
    missingArgument(sourceRef) {
        this.diagnostics.push({
            severity: 'error',
            code: 'TW2_KVS_SIGNATURE_MISMATCH',
            message: 'The KVS block does not match its locked manifest signature.',
            sourceRef
        });
        return undefined;
    }
    unsupported(operation, sourceRef) {
        this.diagnostics.push({
            severity: 'error',
            code: 'TW2_UNSUPPORTED_OPERATION',
            message: `KVS operation is not supported by this lowering phase: ${operation}`,
            sourceRef
        });
        return undefined;
    }
}
export function isKvsEntry(entry) {
    return entry.extensionId === EXTENSION_ID;
}
//# sourceMappingURL=lowering.js.map