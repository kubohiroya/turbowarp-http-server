import { NAMED_DATA_ERROR_CODES, type NamedDataErrorCode, type NamedDataKind, type NamedDataMetadata, type NamedDataReference, type NamedDataRegistryService, type NamedDataReleaseReason, type NamedDataRepresentation, type NamedDataResolveContext, type NamedDataScope } from '@kubohiroya/turbowarp-named-data/composition';
export { NAMED_DATA_ERROR_CODES };
export type { NamedDataErrorCode, NamedDataKind, NamedDataReference, NamedDataScope };
type LegacyNamedDataRegistryErrorCode = 'NAMED_DATA_INCOMPATIBLE_VERSION' | 'NAMED_DATA_NAMESPACE_CONFLICT';
type NamedDataProviderErrorCode = NamedDataErrorCode | LegacyNamedDataRegistryErrorCode;
export type NamedBodyErrorCode = NamedDataProviderErrorCode | 'NAMED_RESPONSE_BODY_DISABLED' | 'NAMED_RESPONSE_INVALID_METADATA';
export type NamedBodyRepresentation = NamedDataRepresentation;
export interface NamedBodyRequest {
    reference: NamedDataReference;
    representation: NamedBodyRepresentation;
    /** Runtime-local identity used only when reference.scope is target. */
    targetId?: string;
}
export interface NamedBodyMetadata extends NamedDataMetadata {
    etag?: string;
}
export type NamedBodyReleaseReason = Exclude<NamedDataReleaseReason, 'shutdown'>;
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
export type NamedDataContextResolver = (request: NamedBodyRequest) => NamedDataResolveContext | Promise<NamedDataResolveContext>;
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
/** Adapts the canonical runtime registry to the HTTP response boundary. */
export declare class NamedDataRegistryResolver extends NamedBodyResolver {
    constructor(registry: NamedDataRegistryService, contextFor: NamedDataContextResolver);
}
export declare class NamedBodyResponder {
    private readonly resolver;
    private readonly featureFlags;
    constructor(resolver: NamedBodyResolver, featureFlags?: Readonly<NamedResponseBodyFeatureFlags>);
    respond(request: NamedBodyRequest, options?: NamedBodyResponseOptions): Promise<Response>;
}
export declare function createNamedBodyResponse(resolver: NamedBodyResolver, request: NamedBodyRequest, options?: NamedBodyResponseOptions): Promise<Response>;
