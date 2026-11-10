import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Network from "expo-network";
import * as Crypto from "expo-crypto";
import { Audio } from "expo-av";
import { useAudioRecorder, type AudioDataEvent, type AudioAnalysis } from "@siteed/audio-studio";
import { Base64 } from "js-base64";

import { useAuthFetch } from "@/contexts/AuthContext";
import { ApiError, ApiTransportError, aiApi, realtimeVoiceApi, waitForAgentRun, type RealtimeVoiceSession } from "@/services/api";
import { heartbeatWithVersionRecovery, RealtimeVoiceSessionUpdater } from "@/services/realtimeVoiceSessionUpdater";

import { isVoiceOutputBlockingCapture } from "@/services/voiceCaptureGate";

type Options = {
  focused?: boolean;
  scopeKey?: string;
  recipeId: number;
  currentStep: number;
  timerSeconds: number;
  timerRunning: boolean;
  recipeSteps: string[];
  recipeIngredients: string[];
  onTranscript: (text: string, final: boolean) => void;
  onBargeIn: () => void;
  onStopOutput: () => void;
  onControl: (action: string, seconds: number) => void;
  onAnswerDelta: (text: string, delta: string, turnId: string) => void;
  onAnswer: (text: string, streamed: boolean, turnId: string) => void;
  onConfirmationRequired: (message: string) => void;
  onError: (message: string) => void;
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onspeechstart: (() => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionConstructor() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
}

function pcm16WavBase64(chunks: string[], sampleRate = 16_000) {
  const parts = chunks.map((chunk) => Base64.toUint8Array(chunk));
  const pcmLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(44 + pcmLength);
  const view = new DataView(output.buffer);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + pcmLength, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, pcmLength, true);
  let offset = 44;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return Base64.fromUint8Array(output);
}

// audio-studio's controls target a platform singleton. A lease must outlive
// pending start/resume operations, including when the owning hook unmounts.
let audioStudioQueue: Promise<void> = Promise.resolve();
async function acquireAudioStudio(stopHardware: () => Promise<unknown>) {
  const previous = audioStudioQueue;
  let release!: () => void;
  audioStudioQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  let operations: Promise<unknown> = Promise.resolve();
  let stopping: Promise<void> | undefined;
  let touched = false;
  return {
    run(operation: () => Promise<unknown>) {
      if (stopping) return Promise.resolve();
      const result = operations.then(async () => {
        if (stopping) return;
        touched = true;
        await operation();
      });
      operations = result.catch(() => undefined);
      return result;
    },
    stop() {
      if (!stopping) stopping = operations.then(async () => {
        try { if (touched) await stopHardware(); }
        finally { release(); }
      });
      return stopping;
    },
  };
}
type AudioStudioLease = Awaited<ReturnType<typeof acquireAudioStudio>>;

