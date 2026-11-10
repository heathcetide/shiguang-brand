import { KeyedSerialQueue } from "./voiceOutputQueue";

describe("KeyedSerialQueue", () => {
  it.each([false, true])("does not initialize cancelled output before replacement (same key: %s)", async (sameKey) => {
    const queue = new KeyedSerialQueue<string>();
    const staleBegin = jest.fn();
    const staleWork = jest.fn(async () => "stale");
    const stale = queue.enqueue("turn-a", staleBegin, staleWork);
    queue.cancel();
    const replacement = queue.enqueue(sameKey ? "turn-a" : "turn-b", () => undefined, async () => "current");
    await expect(stale).resolves.toBeNull();
    await expect(replacement).resolves.toBe("current");
    expect(staleBegin).not.toHaveBeenCalled();
    expect(staleWork).not.toHaveBeenCalled();
  });

  it("plays chunks from one response in order", async () => {
    const queue = new KeyedSerialQueue<string>();
    const calls: string[] = [];
    const first = queue.enqueue("turn-a", () => { calls.push("begin-a"); }, async () => { calls.push("a1"); return "a1"; });
    const second = queue.enqueue("turn-a", () => { calls.push("unexpected"); }, async () => { calls.push("a2"); return "a2"; });

    await expect(Promise.all([first, second])).resolves.toEqual(["a1", "a2"]);
    expect(calls).toEqual(["begin-a", "a1", "a2"]);
  });

  it("drops queued chunks from an interrupted response", async () => {
    const queue = new KeyedSerialQueue<string>();
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const calls: string[] = [];
    const first = queue.enqueue("turn-a", () => { calls.push("begin-a"); }, async () => {
      calls.push("a1");
      markStarted();
      await firstGate;
      return "a1";
    });
    const stale = queue.enqueue("turn-a", () => { calls.push("unexpected"); }, async () => { calls.push("stale-a2"); return "a2"; });
    await started;
    const replacement = queue.enqueue("turn-b", () => { calls.push("begin-b"); }, async () => { calls.push("b1"); return "b1"; });

    await expect(replacement).resolves.toBe("b1");
    releaseFirst();
    await expect(first).resolves.toBe("a1");
    await expect(stale).resolves.toBeNull();
    expect(calls).toEqual(["begin-a", "a1", "begin-b", "b1"]);
  });
});
