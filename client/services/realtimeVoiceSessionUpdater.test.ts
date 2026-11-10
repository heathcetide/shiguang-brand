import {
  heartbeatWithVersionRecovery,
  RealtimeVoiceSessionUpdater,
  type VersionedRealtimeVoiceSession,
} from "./realtimeVoiceSessionUpdater";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("RealtimeVoiceSessionUpdater", () => {
  it("serializes updates and gives the next write the latest version", async () => {
    let current: VersionedRealtimeVoiceSession | null = { id: "session-1", version: 1 };
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const versions: number[] = [];
    const updater = new RealtimeVoiceSessionUpdater({
      current: () => current,
      commit: (session) => { current = session; },
    });

    const first = updater.enqueue(async (session) => {
      versions.push(session.version);
      firstStarted.resolve();
      await releaseFirst.promise;
      return { ...session, version: session.version + 1 };
    });
    await firstStarted.promise;
    const second = updater.enqueue(async (session) => {
      versions.push(session.version);
      return { ...session, version: session.version + 1 };
    });
    releaseFirst.resolve();

    await expect(first).resolves.toMatchObject({ version: 2 });
    await expect(second).resolves.toMatchObject({ version: 3 });
    expect(versions).toEqual([1, 2]);
  });

  it("does not commit an in-flight result after the session is invalidated", async () => {
    let current: VersionedRealtimeVoiceSession | null = { id: "session-1", version: 1 };
    const release = deferred<void>();
    const updater = new RealtimeVoiceSessionUpdater({
      current: () => current,
      commit: (session) => { current = session; },
    });
    const update = updater.enqueue(async (session) => {
      await release.promise;
      return { ...session, version: 2 };
    });

    updater.invalidate();
    current = null;
    release.resolve();

    await expect(update).resolves.toBeNull();
    expect(current).toBeNull();
  });

  it("refreshes once and retries after a version conflict", async () => {
    const attempts: number[] = [];
    const updated = await heartbeatWithVersionRecovery(
      { id: "session-1", version: 1 },
      { muted: true },
      {
        heartbeat: async (session) => {
          attempts.push(session.version);
          if (session.version === 1) throw { code: "REALTIME_VOICE_VERSION_CONFLICT" };
          return { ...session, version: session.version + 1 };
        },
        refresh: async () => ({ id: "session-1", version: 4 }),
        isVersionConflict: (error) => (error as { code?: string }).code === "REALTIME_VOICE_VERSION_CONFLICT",
      },
    );

    expect(attempts).toEqual([1, 4]);
    expect(updated.version).toBe(5);
  });
});