export function useRealtimeCookingVoice(options: Options) {
  const authFetch = useAuthFetch();
  const {
    startRecording: startNativeRecording,
    stopRecording: stopNativeRecording,
    pauseRecording: pauseNativeRecording,
    resumeRecording: resumeNativeRecording,
  } = useAudioRecorder();
  const ownership = useMemo(() => ({ scopeKey: options.scopeKey, focused: options.focused }), [options.scopeKey, options.focused]);
  const ownerRef = useRef(ownership);
  const mountedRef = useRef(false);
  const optionsRef = useRef(options);
  const foregroundRef = useRef(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const nativeLeaseRef = useRef<AudioStudioLease | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const activeRef = useRef(false);
  const lifecycleRef = useRef(0);
  const startingRef = useRef(false);
  const stoppingRef = useRef(0);
  const responseGeneration = useRef(0);
  const interruptedRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeChunksRef = useRef<string[]>([]);
  const nativePreRollRef = useRef<string[]>([]);
  const nativeSpeakingRef = useRef(false);
  const nativeSpeechStartedAtRef = useRef(0);
  const nativeSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeTranscribingRef = useRef<symbol | null>(null);
  const nativeTurnIdRef = useRef("");
  const nativeSequenceRef = useRef(0);
  const nativePartialSentLengthRef = useRef(0);
  const nativePartialInFlightRef = useRef<symbol | null>(null);
  const mutedRef = useRef(false);
  const muteTransitionRef = useRef(false);
  const [session, setSession] = useState<RealtimeVoiceSession | null>(null);
  const [state, setState] = useState<"off" | "connecting" | "listening" | "processing" | "reconnecting" | "muted" | "fallback">("off");
  const stateRef = useRef(state);
  const supported = Boolean(recognitionConstructor()) || Platform.OS === "android" || Platform.OS === "ios";
  const sessionUpdaterRef = useRef<RealtimeVoiceSessionUpdater<RealtimeVoiceSession> | null>(null);
  if (!sessionUpdaterRef.current) {
    sessionUpdaterRef.current = new RealtimeVoiceSessionUpdater({
      current: () => sessionRef.current,
      commit: (updated) => { sessionRef.current = updated; setSession(updated); },
    });
  }

  useLayoutEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const stop = useCallback(async () => {
    if (stoppingRef.current || (!activeRef.current && !startingRef.current && !sessionRef.current)) return;
    stoppingRef.current += 1;
    const stopOwner = ownerRef.current;
    try {
      lifecycleRef.current += 1;
      const current = sessionRef.current;
      sessionRef.current = null;
      setSession(null);
      setState("off");
      activeRef.current = false;
      mutedRef.current = false;
      interruptedRef.current = false;
      optionsRef.current.onStopOutput();
      responseGeneration.current += 1;
      sessionUpdaterRef.current!.invalidate();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      try { recognitionRef.current?.abort(); } catch {}
      recognitionRef.current = null;
      if (nativeSilenceTimerRef.current) clearTimeout(nativeSilenceTimerRef.current);
      nativeSilenceTimerRef.current = null;
      nativeSpeakingRef.current = false;
      nativeChunksRef.current = [];
      nativePreRollRef.current = [];
      nativeTurnIdRef.current = "";
      nativeSequenceRef.current = 0;
      nativePartialSentLengthRef.current = 0;
      nativePartialInFlightRef.current = null;
      nativeTranscribingRef.current = null;
      const nativeLease = nativeLeaseRef.current;
      nativeLeaseRef.current = null;
      if (nativeLease) await nativeLease.stop().catch(() => {
        if (!mountedRef.current || ownerRef.current !== stopOwner) return;
        optionsRef.current.onError("无法确认麦克风已关闭，请退出语音页面并检查系统麦克风指示灯");
      });
      if (current) void realtimeVoiceApi.close(authFetch, current.id).catch(() => undefined);
    } finally { stoppingRef.current -= 1; }
  }, [authFetch]);

  const interruptConnection = useCallback((message = "网络连接中断，已停止持续监听，请联网后手动开启") => {
    if (!activeRef.current && !startingRef.current) return;
    void stop(); // Local invalidation and recorder stop happen before any close request.
    setState("fallback");
    optionsRef.current.onError(message);
  }, [stop]);

  const handleConnectionError = useCallback((error: unknown) => {
    if (error instanceof ApiTransportError) {
      interruptConnection();
      return true;
    }
    if (error instanceof ApiError && [401, 403, 404, 410].includes(error.status)) {
      interruptConnection("实时语音会话已失效，已停止持续监听，请重新开启");
      return true;
    }
    return false;
  }, [interruptConnection]);

  const pollAnswer = useCallback(async (sessionId: string, turnId: string, generation: number) => {
    let after = 0;
    let combined = "";
    let receivedDelta = false;
    const deadline = Date.now() + 120_000;
    while (activeRef.current && responseGeneration.current === generation && Date.now() < deadline) {
      const page = await realtimeVoiceApi.events(authFetch, sessionId, after);
      if (!activeRef.current || mutedRef.current || responseGeneration.current !== generation) return;
      for (const event of page.events) {
        after = Math.max(after, event.sequence);
        if (event.payload.turnId !== turnId) continue;
        if (event.type === "response.text.delta") {
          const delta = String(event.payload.delta || "");
          combined += delta;
          receivedDelta = true;
          optionsRef.current.onAnswerDelta(combined, delta, turnId);
        }
        if (event.type === "response.completed") {
          const answer = String(event.payload.text || combined);
          optionsRef.current.onAnswer(answer, receivedDelta, turnId);
          setState("listening");
          return;
        }
        if (event.type === "response.failed") throw new Error("实时回答失败");
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }, [authFetch]);

  const submitTurn = useCallback(async (transcript: string) => {
    const currentSession = sessionRef.current;
    if (!currentSession || !activeRef.current || mutedRef.current) return;
    setState("processing");
    const generation = responseGeneration.current + 1;
    responseGeneration.current = generation;
    try {
      const result = await realtimeVoiceApi.turn(authFetch, currentSession.id, {
        turnId: Crypto.randomUUID(), transcript,
        currentStep: optionsRef.current.currentStep,
        timerSeconds: optionsRef.current.timerSeconds,
        timerRunning: optionsRef.current.timerRunning,
        interruptedResponse: interruptedRef.current,
      });
      if (!activeRef.current || mutedRef.current || responseGeneration.current !== generation) return;
      interruptedRef.current = false;
      if (result.intent === "control") {
        optionsRef.current.onControl(String(result.action?.action || ""), Number(result.action?.seconds || 0));
        setState("listening");
      } else if (result.intent === "confirmation_required") {
        optionsRef.current.onConfirmationRequired(String(result.action?.message || "该操作需要在屏幕上确认"));
        setState("listening");
      } else {
        await pollAnswer(currentSession.id, result.turnId, generation);
      }
    } catch (error) {
      if (!activeRef.current || mutedRef.current || responseGeneration.current !== generation) return;
      if (handleConnectionError(error)) return;
      optionsRef.current.onError(error instanceof Error ? error.message : "实时语音处理失败");
      if (activeRef.current && !mutedRef.current) setState("listening");
    }
  }, [authFetch, handleConnectionError, pollAnswer]);

  // Communication audio focus is not proof of AEC or an isolated headset route.
  // Until a recorder exposes verified echo isolation, native input is half-duplex.
  const nativeCaptureBlocked = useCallback(() => {
    if (stateRef.current !== "processing" && !isVoiceOutputBlockingCapture()) return false;
    if (nativeSilenceTimerRef.current) clearTimeout(nativeSilenceTimerRef.current);
    nativeSilenceTimerRef.current = null;
    nativeSpeakingRef.current = false;
    nativeChunksRef.current = [];
    nativePreRollRef.current = [];
    nativeTurnIdRef.current = "";
    nativePartialSentLengthRef.current = 0;
    nativePartialInFlightRef.current = null;
    return true;
  }, []);

  const flushNativeUtterance = useCallback(async () => {
    if (nativeCaptureBlocked()) return;
    if (nativeTranscribingRef.current || !nativeChunksRef.current.length) return;
    const chunks = nativeChunksRef.current.splice(0);
    const turnId = nativeTurnIdRef.current || Crypto.randomUUID();
    const sequence = nativeSequenceRef.current + 1;
    const currentSession = sessionRef.current;
    nativeTurnIdRef.current = "";
    nativeSequenceRef.current = sequence;
    nativeSpeakingRef.current = false;
    if (!currentSession || !activeRef.current || mutedRef.current || Date.now() - nativeSpeechStartedAtRef.current < 250 || chunks.length < 2) return;
    const transcription = Symbol("native-transcription");
    const generation = responseGeneration.current;
    const lifecycle = lifecycleRef.current;
    const isCurrent = () => lifecycleRef.current === lifecycle && responseGeneration.current === generation
      && activeRef.current && !mutedRef.current;
    nativeTranscribingRef.current = transcription;
    setState("processing");
    try {
      let transcript = "";
      try {
        const partial = await realtimeVoiceApi.audioChunk(authFetch, currentSession.id, {
          turnId, sequence, audioBase64: pcm16WavBase64(chunks), mimeType: "audio/wav", final: true,
        });
        transcript = partial.transcript.trim();
      } catch (error) {
        if (!isCurrent() || handleConnectionError(error)) return;
        const result = await aiApi.transcribe<{
          transcript?: string;
          text?: string;
          run: { id: string; status: string; transcript?: string; error?: { message?: string } };
        }>(authFetch, pcm16WavBase64(chunks), "audio/wav");
        if (!isCurrent()) return;
        const completed = await waitForAgentRun(authFetch, result.run);
        transcript = String(result.transcript || result.text || completed.transcript || "").trim();
      }
      if (!isCurrent()) return;
      if (!transcript) throw new Error("没有识别到清晰语音");
      if (!activeRef.current || mutedRef.current || sessionRef.current?.id !== currentSession.id) return;
      optionsRef.current.onTranscript(transcript, true);
      await submitTurn(transcript);
    } catch (error) {
      if (!isCurrent()) return;
      if (handleConnectionError(error)) return;
      optionsRef.current.onError(error instanceof Error ? error.message : "连续语音转写失败");
      if (activeRef.current && !mutedRef.current) setState("listening");
    } finally {
      if (nativeTranscribingRef.current === transcription) nativeTranscribingRef.current = null;
    }
  }, [authFetch, handleConnectionError, nativeCaptureBlocked, submitTurn]);

  const handleNativeAudio = useCallback(async (event: AudioDataEvent) => {
    if (!activeRef.current || mutedRef.current || nativeCaptureBlocked() || typeof event.data !== "string") return;
    nativePreRollRef.current.push(event.data);
    nativePreRollRef.current = nativePreRollRef.current.slice(-3);
    if (nativeSpeakingRef.current) {
      nativeChunksRef.current.push(event.data);
      const shouldSendPartial = nativeChunksRef.current.length - nativePartialSentLengthRef.current >= 10;
      const currentSession = sessionRef.current;
      if (shouldSendPartial && currentSession && !nativePartialInFlightRef.current && nativeTurnIdRef.current) {
        const chunks = [...nativeChunksRef.current];
        const lifecycle = lifecycleRef.current;
        const generation = responseGeneration.current;
        const turnId = nativeTurnIdRef.current;
        const sequence = nativeSequenceRef.current + 1;
        nativeSequenceRef.current = sequence;
        nativePartialSentLengthRef.current = chunks.length;
        const partialRequest = Symbol("native-partial");
        nativePartialInFlightRef.current = partialRequest;
        void realtimeVoiceApi.audioChunk(authFetch, currentSession.id, {
          turnId, sequence, audioBase64: pcm16WavBase64(chunks), mimeType: "audio/wav", final: false,
        }).then((result) => {
          if (lifecycleRef.current === lifecycle && responseGeneration.current === generation
            && activeRef.current && !mutedRef.current && !nativeCaptureBlocked()
            && turnId === nativeTurnIdRef.current && result.transcript.trim()) {
            optionsRef.current.onTranscript(result.transcript.trim(), false);
          }
        }).catch((error) => {
          if (lifecycleRef.current === lifecycle && responseGeneration.current === generation && activeRef.current) {
            handleConnectionError(error);
          }
        }).finally(() => {
          if (nativePartialInFlightRef.current === partialRequest) nativePartialInFlightRef.current = null;
        });
      }
    }
    if (nativeChunksRef.current.length > 160) void flushNativeUtterance();
  }, [authFetch, flushNativeUtterance, handleConnectionError, nativeCaptureBlocked]);

  const handleNativeAnalysis = useCallback(async (event: AudioAnalysis) => {
    if (!activeRef.current || mutedRef.current || nativeCaptureBlocked()) return;
    const speaking = event.dataPoints.some((point) => !point.silent && point.rms >= 0.018);
    if (speaking) {
      if (nativeSilenceTimerRef.current) clearTimeout(nativeSilenceTimerRef.current);
      nativeSilenceTimerRef.current = null;
      if (!nativeSpeakingRef.current) {
        nativeSpeakingRef.current = true;
        nativeSpeechStartedAtRef.current = Date.now();
        nativeChunksRef.current = [...nativePreRollRef.current];
        nativeTurnIdRef.current = Crypto.randomUUID();
        nativeSequenceRef.current = 0;
        nativePartialSentLengthRef.current = 0;
      }
      setState("listening");
      return;
    }
    if (nativeSpeakingRef.current && !nativeSilenceTimerRef.current) {
      nativeSilenceTimerRef.current = setTimeout(() => {
        nativeSilenceTimerRef.current = null;
        void flushNativeUtterance();
      }, 650);
    }
  }, [flushNativeUtterance, nativeCaptureBlocked]);

  const updateSession = useCallback((input: { muted?: boolean; reconnect?: boolean }) => (
    sessionUpdaterRef.current!.enqueue((current) => heartbeatWithVersionRecovery(current, input, {
      heartbeat: async (active, heartbeatInput) => (
        await realtimeVoiceApi.heartbeat(authFetch, active.id, { version: active.version, ...heartbeatInput })
      ).session,
      refresh: async (sessionId) => (await realtimeVoiceApi.events(authFetch, sessionId, Number.MAX_SAFE_INTEGER)).session,
      isVersionConflict: (error) => error instanceof ApiError && error.code === "REALTIME_VOICE_VERSION_CONFLICT",
    }))
  ), [authFetch]);

  const toggleMute = useCallback(async () => {
    const nativeLease = nativeLeaseRef.current;
    const sessionId = sessionRef.current?.id;
    if (!sessionId || !activeRef.current || muteTransitionRef.current) return mutedRef.current;
    muteTransitionRef.current = true;
    const nextMuted = !mutedRef.current;
    const stillActive = () => activeRef.current && sessionRef.current?.id === sessionId;
    try {
      // Stop locally before waiting for any network request. Coalesce rapid taps.
      if (nextMuted) {
        mutedRef.current = true;
        responseGeneration.current += 1;
        setState("muted");
        optionsRef.current.onStopOutput();
        if (nativeSilenceTimerRef.current) clearTimeout(nativeSilenceTimerRef.current);
        nativeSilenceTimerRef.current = null;
        nativeSpeakingRef.current = false;
        nativeChunksRef.current = [];
        nativePreRollRef.current = [];
        nativeTurnIdRef.current = "";
        if (Platform.OS === "web") recognitionRef.current?.abort();
        else await nativeLease?.run(pauseNativeRecording);
      }
      const updated = await updateSession({ muted: nextMuted, reconnect: false });
      if (!updated || !stillActive()) return mutedRef.current;
      if (!nextMuted) {
        if (Platform.OS === "web") recognitionRef.current?.start();
        else await nativeLease?.run(resumeNativeRecording);
        if (!stillActive()) {
          if (nativeLease) await nativeLease.stop().catch(() => undefined);
          return mutedRef.current;
        }
        mutedRef.current = false;
        setState("listening");
      }
      return nextMuted;
    } catch (error) {
      if (stillActive()) {
        if (handleConnectionError(error)) return false;
        mutedRef.current = true;
        setState("muted");
        // A failed resume can leave a partially started recorder behind.
        try {
          if (Platform.OS === "web") recognitionRef.current?.abort();
          else await nativeLease?.run(pauseNativeRecording);
        } catch { await stop(); }
        if (stillActive()) void updateSession({ muted: true, reconnect: false }).catch(() => undefined);
        optionsRef.current.onError(error instanceof Error ? error.message : "静音状态同步失败，请重试");
      }
      return mutedRef.current;
    } finally {
      muteTransitionRef.current = false;
    }
  }, [handleConnectionError, pauseNativeRecording, resumeNativeRecording, stop, updateSession]);

  const start = useCallback(async () => {
    if (!mountedRef.current || ownerRef.current !== ownership || optionsRef.current.focused === false || !foregroundRef.current || (Platform.OS === "web" && typeof document !== "undefined" && document.hidden) || startingRef.current || stoppingRef.current || muteTransitionRef.current || activeRef.current) return false;
    const RecognitionConstructor = recognitionConstructor();
    const native = Platform.OS === "android" || Platform.OS === "ios";
    if ((!RecognitionConstructor && !native) || !Number.isInteger(optionsRef.current.recipeId) || optionsRef.current.recipeId <= 0) {
      setState("fallback");
      return false;
    }
    setState("connecting");
    startingRef.current = true;
    const lifecycle = ++lifecycleRef.current;
    const isCurrent = () => lifecycleRef.current === lifecycle;
    try {
      const network = Platform.OS === "web"
        ? { isConnected: typeof navigator === "undefined" ? undefined : navigator.onLine }
        : await Network.getNetworkStateAsync().catch(() => ({} as Network.NetworkState));
      if (!isCurrent()) return false;
      if (network.isConnected === false || ("isInternetReachable" in network && network.isInternetReachable === false)) {
        interruptConnection();
        return false;
      }
      const created = await realtimeVoiceApi.create(authFetch, {
        recipeId: optionsRef.current.recipeId,
        platform: Platform.OS,
        idempotencyKey: `realtime-cooking-${optionsRef.current.recipeId}-${Date.now()}`,
        currentStep: optionsRef.current.currentStep,
        recipeSteps: optionsRef.current.recipeSteps,
        recipeIngredients: optionsRef.current.recipeIngredients,
      });
      if (!isCurrent()) {
        await realtimeVoiceApi.close(authFetch, created.session.id).catch(() => undefined);
        return false;
      }
      sessionRef.current = created.session;
      setSession(created.session);
      activeRef.current = true;
      if (RecognitionConstructor) {
        const recognition = new RecognitionConstructor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "zh-CN";
        recognition.onstart = () => { if (isCurrent() && activeRef.current && !mutedRef.current) setState("listening"); };
        recognition.onspeechstart = () => {
          if (!isCurrent() || !activeRef.current || mutedRef.current) return;
          if (stateRef.current === "processing") {
            interruptedRef.current = true;
            responseGeneration.current += 1;
            optionsRef.current.onBargeIn();
          }
        };
        recognition.onresult = (event: any) => {
          if (!isCurrent() || !activeRef.current || mutedRef.current) return;
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const text = String(result[0]?.transcript || "").trim();
            if (!text) continue;
            optionsRef.current.onTranscript(text, Boolean(result.isFinal));
            if (result.isFinal) void submitTurn(text);
            else interim += text;
          }
          if (interim) optionsRef.current.onTranscript(interim, false);
        };
        recognition.onerror = (event) => {
          if (!isCurrent() || !activeRef.current || mutedRef.current) return;
          if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event?.error)) {
            void stop();
            optionsRef.current.onError("麦克风权限或设备不可用，已停止持续监听");
          } else if (event?.error === "network") interruptConnection();
          else setState("reconnecting");
        };
        recognition.onend = () => {
          if (!isCurrent() || !activeRef.current || mutedRef.current) return;
          setState("reconnecting");
          setTimeout(() => {
            if (!activeRef.current || mutedRef.current || recognitionRef.current !== recognition) return;
            try { recognition.start(); } catch { void stop(); }
          }, 300);
        };
        recognitionRef.current = recognition;
        recognition.start();
      } else {
        const permission = await Audio.requestPermissionsAsync();
        if (!isCurrent()) return false;
        if (!permission.granted) throw new Error("未获得麦克风权限，已保留文字和按轮录音");
        const nativeLease = await acquireAudioStudio(stopNativeRecording);
        if (!isCurrent()) { await nativeLease.stop(); return false; }
        nativeLeaseRef.current = nativeLease;
        await nativeLease.run(() => startNativeRecording({
          sampleRate: 16_000, channels: 1, encoding: "pcm_16bit", interval: 100,
          enableProcessing: true, keepFullAnalysis: false, intervalAnalysis: 100,
          segmentDurationMs: 100, features: { rms: true }, output: { primary: { enabled: false } },
          android: { audioFocusStrategy: "communication" }, autoResumeAfterInterruption: false,
          onAudioStream: async event => { if (isCurrent()) await handleNativeAudio(event); },
          onAudioAnalysis: async event => { if (isCurrent()) await handleNativeAnalysis(event); },
          onRecordingInterrupted: () => {
            if (isCurrent() && activeRef.current) {
              optionsRef.current.onError("录音被系统中断，已停止持续监听");
              void stop();
              setState("fallback");
            }
          },
        }));
        if (!isCurrent()) {
          await nativeLease.stop().catch(() => undefined);
          return false;
        }
        setState("listening");
      }
      heartbeatRef.current = setInterval(() => {
        if (!sessionRef.current) return;
        void updateSession({ muted: mutedRef.current, reconnect: false }).catch((error) => {
          if (!isCurrent() || !activeRef.current) return;
          if (!handleConnectionError(error)) {
            optionsRef.current.onError(error instanceof Error ? error.message : "实时语音状态同步失败");
          }
        });
      }, 20_000);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      await stop();
      if (!mountedRef.current || ownerRef.current !== ownership || !foregroundRef.current) return false;
      setState("fallback");
      optionsRef.current.onError(error instanceof Error ? error.message : "实时通道不可用，已切换按轮录音");
      return false;
    } finally {
      startingRef.current = false;
    }
  }, [authFetch, handleConnectionError, handleNativeAnalysis, handleNativeAudio, interruptConnection, startNativeRecording, stopNativeRecording, stop, submitTurn, updateSession, ownership]);

  useEffect(() => {
    if (Platform.OS === "web") {
      const onOffline = () => interruptConnection();
      window.addEventListener("offline", onOffline);
      return () => window.removeEventListener("offline", onOffline);
    }
    const subscription = Network.addNetworkStateListener((network) => {
      // Unknown reachability is not evidence of disconnection.
      if (network.isConnected === false || network.isInternetReachable === false) interruptConnection();
    });
    return () => subscription.remove();
  }, [interruptConnection]);

  useLayoutEffect(() => {
    ownerRef.current = ownership;
    mountedRef.current = true;
    return () => { mountedRef.current = false; void stop(); };
  }, [stop, ownership]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      foregroundRef.current = next === "active";
      if (next !== "active" && (activeRef.current || startingRef.current)) void stop();
    });
    return () => subscription.remove();
  }, [stop]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onHidden = () => { if (document.hidden) void stop(); };
    const onPageHide = () => { foregroundRef.current = false; void stop(); };
    const onPageShow = () => { foregroundRef.current = true; };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [stop]);

  return { supported, session, state, active: !["off", "fallback"].includes(state), muted: state === "muted", start, stop, toggleMute };
}
