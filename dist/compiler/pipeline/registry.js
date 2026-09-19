export class PlatformAdapterRegistry {
    constructor() {
        this.adapters = new Map();
    }
    register(adapter) {
        if (this.adapters.has(adapter.id))
            throw new Error(`Duplicate platform adapter: ${adapter.id}`);
        this.adapters.set(adapter.id, adapter);
    }
    resolve(id) {
        return this.adapters.get(id);
    }
    ids() {
        return [...this.adapters.keys()].sort();
    }
}
//# sourceMappingURL=registry.js.map