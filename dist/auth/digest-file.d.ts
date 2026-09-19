import type { DigestCredentialStore } from './digest.js';
export interface HtdigestEntry {
    username: string;
    realm: string;
    ha1: string;
}
export declare class HtdigestFile implements DigestCredentialStore {
    private readonly path;
    constructor(path: string);
    getHa1(username: string, realm: string): Promise<string | undefined>;
}
export declare function readHtdigestFile(path: string): Promise<HtdigestEntry[]>;
export declare function writeHtdigestFile(path: string, entries: readonly HtdigestEntry[]): Promise<void>;
export declare function setHtdigestPassword(path: string, username: string, realm: string, password: string): Promise<'created' | 'updated'>;
export declare function updateHtdigestPassword(path: string, username: string, realm: string, password: string): Promise<boolean>;
export declare function deleteHtdigestUser(path: string, username: string, realm: string): Promise<boolean>;
export declare function validateField(name: 'username' | 'realm', value: string): void;
