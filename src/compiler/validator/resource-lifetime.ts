import type {SourceRefV2} from '../ir-v2/types.js';
import type {ServerSubsetDiagnosticCode, TargetNeutralDiagnostic} from './types.js';

interface ResourceState {
  consumed: boolean;
  sourceRef?: SourceRefV2;
}

export class BinaryBodyLifetimeTracker {
  private readonly scopes: Array<Map<string, ResourceState>> = [new Map()];
  private readonly retired = new Set<string>();

  public constructor(
    private readonly routeId: string,
    private readonly diagnostics: TargetNeutralDiagnostic[]
  ) {}

  public enterScope(): void {
    this.scopes.push(new Map());
  }

  public leaveScope(): void {
    if (this.scopes.length === 1) throw new Error('Cannot leave the root binary-body scope.');
    const scope = this.scopes.pop()!;
    for (const id of scope.keys()) this.retired.add(id);
  }

  public declare(id: string, sourceRef?: SourceRefV2): void {
    const current = this.scopes[this.scopes.length - 1]!;
    current.set(id, sourceRef === undefined ? {consumed: false} : {consumed: false, sourceRef});
  }

  public consume(id: string, sourceRef?: SourceRefV2): boolean {
    const state = this.find(id);
    if (state === undefined) {
      const outOfScope = this.retired.has(id);
      this.report(
        outOfScope ? 'TW2_BINARY_BODY_SCOPE' : 'TW2_BINARY_BODY_UNDECLARED',
        outOfScope ? `binary-body ${id} is outside its lexical scope.` : `binary-body ${id} is not declared.`,
        outOfScope ? 'The resource-producing operation completed in a narrower lexical scope.' : 'No resource producer declares this binding.',
        'Consume the body inside its declaring scope, or produce a new binary-body binding.',
        sourceRef
      );
      return false;
    }
    if (state.consumed) {
      this.report(
        'TW2_BINARY_BODY_CONSUMED',
        `binary-body ${id} is consumed more than once.`,
        'binary-body is affine and cannot be cloned, buffered, or reused by the MVP.',
        'Acquire a new body for each put or response operation.',
        sourceRef ?? state.sourceRef
      );
      return false;
    }
    state.consumed = true;
    return true;
  }

  private find(id: string): ResourceState | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const state = this.scopes[index]!.get(id);
      if (state !== undefined) return state;
    }
    return undefined;
  }

  private report(
    code: Extract<ServerSubsetDiagnosticCode, `TW2_BINARY_${string}`>,
    message: string,
    reason: string,
    suggestion: string,
    sourceRef?: SourceRefV2
  ): void {
    const diagnostic: TargetNeutralDiagnostic = {
      severity: 'error',
      phase: 'target-neutral',
      code,
      message,
      routeId: this.routeId,
      reason,
      suggestion
    };
    if (sourceRef !== undefined) diagnostic.sourceRef = sourceRef;
    this.diagnostics.push(diagnostic);
  }
}
