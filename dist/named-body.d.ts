export type NamedDataKind = 'structured' | 'document' | 'binary' | 'asset';
export type NamedDataScope = 'target' | 'project';
/** Stable provider error namespace shared with structured/document/binary data extensions. */
export declare const NAMED_DATA_ERROR_CODES: readonly ["NAMED_DATA_INVALID_REF", "NAMED_DATA_PROVIDER_NOT_FOUND", "NAMED_DATA_NOT_FOUND", "NAMED_DATA_KIND_MISMATCH", "NAMED_DATA_SCOPE_MISMATCH", "NAMED_DATA_REPRESENTATION_UNSUPPORTED", "NAMED_DATA_BODY_TOO_LARGE", "NAMED_DATA_ABORTED", "NAMED_DATA_PROVIDER_RELEASED"];
export type NamedDataErrorCode = (typeof NAMED_DATA_ERROR_CODES)[number];
export type NamedBodyErrorCode = NamedDataErrorCode | 'NAMED_RESPONSE_BODY_DISABLED' | 'NAMED_RESPONSE_INVALID_METADATA';
export interface NamedDataReference {
    namespace: string;
    name: string;
    kind: NamedDataKind;
    scope: NamedDataScope;
}
export type NamedBodyRepresentation = 'json' | 'yaml' | 'html' | 'markdown' | 'raw';
export interface NamedBodyRequest {
    reference: NamedDataReference;
    representation: NamedBodyRepresentation;
    /** Runtime-local identity used only when reference.scope is target. */
    targetId?: string;
}
export interface NamedBodyMetadata {
    mediaType: string;
    byteLength?: number;
    etag?: string;
    revision?: string;
}
export type NamedBodyReleaseReason = 'complete' | 'cancel' | 'abort' | 'error';
export interface NamedBodyHandle {
    metadata: NamedBodyMetadata;
    body: Uint8Array | ReadableStream<Uint8Array>;
    release(reason: NamedBodyReleaseReason): void | Promise<void>;
}
export interface NamedBodyProvider {
    canResolve(request: NamedBodyRequest): boolean;
    stat(request: NamedBodyRequest, signal: AbortSignal): NamedBodyMetadata | null | Promise<NamedBodyMetadata | null>;
    openBody(request: NamedBodyRequest, signal: AbortSignal): NamedBodyHandle | null | Promise<NamedBodyHandle | null>;
}
export interface NamedResponseBodyFeatureFlags {
    namedResponseBody: boolean;
}
export declare const DEFAULT_NAMED_RESPONSE_BODY_FEATURE_FLAGS: Readonly<NamedResponseBodyFeatureFlags>;
export interface NamedBodyResponseOptions {
    method?: string;
    status?: number;
    headers?: HeadersInit;
    signal?: AbortSignal;
    maxBodyBytes?: number;
    featureFlags?: Readonly<NamedResponseBodyFeatureFlags>;
}
export declare class NamedBodyResolver {
    private readonly providers;
    constructor(providers: readonly NamedBodyProvider[]);
    stat(request: NamedBodyRequest, signal: AbortSignal): Promise<NamedBodyMetadata | null>;
    openBody(request: NamedBodyRequest, signal: AbortSignal): Promise<NamedBodyHandle | null>;
    canResolve(request: NamedBodyRequest): boolean;
    private providerFor;
}
export declare class NamedBodyResponder {
    private readonly resolver;
    private readonly featureFlags;
    constructor(resolver: NamedBodyResolver, featureFlags?: Readonly<NamedResponseBodyFeatureFlags>);
    respond(request: NamedBodyRequest, options?: NamedBodyResponseOptions): Promise<Response>;
}
export declare function createNamedBodyResponse(resolver: NamedBodyResolver, request: NamedBodyRequest, options?: NamedBodyResponseOptions): Promise<Response>;
