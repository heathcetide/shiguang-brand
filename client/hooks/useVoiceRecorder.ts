import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { useAuthFetch } from "@/contexts/AuthContext";
import { aiApi, waitForAgentRun } from "@/services/api";

// expo-av's native stop/unload APIs operate on a platform singleton, not an
// individual Recording. Keep ownership through cleanup, including across mounts.
let nativeRecorderQueue: Promise<void> = Promise.resolve();
async function acquireNativeRecorder() {
  const previous = nativeRecorderQueue;
  let release!: () => void;
  nativeRecorderQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  return release;
}

async function releaseNativeRecorder(recording: Audio.Recording | undefined, release: () => void) {
  try {
    if (recording) await recording.stopAndUnloadAsync();
  } finally {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    } finally {
      release();
    }
  }
}

type NativeRecording = { recording: Audio.Recording; stop: () => Promise<void> };

interface VoiceRecorderOptions {
  /** Discard recordings and pending transcription when the owning conversation changes. */
  scopeKey?: string;
  /** Whether the owning route is focused; refocusing never resumes capture. */
  focused?: boolean;
  /** Invalidate downstream voice work when capture ownership is lost. */
  onDiscard?: () => void;
  /** 识别中的临时文本，用于更新 UI。 */
  onSpeechResult?: (text: string) => void;
  /** 一轮录音完成后的最终文本。无论自动停顿或手动结束，都只触发一次。 */
  onSpeechFinal?: (text: string) => void;
  /** 本轮结束但未能识别出有效语音。 */
  onSpeechEmpty?: () => void;
}

