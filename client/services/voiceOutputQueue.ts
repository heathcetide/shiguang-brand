export class KeyedSerialQueue<T> {
  private key: string | null = null;
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();

  enqueue(key: string, onBegin: () => Promise<void> | void, work: () => Promise<T>): Promise<T | null> {
    if (this.key !== key) {
      this.key = key;
      this.generation += 1;
      const generation = this.generation;
      this.tail = Promise.resolve().then(() => {
        if (this.key === key && this.generation === generation) return onBegin();
      });
    }
    const generation = this.generation;
    const task = this.tail.then(() => this.key === key && this.generation === generation ? work() : null);
    this.tail = task.catch(() => undefined);
    return task;
  }

  cancel() {
    this.key = null;
    this.generation += 1;
    this.tail = Promise.resolve();
  }
}
