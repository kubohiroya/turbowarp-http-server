export class BinaryBodyLifetimeTracker {
    constructor(routeId, diagnostics) {
        this.routeId = routeId;
        this.diagnostics = diagnostics;
        this.scopes = [new Map()];
        this.retired = new Set();
    }
    enterScope() {
        this.scopes.push(new Map());
    }
    fork() {
        const tracker = new BinaryBodyLifetimeTracker(this.routeId, this.diagnostics);
        tracker.scopes.splice(0, tracker.scopes.length, ...this.scopes.map((scope) => new Map([...scope].map(([id, state]) => [
            id,
            state.sourceRef === undefined
                ? { consumed: state.consumed }
                : { consumed: state.consumed, sourceRef: state.sourceRef }
        ]))));
        for (const id of this.retired)
            tracker.retired.add(id);
        return tracker;
    }
    mergeBranches(left, right) {
        for (let scopeIndex = 0; scopeIndex < this.scopes.length; scopeIndex += 1) {
            const scope = this.scopes[scopeIndex];
            const leftScope = left.scopes[scopeIndex];
            const rightScope = right.scopes[scopeIndex];
            for (const [id, state] of scope) {
                state.consumed = leftScope.get(id)?.consumed === true || rightScope.get(id)?.consumed === true;
            }
            for (const [id, leftState] of leftScope) {
                if (scope.has(id))
                    continue;
                const rightState = rightScope.get(id);
                if (rightState !== undefined) {
                    scope.set(id, {
                        consumed: leftState.consumed || rightState.consumed,
                        ...(leftState.sourceRef === undefined ? {} : { sourceRef: leftState.sourceRef })
                    });
                }
            }
        }
    }
    absorbPossibleExecution(child, maximumExecutions = 1, sourceRef) {
        if (maximumExecutions < 1)
            return;
        for (let scopeIndex = 0; scopeIndex < this.scopes.length; scopeIndex += 1) {
            for (const [id, state] of this.scopes[scopeIndex]) {
                if (child.scopes[scopeIndex]?.get(id)?.consumed === true) {
                    if (!state.consumed && maximumExecutions > 1) {
                        this.report('TW2_BINARY_BODY_CONSUMED', `binary-body ${id} may be consumed more than once by a loop.`, 'An affine body declared outside a loop cannot be consumed by multiple iterations.', 'Acquire the body inside the loop or make the loop execute at most once.', sourceRef);
                    }
                    state.consumed = true;
                }
            }
        }
    }
    leaveScope() {
        if (this.scopes.length === 1)
            throw new Error('Cannot leave the root binary-body scope.');
        const scope = this.scopes.pop();
        for (const id of scope.keys())
            this.retired.add(id);
    }
    declare(id, sourceRef) {
        const current = this.scopes[this.scopes.length - 1];
        current.set(id, sourceRef === undefined ? { consumed: false } : { consumed: false, sourceRef });
    }
    consume(id, sourceRef) {
        const state = this.find(id);
        if (state === undefined) {
            const outOfScope = this.retired.has(id);
            this.report(outOfScope ? 'TW2_BINARY_BODY_SCOPE' : 'TW2_BINARY_BODY_UNDECLARED', outOfScope ? `binary-body ${id} is outside its lexical scope.` : `binary-body ${id} is not declared.`, outOfScope ? 'The resource-producing operation completed in a narrower lexical scope.' : 'No resource producer declares this binding.', 'Consume the body inside its declaring scope, or produce a new binary-body binding.', sourceRef);
            return false;
        }
        if (state.consumed) {
            this.report('TW2_BINARY_BODY_CONSUMED', `binary-body ${id} is consumed more than once.`, 'binary-body is affine and cannot be cloned, buffered, or reused by the MVP.', 'Acquire a new body for each put or response operation.', sourceRef ?? state.sourceRef);
            return false;
        }
        state.consumed = true;
        return true;
    }
    find(id) {
        for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
            const state = this.scopes[index].get(id);
            if (state !== undefined)
                return state;
        }
        return undefined;
    }
    report(code, message, reason, suggestion, sourceRef) {
        const diagnostic = {
            severity: 'error',
            phase: 'target-neutral',
            code,
            message,
            routeId: this.routeId,
            reason,
            suggestion
        };
        if (sourceRef !== undefined)
            diagnostic.sourceRef = sourceRef;
        this.diagnostics.push(diagnostic);
    }
}
//# sourceMappingURL=resource-lifetime.js.map