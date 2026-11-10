import { beginVoiceOutput, isVoiceOutputBlockingCapture, nativeVoiceCaptureMode } from "./voiceCaptureGate";

describe("native echo safety", () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { const finish = beginVoiceOutput(true); finish(); jest.advanceTimersByTime(301); jest.useRealTimers(); });

  it("does not claim AEC or headset detection from communication focus", () => {
    expect(nativeVoiceCaptureMode).toBe("half-duplex");
  });
  it("keeps queued output blocked until the last chunk and echo tail finish", () => {
    const first = beginVoiceOutput(true);
    const second = beginVoiceOutput();
    first();
    expect(isVoiceOutputBlockingCapture()).toBe(true);
    second();
    expect(isVoiceOutputBlockingCapture()).toBe(true);
    jest.advanceTimersByTime(301);
    expect(isVoiceOutputBlockingCapture()).toBe(false);
  });
  it("ignores old completion after replacement or stop", () => {
    const old = beginVoiceOutput(true);
    const current = beginVoiceOutput(true);
    old();
    jest.advanceTimersByTime(1000);
    expect(isVoiceOutputBlockingCapture()).toBe(true);
    current();
    jest.advanceTimersByTime(301);
    expect(isVoiceOutputBlockingCapture()).toBe(false);
  });
});
