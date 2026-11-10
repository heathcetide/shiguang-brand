import { useIsFocused } from "@react-navigation/native";
import { combineInventoryDeductions, ingredientConsumptionRequests, inventoryPreviewWarnings } from "@/utils/inventoryConsumptions";
import { KitchenwareSafetyHints } from "@/screens/cooking-mode/KitchenwareSafetyHints";
import { useCookingTimer } from "@/hooks/useCookingTimer";
import type { CookingQueueItem } from "@/services/api/cookingQueue";

import * as Crypto from "expo-crypto";
import { useCookingCompletion } from "@/hooks/useCookingCompletion";
import { MealProductionFields } from "@/components/MealProductionFields";
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeSearchParams, useSafeRouter } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import * as Haptics from "expo-haptics";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { toLocalDateKey, toLocalTimeKey } from "@/utils/date";
import { aiApi, cookingQueueApi, inventoryApi, recipesApi, waitForAgentRun, type Recipe } from "@/services/api";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useRealtimeCookingVoice } from "@/hooks/useRealtimeCookingVoice";
import { enqueueVoiceOutput, prefetchVoiceText, prewarmVoicePack, speakWithVoiceFallback, stopVoiceOutput, type VoiceSource } from "@/services/voicePackManager";

interface CookingStep {
  text: string;
  duration?: number; // in seconds
  completed: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  responseTimeMs?: number;
}

interface VoiceConversationTurn {
  question: string;
  answer: string;
}

type CookingAgentRun = {
  id: string;
  status: string;
  reply?: string;
  error?: { message?: string };
  durationMs?: number;
};

