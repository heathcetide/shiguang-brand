import React from "react";
import renderer, { act } from "react-test-renderer";
import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { useTTS } from "./useTTS";

jest.mock("expo-speech", () => ({ speak: jest.fn(), stop: jest.fn() }));

describe("useTTS playback ownership", () => {
  let hook: ReturnType<typeof useTTS>;
  let tree: renderer.ReactTestRenderer | null;
  let utterances: SpeechSynthesisUtterance[];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalUtterance = Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance");
  const browser = { cancel: jest.fn(), getVoices: jest.fn(() => []), speak: jest.fn(), speaking: false };
  function Test() {
    const value = useTTS();
    React.useLayoutEffect(() => { hook = value; });
    return null;
  }
  function mount() { act(() => { tree = renderer.create(<Test />); }); }
  function speak(text = "你好") { act(() => hook.speak(text)); }
  function nativeOptions(index = 0) { return (Speech.speak as jest.Mock).mock.calls[index][1]; }

  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks();
    Platform.OS = "web"; utterances = []; tree = null; browser.speaking = false;
    (Speech.stop as jest.Mock).mockResolvedValue(undefined);
    browser.speak.mockImplementation((value) => { utterances.push(value); });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { speechSynthesis: browser } });
    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: class { constructor(public text: string) {} } });
  });
  afterEach(() => {
    if (tree) act(() => tree!.unmount());
    jest.useRealTimers();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalUtterance) Object.defineProperty(globalThis, "SpeechSynthesisUtterance", originalUtterance);
    else Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
  });
  const fire = (utterance: SpeechSynthesisUtterance, event: "onend" | "onstart" | "onerror", error = "failed") => {
    act(() => { (utterance[event] as ((event: unknown) => void) | null)?.({ error }); });
  };

  it("ignores old Web callbacks without clearing the new start watchdog", () => {
    mount(); speak("旧回答"); speak("新回答");
    fire(utterances[0], "onend"); fire(utterances[0], "onerror"); fire(utterances[0], "onstart");
    expect(hook.isSpeaking).toBe(true); expect(hook.error).toBe("");
    act(() => jest.advanceTimersByTime(1500));
    expect(hook.isSpeaking).toBe(false); expect(hook.error).not.toBe("");
  });
  it("does not report a start failure after a short synchronous Web utterance", () => {
    browser.speak.mockImplementation((value) => { value.onstart(); value.onend(); });
    mount(); speak(); act(() => jest.advanceTimersByTime(1500));
    expect(hook.isSpeaking).toBe(false); expect(hook.error).toBe("");
    expect(jest.getTimerCount()).toBe(0);
  });
  it("invalidates callbacks and timers on explicit stop", () => {
    mount(); speak(); act(() => hook.stop()); fire(utterances[0], "onerror");
    act(() => jest.advanceTimersByTime(1500));
    expect(hook.isSpeaking).toBe(false); expect(hook.error).toBe("");
    expect(jest.getTimerCount()).toBe(0);
  });
  it("cancels on unmount and prevents retained speak from restarting output", () => {
    mount(); speak(); const previous = hook;
    act(() => tree!.unmount()); tree = null;
    fire(utterances[0], "onerror"); act(() => previous.speak("过期回答"));
    expect(browser.speak).toHaveBeenCalledTimes(1); expect(browser.cancel).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });
  it("handles synchronous browser start failure", () => {
    browser.speak.mockImplementation(() => { throw new Error("unavailable"); });
    mount(); speak(); expect(hook.isSpeaking).toBe(false); expect(hook.error).not.toBe("");
    expect(jest.getTimerCount()).toBe(0);
  });
  it("ignores stale native completion and errors while allowing current completion", () => {
    Platform.OS = "ios"; mount(); speak("旧回答"); speak("新回答");
    act(() => { nativeOptions().onDone(); nativeOptions().onStopped(); nativeOptions().onError(); });
    expect(hook.isSpeaking).toBe(true); expect(hook.error).toBe("");
    act(() => nativeOptions(1).onDone()); expect(hook.isSpeaking).toBe(false);
  });
  it("handles native start failure and rejected stop without an unhandled rejection", async () => {
    Platform.OS = "ios";
    (Speech.stop as jest.Mock).mockRejectedValue(new Error("stop unavailable"));
    (Speech.speak as jest.Mock).mockImplementationOnce(() => { throw new Error("start unavailable"); });
    mount(); await act(async () => hook.speak("你好"));
    expect(hook.isSpeaking).toBe(false); expect(hook.error).not.toBe("");
  });
});
