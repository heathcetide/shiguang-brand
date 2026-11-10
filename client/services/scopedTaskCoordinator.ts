export type ScopedTaskTicket = {
  scope: string;
  scopeGeneration: number;
  globalGeneration: number;
};

export type ScopedTaskResult<T> =
  | { status: "committed"; value: T }
  | { status: "cancelled" };

export class ScopedTaskCoordinator {
  private globalGeneration = 0;
  private readonly scopeGenerations = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();

  begin(scope: string): ScopedTaskTicket {
    return {
      scope,
      scopeGeneration: this.scopeGenerations.get(scope) || 0,
      globalGeneration: this.globalGeneration,
    };
  }

  isCurrent(ticket: ScopedTaskTicket) {
    return ticket.globalGeneration === this.globalGeneration
      && ticket.scopeGeneration === (this.scopeGenerations.get(ticket.scope) || 0);
  }

  commit<T>(ticket: ScopedTaskTicket, operation: () => Promise<T>): Promise<ScopedTaskResult<T>> {
    return this.enqueue(async () => {
      if (!this.isCurrent(ticket)) return { status: "cancelled" } as const;
      return { status: "committed", value: await operation() } as const;
    });
  }

  invalidate<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    this.scopeGenerations.set(scope, (this.scopeGenerations.get(scope) || 0) + 1);
    return this.enqueue(operation);
  }

  invalidateAll<T>(operation: () => Promise<T>): Promise<T> {
    this.globalGeneration += 1;
    return this.enqueue(operation);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
