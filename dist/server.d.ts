import { Hono } from 'hono';
import type { CommunityServerOptions } from './community.js';
import type { BridgeRequestMessage } from './protocol.js';
export { createNamedBodyResponse, DEFAULT_NAMED_RESPONSE_BODY_FEATURE_FLAGS, NAMED_DATA_ERROR_CODES, NamedBodyResponder, NamedBodyResolver } from './named-body.js';
export type { NamedBodyErrorCode, NamedBodyHandle, NamedBodyMetadata, NamedBodyProvider, NamedBodyReleaseReason, NamedBodyRequest, NamedBodyResponseOptions, NamedBodyRepresentation, NamedDataKind, NamedDataErrorCode, NamedDataReference, NamedDataScope, NamedResponseBodyFeatureFlags } from './named-body.js';
export { createAssetManagerNamedBodyProvider } from './resource-named-body-provider.js';
export type { AssetManagerNamedBodyProviderOptions } from './resource-named-body-provider.js';
export interface ServerOptions {
    hostname: string;
    port: number;
    resources?: ResourceCapability;
    maxResourceBodyBytes?: number;
    maxRequestBodyBytes?: number;
    logger?: ResourceLogger;
    authorizeResource?: ResourceAuthorizer;
    requestTimeoutMs?: number;
    namedResponseBody?: boolean;
    maxNamedResponseBodyBytes?: number;
    routes?: readonly string[];
    community?: false | CommunityServerOptions;
}
export interface RunningServer {
    hostname: string;
    port: number;
    close(): Promise<void>;
}
export interface ResourceSnapshot {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
    byteLength?: number;
    etag?: string;
    replacementId?: string;
    lastModified?: Date;
    cacheControl?: string;
}
export interface ResourceMetadata {
    name: string;
    mimeType: string;
    byteLength?: number;
    etag?: string;
    replacementId?: string;
    lastModified?: Date;
    cacheControl?: string;
}
export interface ResourceWriteRequest {
    routeName: string;
    resourceName: string;
    mimeType: string;
    bytes: Uint8Array;
}
export interface ResourceWriteResult {
    created: boolean;
    snapshot?: ResourceSnapshot;
}
export interface ResourceCapability {
    isNamespacePublished?(routeName: string): boolean | Promise<boolean>;
    getResource(routeName: string, resourceName: string): ResourceSnapshot | null | Promise<ResourceSnapshot | null>;
    listResources?(routeName: string): readonly ResourceMetadata[] | Promise<readonly ResourceMetadata[]>;
    putResource?(request: ResourceWriteRequest): ResourceWriteResult | Promise<ResourceWriteResult>;
    deleteResource?(routeName: string, resourceName: string): boolean | Promise<boolean>;
    isSupportedResourceType?(mimeType: string): boolean | Promise<boolean>;
}
export interface ResourceLogEvent {
    event: 'resource.get' | 'resource.head' | 'resource.put' | 'resource.delete' | 'resource.list';
    routeName: string;
    resourceName?: string;
    mimeType?: string;
    byteLength?: number;
    status: number;
}
export interface ResourceLogger {
    info(event: ResourceLogEvent): void;
}
export type ResourceAuthorizer = (request: Request, operation: 'get' | 'head' | 'put' | 'delete' | 'list', routeName: string, resourceName?: string) => boolean | Promise<boolean>;
export interface ServerAppOptions {
    resources?: ResourceCapability;
    maxResourceBodyBytes?: number;
    maxRequestBodyBytes?: number;
    logger?: ResourceLogger;
    authorizeResource?: ResourceAuthorizer;
    bridge?: HttpRequestBridge;
    routes?: readonly string[];
    community?: false | CommunityServerOptions;
}
export interface HttpRequestBridge {
    forward(message: BridgeRequestMessage, method: string, signal?: AbortSignal): Promise<Response>;
}
export declare function createApp(options?: ServerAppOptions): Hono;
export declare function startServer(options: ServerOptions): RunningServer;
