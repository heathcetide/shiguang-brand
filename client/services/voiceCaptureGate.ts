/** No recorder route/AEC verification exists yet. Use half-duplex, not RMS barge-in. */
export const nativeVoiceCaptureMode = "half-duplex" as const;

const pendingOutput = new Set<symbol>();
let quietAfter = 0;
const ECHO_TAIL_MS = 300;

/** Includes queued audio and synthesis, so gaps between chunks do not reopen capture. */
export function beginVoiceOutput(replace = false) {
  if (replace) pendingOutput.clear();
  const token = Symbol("voice-output");
  pendingOutput.add(token);
  return () => {
    if (!pendingOutput.delete(token)) return;
    if (!pendingOutput.size) quietAfter = Date.now() + ECHO_TAIL_MS;
  };
}

export function isVoiceOutputBlockingCapture() {
  return pendingOutput.size > 0 || Date.now() < quietAfter;
}
