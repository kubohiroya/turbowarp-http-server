import type { NamedBodyProvider } from './named-body.js';
import type { ResourceCapability } from './server.js';
export interface AssetManagerNamedBodyProviderOptions {
    namespace?: string;
    projectRouteName?: string;
}
/** Adapts the public Asset Manager resource capability without reading extension-private state. */
export declare function createAssetManagerNamedBodyProvider(resources: ResourceCapability, options?: AssetManagerNamedBodyProviderOptions): NamedBodyProvider;