export default function CookingModeScreen() {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { recipeId, fromQueue, queueItemId, queueVersion } = useSafeSearchParams<{
    recipeId: number;
    fromQueue?: boolean;
    queueItemId?: string;
    queueVersion?: number;
  }>();

  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  const { user, sessionGeneration } = useAuth();
  const completion = useCookingCompletion(user?.id, authFetch);
  const voiceScopeKey = JSON.stringify([user?.id ?? null, sessionGeneration, recipeId, queueItemId ?? null, queueVersion ?? null, fromQueue ?? false]);
  const voiceScope = useMemo(() => ({ key: voiceScopeKey, sessionId: `cooking-${Crypto.randomUUID()}` }), [voiceScopeKey, focused]);
  const currentVoiceScope = useRef(voiceScope);
  useLayoutEffect(() => { currentVoiceScope.current = voiceScope; }, [voiceScope]);
  const voiceMounted = useRef(false);
  const voiceGeneration = useRef(0);
  const cookingChatSessionId = voiceScope.sessionId;
  const isVoiceScopeCurrent = useCallback(() => voiceMounted.current && currentVoiceScope.current === voiceScope, [voiceScope]);
  const [loadedVoiceScopeKey, setLoadedVoiceScopeKey] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [queueContext, setQueueContext] = useState<CookingQueueItem | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(true);
  const [recipeError, setRecipeError] = useState("");
  const title = recipe?.title;
  const calories = recipe?.calories;
  const protein = recipe?.protein;
  const carbs = recipe?.carbs;
  const fat = recipe?.fat;

  // Primary State
  const [currentStep, setCurrentStep] = useState(0);
  const [cookingSteps, setCookingSteps] = useState<CookingStep[]>([]);
  const [ingredients, setIngredients] = useState<
    { name: string; amount: string; checked: boolean }[]
  >([]);

  // Timer State
  const timer = useCookingTimer(user?.id, queueItemId ? `queue:${queueItemId}` : `recipe:${recipeId}`, recipeLoading ? undefined : cookingSteps[0]?.duration || 180);
  const { timerSeconds, timerMode, isTimerRunning, setTimerSeconds, setTimerMode, setIsTimerRunning } = timer;
  const [showTimerModal, setShowTimerModal] = useState(false);

  // View Controls
  const [viewMode, setViewMode] = useState<"hero" | "timeline">("hero");
  const [showIngredientsDrawer, setShowIngredientsDrawer] = useState(false);
  const [reportedMinutes,setReportedMinutes] = useState("");
  useEffect(() => setReportedMinutes(""),[recipeId,queueItemId,user?.id]);
  const [producedServings, setProducedServings] = useState("1");
  const [eatenServings, setEatenServings] = useState("0");
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [inventoryConsumptionMode, setInventoryConsumptionMode] = useState<"estimated" | "actual" | "all">("estimated");
  const [actualConsumptionAmounts, setActualConsumptionAmounts] = useState<Record<string, string>>({});

  // AI & Voice State
  const [showAIChat, setShowAIChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isAILoading, setIsAILoading] = useState(false);

  const [autoSpeechEnabled, setAutoSpeechEnabled] = useState(true);
  const [voiceSource, setVoiceSource] = useState<VoiceSource | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  // 🎙️ Live Direct Voice HUD Toast State (底栏上方半透明 HUD 悬浮卡片状态)
  const [voiceHudState, setVoiceHudState] = useState<{
    visible: boolean;
    type: "listening" | "processing" | "result";
    userText?: string;
    aiText?: string;
    actionDoneText?: string;
  }>({ visible: false, type: "listening" });
  const [voiceConversation, setVoiceConversation] = useState<VoiceConversationTurn[]>([]);

  const voiceHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    voiceMounted.current = true;
    setVoiceHudState({ visible: false, type: "listening" });
    setVoiceConversation([]);
    setVoiceSource(null);
    return () => {
      voiceMounted.current = false;
      voiceGeneration.current += 1;
      if (voiceHudTimerRef.current) clearTimeout(voiceHudTimerRef.current);
      voiceHudTimerRef.current = null;
      void stopVoiceOutput();
    };
  }, [voiceScope]);

  const speak = useCallback((text: string, sensitive = false) => {
    if (!isVoiceScopeCurrent()) return;
    void speakWithVoiceFallback(authFetch, text, { userId: user?.id, sensitive })
      .then((source) => { if (isVoiceScopeCurrent()) setVoiceSource(source); })
      .catch(() => { if (isVoiceScopeCurrent()) setVoiceSource("system"); });
  }, [authFetch, user?.id, isVoiceScopeCurrent]);

  useEffect(() => {
    void prewarmVoicePack(user?.id);
    const upcoming = cookingSteps.slice(currentStep, currentStep + 2).map((step) => step.text).filter(Boolean);
    void Promise.all(upcoming.map((text) => prefetchVoiceText(text, user?.id)));
  }, [cookingSteps, currentStep, user?.id]);

  // Step duration estimation
  const estimateStepDuration = (step: string): number => {
    const lower = step.toLowerCase();
    if (lower.includes("腌")) return 900;
    if (lower.includes("炖") || lower.includes("煲") || lower.includes("慢火") || lower.includes("收汁")) return 600;
    if (lower.includes("蒸")) return 480;
    if (lower.includes("炒") || lower.includes("煎") || lower.includes("爆") || lower.includes("焯")) return 300;
    if (lower.includes("煮")) return 360;
    if (lower.includes("切") || lower.includes("洗") || lower.includes("备") || lower.includes("主料") || lower.includes("辅料")) return 120;
    return 180;
  };

  // Step Action Tag Classifier
  const getStepActionTag = (stepText: string) => {
    if (!stepText)
      return { label: "烹饪步骤", icon: "utensils", bg: "bg-brand-soft", text: "text-brand" };
    const lower = stepText.toLowerCase();
    if (
      lower.includes("切") ||
      lower.includes("洗") ||
      lower.includes("备") ||
      lower.includes("主料") ||
      lower.includes("辅料") ||
      lower.includes("刨") ||
      lower.includes("撕")
    ) {
      return { label: "切配准备", icon: "kitchen-set", bg: "bg-warm-soft", text: "text-warm" };
    }
    if (
      lower.includes("炒") ||
      lower.includes("爆") ||
      lower.includes("煎") ||
      lower.includes("炸") ||
      lower.includes("煸")
    ) {
      return { label: "火候烹炒", icon: "fire", bg: "bg-danger-soft", text: "text-critical" };
    }
    if (
      lower.includes("炖") ||
      lower.includes("煮") ||
      lower.includes("煲") ||
      lower.includes("焖") ||
      lower.includes("收汁")
    ) {
      return { label: "慢炖文火", icon: "whiskey-glass", bg: "bg-brand-soft", text: "text-brand-strong" };
    }
    if (lower.includes("蒸") || lower.includes("焯")) {
      return { label: "水蒸焯水", icon: "cloud", bg: "bg-info-soft", text: "text-info" };
    }
    if (
      lower.includes("调") ||
      lower.includes("拌") ||
      lower.includes("腌") ||
      lower.includes("淋") ||
      lower.includes("勾芡")
    ) {
      return { label: "调味腌制", icon: "bowl-rice", bg: "bg-info-soft", text: "text-info" };
    }
    return { label: "精细烹饪", icon: "utensils", bg: "bg-brand-soft", text: "text-brand" };
  };

  // Step Context AI Tip
  const getStepContextTip = (stepText: string) => {
    if (!stepText) return null;
    const lower = stepText.toLowerCase();
    if (lower.includes("炒") || lower.includes("爆") || lower.includes("煸")) {
      return "热锅冷油下料，翻炒动作要迅速，大火能锁住食材汁水与香气。";
    }
    if (lower.includes("切") || lower.includes("主料")) {
      return "顺纹切猪肉、逆纹切牛肉，这样烹饪出来的肉质更加嫩滑易嚼。";
    }
    if (lower.includes("炖") || lower.includes("焖") || lower.includes("收汁")) {
      return "炖煮时汤水建议一次性加足，中途加水会降低汤汁鲜美度。";
    }
    if (lower.includes("腌")) {
      return "加入少许淀粉或蛋清抓匀，腌制 10 分钟口感更细腻饱满。";
    }
    if (lower.includes("蒸") || lower.includes("焯")) {
      return "待水沸腾上汽后再下入食材，能更快锁存食物原本的营养。";
    }
    return "注意厨房油温与用火安全，保持食材切配卫生。";
  };

  const speakStep = useCallback((stepText: string, stepIndex: number) => {
    try {
      const contentToSpeak = `第 ${stepIndex + 1} 步：${stepText}`;
      speak(contentToSpeak);
    } catch (e) {
      console.error("Speech error", e);
    }
  }, [speak]);

  useEffect(() => {
    const id = Number(recipeId);
    if (!Number.isInteger(id) || id <= 0) {
      setRecipeError("菜谱编号无效，请从菜谱详情重新开始烹饪。");
      setRecipeLoading(false);
      return;
    }
    let active = true;
    setRecipeLoading(true);
    setCurrentStep(0);
    setRecipeError("");
    void Promise.all([recipesApi.detail(id), queueItemId ? cookingQueueApi.list(authFetch) : Promise.resolve([])]).then(([latestRecipe, queue]) => {
      if (!active) return;
      const queued = queueItemId ? queue.find(item => item.id === queueItemId && item.recipeId === id) : null;
      if (queueItemId && !queued) throw new Error("队列项目已变化，请返回队列重新开始");
      setQueueContext(queued ?? null);
      setProducedServings(String(queued?.plannedServings ?? 1));
      setEatenServings("0");
      const parsedSteps: CookingStep[] = (latestRecipe.steps || []).map((s: string) => ({
        text: s,
        duration: estimateStepDuration(s),
        completed: false,
      }));
      if (!parsedSteps.length || !latestRecipe.ingredients?.length) throw new Error("菜谱步骤或食材不完整");
      setLoadedVoiceScopeKey(voiceScopeKey);
      setRecipe(latestRecipe);
      setCookingSteps(parsedSteps);
      setIngredients(
        (queued?.sourcePlanItemId ? queued.ingredients : latestRecipe.ingredients).map((i) => ({
          ...i,
          checked: false,
        }))
      );

    }).catch((error) => {
      if (!active) return;
      setRecipe(null);
      setCookingSteps([]);
      setIngredients([]);
      setRecipeError(error instanceof Error ? error.message : "菜谱读取失败");
    }).finally(() => { if (active) setRecipeLoading(false); });
    return () => { active = false; };
  }, [recipeId, queueItemId, authFetch, voiceScopeKey]);

  // Speech preferences never mutate the task timer.
  useEffect(() => {
    if (loadedVoiceScopeKey === voiceScopeKey && autoSpeechEnabled && cookingSteps[currentStep]) speakStep(cookingSteps[currentStep].text, currentStep);
  }, [currentStep, autoSpeechEnabled, cookingSteps, speakStep, loadedVoiceScopeKey, voiceScopeKey]);

  // 🎙️ Execute Direct Voice Command from HUD
  const executeDirectVoiceCommand = async (commandText: string) => {
    const text = commandText.trim();
    if (!text || !isVoiceScopeCurrent() || recipeLoading || loadedVoiceScopeKey !== voiceScopeKey) return;
    const generation = ++voiceGeneration.current;
    const isCurrent = () => isVoiceScopeCurrent() && voiceGeneration.current === generation;

    if (voiceHudTimerRef.current) clearTimeout(voiceHudTimerRef.current);
    setVoiceHudState({
      visible: true,
      type: "processing",
      userText: text,
    });

    try {
      const data = await aiApi.voiceCommand<{ type: string; action?: string; answerText?: string; run?: CookingAgentRun }>(
        authFetch,
        {
          speechText: text,
          sessionId: cookingChatSessionId,
          currentStep,
          recipeTitle: title || "当前菜品",
          recipeSteps: cookingSteps.map((s) => s.text),
          recipeIngredients: ingredients.map((i) => `${i.name} ${i.amount}`),
          voiceHistory: voiceConversation,
        }
      );

      if (!isCurrent()) return;
      if (data.type === "CONTROL") {
        let actionDoneText = "已完成语音控制";
        if (data.action === "NEXT_STEP") {
          if (currentStep < cookingSteps.length - 1) {
            handleNextStep();
            actionDoneText = "已为您切换至下一步";
          } else {
            actionDoneText = "已是最后一步步骤";
          }
        } else if (data.action === "PREV_STEP") {
          if (currentStep > 0) {
            handlePrevStep();
            actionDoneText = "已为您返回上一步";
          }
        } else if (data.action === "TOGGLE_TIMER") {
          setIsTimerRunning((prev) => !prev);
          actionDoneText = isTimerRunning ? "已为您暂停倒计时" : "已为您开启倒计时";
        }

        setVoiceHudState({
          visible: true,
          type: "result",
          userText: text,
          actionDoneText,
        });

        speak(actionDoneText);
      } else {
        const completedRun = data.run ? await waitForAgentRun(authFetch, data.run) : undefined;
        if (!isCurrent()) return;
        const reply = completedRun?.reply || data.answerText || completedRun?.error?.message || "已为您提供下厨解答";
        setVoiceConversation((previous) => [
          ...previous,
          { question: text, answer: reply },
        ].slice(-3));
        setVoiceHudState({
          visible: true,
          type: "result",
          userText: text,
          aiText: reply,
        });

        speak(reply, true);
      }

      // Keep the floating answer available while the user is cooking, then dismiss it.
      voiceHudTimerRef.current = setTimeout(() => {
        if (!isCurrent()) return;
        setVoiceHudState((prev) => ({ ...prev, visible: false }));
      }, data.type === "CONTROL" ? 4000 : 30000);
    } catch (error) {
      if (!isCurrent()) return;
      setVoiceHudState({
        visible: true,
        type: "result",
        userText: text,
        aiText: error instanceof Error ? error.message : "处理语音指令失败，请稍后重试",
      });
    }
  };

  // 🎙️ Voice Recorder Integration
  const {
    isRecording: isVoiceRecording,
    isTranscribing: isVoiceTranscribing,
    toggleRecording: toggleVoiceRecording,
    stopRecording: stopVoiceRecording,
    discardRecording: discardVoiceRecording,
  } = useVoiceRecorder({
    focused,
    onDiscard: () => {
      voiceGeneration.current += 1;
      setVoiceHudState({ visible: false, type: "listening" });
      if (voiceHudTimerRef.current) clearTimeout(voiceHudTimerRef.current);
      voiceHudTimerRef.current = null;
      void stopVoiceOutput();
    },
    scopeKey: voiceScopeKey,
    onSpeechResult: (recognizedText) => {
      if (isVoiceScopeCurrent() && recognizedText) {
        setVoiceHudState({
          visible: true,
          type: "listening",
          userText: recognizedText,
        });
      }
    },
    onSpeechFinal: (finalText) => {
      if (finalText) {
        void executeDirectVoiceCommand(finalText);
      }
    },
    onSpeechEmpty: () => {
      if (!isVoiceScopeCurrent()) return;
      setVoiceHudState({
        visible: true,
        type: "result",
        aiText: "未能清晰识别到您的语音，请再试一次。",
      });
    },
  });

  const realtimeVoice = useRealtimeCookingVoice({
    focused,
    scopeKey: voiceScopeKey,
    recipeId: Number(recipeId) || 0,
    currentStep,
    timerSeconds,
    timerRunning: isTimerRunning,
    recipeSteps: cookingSteps.map((step) => step.text),
    recipeIngredients: ingredients.map((ingredient) => `${ingredient.name} ${ingredient.amount}`),
    onTranscript: (text) => setVoiceHudState({ visible: true, type: "listening", userText: text }),
    onStopOutput: () => { void stopVoiceOutput(); },
    onBargeIn: () => {
      void stopVoiceOutput();
      setVoiceHudState((previous) => ({ ...previous, visible: true, type: "listening", aiText: undefined }));
    },
    onControl: (action, seconds) => {
      let message = "已完成语音控制";
      if (action === "NEXT_STEP") {
        setCookingSteps((steps) => steps.map((step, index) => index === currentStep ? { ...step, completed: true } : step));
        setCurrentStep((step) => Math.min(step + 1, Math.max(0, cookingSteps.length - 1)));
        message = currentStep < cookingSteps.length - 1 ? "已切换至下一步" : "已经是最后一步";
      } else if (action === "PREV_STEP") {
        setCurrentStep((step) => Math.max(0, step - 1));
        message = currentStep > 0 ? "已返回上一步" : "已经是第一步";
      } else if (action === "PAUSE_TIMER") {
        setIsTimerRunning(false);
        message = "计时已暂停";
      } else if (action === "START_TIMER") {
        setIsTimerRunning(true);
        message = "计时已开始";
      } else if (action === "ADD_TIMER") {
        setTimerSeconds((value) => value + seconds);
        message = `已增加 ${Math.round(seconds / 60)} 分钟`;
      }
      setVoiceHudState({ visible: true, type: "result", actionDoneText: message });
      if (autoSpeechEnabled) speak(message);
    },
    onAnswerDelta: (text, delta, turnId) => {
      setVoiceHudState((previous) => ({ ...previous, visible: true, type: "result", aiText: text }));
      if (autoSpeechEnabled) void enqueueVoiceOutput(authFetch, delta, { streamId: turnId, userId: user?.id, sensitive: true })
        .then((source) => { if (source) setVoiceSource(source); })
        .catch(() => setVoiceSource("system"));
    },
    onAnswer: (text, streamed) => {
      setVoiceHudState((previous) => ({ ...previous, visible: true, type: "result", aiText: text }));
      if (autoSpeechEnabled && !streamed) speak(text, true);
    },
    onConfirmationRequired: (message) => {
      void stopVoiceOutput();
      Alert.alert("需要屏幕确认", message);
      setVoiceHudState({ visible: true, type: "result", aiText: message });
    },
    onError: (message) => setVoiceHudState({ visible: true, type: "result", aiText: message }),
  });

  // 🎙️ Direct Voice Mic Handler (点击底栏麦克风直接唤起/停止半透明 HUD 卡片与麦克风)
  const handleToggleDirectMic = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    if (realtimeVoice.active) {
      void realtimeVoice.stop();
      void stopVoiceOutput();
      return;
    }
    if (isVoiceRecording) {
      stopVoiceRecording();
      return;
    }

    if (voiceHudTimerRef.current) clearTimeout(voiceHudTimerRef.current);
    setVoiceHudState({
      visible: true,
      type: "listening",
    });
    if (realtimeVoice.supported) {
      const disclosure = "持续语音仅在本次做饭页面前台监听；退出、静音或关闭页面会立即停止。原始音频不长期保存。是否开启？";
      if (Platform.OS === "web" && typeof window !== "undefined") {
        if (window.confirm(disclosure)) void realtimeVoice.start();
      } else {
        Alert.alert("开启连续语音", disclosure, [
          { text: "取消", style: "cancel" },
          { text: "开启", onPress: () => void realtimeVoice.start() },
        ]);
      }
      return;
    }
    toggleVoiceRecording();
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDurationText = (seconds: number): string => {
    if (seconds >= 60) {
      const mins = Math.floor(seconds / 60);
      const remainingSecs = seconds % 60;
      return remainingSecs > 0 ? `${mins}分${remainingSecs}秒` : `${mins}分钟`;
    }
    return `${seconds}秒`;
  };

  const handleStartPauseTimer = () => {
    if (!timer.ready) return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setIsTimerRunning((prev) => !prev);
  };

  const handleResetTimer = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
    setIsTimerRunning(false);
    const targetDur = cookingSteps[currentStep]?.duration || 180;
    setTimerSeconds(timerMode === "countdown" ? targetDur : 0);
  };

  const handleAddMinutes = (mins: number) => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setTimerSeconds((prev) => prev + mins * 60);
  };

  const toggleTimerMode = () => {
    const nextMode = timerMode === "countdown" ? "stopwatch" : "countdown";
    setTimerMode(nextMode);
    setIsTimerRunning(false);
    const targetDur = cookingSteps[currentStep]?.duration || 180;
    setTimerSeconds(nextMode === "countdown" ? targetDur : 0);
  };

  const handlePrevStep = () => {
    if (currentStep > 0) {
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleNextStep = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    const newSteps = [...cookingSteps];
    if (newSteps[currentStep]) {
      newSteps[currentStep].completed = true;
      setCookingSteps(newSteps);
    }

    if (currentStep < cookingSteps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Last step completed! Open Finish Modal
      try {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      setShowFinishModal(true);
    }
  };

  const handleCheckIngredient = (index: number) => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setIngredients((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], checked: !updated[index].checked };
      return updated;
    });
  };

  const handleToggleSelectAllIngredients = () => {
    const allChecked = ingredients.every((i) => i.checked);
    setIngredients((prev) =>
      prev.map((i) => ({ ...i, checked: !allChecked }))
    );
  };

  const getMealType = () => {
    const hour = new Date().getHours();
    return hour < 10 ? "早餐" : hour < 15 ? "午餐" : hour < 21 ? "晚餐" : "加餐";
  };

  const findMatchedInventoryIds = async () => {
    const inventory = await inventoryApi.list(authFetch);
    if (!Array.isArray(inventory)) return [];
    const normalize = (value: string) =>
      value.toLocaleLowerCase().replace(/[\s·、，,。()（）/\\_-]/g, "");
    const ingredientNames = ingredients
      .filter((item) => item.checked)
      .map((item) => normalize(item.name));
    const matches = inventory.filter(
      (item: { food_name?: string; is_available?: boolean }) => {
        const foodName = normalize(String(item.food_name || ""));
        return (
          item.is_available &&
          ingredientNames.some(
            (name) => name && (foodName.includes(name) || name.includes(foodName))
          )
        );
      }
    );
    return matches.map((item: { id: number }) => item.id);
  };

  const buildInventoryConsumptions = async () => {
    const inventory = await inventoryApi.list(authFetch);
    if (inventoryConsumptionMode === "all") {
      const ids = new Set(await findMatchedInventoryIds());
      return inventory
        .filter((item) => ids.has(item.id))
        .map((item) => ({ item_id: item.id, version: item.version || 1, mode: "all" as const }));
    }

    const { requests, unknown } = ingredientConsumptionRequests(ingredients.filter(ingredient => ingredient.checked).map(ingredient => ({
      name: ingredient.name, amount: inventoryConsumptionMode === "actual" ? actualConsumptionAmounts[ingredient.name] || ingredient.amount : ingredient.amount,
    })));
    if (unknown.length) throw new Error(`用量无法换算：${unknown.join("、")}。请填写明确数值和单位，或确认实际整项用完后选择“整项用完”。`);
    if (!requests.length) throw new Error("请勾选本次实际使用的原料，或确认未使用库存原料后保存制作。");
    const preview = await inventoryApi.consumptionPreview(authFetch, requests);
    const warnings = inventoryPreviewWarnings(preview);
    if (warnings.length) throw new Error(`库存不足或单位不可换算：${warnings.join("、")}`);
    return combineInventoryDeductions(preview.items.flatMap((item) => item.deductions));
  };

  const finishCooking = async (consumeInventory: boolean) => {
    if (isCompleting) return;
    try {
      setIsCompleting(true);
      const result = await completion.submit(async () => {
      let inventoryConsumptions: Awaited<ReturnType<typeof buildInventoryConsumptions>> = [];
      if (consumeInventory) {
        inventoryConsumptions = await buildInventoryConsumptions();
        if (inventoryConsumptions.length === 0) {
          Alert.alert(
            "未匹配到库存",
            "没有找到已勾选且名称匹配的库存食材。可确认本次未使用库存原料后保存制作。",
            [{ text: "不扣库存，保存制作", onPress: () => void finishCooking(false) }]
          );
          return null;
        }
      }
      const nutritionNumber = (value: unknown) => {
        if (value == null || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      };

      return {
        idempotency_key: `cook-${Crypto.randomUUID()}`,
        recipe_id:
          Number.isInteger(Number(recipeId)) && Number(recipeId) > 0
            ? Number(recipeId)
            : null,
        inventory_item_ids: [],
        inventory_consumptions: inventoryConsumptions,
        production: (await import("@dietdigidose/contracts")).mealProductionSchema.parse({
          food_name: title || "自制餐食",
          ...(queueContext?.plannedDate ? { planned_date: queueContext.plannedDate } : {}),
          reported_cooking_minutes: reportedMinutes.trim() ? Number(reportedMinutes) : null,
          produced_servings: Number(producedServings), eaten_servings: Number(eatenServings),
          meal_type: getMealType(), eaten_at: toLocalDateKey(), eaten_time: toLocalTimeKey(),
          // Existing recipe nutrition has no verified serving basis for a multi-serving batch.
          nutrition_per_serving: Number(producedServings) === 1 ? {
            calories: nutritionNumber(calories), protein: nutritionNumber(protein), carbs: nutritionNumber(carbs), fat: nutritionNumber(fat),
          } : {},
          ...(queueItemId && (queueContext?.version || queueVersion) ? { queue_item_id: queueItemId, queue_version: queueContext?.version ?? Number(queueVersion) } : {}),
        }),
      };
      });
      if (!result) return;
      timer.finish();

      setShowFinishModal(false);
      Alert.alert(
        result.repeated ? "已完成" : "烹饪完成！",
        `制作已保存，${result.prepared_meal?.remaining_servings ?? 0} 份留待吃${result.diet_record ? "，实际食用已记入饮食" : "，尚未新增摄入"}${
          result.consumed_inventory_item_ids.length
            ? `，并自动扣减了 ${result.consumed_inventory_item_ids.length} 项库存食材`
            : ""
        }。`,
        fromQueue
          ? [
            { text: "继续下一道", onPress: () => router.replace("/cooking-queue") },
            { text: "查看待吃餐", onPress: () => router.replace("/prepared-meals") },
          ]
          : [{ text: "查看待吃餐", onPress: () => router.replace("/prepared-meals") }]
      );
    } catch (error) {
      Alert.alert("完成失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setIsCompleting(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: chatInput,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsAILoading(true);

    try {
      const currentDish = title || "这道菜";
      const currentStepText = cookingSteps[currentStep]?.text || "准备中";

      const data = await aiApi.chat<{ reply?: string; responseTimeMs?: number; run: CookingAgentRun }>(authFetch, {
        source: "cooking",
        sessionId: cookingChatSessionId,
        messages: [
          {
            role: "user",
            content: `【当前烹饪状态】菜品：${currentDish}；步骤 ${currentStep + 1}：${currentStepText}`,
          },
          ...chatMessages.slice(-46).map((message) => ({ role: message.role, content: message.content })),
          { role: "user", content: chatInput.trim() },
        ],
      });
      const completedRun = await waitForAgentRun(authFetch, data.run);

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: completedRun.reply || data.reply || completedRun.error?.message || "抱歉，我暂时无法回答这个问题。",
        timestamp: new Date(),
        responseTimeMs: completedRun.durationMs ?? data.responseTimeMs,
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: error instanceof Error ? error.message : "AI 对话请求失败，请稍后重试",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsAILoading(false);
    }
  };

  const completedCount = cookingSteps.filter((s) => s.completed).length;
  const progressPercent =
    cookingSteps.length > 0 ? (completedCount / cookingSteps.length) * 100 : 0;
  const checkedIngredientsCount = ingredients.filter((i) => i.checked).length;
  const actionTag = getStepActionTag(cookingSteps[currentStep]?.text || "");
  const contextTip = getStepContextTip(cookingSteps[currentStep]?.text || "");
  const targetStepDuration = cookingSteps[currentStep]?.duration || 180;

  if (recipeLoading) {
    return <Screen><View className="flex-1 items-center justify-center"><ActivityIndicator size="large" colorClassName="accent-brand" /><Text className="mt-3 text-sm text-copy-muted">正在读取最新菜谱…</Text></View></Screen>;
  }
  if (!recipe || recipeError) {
    return <Screen><View className="flex-1 items-center justify-center px-8"><FontAwesome6 name="triangle-exclamation" size={28} colorClassName="accent-critical" /><Text className="mt-4 text-center text-base font-black text-ink">无法开始烹饪</Text><Text className="mt-2 text-center text-sm leading-6 text-copy-muted">{recipeError || "菜谱暂不可用"}</Text><TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-2xl bg-brand-fill px-6 py-3"><Text className="font-bold text-white">返回菜谱</Text></TouchableOpacity></View></Screen>;
  }

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} className="flex-1 bg-background-secondary relative">
      {completion.pending ? <View className="bg-warm-soft p-4 gap-2">
        <Text className="text-ink">上次「{completion.pending.production?.food_name}」制作尚未确认：制作 {completion.pending.production?.produced_servings} 份，食用 {completion.pending.production?.eaten_servings} 份。将恢复原日期和库存操作。</Text>
        <TouchableOpacity disabled={isCompleting} onPress={() => void finishCooking(false)}><Text className="font-bold text-brand">重试原制作记录</Text></TouchableOpacity>
      </View> : null}
      {completion.error ? <Text className="text-danger p-4">{completion.error}</Text> : null}
      {/* 🌿 Minimalist Ultra-Clean Top Header (极致清爽顶栏) */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + 4 }}
        className="bg-surface pb-3 px-5 border-b border-line shadow-xs relative flex-row items-center justify-between"
      >
        {/* Back Button */}
        <TouchableOpacity
          onPress={() => {
            const doExit = () => {
              void realtimeVoice.stop();
              discardVoiceRecording();
              void stopVoiceOutput();
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)");
              }
            };

            if (Platform.OS === "web") {
              if (typeof window !== "undefined" && window.confirm("确定要退出当前的烹饪流程吗？")) {
                doExit();
              }
            } else {
              Alert.alert("退出做饭模式", "确定要退出当前的烹饪流程吗？", [
                { text: "取消", style: "cancel" },
                { text: "退出", style: "destructive", onPress: doExit },
              ]);
            }
          }}
          className="w-9 h-9 rounded-full bg-background-secondary border border-line items-center justify-center active:bg-background-secondary"
        >
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>

        {/* Center: Title + Step Badge */}
        <View className="flex-1 items-center mx-3">
          <Text className="text-brand-strong text-base font-black tracking-wide" numberOfLines={1}>
            {title || "做饭模式"}
          </Text>
          <Text className="text-brand text-[11px] font-bold mt-0.5">
            第 {currentStep + 1}/{cookingSteps.length || 1} 步 ({Math.round(progressPercent)}%)
          </Text>
        </View>

        {/* Right Clean Action Controls (2 icons only) */}
        <View className="flex-row items-center gap-2">
          {/* TTS Speech Mute/Unmute */}
          <TouchableOpacity
            onPress={() => {
              const nextState = !autoSpeechEnabled;
              setAutoSpeechEnabled(nextState);
              if (nextState && cookingSteps[currentStep]) {
                speakStep(cookingSteps[currentStep].text, currentStep);
              }
            }}
            className={`w-9 h-9 rounded-full items-center justify-center border ${
              autoSpeechEnabled
                ? "bg-brand-soft border-brand/20"
                : "bg-background-secondary border-line"
            }`}
          >
            <FontAwesome6
              name={autoSpeechEnabled ? "volume-high" : "volume-xmark"}
              size={13}
              colorClassName={autoSpeechEnabled ? "accent-brand" : "accent-copy-muted"}
            />
          </TouchableOpacity>

          {/* Timeline Switcher */}
          <TouchableOpacity
            onPress={() => setViewMode((prev) => (prev === "hero" ? "timeline" : "hero"))}
            className={`w-9 h-9 rounded-full items-center justify-center border ${
              viewMode === "timeline"
                ? "bg-brand-fill border-brand"
                : "bg-background-secondary border-line"
            }`}
          >
            <FontAwesome6
              name={viewMode === "hero" ? "list-ul" : "layer-group"}
              size={13}
              colorClassName={viewMode === "timeline" ? "accent-on-brand" : "accent-ink"}
            />
          </TouchableOpacity>
        </View>

        {/* Flush 3px Progress Line attached to header bottom */}
        <View className="absolute bottom-0 left-0 right-0 h-[3px] bg-background-secondary">
          <View
            className="h-full bg-brand-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </View>
      </View>

      {/* 🥗 Floating Ingredient Drawer Launcher Pill */}
      {ingredients.length > 0 && (
        <View className="px-5 pt-3 pb-1">
          <TouchableOpacity
            onPress={() => setShowIngredientsDrawer(true)}
            className="bg-surface border border-line rounded-2xl px-4 py-2.5 flex-row items-center justify-between shadow-sm active:bg-background-secondary"
          >
            <View className="flex-row items-center gap-2.5">
              <View className="w-6 h-6 rounded-full bg-brand-soft items-center justify-center">
                <FontAwesome6 name="basket-shopping" size={12} colorClassName="accent-brand" />
              </View>
              <Text className="text-xs font-bold text-ink">
                食材准备清单 ({checkedIngredientsCount}/{ingredients.length})
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="text-xs font-bold text-brand">
                {checkedIngredientsCount === ingredients.length ? "已全部备齐" : "查看/勾选 ▸"}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Mode Content */}
      <ScrollView className="flex-1 px-5 pt-2" showsVerticalScrollIndicator={false}>
        <KitchenwareSafetyHints recipeId={Number(recipeId)} />
        {viewMode === "hero" ? (
          /* 📱 HERO BIG STEP CARD DECK (食光大卡片沉浸视图) */
          <View className="pb-44">
            {cookingSteps.length > 0 && (
              <View className="gap-3">
                <View className="bg-surface rounded-[24px] p-6 border border-line shadow-sm">
                {/* Step Action Tag & Header */}
                <View className="flex-row items-center justify-between mb-4">
                  <View className="flex-row items-center gap-2.5">
                    <View className="w-11 h-11 rounded-2xl bg-brand-fill items-center justify-center shadow-md">
                      <Text className="text-white text-lg font-black">
                        {currentStep + 1}
                      </Text>
                    </View>
                    <View className={`px-3 py-1.5 rounded-full flex-row items-center gap-1.5 ${actionTag.bg}`}>
                      <FontAwesome6 name={actionTag.icon} size={12} className={actionTag.text} color="currentColor" />
                      <Text className={`text-xs font-bold ${actionTag.text}`}>{actionTag.label}</Text>
                    </View>
                  </View>

                  {/* ⏱️ Compact Timer Trigger Button */}
                  <TouchableOpacity
                    onPress={() => setShowTimerModal(true)}
                    className={`px-3.5 py-2 rounded-full flex-row items-center gap-1.5 border ${
                      isTimerRunning
                        ? "bg-critical-fill border-critical shadow-sm"
                        : "bg-background-secondary border-line"
                    }`}
                  >
                    <FontAwesome6
                      name={isTimerRunning ? "clock" : "stopwatch"}
                      size={12}
                      colorClassName={isTimerRunning ? "accent-on-brand" : "accent-brand"}
                    />
                    <Text
                      className={`text-xs font-bold ${
                        isTimerRunning ? "text-white" : "text-brand"
                      }`}
                    >
                      {isTimerRunning
                        ? `${formatTime(timerSeconds)} (${timerMode === "countdown" ? "倒计时" : "正计时"})`
                        : `建议: ${formatDurationText(targetStepDuration)}`}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Main High-Readability Step Text */}
                <Text className="text-2xl font-black text-brand-strong leading-9 tracking-wide mb-6">
                  {cookingSteps[currentStep]?.text}
                </Text>

                {/* AI Context Tip Pill */}
                {contextTip && (
                  <View className="bg-brand-soft border border-brand/20 rounded-2xl p-4 mb-4">
                    <Text className="text-xs font-bold text-brand-strong leading-5">
                      {contextTip}
                    </Text>
                  </View>
                )}

                {/* ⏱️ Inline Compact Quick Timer Bar */}
                <View className="bg-background-secondary rounded-2xl p-3.5 border border-line flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2.5">
                    <View
                      className={`w-9 h-9 rounded-xl items-center justify-center ${
                        isTimerRunning ? "bg-critical-fill" : "bg-brand-fill"
                      }`}
                    >
                      <FontAwesome6 name="clock" size={15} colorClassName="accent-on-brand" />
                    </View>
                    <View>
                      <Text className="text-[10px] font-bold text-copy-muted">
                        {timerMode === "countdown" ? "倒计时" : "正计时"} ({formatDurationText(targetStepDuration)})
                      </Text>
                      <Text className="text-xl font-black text-brand-strong tracking-wider">
                        {formatTime(timerSeconds)}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2">
                    {/* Start/Pause */}
                    <TouchableOpacity
                      onPress={handleStartPauseTimer}
                      className={`px-4 py-2.5 rounded-xl flex-row items-center gap-1.5 shadow-sm ${
                        isTimerRunning ? "bg-critical-fill" : "bg-brand-fill"
                      }`}
                    >
                      <FontAwesome6
                        name={isTimerRunning ? "pause" : "play"}
                        size={12}
                        colorClassName="accent-on-brand"
                      />
                      <Text className="text-white text-xs font-bold">
                        {isTimerRunning ? "暂停" : "开始"}
                      </Text>
                    </TouchableOpacity>

                    {/* Open Full Timer Controls Modal */}
                    <TouchableOpacity
                      onPress={() => setShowTimerModal(true)}
                      className="bg-surface p-2.5 rounded-xl border border-line active:bg-background-secondary"
                    >
                      <FontAwesome6 name="ellipsis" size={14} colorClassName="accent-ink" />
                    </TouchableOpacity>
                  </View>
                </View>
                </View>

              </View>
            )}
          </View>
        ) : (
          /* 📋 FULL TIMELINE OVERVIEW (全部步骤总览视图) */
          <View className="pb-44 pt-2">
            <View className="bg-surface rounded-[24px] p-5 border border-line shadow-sm">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-base font-bold text-brand-strong">全部烹饪步骤</Text>
                <Text className="text-xs text-copy-muted">点击可直接跳转对应步骤</Text>
              </View>

              <View className="gap-3">
                {cookingSteps.map((step, idx) => {
                  const isCurrent = idx === currentStep;
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => {
                        setCurrentStep(idx);
                        setViewMode("hero");
                      }}
                      className={`flex-row items-start p-4 rounded-2xl border ${
                        isCurrent
                          ? "bg-brand-soft border-brand"
                          : step.completed
                          ? "bg-background-secondary border-transparent opacity-60"
                          : "bg-surface border-line"
                      }`}
                    >
                      <View
                        className={`w-7 h-7 rounded-full items-center justify-center mr-3 mt-0.5 ${
                          step.completed
                            ? "bg-brand-fill"
                            : isCurrent
                            ? "bg-highlight"
                            : "bg-background-secondary"
                        }`}
                      >
                        {step.completed ? (
                          <FontAwesome6 name="check" size={12} colorClassName="accent-on-brand" />
                        ) : (
                          <Text
                            className={`text-xs font-bold ${
                              isCurrent ? "text-ink" : "text-copy-muted"
                            }`}
                          >
                            {idx + 1}
                          </Text>
                        )}
                      </View>
                      <View className="flex-1">
                        <Text
                          className={`text-sm leading-6 font-bold ${
                            step.completed
                              ? "text-copy-muted line-through"
                              : isCurrent
                              ? "text-brand-strong"
                              : "text-ink"
                          }`}
                        >
                          {step.text}
                        </Text>
                        {step.duration ? (
                          <Text className="text-[11px] text-copy-muted mt-1">
                            建议耗时: {formatDurationText(step.duration)}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* LIVE SEMI-TRANSPARENT FROSTED GLASS VOICE HUD TOAST */}
      {voiceHudState.visible && (
        <View className="absolute bottom-24 left-4 right-4 z-50 bg-surface/95 backdrop-blur-md rounded-2xl p-4 border border-line shadow-2xl">
          <View className="flex-row items-center justify-between mb-2 pb-1.5 border-b border-line">
            <View className="flex-row items-center gap-2">
              <View
                className={`w-2.5 h-2.5 rounded-full ${
                  realtimeVoice.muted ? "bg-copy-muted" : realtimeVoice.active || isVoiceRecording ? "bg-critical-fill" : "bg-brand-fill"
                }`}
              />
              <Text className="text-xs font-black text-brand-strong tracking-wide">
                {realtimeVoice.active
                  ? realtimeVoice.muted ? "持续监听已静音，点麦克风恢复" : realtimeVoice.state === "reconnecting" ? "连接较弱，正在恢复连续语音..." : Platform.OS === "web" ? "连续语音已开启，可直接说话或插话" : "连续语音已开启，请等回复结束后再说话"
                  : isVoiceRecording
                  ? "正在录制本轮语音，请说话..."
                  : isVoiceTranscribing || voiceHudState.type === "processing"
                  ? "正在调用 AI 大模型解答中..."
                  : "AI 厨艺语音解答"}
              </Text>
            </View>
            {realtimeVoice.active ? (
              <TouchableOpacity
                onPress={() => void realtimeVoice.toggleMute()}
                accessibilityRole="button"
                accessibilityLabel={realtimeVoice.muted ? "恢复持续监听" : "静音持续监听"}
                className="ml-auto mr-2 h-7 w-7 items-center justify-center rounded-full bg-background-secondary"
              >
                <FontAwesome6 name={realtimeVoice.muted ? "microphone-slash" : "microphone"} size={10} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            ) : null}
            {voiceSource ? (
              <Text className="mr-2 rounded-full bg-background-secondary px-2 py-1 text-[9px] font-black text-copy-muted">
                {voiceSource === "local" ? "本地音色" : voiceSource === "server" ? "云端语音" : "系统语音"}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={() => {
                if (isVoiceRecording) stopVoiceRecording();
                if (realtimeVoice.active) void realtimeVoice.stop();
                void stopVoiceOutput();
                setVoiceHudState((prev) => ({ ...prev, visible: false }));
              }}
              className="w-6 h-6 rounded-full bg-background-secondary border border-line items-center justify-center active:bg-background-secondary"
            >
              <FontAwesome6 name="xmark" size={11} colorClassName="accent-ink" />
            </TouchableOpacity>
          </View>

          {/* Listening State Mode */}
          {voiceHudState.type === "listening" ? (
            <View className="gap-2">
              {voiceHudState.userText ? (
                <View className="flex-row items-start gap-1.5 bg-brand-soft p-2.5 rounded-xl border border-brand/20">
                  <Text className="text-xs font-bold text-brand">识别中:</Text>
                  <Text className="text-xs font-bold text-brand-strong flex-1">{voiceHudState.userText}</Text>
                </View>
              ) : (
                <Text className="text-xs font-bold text-copy-muted">
                  请直接说出问题，或点击下方常用指令：
                </Text>
              )}

              <View className="flex-row flex-wrap gap-1.5 pt-0.5">
                {["怎么切方块", "老抽放多少", "下一步", "上一步", "火候怎么掌握"].map((cmd, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => {
                      if (isVoiceRecording) stopVoiceRecording();
                      void executeDirectVoiceCommand(cmd);
                    }}
                    className="bg-background-secondary px-3 py-1.5 rounded-full border border-line active:bg-brand-soft"
                  >
                    <Text className="text-xs font-bold text-brand">“{cmd}”</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : voiceHudState.type === "processing" || isVoiceTranscribing ? (
            <View className="flex-row items-center gap-2.5 py-1.5">
              <ActivityIndicator size="small" colorClassName="accent-brand" />
              <Text className="text-xs text-brand-strong font-bold">正在为您识别语音并检索烹饪数据库...</Text>
            </View>
          ) : (
            /* Result Toast Mode */
            <View className="gap-2">
              {voiceHudState.userText ? (
                <View className="flex-row items-start gap-1.5">
                  <Text className="text-xs font-bold text-warm">你问:</Text>
                  <Text className="text-xs font-bold text-brand-strong flex-1">{voiceHudState.userText}</Text>
                </View>
              ) : null}

              {voiceHudState.actionDoneText ? (
                <View className="bg-brand-soft p-2.5 rounded-xl border border-brand/20 flex-row items-center gap-2">
                  <FontAwesome6 name="circle-check" size={13} colorClassName="accent-brand" />
                  <Text className="text-xs font-bold text-brand-strong">{voiceHudState.actionDoneText}</Text>
                </View>
              ) : null}

              {voiceHudState.aiText ? (
                <View className="bg-brand-soft/90 p-3 rounded-xl border border-brand/20 gap-1 mt-1">
                  <View className="flex-row items-center gap-1.5">
                    <FontAwesome6 name="robot" size={12} colorClassName="accent-brand" />
                    <Text className="text-xs font-black text-brand">AI 大厨解答</Text>
                  </View>
                  <Text className="text-xs leading-5 font-bold text-brand-strong mt-0.5" numberOfLines={4}>
                    {voiceHudState.aiText}
                  </Text>
                </View>
              ) : null}

            </View>
          )}
        </View>
      )}

      {/* 🛠️ UNIFIED BOTTOM CONTROL CAPSULE DOCK (全合一底栏控制胶囊) */}
      <View className="absolute bottom-6 left-4 right-4 bg-surface/95 backdrop-blur-md rounded-full p-2 flex-row items-center gap-2 shadow-2xl border border-line">
        {/* Prev Step Button */}
        <TouchableOpacity
          onPress={handlePrevStep}
          disabled={currentStep === 0}
          className={`w-10 h-10 rounded-full items-center justify-center border ${
            currentStep === 0
              ? "bg-background-secondary border-line opacity-30"
              : "bg-background-secondary border-line active:bg-background-secondary"
          }`}
        >
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>

        {/* Direct Voice Mic Button (Tap to trigger direct recording HUD) */}
        <TouchableOpacity
          onPress={handleToggleDirectMic}
          className={`w-10 h-10 rounded-full items-center justify-center shadow-xs active:scale-95 ${
            realtimeVoice.active || isVoiceRecording
              ? "bg-critical-fill"
              : "bg-highlight"
          }`}
        >
          <FontAwesome6
            name={realtimeVoice.active || isVoiceRecording ? "square" : "microphone"}
            size={realtimeVoice.active || isVoiceRecording ? 12 : 14}
            colorClassName={realtimeVoice.active || isVoiceRecording ? "accent-on-brand" : "accent-ink"}
          />
        </TouchableOpacity>

        {/* AI Kitchen Mentor Q&A Button (Soft Mint Green) */}
        <TouchableOpacity
          onPress={() => setShowAIChat(true)}
          className="w-10 h-10 rounded-full bg-brand-soft border border-brand/20 items-center justify-center active:bg-brand-soft shadow-xs"
        >
          <FontAwesome6 name="robot" size={14} colorClassName="accent-brand" />
        </TouchableOpacity>

        {/* Primary Step Action Button */}
        <TouchableOpacity
          onPress={handleNextStep}
          className="flex-1 h-10 rounded-full bg-brand-fill items-center justify-center flex-row gap-2 shadow-md active:bg-brand-fill"
        >
          <Text className="text-white font-black text-sm tracking-wide" numberOfLines={1}>
            {currentStep < cookingSteps.length - 1 ? "完成此步，下一步" : "完成烹饪!"}
          </Text>
          <FontAwesome6
            name={currentStep < cookingSteps.length - 1 ? "arrow-right" : "check"}
            size={12}
            colorClassName="accent-on-brand"
          />
        </TouchableOpacity>
      </View>

      {/* ⏱️ TIMER QUICK CONTROLS MODAL */}
      <Modal
        visible={showTimerModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowTimerModal(false)}
      >
        <View className="flex-1 bg-black/60 justify-center px-6">
          <View className="bg-surface rounded-[32px] p-6 items-center shadow-2xl border border-line">
            <View className="flex-row items-center justify-between w-full mb-4">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-brand-soft items-center justify-center">
                  <FontAwesome6 name="clock" size={14} colorClassName="accent-brand" />
                </View>
                <Text className="text-base font-bold text-brand-strong">厨房智能计时器</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTimerModal(false)} className="p-1">
                <FontAwesome6 name="xmark" size={18} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>

            {/* Huge Time Display */}
            <Text className="text-6xl font-black text-brand-strong tracking-wider my-3">
              {formatTime(timerSeconds)}
            </Text>

            <Text className="text-sm text-copy-muted mb-3">{timerMode === "countdown" && timerSeconds === 0 ? "计时已结束。" : ""}{timer.notice || "切换步骤保留当前计时；重置后使用当前步骤时长。系统强制停止应用可能阻止提醒。"}</Text>
            {/* Mode Switcher */}
            <TouchableOpacity
              onPress={toggleTimerMode}
              className="bg-background-secondary px-4 py-2 rounded-full border border-line mb-5"
            >
            <Text className="text-xs font-bold text-brand">
                当前为{timerMode === "countdown" ? "【倒计时模式】点击切为正计时" : "【正计时模式】点击切为倒计时"}
              </Text>
            </TouchableOpacity>

            {/* Quick Modifiers */}
            <View className="flex-row gap-3 mb-6">
              <TouchableOpacity
                onPress={() => handleAddMinutes(1)}
                className="bg-background-secondary px-5 py-2.5 rounded-full border border-line active:bg-highlight"
              >
                <Text className="text-xs font-bold text-ink">+1 分钟</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleAddMinutes(5)}
                className="bg-background-secondary px-5 py-2.5 rounded-full border border-line active:bg-highlight"
              >
                <Text className="text-xs font-bold text-ink">+5 分钟</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleResetTimer}
                className="bg-background-secondary px-5 py-2.5 rounded-full border border-line active:bg-background-secondary"
              >
                <Text className="text-xs font-bold text-copy-muted">重置</Text>
              </TouchableOpacity>
            </View>

            {/* Primary Action Button */}
            <TouchableOpacity
              onPress={() => {
                handleStartPauseTimer();
                setShowTimerModal(false);
              }}
              className={`w-full py-4 rounded-2xl flex-row items-center justify-center gap-2 shadow-md active:opacity-90 ${
                isTimerRunning ? "bg-critical-fill" : "bg-brand-fill"
              }`}
            >
              <FontAwesome6
                name={isTimerRunning ? "pause" : "play"}
                size={16}
                colorClassName="accent-on-brand"
              />
              <Text className="text-white font-black text-sm">
                {isTimerRunning ? "暂停计时" : "开始计时"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🥗 INGREDIENTS SHEET MODAL */}
      <Modal
        visible={showIngredientsDrawer}
        animationType="slide"
        transparent
        onRequestClose={() => setShowIngredientsDrawer(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface rounded-t-[32px] p-6 max-h-[75%]">
            <View className="flex-row items-center justify-between mb-4 border-b border-line pb-3">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-brand-soft items-center justify-center">
                  <FontAwesome6 name="basket-shopping" size={14} colorClassName="accent-brand" />
                </View>
                <Text className="text-lg font-bold text-brand-strong">食材备料打勾清单</Text>
                <Text className="text-xs text-copy-muted">
                  ({checkedIngredientsCount}/{ingredients.length})
                </Text>
              </View>

              <View className="flex-row items-center gap-3">
                <TouchableOpacity onPress={handleToggleSelectAllIngredients}>
                  <Text className="text-xs font-bold text-brand">
                    {checkedIngredientsCount === ingredients.length ? "取消全选" : "全选"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowIngredientsDrawer(false)} className="p-1">
                  <FontAwesome6 name="xmark" size={20} colorClassName="accent-copy-muted" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              <View className="flex-row flex-wrap gap-2.5 pb-4">
                {ingredients.map((ing, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => handleCheckIngredient(idx)}
                    className={`px-4 py-3 rounded-2xl border flex-row items-center gap-2.5 ${
                      ing.checked
                        ? "bg-brand-soft border-brand"
                        : "bg-background-secondary border-line"
                    }`}
                  >
                    <View
                      className={`w-5 h-5 rounded-md items-center justify-center border ${
                        ing.checked
                          ? "bg-brand-fill border-brand"
                          : "border-line"
                      }`}
                    >
                      {ing.checked && <FontAwesome6 name="check" size={10} colorClassName="accent-on-brand" />}
                    </View>
                    <Text
                      className={`text-xs font-bold ${
                        ing.checked ? "text-brand line-through" : "text-ink"
                      }`}
                    >
                      {ing.name} {ing.amount}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              onPress={() => setShowIngredientsDrawer(false)}
              className="bg-brand-fill py-4 rounded-2xl items-center justify-center mt-2 shadow-md active:bg-brand-fill"
            >
              <Text className="text-white font-bold text-sm">完成备料确认</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🎉 COOKING FINISH CELEBRATION MODAL */}
      <Modal
        visible={showFinishModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowFinishModal(false)}
      >
        <View className="flex-1 bg-black/70 justify-center px-6">
          <ScrollView className="max-h-[90%] rounded-[32px] bg-surface" contentContainerClassName="p-6 items-center" keyboardShouldPersistTaps="handled">
            <View className="w-20 h-20 rounded-full bg-highlight items-center justify-center mb-4 shadow-amber-glow">
              <FontAwesome6 name="trophy" size={36} colorClassName="accent-ink" />
            </View>

            <Text className="text-2xl font-black text-brand-strong text-center">烹饪圆满完成！</Text>
            <Text className="text-xs text-copy-muted mt-1 mb-5 text-center leading-5">
              您已成功完成了【{title || "自制菜品"}】的全部 {cookingSteps.length} 个步骤！
            </Text>

            {(queueContext?.productionMeals?.length ?? 0) > 1 && <View className="mb-3 w-full"><Text className="font-bold text-ink">共用一次制作 · 共 {queueContext?.plannedServings} 份</Text>{queueContext?.productionMeals?.map((meal, index) => <Text key={index} className="mt-1 text-copy-muted">{meal.date} · {({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" })[meal.mealType]} · {meal.servings} 份</Text>)}</View>}
            <MealProductionFields produced={producedServings} eaten={eatenServings} onProducedChange={setProducedServings} onEatenChange={setEatenServings} />
            <Text className="mt-3 text-copy-muted">实际制作花了几分钟（可留空，不使用菜谱估时）</Text>
            <TextInput accessibilityLabel="用户报告的实际制作分钟" editable={!isCompleting && !completion.pending} value={reportedMinutes} onChangeText={setReportedMinutes} keyboardType="number-pad" placeholder="例如 25" className="mt-2 w-full rounded-xl border border-line p-3 text-ink" />
            {/* Nutrition Cards Preview */}
            {(calories || protein || carbs || fat) ? (
              <View className="w-full bg-background-secondary rounded-2xl p-4 border border-line mb-5">
                <Text className="text-xs font-bold text-brand-strong mb-3 text-center">
                  菜谱营养参考（多份制作的每份营养待核实）
                </Text>
                <View className="flex-row justify-around">
                  {calories ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-brand">{calories}</Text>
                      <Text className="text-[10px] font-bold text-copy-muted">热量 kcal</Text>
                    </View>
                  ) : null}
                  {protein ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-brand">{protein}g</Text>
                      <Text className="text-[10px] font-bold text-copy-muted">蛋白质</Text>
                    </View>
                  ) : null}
                  {carbs ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-brand">{carbs}g</Text>
                      <Text className="text-[10px] font-bold text-copy-muted">碳水</Text>
                    </View>
                  ) : null}
                  {fat ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-brand">{fat}g</Text>
                      <Text className="text-[10px] font-bold text-copy-muted">脂肪</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Actions */}
            <View className="w-full gap-3">
              <View className="rounded-2xl border border-line bg-background-secondary p-3">
                <Text className="text-[10px] font-black text-ink">库存扣减方式</Text>
                <View className="mt-2 flex-row gap-1.5">
                  {([
                    ["estimated", "按菜谱预计"],
                    ["actual", "修改实际用量"],
                    ["all", "整项用完"],
                  ] as const).map(([value, label]) => (
                    <TouchableOpacity
                      key={value}
                      onPress={() => setInventoryConsumptionMode(value)}
                      className={`flex-1 items-center rounded-xl px-1 py-2 ${inventoryConsumptionMode === value ? "bg-brand-fill" : "bg-surface"}`}
                    >
                      <Text className={`text-[9px] font-black ${inventoryConsumptionMode === value ? "text-white" : "text-copy-muted"}`}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {inventoryConsumptionMode === "actual" ? (
                  <View className="mt-2 gap-1.5">
                    {ingredients.filter((ingredient) => ingredient.checked).slice(0, 5).map((ingredient) => (
                      <View key={ingredient.name} className="flex-row items-center rounded-xl bg-surface px-3">
                        <Text className="min-w-0 flex-1 text-[10px] font-bold text-ink" numberOfLines={1}>{ingredient.name}</Text>
                        <TextInput
                          value={actualConsumptionAmounts[ingredient.name] ?? ingredient.amount}
                          onChangeText={(value) => setActualConsumptionAmounts((current) => ({ ...current, [ingredient.name]: value }))}
                          placeholder="如 200g"
                          placeholderTextColorClassName="accent-copy-muted"
                          className="h-9 w-24 text-right text-[10px] font-black text-brand"
                        />
                      </View>
                    ))}
                    {ingredients.filter((ingredient) => ingredient.checked).length > 5 ? (
                      <Text className="text-[9px] text-copy-muted">其余食材沿用菜谱预计用量</Text>
                    ) : null}
                  </View>
                ) : null}
                <Text className="mt-2 text-[9px] leading-4 text-copy-muted">优先扣减更早到期批次；不可换算单位不会被强行扣减。</Text>
              </View>
              <TouchableOpacity
                onPress={() => finishCooking(true)}
                disabled={isCompleting}
                className="bg-highlight py-4 rounded-2xl items-center justify-center flex-row gap-2 shadow-md active:opacity-90"
              >
                {isCompleting ? (
                  <ActivityIndicator size="small" colorClassName="accent-ink" />
                ) : (
                  <>
                    <FontAwesome6 name="boxes-packing" size={15} colorClassName="accent-ink" />
                    <Text className="text-ink font-black text-sm">
                      {inventoryConsumptionMode === "estimated" ? "按预计扣减并保存制作" : inventoryConsumptionMode === "actual" ? "按实际用量扣减并保存" : "整项用完并保存制作"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => finishCooking(false)}
                disabled={isCompleting}
                className="bg-brand-fill py-3.5 rounded-2xl items-center justify-center flex-row gap-2 shadow-md active:opacity-90"
              >
                <FontAwesome6 name="utensils" size={14} colorClassName="accent-on-brand" />
                <Text className="text-white font-bold text-sm">保存制作，不扣原料</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowFinishModal(false)}
                disabled={isCompleting}
                className="py-2.5 items-center justify-center active:opacity-70"
              >
                <Text className="text-copy-muted text-xs font-semibold">稍后保存</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* 🤖 AI CHAT MODAL */}
      <Modal
        visible={showAIChat}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAIChat(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface rounded-t-[32px] max-h-[80%]">
            {/* Header */}
            <View className="flex-row items-center justify-between p-4 border-b border-line">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-full bg-brand-fill items-center justify-center">
                  <FontAwesome6 name="robot" size={18} colorClassName="accent-on-brand" />
                </View>
                <View className="ml-3">
                  <Text className="text-base font-bold text-brand-strong">AI 烹饪导师</Text>
                  <Text className="text-xs text-copy-muted">有任何烹饪疑问随问随答</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowAIChat(false)} className="p-2">
                <FontAwesome6 name="xmark" size={20} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>

            {/* Chat Messages */}
            <ScrollView
              className="flex-1 p-4"
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={false}
            >
              {chatMessages.length === 0 && (
                <View className="items-center py-6">
                  <FontAwesome6 name="utensils" size={36} colorClassName="accent-brand" />
                  <Text className="text-copy-muted text-xs mt-3 text-center leading-5">
                    正在烹饪【{title || "菜品"}】第 {currentStep + 1} 步{"\n"}
                    遇到调料放多少、火候问题？随时向我提问！
                  </Text>
                  <View className="mt-4 gap-2">
                    {[
                      "这一步火候怎么掌握？",
                      "没有老抽可以用什么代替？",
                      "怎样判断食材是否已经熟透？",
                    ].map((q, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => setChatInput(q)}
                        className="bg-background-secondary px-4 py-2.5 rounded-full border border-line active:bg-brand-soft"
                      >
                        <Text className="text-xs font-semibold text-brand">{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              {chatMessages.map((msg) => (
                <View
                  key={msg.id}
                  className={`mb-3 ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <View
                    className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                      msg.role === "user"
                        ? "bg-brand-fill"
                        : "bg-background-secondary border border-line"
                    }`}
                  >
                    <Text
                      className={`text-sm leading-6 ${
                        msg.role === "user" ? "text-white" : "text-ink"
                      }`}
                    >
                      {msg.content}
                    </Text>
                    {msg.role === "assistant" && typeof msg.responseTimeMs === "number" ? (
                      <Text className="mt-1 text-[10px] text-copy-muted">
                        回复耗时 {msg.responseTimeMs < 1000 ? `${Math.round(msg.responseTimeMs)} ms` : `${(msg.responseTimeMs / 1000).toFixed(2)} 秒`}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
              {isAILoading && (
                <View className="items-start mb-3">
                  <View className="bg-background-secondary px-4 py-3 rounded-2xl border border-line">
                    <Text className="text-xs text-copy-muted">思考中...</Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Input */}
            <View className="p-4 border-t border-line">
              <View className="flex-row items-center bg-background-secondary rounded-full px-4 py-2 border border-line">
                <TextInput
                  className="flex-1 text-sm text-ink px-2"
                  placeholder="问点什么..."
                  placeholderTextColorClassName="accent-copy-muted"
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={handleSendChat}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  onPress={handleSendChat}
                  disabled={!chatInput.trim() || isAILoading}
                  className={`w-8 h-8 rounded-full items-center justify-center ${
                    chatInput.trim() && !isAILoading ? "bg-brand-fill" : "bg-background-secondary"
                  }`}
                >
                  <FontAwesome6
                    name="paper-plane"
                    size={12}
                    colorClassName={chatInput.trim() && !isAILoading ? "accent-on-brand" : "accent-copy-muted"}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
