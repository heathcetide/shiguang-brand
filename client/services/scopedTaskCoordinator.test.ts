import { ScopedTaskCoordinator } from "./scopedTaskCoordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("ScopedTaskCoordinator", () => {
  it("cancels a task invalidated while its producer is still running", async () => {
    const coordinator = new ScopedTaskCoordinator();
    const ticket = coordinator.begin("user:101");

    await coordinator.invalidate("user:101", async () => undefined);

    await expect(coordinator.commit(ticket, async () => "write"))
      .resolves.toEqual({ status: "cancelled" });
  });

  it("serializes cleanup after an active write and exposes invalidation during the write", async () => {
    const coordinator = new ScopedTaskCoordinator();
    const ticket = coordinator.begin("user:101");
    const writeStarted = deferred();
    const releaseWrite = deferred();
    const events: string[] = [];

    const write = coordinator.commit(ticket, async () => {
      events.push("write:start");
      writeStarted.resolve();
      await releaseWrite.promise;
      events.push(coordinator.isCurrent(ticket) ? "write:current" : "write:stale");
    });
    await writeStarted.promise;
    const cleanup = coordinator.invalidate("user:101", async () => { events.push("cleanup"); });
    releaseWrite.resolve();

    await Promise.all([write, cleanup]);
    expect(events).toEqual(["write:start", "write:stale", "cleanup"]);
  });

  it("invalidates only the selected account while allowing a later session to write", async () => {
    const coordinator = new ScopedTaskCoordinator();
    const accountA = coordinator.begin("user:101");
    const accountB = coordinator.begin("user:202");

    await coordinator.invalidate("user:101", async () => undefined);
    const accountANextSession = coordinator.begin("user:101");

    await expect(coordinator.commit(accountA, async () => "old-a"))
      .resolves.toEqual({ status: "cancelled" });
    await expect(coordinator.commit(accountB, async () => "b"))
      .resolves.toEqual({ status: "committed", value: "b" });
    await expect(coordinator.commit(accountANextSession, async () => "new-a"))
      .resolves.toEqual({ status: "committed", value: "new-a" });
  });

  it("invalidates every account when the whole cache is cleared", async () => {
    const coordinator = new ScopedTaskCoordinator();
    const accountA = coordinator.begin("user:101");
    const accountB = coordinator.begin("user:202");

    await coordinator.invalidateAll(async () => undefined);

    await expect(coordinator.commit(accountA, async () => "a"))
      .resolves.toEqual({ status: "cancelled" });
    await expect(coordinator.commit(accountB, async () => "b"))
      .resolves.toEqual({ status: "cancelled" });
  });
});
