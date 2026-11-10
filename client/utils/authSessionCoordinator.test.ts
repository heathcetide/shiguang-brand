import { AuthSessionCoordinator } from "./authSessionCoordinator";

describe("auth session mutation ordering", () => {
  it("discards a delayed profile response after a different account logs in", async () => {
    const coordinator = new AuthSessionCoordinator();
    let storedUser = "A";
    const generation = await coordinator.authenticate(async () => undefined);
    await coordinator.authenticate(async () => { storedUser = "B"; });

    await expect(coordinator.updateIfCurrent(generation, async () => {
      storedUser = "A updated";
    })).resolves.toBe(false);
    expect(storedUser).toBe("B");
  });

  it("finishes an ongoing profile write before clearing the session", async () => {
    const coordinator = new AuthSessionCoordinator();
    let storedUser: string | null = "A";
    const generation = await coordinator.authenticate(async () => undefined);
    let releaseWrite!: () => void;
    const storageWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
    const update = coordinator.updateIfCurrent(generation, async () => {
      await storageWrite;
      storedUser = "A updated";
    });
    const logout = coordinator.clearIfCurrent(generation, async () => { storedUser = null; });
    releaseWrite();
    await expect(update).resolves.toBe(true);
    await expect(logout).resolves.toBe(true);
    expect(storedUser).toBeNull();
    await expect(coordinator.updateIfCurrent(generation, async () => {
      storedUser = "A resurrected";
    })).resolves.toBe(false);
  });

  it("does not let stale logout cleanup delete a newer login", async () => {
    const coordinator = new AuthSessionCoordinator();
    let storedToken: string | null = null;
    const originalGeneration = await coordinator.authenticate(async () => {
      storedToken = "old-token";
    });
    let releaseCleanup!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => { releaseCleanup = resolve; });

    const staleLogout = (async () => {
      await cleanupStarted;
      return coordinator.clearIfCurrent(originalGeneration, async () => {
        storedToken = null;
      });
    })();
    await coordinator.authenticate(async () => {
      storedToken = "new-token";
    });
    releaseCleanup();

    await expect(staleLogout).resolves.toBe(false);
    expect(storedToken).toBe("new-token");
  });

  it("serializes a requested logout before a later login", async () => {
    const coordinator = new AuthSessionCoordinator();
    let storedToken: string | null = null;
    const generation = await coordinator.authenticate(async () => { storedToken = "old-token"; });
    const logout = coordinator.clearIfCurrent(generation, async () => { storedToken = null; });
    const login = coordinator.authenticate(async () => { storedToken = "new-token"; });

    await Promise.all([logout, login]);
    expect(storedToken).toBe("new-token");
  });
});
