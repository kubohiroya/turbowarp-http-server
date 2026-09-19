export declare const DIGEST_AUTH_USER_HEADER = "x-turbowarp-http-auth-user";
export interface DigestCredentialStore {
    getHa1(username: string, realm: string): string | undefined | Promise<string | undefined>;
}
export interface DigestAuthOptions {
    realm: string;
    credentials: DigestCredentialStore;
    nonceMaxAgeMs?: number;
    nonceSecret?: string;
}
export interface DigestAuthResult {
    ok: boolean;
    username?: string;
    challenge?: string;
}
export declare function createHa1(username: string, realm: string, password: string): string;
export declare function createDigestChallenge(options: DigestAuthOptions): string;
export declare function verifyDigestAuth(request: Request, method: string, options: DigestAuthOptions): Promise<DigestAuthResult>;
export declare function parseDigestAuthorization(value: string): Record<string, string>;
export declare function isLocalAddress(address: string | undefined): boolean;
declare global {
    var __turbowarpHttpDigestNonceSecret: string | undefined;
}
