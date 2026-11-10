export class InterventionReadTimeout extends Error {
  constructor() { super("Intervention account snapshot timed out"); }
}
/** Bounds read-only work. Late results are discarded; this does not cancel an already executing database query. */
export async function withInterventionReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>,parent: AbortSignal,timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>30_000) throw new Error("Invalid intervention read deadline");
  parent.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(parent.reason);
  const timer = setTimeout(() => controller.abort(new InterventionReadTimeout()),timeoutMs);
  parent.addEventListener("abort",cancel,{ once: true });
  let rejectRead: () => void = () => {};
  try {
    const interrupted = new Promise<never>((_resolve,reject) => {
      rejectRead = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort",rejectRead,{ once: true });
    });
    return await Promise.race([read(controller.signal),interrupted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort",cancel);
    controller.signal.removeEventListener("abort",rejectRead);
  }
}
