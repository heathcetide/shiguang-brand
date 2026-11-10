const DEFAULT_EXTERNAL_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS) || DEFAULT_EXTERNAL_TIMEOUT_MS,
) {
  return fetch(input, {
    ...init,
    signal: init.signal || AbortSignal.timeout(Math.max(1_000, timeoutMs)),
  });
}