export function useVoiceRecorder({ scopeKey, focused = true, onDiscard, onSpeechResult, onSpeechFinal, onSpeechEmpty }: VoiceRecorderOptions = {}) {
  const authFetch = useAuthFetch();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const mediaRecorderRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const submittedRef = useRef(false);
  const emptyNotifiedRef = useRef(false);
  const cleanupAudioRef = useRef<(() => void) | null>(null);
  const nativeRecordingRef = useRef<NativeRecording | null>(null);
  const disposed = useRef(false);
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey, focused]);
  const currentScope = useRef(scope);
  // A scope may return to the same key; each recording attempt must still expire.
  const generation = useRef(0);
  const pendingStart = useRef<number | null>(null);
  const isCurrent = useCallback(() => !disposed.current && currentScope.current === scope, [scope]);
  const onDiscardRef = useRef(onDiscard);
  useLayoutEffect(() => { onDiscardRef.current = onDiscard; }, [onDiscard]);
  const foreground = useRef(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const discardCapture = useCallback(() => {
    generation.current += 1;
    pendingStart.current = null;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      try { if (recorder.state !== "inactive") recorder.stop(); } catch {}
    }
    cleanupAudioRef.current?.(); cleanupAudioRef.current = null;
    const native = nativeRecordingRef.current; nativeRecordingRef.current = null;
    if (native) void native.stop().catch(() => undefined);
    onDiscardRef.current?.();
  }, []);
  const discardRecording = useCallback(() => {
    if (!isCurrent()) return;
    discardCapture();
    setIsRecording(false);
    setIsTranscribing(false);
    setStatusText("");
  }, [discardCapture, isCurrent]);
  useLayoutEffect(() => {
    currentScope.current = scope;
    disposed.current = false;
    setIsRecording(false);
    setIsTranscribing(false);
    setStatusText("");
    return () => {
      disposed.current = true;
      discardCapture();
    };
  }, [scope, discardCapture]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => {
      foreground.current = next === "active";
      if (!foreground.current) discardRecording();
    });
    const onHidden = () => { if (document.hidden) discardRecording(); };
    const onPageHide = () => { foreground.current = false; discardRecording(); };
    const onPageShow = () => { foreground.current = true; };
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onHidden);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
    }
    return () => {
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
    };
  }, [discardRecording]);

  const emitFinalTranscript = useCallback((text?: string) => {
    const transcript = (text ?? transcriptRef.current).trim();
    if (!isCurrent() || !transcript || submittedRef.current) return false;
    submittedRef.current = true;
    onSpeechFinal?.(transcript);
    return true;
  }, [isCurrent, onSpeechFinal]);

  const emitEmptySpeech = useCallback(() => {
    if (!isCurrent() || submittedRef.current || emptyNotifiedRef.current) return;
    emptyNotifiedRef.current = true;
    onSpeechEmpty?.();
  }, [isCurrent, onSpeechEmpty]);

  const transcribeNativeRecording = useCallback(async (native: NativeRecording, session: number) => {
    const isSessionCurrent = () => isCurrent() && generation.current === session;
    setIsTranscribing(true);
    setStatusText("正在识别语音...");
    try {
      await native.stop();
      if (!isSessionCurrent()) return;
      const uri = native.recording.getURI();
      if (!uri) throw new Error("录音文件不可用");
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
      if (!isSessionCurrent()) return;
      const response = await aiApi.transcribe<{
        text?: string;
        run: { id: string; status: string; transcript?: string; error?: { message?: string } };
      }>(authFetch, base64, "audio/m4a");
      if (!isSessionCurrent()) return;
      const run = await waitForAgentRun(authFetch, response.run);
      if (!isSessionCurrent()) return;
      const transcript = (response.text || run.transcript || "").trim();
      if (transcript) {
        transcriptRef.current = transcript;
        onSpeechResult?.(transcript);
      }
      if (!emitFinalTranscript(transcript)) emitEmptySpeech();
    } catch (error) {
      if (!isSessionCurrent()) return;
      console.error("[Native Transcribe Error]", error);
      emitEmptySpeech();
    } finally {
      if (isSessionCurrent()) {
        nativeRecordingRef.current = null;
        setIsTranscribing(false);
        setIsRecording(false);
        setStatusText("");
      }
    }
  }, [authFetch, emitEmptySpeech, emitFinalTranscript, isCurrent, onSpeechResult]);

  const stopRecording = useCallback(() => {
    if (!isCurrent()) return;
    if (pendingStart.current !== null) {
      generation.current += 1;
      pendingStart.current = null;
      setStatusText("");
    }
    if (nativeRecordingRef.current) {
      const recording = nativeRecordingRef.current;
      nativeRecordingRef.current = null;
      void transcribeNativeRecording(recording, generation.current);
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    cleanupAudioRef.current?.();
    cleanupAudioRef.current = null;
    setIsRecording(false);
  }, [isCurrent, transcribeNativeRecording]);

  const startRecording = useCallback(async () => {
    if (!isCurrent() || !focused || !foreground.current || (Platform.OS === "web" && typeof document !== "undefined" && document.hidden) || pendingStart.current !== null || nativeRecordingRef.current || mediaRecorderRef.current) return;
    const session = ++generation.current;
    pendingStart.current = session;
    const isSessionCurrent = () => isCurrent() && generation.current === session;
    setIsTranscribing(false);
    setStatusText("正在倾听，请说话...");
    setIsRecording(true);
    transcriptRef.current = "";
    submittedRef.current = false;
    emptyNotifiedRef.current = false;

    if (Platform.OS !== "web") {
      let release: (() => void) | undefined;
      let createdRecording: Audio.Recording | undefined;
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!isSessionCurrent()) return;
        if (!permission.granted) {
          pendingStart.current = null;
          setIsRecording(false);
          setStatusText("");
          Alert.alert(
            "需要麦克风权限",
            permission.canAskAgain
              ? "请允许食光烙记使用麦克风后再试。"
              : "麦克风权限已被关闭，请前往系统设置为食光烙记开启权限。",
            permission.canAskAgain
              ? [{ text: "知道了" }]
              : [{ text: "取消", style: "cancel" }, { text: "打开设置", onPress: () => void Linking.openSettings() }],
          );
          return;
        }
        release = await acquireNativeRecorder();
        if (!isSessionCurrent()) return;
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });
        if (!isSessionCurrent()) return;
        // createAsync starts a fire-and-forget unload when start fails. Own the
        // prepared object instead so every failure finishes cleanup under the lease.
        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync({ ...Audio.RecordingOptionsPresets.HIGH_QUALITY, keepAudioActiveHint: true });
        createdRecording = recording;
        if (!isSessionCurrent()) return;
        await recording.startAsync();
        if (!isSessionCurrent()) return;
        const releaseOwner = release;
        nativeRecordingRef.current = { recording, stop: () => releaseNativeRecorder(recording, releaseOwner) };
        release = undefined;
        pendingStart.current = null;
        return;
      } catch (error) {
        if (!isSessionCurrent()) return;
        pendingStart.current = null;
        console.error("[Native Recording Start Error]", error);
        setIsRecording(false);
        setStatusText("");
        Alert.alert("无法开始录音", "请检查麦克风权限或系统录音限制后重试。", [
          { text: "取消", style: "cancel" },
          { text: "打开设置", onPress: () => void Linking.openSettings() },
        ]);
        return;
      } finally {
        if (release) await releaseNativeRecorder(createdRecording, release).catch(() => undefined);
      }
    }

    // 所有转录统一通过后端 VoiceAgent，避免浏览器 ASR 绕开 Agent Run 与审计。
    if (
      Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      navigator.mediaDevices?.getUserMedia
    ) {
      let releaseStream: (() => void) | undefined;
      let recorder: MediaRecorder | undefined;
      let closeAudioContext: (() => void) | undefined;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isSessionCurrent()) { stream.getTracks().forEach(track => track.stop()); return; }
        releaseStream = () => stream.getTracks().forEach(track => track.stop());
        const mediaRecorder = new MediaRecorder(stream);
        recorder = mediaRecorder;
        const audioChunks: Blob[] = [];

        mediaRecorder.ondataavailable = (event) => {
          if (!isSessionCurrent()) return;
          if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
          if (!isSessionCurrent()) return;
          mediaRecorderRef.current = null;
          cleanupAudioRef.current?.();
          cleanupAudioRef.current = null;
          const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          setIsTranscribing(true);
          setStatusText("正在调用 ASR 大模型识别语音...");

          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            if (!isSessionCurrent()) return;
            const base64data = (reader.result as string) || "";
            try {
              const res = await aiApi.transcribe<{ text?: string; run: { id: string; status: string; transcript?: string; error?: { message?: string } } }>(authFetch, base64data, "audio/webm");
              if (!isSessionCurrent()) return;
              const run = await waitForAgentRun(authFetch, res.run);
              if (!isSessionCurrent()) return;
              const transcript = res.text || run.transcript || "";
              if (transcript && onSpeechResult) {
                transcriptRef.current = transcript;
                onSpeechResult(transcript);
              }
              if (!emitFinalTranscript(transcript)) emitEmptySpeech();
            } catch (err) {
              if (!isSessionCurrent()) return;
              console.error("[Transcribe Error]", err);
              emitEmptySpeech();
            } finally {
              if (isSessionCurrent()) {
                setIsTranscribing(false);
                setIsRecording(false);
                setStatusText("");
              }
            }
          };
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;

        // 没有 Web Speech API 时，用输入音量检测停顿：检测到说话后静默 1.2 秒自动提交。
        const audioContext = new AudioContext();
        closeAudioContext = () => { void audioContext.close(); };
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let animationFrame = 0;
        let heardVoice = false;
        let lastVoiceAt = Date.now();
        const watchSilence = () => {
          if (!isSessionCurrent()) return;
          analyser.getByteTimeDomainData(samples);
          const amplitude = samples.reduce((total, value) => total + Math.abs(value - 128), 0) / samples.length;
          if (amplitude > 3) {
            heardVoice = true;
            lastVoiceAt = Date.now();
          }
          if (heardVoice && Date.now() - lastVoiceAt >= 1200 && mediaRecorder.state !== "inactive") {
            setStatusText("检测到停顿，正在结束本轮...");
            mediaRecorder.stop();
            return;
          }
          animationFrame = requestAnimationFrame(watchSilence);
        };
        animationFrame = requestAnimationFrame(watchSilence);
        pendingStart.current = null;
        cleanupAudioRef.current = () => {
          cancelAnimationFrame(animationFrame);
          stream.getTracks().forEach((track) => track.stop());
          void audioContext.close();
        };
      } catch (err) {
        if (recorder) {
          recorder.onstop = null;
          if (recorder.state !== "inactive") recorder.stop();
        }
        releaseStream?.();
        closeAudioContext?.();
        if (!isSessionCurrent()) return;
        mediaRecorderRef.current = null;
        pendingStart.current = null;
        console.error("[getUserMedia Error]", err);
        alert("无法获取麦克风权限，请在浏览器地址栏允许麦克风权限");
        setIsRecording(false);
        setStatusText("");
      }
    } else {
      pendingStart.current = null;
      Alert.alert("暂不支持录音", "当前浏览器不支持麦克风录音，请改用文字输入。");
      setIsRecording(false);
      setStatusText("");
    }
  }, [authFetch, emitEmptySpeech, emitFinalTranscript, focused, isCurrent, onSpeechResult]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    isTranscribing,
    statusText,
    startRecording,
    stopRecording,
    discardRecording,
    toggleRecording,
  };
}
