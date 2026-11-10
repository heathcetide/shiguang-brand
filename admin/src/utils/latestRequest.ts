export function createLatestRequest() {
  let activeController: AbortController | null = null;
  return {
    begin() {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      return {
        signal: controller.signal,
        isLatest: () => !controller.signal.aborted,
      };
    },
    cancel() {
      activeController?.abort();
      activeController = null;
    },
  };
}
