import type {PlatformAdapter} from './types.js';

export class PlatformAdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>();

  public register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error(`Duplicate platform adapter: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  public resolve(id: string): PlatformAdapter | undefined {
    return this.adapters.get(id);
  }

  public ids(): string[] {
    return [...this.adapters.keys()].sort();
  }
}
