// A settings route can unmount while its HTTP response or native scheduling is
// pending. Keep one write-through-schedule operation per auth session, so a new
// instance cannot overtake it and then have its schedules replaced by old data.
const pendingSaves = new Map<string, Promise<void>>();
const sessionKey = (userId: number, generation: number) => `${userId}:${generation}`;

export function waitForNotificationSave(userId: number, generation: number) {
  return pendingSaves.get(sessionKey(userId, generation))?.catch(() => undefined);
}

export function startNotificationSave(userId: number, generation: number, save: () => Promise<void>) {
  const key = sessionKey(userId, generation);
  if (pendingSaves.has(key)) return null;
  const pending = Promise.resolve().then(save).finally(() => {
    if (pendingSaves.get(key) === pending) pendingSaves.delete(key);
  });
  pendingSaves.set(key, pending);
  return pending;
}
