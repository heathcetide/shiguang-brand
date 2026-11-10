export class AuthSessionCoordinator {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();

  currentGeneration() {
    return this.generation;
  }

  authenticate(writeSession: () => Promise<void>) {
    return this.enqueue(async () => {
      await writeSession();
      this.generation += 1;
      return this.generation;
    });
  }

  clearIfCurrent(expectedGeneration: number, clearSession: () => Promise<void>) {
    return this.enqueue(async () => {
      if (this.generation !== expectedGeneration) return false;
      await clearSession();
      this.generation += 1;
      return true;
    });
  }

  updateIfCurrent(expectedGeneration: number, writeSession: () => Promise<void>) {
    return this.enqueue(async () => {
      if (this.generation !== expectedGeneration) return false;
      await writeSession();
      return true;
    });
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}
