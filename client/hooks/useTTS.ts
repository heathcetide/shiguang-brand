import { useState, useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Speech from "expo-speech";

/** System TTS only: browser SpeechSynthesis on Web, expo-speech on native. */
export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const ttsStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStartTimer = useCallback(() => {
    if (ttsStartTimerRef.current !== null) clearTimeout(ttsStartTimerRef.current);
    ttsStartTimerRef.current = null;
  }, []);

  const cancelOutput = useCallback(() => {
    // Invalidate callbacks before cancellation, which may invoke them synchronously.
    generationRef.current += 1;
    clearStartTimer();
    try {
      if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch { /* Cancellation must not prevent the other engine from stopping. */ }
    try {
      void Promise.resolve(Speech.stop()).catch(() => undefined);
    } catch { /* Ignore platform stop failures. */ }
  }, [clearStartTimer]);

  const stop = useCallback(() => {
    cancelOutput();
    if (mountedRef.current) setIsSpeaking(false);
  }, [cancelOutput]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelOutput();
    };
  }, [cancelOutput]);

  const speak = useCallback((text: string) => {
    const reply = text.trim();
    if (!reply || !mountedRef.current) return;
    cancelOutput();
    const generation = generationRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current;
    let finished = false;
    const finish = (message = "") => {
      if (!isCurrent() || finished) return;
      finished = true;
      clearStartTimer();
      if (message) setError(message);
      setIsSpeaking(false);
    };
    setError("");
    setIsSpeaking(true);

    const webError = "自动朗读未能启动。请点击「重播回答」手动播放，并检查标签页和系统媒体音量。";
    const nativeError = "语音播放未启动，请点「重播回答」或检查设备媒体音量。";
    const useBrowser = Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window;
    try {
      if (useBrowser) {
        const utterance = new SpeechSynthesisUtterance(reply);
        const chineseVoice = window.speechSynthesis.getVoices().find((voice) => /^zh(?:-|_)/i.test(voice.lang));
        utterance.lang = chineseVoice?.lang || "zh-CN";
        utterance.voice = chineseVoice || null;
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onstart = () => {
          if (isCurrent() && !finished) clearStartTimer();
        };
        utterance.onend = () => finish();
        utterance.onerror = (event) => finish(
          event.error === "canceled" || event.error === "interrupted" ? "" : webError,
        );
        // Register before speak: some engines fire callbacks synchronously.
        ttsStartTimerRef.current = setTimeout(() => {
          if (!isCurrent() || finished) return;
          ttsStartTimerRef.current = null;
          if (!window.speechSynthesis.speaking) finish(webError);
        }, 1500);
        window.speechSynthesis.speak(utterance);
        return;
      }
      Speech.speak(reply, {
        language: "zh-CN", rate: 1.0, pitch: 1.0,
        onDone: () => finish(),
        onStopped: () => finish(),
        onError: () => finish(nativeError),
      });
    } catch {
      finish(useBrowser ? webError : nativeError);
    }
  }, [cancelOutput, clearStartTimer]);

  return { speak, stop, isSpeaking, error } as const;
}
