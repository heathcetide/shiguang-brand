export type VersionedRealtimeVoiceSession = {
  id: string;
  version: number;
};

type SessionUpdaterOptions<T extends VersionedRealtimeVoiceSession> = {
  current: () => T | null;
  commit: (session: T) => void;
};

/** Serializes optimistic-version session writes and discards results after stop/restart. */
export class RealtimeVoiceSessionUpdater<T extends VersionedRealtimeVoiceSession> {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly current: SessionUpdaterOptions<T>["current"];
  private readonly commit: SessionUpdaterOptions<T>["commit"];

  constructor(options: SessionUpdaterOptions<T>) {
    this.current = options.current;
    this.commit = options.commit;
  }

  enqueue(operation: (session: T) => Promise<T>): Promise<T | null> {
    const generation = this.generation;
    const result = this.tail.then(async () => {
      if (generation !== this.generation) return null;
      const session = this.current();
      if (!session) return null;
      const updated = await operation(session);
      const active = this.current();
      if (generation !== this.generation || !active || active.id !== session.id) return null;
      this.commit(updated);
      return updated;
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  invalidate() {
    this.generation += 1;
  }
}

type HeartbeatDependencies<T extends VersionedRealtimeVoiceSession, TInput> = {
  heartbeat: (session: T, input: TInput) => Promise<T>;
  refresh: (sessionId: string) => Promise<T>;
  isVersionConflict: (error: unknown) => boolean;
};

export async function heartbeatWithVersionRecovery<T extends VersionedRealtimeVoiceSession, TInput>(
  session: T,
  input: TInput,
  dependencies: HeartbeatDependencies<T, TInput>,
) {
  try {
    return await dependencies.heartbeat(session, input);
  } catch (error) {
    if (!dependencies.isVersionConflict(error)) throw error;
    const refreshed = await dependencies.refresh(session.id);
    return dependencies.heartbeat(refreshed, input);
  }
}
