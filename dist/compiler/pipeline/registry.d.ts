import type { PlatformAdapter } from './types.js';
export declare class PlatformAdapterRegistry {
    private readonly adapters;
    register(adapter: PlatformAdapter): void;
    resolve(id: string): PlatformAdapter | undefined;
    ids(): string[];
}
