export declare const HTTP_BRIDGE_PROTOCOL: "turbowarp-http-server";
export declare const HTTP_BRIDGE_PROTOCOL_VERSION: 1;
export interface BridgeTextBody {
    kind: 'text';
    text: string;
}
export interface BridgeEmptyBody {
    kind: 'empty';
}
export interface BridgeUnsupportedBody {
    kind: 'unsupported';
    reason: string;
}
export type BridgeBody = BridgeTextBody | BridgeEmptyBody | BridgeUnsupportedBody;
export interface BridgeRequestMessage {
    type: 'request';
    protocol: typeof HTTP_BRIDGE_PROTOCOL;
    version: typeof HTTP_BRIDGE_PROTOCOL_VERSION;
    id: string;
    method: string;
    url: string;
    path: string;
    route: string;
    pathParams: Record<string, string>;
    query: Record<string, string[]>;
    headers: Record<string, string[]>;
    body: BridgeBody;
    clientAddress: string;
}
export interface BridgeResponseMessage {
    type: 'response';
    id: string;
    status: number;
    headers: Record<string, string[]>;
    body: BridgeBody;
}
export interface BridgeErrorMessage {
    type: 'error';
    id?: string;
    message: string;
}
export type BridgeClientMessage = BridgeResponseMessage | BridgeErrorMessage;
export declare function normalizeHeaderName(name: string): string;
export declare function isValidHttpStatus(status: number): boolean;
export declare function isBodyForbidden(method: string, status: number): boolean;
export declare function isForbiddenResponseHeader(name: string): boolean;
export declare function validateHeaderName(name: string): boolean;
export declare function validateHeaderValue(value: string): boolean;
export declare function firstValue(values: readonly string[] | undefined): string;
export declare function parseBridgeClientMessage(value: string): BridgeClientMessage | null;
export declare function requireHeaderRecord(value: unknown): Record<string, string[]>;
export declare function requireBridgeBody(value: unknown): BridgeBody;
