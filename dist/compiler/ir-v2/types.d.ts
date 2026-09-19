export declare const DEPLOY_IR_V2_VERSION: 2;
export declare const IR_V2_EXPRESSION_KINDS: readonly ["literal", "request", "request-value", "concat", "handler-variable", "handler-variable-exists", "handler-variable-names", "kvs-get-text", "kvs-has", "kvs-list-keys", "binding", "json-text-coerce", "json-parse", "json-stringify", "json-is-valid", "json-get", "json-has", "json-set", "json-delete", "json-keys", "json-length", "iteration-key", "iteration-index", "iteration-value"];
export declare const IR_V2_STATEMENT_KINDS: readonly ["set-status", "set-header", "remove-header", "set-handler-variable", "change-handler-variable", "delete-handler-variable", "clear-handler-variables", "kvs-set-text", "kvs-delete", "record-create", "record-list", "record-get", "record-delete", "asset-resolve", "request-body-binary", "asset-object-get", "asset-object-put", "asset-object-delete", "if", "bounded-loop", "json-for-each", "respond-binary", "respond-named-body", "respond"];
export type EffectKindV2 = 'response-write' | 'handler-state-write' | 'record-read' | 'record-write' | 'key-value-read' | 'key-value-write' | 'object-read' | 'object-write' | 'binary-consume' | 'control';
export declare const IR_V2_STATEMENT_EFFECTS: {
    readonly 'set-status': readonly ["response-write"];
    readonly 'set-header': readonly ["response-write"];
    readonly 'remove-header': readonly ["response-write"];
    readonly 'set-handler-variable': readonly ["handler-state-write"];
    readonly 'change-handler-variable': readonly ["handler-state-write"];
    readonly 'delete-handler-variable': readonly ["handler-state-write"];
    readonly 'clear-handler-variables': readonly ["handler-state-write"];
    readonly 'kvs-set-text': readonly ["key-value-write"];
    readonly 'kvs-delete': readonly ["key-value-write"];
    readonly 'record-create': readonly ["record-write"];
    readonly 'record-list': readonly ["record-read"];
    readonly 'record-get': readonly ["record-read"];
    readonly 'record-delete': readonly ["record-write"];
    readonly 'asset-resolve': readonly ["object-read"];
    readonly 'request-body-binary': readonly ["control"];
    readonly 'asset-object-get': readonly ["object-read"];
    readonly 'asset-object-put': readonly ["object-write", "binary-consume"];
    readonly 'asset-object-delete': readonly ["object-write"];
    readonly if: readonly ["control"];
    readonly 'bounded-loop': readonly ["control"];
    readonly 'json-for-each': readonly ["control"];
    readonly 'respond-binary': readonly ["response-write", "binary-consume"];
    readonly 'respond-named-body': readonly ["response-write"];
    readonly respond: readonly ["response-write"];
};
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface BinaryRefDescriptorV2 {
    namespace: string;
    key: string;
    contentType?: string;
    size?: number;
    integrity?: `sha256:${string}`;
    revision?: string;
}
export interface BinaryLocatorV2 {
    namespace: string;
    key: string;
}
export interface BinaryMetadataV2 {
    contentType?: string;
    size?: number;
    integrity?: `sha256:${string}`;
    revision?: string;
}
export type BinaryDeleteTargetV2 = {
    kind: 'ref';
    ref: ExpressionIrV2;
} | {
    kind: 'locator';
    locator: BinaryLocatorV2;
};
export type BinaryContentDispositionV2 = {
    kind: 'inline';
} | {
    kind: 'attachment';
    filename: string;
};
export type NamedDataKindV2 = 'structured' | 'document' | 'binary' | 'asset';
export type NamedDataScopeV2 = 'target' | 'project';
export type NamedBodyRepresentationV2 = 'json' | 'yaml' | 'html' | 'markdown' | 'raw';
export interface NamedDataReferenceV2 {
    namespace: string;
    name: string;
    kind: NamedDataKindV2;
    scope: NamedDataScopeV2;
}
export type AtomicValueTypeV2 = 'null' | 'boolean' | 'number' | 'string' | 'json-text' | 'json-array' | 'json-object' | 'binary-ref';
export type ValueTypeV2 = AtomicValueTypeV2 | {
    kind: 'union';
    members: AtomicValueTypeV2[];
};
export type JsonValueTypeV2 = {
    kind: 'union';
    members: ['null', 'boolean', 'number', 'string', 'json-array', 'json-object'];
};
export declare const JSON_VALUE_TYPE_V2: JsonValueTypeV2;
export type ResourceTypeV2 = 'binary-body';
export type BindingTypeV2 = {
    kind: 'value';
    valueType: ValueTypeV2;
} | {
    kind: 'resource';
    resourceType: ResourceTypeV2;
};
export interface BindingDeclarationV2 {
    id: string;
    type: BindingTypeV2;
}
export interface SourceRefV2 {
    targetIndex: number;
    targetName: string;
    blockId: string;
    opcode: string;
    input?: string;
}
export type PathSegmentV2 = {
    kind: 'key';
    value: string;
} | {
    kind: 'index';
    value: number;
};
export type ExpressionIrV2 = {
    kind: 'literal';
    valueType: Exclude<AtomicValueTypeV2, 'binary-ref'>;
    value: JsonValue;
    sourceRef?: SourceRefV2;
} | {
    kind: 'literal';
    valueType: 'binary-ref';
    value: BinaryRefDescriptorV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'request';
    valueType: 'string';
    source: 'method' | 'path' | 'url' | 'body-text' | 'content-type' | 'client-address';
    sourceRef?: SourceRefV2;
} | {
    kind: 'request-value';
    valueType: 'string';
    source: 'query' | 'path-param' | 'header';
    name: string;
    sourceRef?: SourceRefV2;
} | {
    kind: 'concat';
    valueType: 'string';
    left: ExpressionIrV2;
    right: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'handler-variable';
    valueType: {
        kind: 'union';
        members: ['number', 'string'];
    };
    name: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'handler-variable-exists';
    valueType: 'boolean';
    name: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'handler-variable-names';
    valueType: 'string';
    sourceRef?: SourceRefV2;
} | {
    kind: 'kvs-get-text';
    valueType: 'string';
    namespace: ExpressionIrV2;
    key: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'kvs-has';
    valueType: 'boolean';
    namespace: ExpressionIrV2;
    key: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'kvs-list-keys';
    valueType: 'json-text';
    namespace: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'binding';
    valueType: ValueTypeV2;
    binding: string;
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-text-coerce';
    valueType: 'json-text';
    input: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-parse';
    valueType: JsonValueTypeV2;
    text: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-stringify';
    valueType: 'json-text';
    value: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-is-valid';
    valueType: 'boolean';
    text: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-get';
    valueType: JsonValueTypeV2;
    root: ExpressionIrV2;
    path: PathSegmentV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-has';
    valueType: 'boolean';
    root: ExpressionIrV2;
    path: PathSegmentV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-set';
    valueType: JsonValueTypeV2;
    root: ExpressionIrV2;
    path: PathSegmentV2[];
    value: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-delete';
    valueType: JsonValueTypeV2;
    root: ExpressionIrV2;
    path: PathSegmentV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-keys';
    valueType: 'json-array';
    root: ExpressionIrV2;
    path: PathSegmentV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-length';
    valueType: 'number';
    root: ExpressionIrV2;
    path: PathSegmentV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'iteration-key';
    valueType: 'string';
    loopId: string;
    sourceRef?: SourceRefV2;
} | {
    kind: 'iteration-index';
    valueType: 'number';
    loopId: string;
    sourceRef?: SourceRefV2;
} | {
    kind: 'iteration-value';
    valueType: JsonValueTypeV2;
    loopId: string;
    sourceRef?: SourceRefV2;
};
export type StatementIrV2 = {
    kind: 'set-status';
    status: number;
    sourceRef?: SourceRefV2;
} | {
    kind: 'set-header';
    name: string;
    value: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'remove-header';
    name: string;
    sourceRef?: SourceRefV2;
} | {
    kind: 'set-handler-variable' | 'change-handler-variable';
    name: ExpressionIrV2;
    value: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'delete-handler-variable';
    name: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'clear-handler-variables';
    sourceRef?: SourceRefV2;
} | {
    kind: 'kvs-set-text';
    namespace: ExpressionIrV2;
    key: ExpressionIrV2;
    value: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'kvs-delete';
    namespace: ExpressionIrV2;
    key: ExpressionIrV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'record-create';
    collection: string;
    data: ExpressionIrV2;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'record-list';
    collection: string;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'record-get' | 'record-delete';
    id: ExpressionIrV2;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'asset-resolve';
    locator: BinaryLocatorV2;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'request-body-binary';
    maxBytes: number;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'asset-object-get';
    ref: ExpressionIrV2;
    maxBytes: number;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'asset-object-put';
    locator: BinaryLocatorV2;
    body: string;
    metadata: BinaryMetadataV2;
    maxBytes: number;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'asset-object-delete';
    target: BinaryDeleteTargetV2;
    result: BindingDeclarationV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'if';
    condition: ExpressionIrV2;
    then: StatementIrV2[];
    else?: StatementIrV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'bounded-loop';
    maxIterations: number;
    body: StatementIrV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'json-for-each';
    loopId: string;
    root: ExpressionIrV2;
    path: PathSegmentV2[];
    maxIterations: number;
    body: StatementIrV2[];
    sourceRef?: SourceRefV2;
} | {
    kind: 'respond-binary';
    body: string;
    disposition?: BinaryContentDispositionV2;
    sourceRef?: SourceRefV2;
} | {
    kind: 'respond-named-body';
    reference: NamedDataReferenceV2;
    representation: NamedBodyRepresentationV2;
    targetId?: string;
    maxBytes: number;
    sourceRef?: SourceRefV2;
} | {
    kind: 'respond';
    format: 'text' | 'html' | 'json';
    body: ExpressionIrV2;
    sourceRef?: SourceRefV2;
};
export type CapabilityRequirementV2 = {
    kind: 'record-store';
} | {
    kind: 'key-value-store';
} | {
    kind: 'object-storage';
} | {
    kind: 'streaming-body';
} | {
    kind: 'named-body-provider';
} | {
    kind: 'request-metadata';
    field: 'client-address';
} | {
    kind: 'auth';
    scheme: 'external-jwt' | 'trusted-access-jwt';
};
export type AuthPolicyV2 = {
    kind: 'none';
} | {
    kind: 'jwt';
    scheme: 'external-jwt' | 'trusted-access-jwt';
};
export type HttpMethodV2 = 'ALL' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
export interface RouteIrV2 {
    id: string;
    method: HttpMethodV2;
    path: string;
    auth: 'public' | 'required';
    body: StatementIrV2[];
    sourceRef?: SourceRefV2;
}
export interface DeployIrV2 {
    version: typeof DEPLOY_IR_V2_VERSION;
    name: string;
    auth: AuthPolicyV2;
    capabilities: CapabilityRequirementV2[];
    routes: RouteIrV2[];
}
export interface CompilerDiagnosticV2 {
    severity: 'warning' | 'error';
    code: `TW2_${string}`;
    message: string;
    sourceRef?: SourceRefV2;
}
