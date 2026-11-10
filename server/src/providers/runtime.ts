import { ProviderOperationError, type ProviderOperationResult } from "./contracts.js";

type Operation<T> = {
  providerId: string;
  run: (signal: AbortSignal) => Promise<T>;
};

type ExecuteOptions<T> = Operation<T> & {
  timeoutMs?: number;
  fallback?: Operation<T>;
};

function timeoutError(providerId: string, timeoutMs: number) {
  return new ProviderOperationError(providerId, "timeout", `${providerId} timed out after ${timeoutMs} ms`, true);
}

async function runWithTimeout<T>(operation: Operation<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(timeoutError(operation.providerId, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof ProviderOperationError) throw error;
    throw new ProviderOperationError(operation.providerId, "unavailable", `${operation.providerId} operation failed`, true, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Provider calls fail with one shared error vocabulary. Only retryable failures
 * may use the explicitly supplied fallback; rejected input never degrades.
 */
export async function executeProviderOperation<T>(options: ExecuteOptions<T>): Promise<ProviderOperationResult<T>> {
  const timeoutMs = Math.max(100, options.timeoutMs ?? (Number(process.env.PROVIDER_TIMEOUT_MS) || 10_000));
  try {
    return { value: await runWithTimeout(options, timeoutMs), providerId: options.providerId, degraded: false };
  } catch (error) {
    if (!(error instanceof ProviderOperationError) || !error.retryable || !options.fallback) throw error;
    return {
      value: await runWithTimeout(options.fallback, timeoutMs),
      providerId: options.fallback.providerId,
      degraded: true,
    };
  }
}
