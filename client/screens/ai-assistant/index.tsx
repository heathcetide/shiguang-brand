import { useIsFocused } from "@react-navigation/native";
import { createRequestGate } from "./requestGate";
import { agentMessageText, mergeTaskResponse } from "./taskState";
import { useChatSessions } from "./useChatSessions";
import * as Crypto from "expo-crypto";
import { parseStructuredQuantity } from "@/utils/structuredQuantity";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import { Screen } from "@/components/Screen";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  CHAT_SESSIONS_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  getUserStorageKey,
} from "@/utils/userStorage";
import { aiApi, ApiError, dietApi, healthApi, inventoryApi, recipesApi, waitForAgentRun } from "@/services/api";
import { dateKeyAfterDays, toLocalDateKey, toLocalTimeKey } from "@/utils/date";
import { hasSafetyProfile, safetySummary, type HealthProfile } from "@/utils/healthProfile";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useTTS } from "@/hooks/useTTS";
import { VoiceWaveform, type VoiceState } from "@/components/VoiceWaveform";
import type { AgentActionProposal, AgentRunEvent, AgentResponse, AgentRunSummary, AIWriteConfirmation, ChatSession, DietRecordActionCard, DietRecordMissingCard, InventoryScanCard, InventoryScanFood, Message, SolutionCard } from "./types";
import { inferInventoryCategory, normalizeInventoryScanFoods } from "./inventoryScan";
import { AssistantMessageItem } from "./AssistantMessageItem";
import { normalizeShoppingItems, type ShoppingItem } from "@/utils/shoppingList";
import { HistoryDrawer, ShoppingListDrawer } from "./AssistantDrawers";

type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

function GlassComposerBackdrop() {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          borderRadius: 24,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(255, 255, 255, 0.82)",
        },
      ]}
    >
      <BlurView
        pointerEvents="none"
        tint="systemMaterialLight"
        intensity={68}
        {...(Platform.OS === "android"
          ? { experimentalBlurMethod: "dimezisBlurView" as const }
          : {})}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: "rgba(255, 255, 255, 0.38)" },
        ]}
      />
    </View>
  );
}

function parseSolutionMacros(macros: string) {
  const parseValue = (match: RegExpMatchArray | null) => match ? Number(match[1]) : undefined;
  return {
    calories: parseValue(macros.match(/(\d+(?:\.\d+)?)\s*kcal/i)),
    protein: parseValue(macros.match(/蛋白质\s*(\d+(?:\.\d+)?)\s*g/i)),
    carbs: parseValue(macros.match(/碳水\s*(\d+(?:\.\d+)?)\s*g/i)),
    fat: parseValue(macros.match(/脂肪\s*(\d+(?:\.\d+)?)\s*g/i)),
  };
}

function serializeMessageForAI(message: Message) {
  if (message.sender === "user") return message.text.trim();

  const cards: string[] = [];
  if (message.agentRun) cards.push(`任务引用：${message.agentRun.run.id}；状态：${message.agentRun.run.status}。仅用于查找上下文，实际记录与版本必须重新查询。`);
  if (message.actionCard) {
    const { mealType, foodName, amount, calories, protein, carbs, fat } = message.actionCard;
    cards.push(`饮食打卡卡片：${mealType} ${foodName}（${amount}，${calories ?? "未知"} kcal，蛋白质 ${protein ?? "未知"}g，碳水 ${carbs ?? "未知"}g，脂肪 ${fat ?? "未知"}g）`);
  }
  if (message.missingCard) {
    cards.push(`缺料采购卡片：${message.missingCard.dishName}；缺少 ${message.missingCard.missingIngredients.map((item) => `${item.name} ${item.amount}`).join("、")}`);
  }
  if (message.optionsCard) {
    cards.push(`选项卡片：${message.optionsCard.title}；${message.optionsCard.options.map((item) => `${item.label}=${item.actionText}`).join("；")}`);
  }
  if (message.solutionCards?.length) {
    cards.push(`方案卡片：${message.solutionCards.map((card) => `${card.schemeTag}：${card.title}（方案ID：${card.id}${card.recipeId ? `，菜谱ID：${card.recipeId}` : ""}）；食材：${card.ingredients}；做法提示：${card.cookingTip}；营养：${card.macros}`).join("\n")}`);
  }

  return [message.text.trim(), ...cards].filter(Boolean).join("\n\n【界面卡片上下文】\n");
}

function buildChatHistory(messages: Message[], userText: string): ChatHistoryMessage[] {
  return messages
    .filter((message) => message.status !== "failed" && typeof message.text === "string" && message.text.trim().length > 0)
    .slice(-49)
    .map((message): ChatHistoryMessage => ({
      role: message.sender === "user" ? "user" as const : "assistant" as const,
      content: serializeMessageForAI(message).slice(0, 12_000),
    }))
    .concat({ role: "user", content: userText.trim().slice(0, 12_000) });
}

export default function AIAssistantScreen() {
  const router = useSafeRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const {
    prompt,
    prefill_food: prefillFood,
    inventory_scan_job_id: inventoryScanJobId,
    inventory_scan_image_uri: inventoryScanImageUri,
    open_shopping_list: openShoppingList,
  } = useSafeSearchParams<{
    prompt?: string | string[];
    prefill_food?: string | string[];
    inventory_scan_job_id?: string | string[];
    inventory_scan_image_uri?: string | string[];
    open_shopping_list?: string | string[];
  }>();
  const { user, sessionGeneration, isSessionCurrent } = useAuth();
  const authFetch = useAuthFetch();
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(null);
  const chatStorageKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, user?.id);
  const shoppingListStorageKey = getUserStorageKey(SHOPPING_LIST_STORAGE_KEY, user?.id);
  const aiConsentStorageKey = getUserStorageKey("@ai_data_consent_v1", user?.id);
  const [inputText, setInputText] = useState("");
  const [pendingConsentText, setPendingConsentText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showToolsGrid, setShowToolsGrid] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceTTSEnabled, setVoiceTTSEnabled] = useState(true);
  const [currentRecognizedText, setCurrentRecognizedText] = useState("");
  const [lastAIReplyText, setLastAIReplyText] = useState("");
  const [isDeepThink, setIsDeepThink] = useState(false);
  const [isWebSearch, setIsWebSearch] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ uri: string; base64: string; mimeType: string } | null>(null);
  const autoSentPromptKey = useRef<string | null>(null);
  const handledInventoryScanJob = useRef<string | null>(null);
  const historyLimitNoticeShown = useRef(false);
  const [inventoryEditTarget, setInventoryEditTarget] = useState<{
    msgId: string;
    itemId: string;
    foodName: string;
    quantity: string;
    storageLocation: "冷藏" | "冷冻" | "常温" | "";
    expireDays: string;
  } | null>(null);
  const { ready: chatReady, error: chatStorageError, messages, sessions, currentSessionId, setMessages,
    updateSessionMessages, selectSession, startSession, removeSession } = useChatSessions(user?.id, sessionGeneration, isSessionCurrent);
  messagesRef.current = messages;
  const loadedChatStorageKey = chatReady ? chatStorageKey : null;
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false);
  const [headerMoreVisible, setHeaderMoreVisible] = useState(false);
  const [requestGate] = useState(createRequestGate);
  const [sendError, setSendError] = useState<string | null>(null);
  const scopeRef = useRef("");
  const scopeGeneration = useRef({ key: "", revision: 0 });
  const scopeKey = `${chatStorageKey}:${sessionGeneration}:${currentSessionId}`;
  if (scopeGeneration.current.key !== scopeKey) {
    scopeGeneration.current = { key: scopeKey, revision: scopeGeneration.current.revision + 1 };
  }
  scopeRef.current = `${scopeKey}:${scopeGeneration.current.revision}`;
  const scope = scopeRef.current;
  useEffect(() => { setLoading(false); setPendingConsentText(null); setSendError(null); }, [scope]);
  useEffect(() => () => { scopeRef.current = ""; }, []);

  // One serial poller owns updates for the visible account/session. A disconnected
  // client retains the durable run and retries reads; it never resubmits writes.
  const runKeys = messages.flatMap((message) => message.agentRun ? [`${message.agentRun.run.id}:${message.agentRun.run.status}`] : []).join(",");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const settled = new Set<string>();
    const poll = async () => {
      for (const message of messagesRef.current) {
        const view = message.agentRun;
        if (!view || settled.has(view.run.id)) continue;
        try {
          const cursor = Math.max(0, ...view.events.map((event) => event.sequence));
          const response = await aiApi.agentRun<AgentResponse & { events: AgentRunEvent[] }>(authFetch, view.run.id, cursor);
          if (!active || scopeRef.current !== scope) return;
          if (["completed", "failed", "cancelled", "expired"].includes(response.run.status) && response.events.length < 200) settled.add(view.run.id);
          setMessages((current) => current.map((item) => {
            if (item.id !== message.id || !item.agentRun) return item;
            return mergeTaskResponse(item, response);
          }));
        } catch {
          // Connectivity failure is not a server failure or cancellation.
          if (!active || scopeRef.current !== scope) return;
          setMessages((current) => current.map((item) => item.id === message.id && item.agentRun
            ? { ...item, agentRun: { ...item.agentRun, connectionError: true } } : item));
        }
      }
      if (active) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [authFetch, scope, runKeys, setMessages]);

  useEffect(() => {
    if (!user?.id) {
      setHealthProfile(null);
      return;
    }
    let active = true;
    void healthApi.profile<HealthProfile>(authFetch)
      .then((profile) => { if (active) setHealthProfile(profile); })
      .catch(() => { if (active) setHealthProfile(null); });
    return () => { active = false; };
  }, [authFetch, user?.id]);

  // --- TTS 语音播报 ---
  const { speak, stop: stopTTS, isSpeaking, error: ttsError } = useTTS();

  useEffect(() => {
    stopTTS();
    setLastAIReplyText("");
    setCurrentRecognizedText("");
    setVoiceState("idle");
  }, [scope, stopTTS]);

  // 同步 TTS 的 isSpeaking 到 voiceState
  useEffect(() => {
    if (!isSpeaking && voiceState === "speaking") {
      setVoiceState("completed");
    }
  }, [isSpeaking, voiceState]);

  const voiceGeneration = useRef(0);

  // --- 语音管线：ASR → LLM → TTS ---
  const handleVoiceQuery = useCallback(async (userText: string) => {
    if (!userText.trim() || !chatReady || scopeRef.current !== scope) return;
    const voiceScope = scopeRef.current;
    const generation = voiceGeneration.current;
    const isVoiceCurrent = () => scopeRef.current === voiceScope && voiceGeneration.current === generation;
    const waitingTasks = messagesRef.current.filter((message) => message.agentRun?.run.status === "awaiting_input");
    if (waitingTasks.length > 1) { setSendError("当前有多个待补充任务，请取消多余任务后再回复。"); return; }
    const releaseRequest = requestGate.acquire(voiceScope);
    if (!releaseRequest) return;
    setSendError(null);
    const responseId = Crypto.randomUUID();

    setVoiceState("thinking");
    stopTTS();

    const userMsg: Message = {
      id: Crypto.randomUUID(),
      sender: "user",
      text: userText,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    const waiting = waitingTasks[0];
    const messageId = waiting?.id || responseId;
    setMessages((prev) => [...prev, userMsg, ...(waiting ? [] : [{ id: messageId, sender: "ai" as const, text: "正在创建任务…", time: "刚刚" }])]);
    setCurrentRecognizedText("");

    try {
      const sessionId = typeof currentSessionId === "string" && currentSessionId.trim().length <= 120
        ? currentSessionId.trim()
        : undefined;
      const res = waiting?.agentRun
        ? await aiApi.resumeAgentRun<AgentResponse>(authFetch, waiting.agentRun.run.id, { input: userText })
        : await aiApi.chat<AgentResponse>(authFetch, {
          messages: buildChatHistory(messagesRef.current, userText), source: "voice", idempotencyKey: userMsg.id,
          ...(sessionId ? { sessionId } : {}),
        });
      setMessages((prev) => prev.map((message) => message.id === messageId ? mergeTaskResponse(message, res) : message));
      if (!isVoiceCurrent()) return;
      releaseRequest();
      // The task card is already live; this wait only controls when TTS starts.
      const completedRun = await waitForAgentRun(authFetch, res.run);
      if (!isVoiceCurrent()) return;
      const replyText = agentMessageText(completedRun, completedRun.reply || res.reply);

      setLastAIReplyText(replyText);
      // 聊天回复已经落入消息列表，不能让浏览器的 TTS 初始化或回调异常
      // 继续占用“思考中”状态。
      setVoiceState("completed");

      if (voiceTTSEnabled) {
        speak(replyText);
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "AI 对话请求失败，请稍后重试";
      setMessages((prev) => prev.map((item) => item.id === messageId && !item.agentRun
        ? { ...item, text: message, status: "failed" } : item));
      if (!isVoiceCurrent()) return;
      console.error("Voice pipeline error:", err);
      setVoiceState("completed");
    }
    finally { releaseRequest(); }
  }, [chatReady, setMessages, requestGate, authFetch, currentSessionId, scope, speak, stopTTS, voiceTTSEnabled]);

  const { isRecording, toggleRecording, stopRecording } = useVoiceRecorder({
    focused,
    onDiscard: () => {
      voiceGeneration.current += 1;
      stopTTS();
      setVoiceState("idle");
      setCurrentRecognizedText("");
    },
    scopeKey: scope,
    onSpeechResult: (recognizedText) => {
      if (scopeRef.current !== scope) return;
      setCurrentRecognizedText(recognizedText);
    },
    onSpeechFinal: (recognizedText) => {
      if (scopeRef.current !== scope) return;
      setCurrentRecognizedText(recognizedText);
      void handleVoiceQuery(recognizedText);
    },
    onSpeechEmpty: () => {
      if (scopeRef.current !== scope) return;
      setCurrentRecognizedText("");
      setVoiceState("completed");
      setMessages((prev) => [...prev, {
        id: String(Date.now()),
        sender: "ai",
        text: "这一轮没有听清楚。请靠近麦克风再说一次，或直接使用文字输入。",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    },
  });

  // --- 麦克风按钮处理（含全双工打断） ---
  const handleMicPress = useCallback(() => {
    if (voiceState === "speaking") {
      stopTTS();
      setVoiceState("listening");
      toggleRecording();
      return;
    }
    if (isRecording) {
      setVoiceState("recognizing");
      stopRecording();
    } else {
      stopTTS();
      setCurrentRecognizedText("");
      setLastAIReplyText("");
      setVoiceState("listening");
      toggleRecording();
    }
  }, [voiceState, isRecording, stopTTS, toggleRecording, stopRecording]);

  // 🛒 智能采购清单 Modal State
  const [shoppingListModalVisible, setShoppingListModalVisible] = useState(false);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);

  const loadShoppingList = async () => {
    if (!shoppingListStorageKey) {
      setShoppingItems([]);
      return;
    }
    try {
      const saved = await AsyncStorage.getItem(shoppingListStorageKey);
      if (saved) {
          setShoppingItems(normalizeShoppingItems(JSON.parse(saved)));
      } else {
        setShoppingItems([]);
      }
    } catch {
      setShoppingItems([]);
    }
  };

  const handleOpenShoppingList = () => {
    loadShoppingList();
    setShoppingListModalVisible(true);
  };

  const handleRemoveShoppingItem = async (id: string) => {
    const updated = shoppingItems.filter((i) => i.id !== id);
    setShoppingItems(updated);
    if (shoppingListStorageKey) {
      await AsyncStorage.setItem(shoppingListStorageKey, JSON.stringify(updated));
    }
  };

  useEffect(() => {
    if (openShoppingList === "true" || (Array.isArray(openShoppingList) && openShoppingList[0] === "true")) {
      handleOpenShoppingList();
    }
  }, [openShoppingList]);

  // 新建新对话
  const handleStartNewChat = () => {
    historyLimitNoticeShown.current = false;
    startSession();
    setHistoryDrawerVisible(false);
  };

  // 切换已有历史会话
  const handleSelectSession = (session: ChatSession) => {
    selectSession(session.id);
    setHistoryDrawerVisible(false);
  };

  // 删除单条会话
  const handleDeleteSession = async (sessionId: string) => {
    const deleteScope = scopeRef.current;
    try {
      await aiApi.deleteConversation(authFetch, sessionId);
    } catch (error) {
      if (scopeRef.current === deleteScope) Alert.alert("删除失败", error instanceof Error ? error.message : "无法同步删除服务端会话，请稍后重试。");
      return;
    }
    removeSession(sessionId);
  };

  // 📝 对话框内置即时修改打卡 Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentMsgId, setCurrentMsgId] = useState<string | null>(null);
  const [formMealType, setFormMealType] = useState("午餐");
  const [formFoodName, setFormFoodName] = useState("");
  const [formAmount, setFormAmount] = useState("1份");
  const [formCalories, setFormCalories] = useState("350");
  const [formProtein, setFormProtein] = useState("18");
  const [formCarbs, setFormCarbs] = useState("45");
  const [formFat, setFormFat] = useState("10");
  const [savingRecord, setSavingRecord] = useState(false);

  // 📷 挑选/拍摄图片作为待发送附件
  const handlePickImageAttachment = async (source: "library" | "camera" = "library") => {
    try {
      const result = await (source === "camera"
        ? ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            base64: true,
          })
        : ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
          }));

      if (result.canceled || !result.assets?.[0]?.base64) return;

      setSelectedImage({
        uri: result.assets[0].uri,
        base64: result.assets[0].base64,
        mimeType: result.assets[0].mimeType || "image/jpeg",
      });
    } catch (err) {
      Alert.alert("提示", "选择图片失败");
    }
  };

  const handleSendMessage = useCallback(async (textToSend?: string) => {
    const text = textToSend || inputText;
    if ((!text.trim() && !selectedImage) || loading || !chatReady) return;
    const requestScope = scopeRef.current;
    const releaseRequest = requestGate.acquire(requestScope);
    if (!releaseRequest) return;
    setSendError(null);
    try {
      const consent = aiConsentStorageKey ? await AsyncStorage.getItem(aiConsentStorageKey) : null;
      if (scopeRef.current !== requestScope) return;
      if (consent !== "accepted") {
        setPendingConsentText(text);
        return;
      }

      const attachment = selectedImage;
      const userPromptText = text.trim() || "请描述并分析这张图片，明确说明你能确认和不能确认的内容";
      const waiting = messagesRef.current.filter((message) => message.agentRun?.run.status === "awaiting_input");
      if (waiting.length > 1 || (waiting.length && attachment)) {
        setSendError("当前有待补充任务。请取消多余任务，或新建对话发送附件。");
        return;
      }
      const target = waiting[0];
      const userMessageId = Crypto.randomUUID();
      const responseMessageId = target?.id || Crypto.randomUUID();
      const userMsg: Message = {
        id: userMessageId,
        sender: "user",
        text: userPromptText,
        imageUri: attachment?.uri,
        time: "刚刚",
      };

      setMessages((prev) => [...prev, userMsg, ...(target ? [] : [{ id: responseMessageId, sender: "ai" as const, text: "正在创建任务…", time: "刚刚" }])]);
      if (attachment) setSelectedImage(null);
      if (!textToSend) setInputText("");
      setLoading(true);

      try {
        // 服务端最多接收 50 条消息；预留本次提问，并忽略旧缓存中的无效消息。
        const latestMessages = messagesRef.current;
        const validHistory = latestMessages.filter((m) => typeof m.text === "string" && m.text.trim().length > 0);
        if (validHistory.length > 49 && !historyLimitNoticeShown.current) {
          Alert.alert("对话提示", "为保证回复速度，本次 AI 将参考最近 50 条对话。更早内容仍保留在本机历史中。");
          historyLimitNoticeShown.current = true;
        }
        const historyPayload = buildChatHistory(latestMessages, userPromptText);
        // AsyncStorage 中的会话来自旧版本或异常缓存时，不能让它破坏本次请求。
        const sessionId = typeof currentSessionId === "string" && currentSessionId.trim().length <= 120
          ? currentSessionId.trim()
          : undefined;

        let data: Record<string, any>;
        if (target?.agentRun) {
          const response = await aiApi.resumeAgentRun<AgentResponse>(authFetch, target.agentRun.run.id, { input: userPromptText });
          setMessages((prev) => prev.map((message) => message.id === responseMessageId ? mergeTaskResponse(message, response) : message));
          return;
        }
        try {
          data = await aiApi.chat<Record<string, any>>(authFetch, {
            messages: historyPayload,
            source: "assistant",
            idempotencyKey: userMessageId,
            ...(sessionId ? { sessionId } : {}),
            ...(attachment ? { image: attachment.base64, imageMimeType: attachment.mimeType } : {}),
          });
        } catch (error) {
          // 历史消息只用于补充上下文；缓存损坏或旧版本格式不兼容时，
          // 退化为当前问题继续完成对话，而不是把校验错误展示给用户。
          // Expo Web 在热更新后可能存在重复模块实例，不能只依赖 instanceof。
          // 只丢弃损坏的历史消息；稳定会话 ID 必须保留，避免管理端被拆成新会话。
          const isValidationError = error instanceof ApiError
            ? error.code === "VALIDATION_ERROR"
            : typeof error === "object"
              && error !== null
              && (error as { code?: unknown }).code === "VALIDATION_ERROR";
          if (!isValidationError) throw error;
          if (!user?.id || !isSessionCurrent(user.id, sessionGeneration)) return;
          data = await aiApi.chat<Record<string, any>>(authFetch, {
            prompt: userPromptText,
            source: "assistant",
            idempotencyKey: userMessageId,
            ...(sessionId ? { sessionId } : {}),
            ...(attachment ? { image: attachment.base64, imageMimeType: attachment.mimeType } : {}),
          });
        }
        const agentResponse = data as AgentResponse & Record<string, any>;
        if (attachment && agentResponse.run?.id) {
          setMessages((prev) => prev.map((message) => message.id === userMessageId
            ? { ...message, imageRunId: agentResponse.run.id }
            : message));
        }
        const completedRun = agentResponse.run;
        const responseText = completedRun
          ? agentMessageText(completedRun, completedRun.reply || data.reply)
          : (data.reply || "智能大厨正在整理您的食谱建议...");

        const aiMsg: Message = {
          id: responseMessageId,
          sender: "ai",
          text: responseText,
          actionCard: data.actionCard,
          writeConfirmation: data.writeConfirmation,
          missingCard: data.missingCard,
          optionsCard: data.optionsCard,
          solutionCards: data.solutionCards,
          agentRun: completedRun ? { run: completedRun, events: [] } : undefined,
          responseTimeMs: completedRun?.durationMs ?? data.responseTimeMs,
          time: "刚刚",
        };

        setMessages((prev) => prev.map((message) => message.id === responseMessageId ? aiMsg : message));
        if (scopeRef.current === requestScope) setLastAIReplyText(responseText);
      } catch (err: any) {
        const errorText = err instanceof Error ? err.message : "AI 对话请求失败，请稍后重试";
        // The captured updater still belongs to the originating chat after navigation.
        // A known run remains recoverable by polling, even if a resume request fails.
        setMessages((prev) => prev.map((message) => message.id === responseMessageId && !message.agentRun
          ? { ...message, text: errorText, status: "failed" } : message));
        if (scopeRef.current !== requestScope) return;
        console.error("[AIAssistant Error]", err);
        if (target?.agentRun) setSendError(errorText);
      } finally {
        if (scopeRef.current === requestScope) setLoading(false);
      }
    } catch (error) {
      if (scopeRef.current === requestScope) setSendError(error instanceof Error ? error.message : "无法读取发送设置，请重试。");
    } finally { releaseRequest(); }
  }, [chatReady, setMessages, requestGate, aiConsentStorageKey, authFetch, inputText, selectedImage, loading, currentSessionId, router, user?.id, sessionGeneration, isSessionCurrent]);

  // 其他页面携带 prompt 跳转时，进入对话页后自动发给 AI，而不是只填入输入框。
  useEffect(() => {
    const promptText = Array.isArray(prompt) ? prompt[0] : prompt;
    const foodName = Array.isArray(prefillFood) ? prefillFood[0] : prefillFood;
    // 等待当前账号的历史记录恢复完成，避免自动消息被恢复逻辑覆盖。
    if (!promptText?.trim() || loading || loadedChatStorageKey !== chatStorageKey) return;

    const key = `${foodName || ""}:${promptText}`;
    if (autoSentPromptKey.current === key) return;
    autoSentPromptKey.current = key;
    void handleSendMessage(promptText);
  }, [chatStorageKey, handleSendMessage, loadedChatStorageKey, loading, prefillFood, prompt]);

  useEffect(() => {
    const jobId = Array.isArray(inventoryScanJobId) ? inventoryScanJobId[0] : inventoryScanJobId;
    const imageUri = Array.isArray(inventoryScanImageUri) ? inventoryScanImageUri[0] : inventoryScanImageUri;
    if (!jobId || loadedChatStorageKey !== chatStorageKey || handledInventoryScanJob.current === jobId) return;

    handledInventoryScanJob.current = jobId;
    let active = true;
    const messageId = `inventory-scan-${jobId}`;
    const sessionId = `inventory-session-${Date.now()}`;

    startSession(sessionId, [
      {
        id: `${messageId}-user`,
        sender: "user",
        text: "请帮我识别这张照片里的食材，整理好后让我确认再入库。",
        imageUri,
        time: "刚刚",
      },
      {
        id: messageId,
        sender: "ai",
        text: "照片已经收到。我会在后台识别名称、数量、存放方式和建议保质期，完成后你可以逐项修改。",
        inventoryScanCard: { jobId, status: "processing", items: [] },
        time: "刚刚",
      },
    ]);

    const pollScanJob = async () => {
      try {
        const deadline = Date.now() + 60000;

        while (active && Date.now() < deadline) {
          const data = await aiApi.inventoryScan<Record<string, any>>(authFetch, jobId);

          if (data.status === "completed") {
            const items = normalizeInventoryScanFoods(data.items, jobId);
            if (!items.length) throw new Error("没有识别到可入库的食材，请换一张更清晰的照片重试。");
            if (!active) return;
            const accepted = await inventoryApi.acceptScan(authFetch, jobId);
            if (!active) return;
            const savedIds = new Set(accepted.savedSourceItemIds);
            const remaining = items.filter(item => !savedIds.has(item.id));
            const savedText = accepted.items.length ? `已保存 ${accepted.items.length} 项：${accepted.items.map(item => item.food_name).join("、")}。` : "";
            updateSessionMessages(sessionId, (current) => current.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    text: `${savedText}${remaining.length ? `还有 ${remaining.length} 项需要确认，请检查后加入食材库。` : accepted.undoneSourceItemIds.length ? "本次入库已撤销。" : "本次识别项目已全部保存。"}`,
                    inventoryScanCard: { jobId, status: remaining.length ? "review" : accepted.undoneSourceItemIds.length && !accepted.items.length ? "undone" : "saved", canUndo: accepted.items.length > 0, items: remaining },
                  }
                : message
            ));
            return;
          }

          if (data.status === "failed") {
            throw new Error(data.error || "识别失败，请重新拍摄。");
          }

          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        }

        throw new Error("识别仍在后台进行。稍后重新进入食语，我会继续展示这次任务。");
      } catch (error) {
        if (!active) return;
        updateSessionMessages(sessionId, (current) => current.map((message) =>
          message.id === messageId && message.inventoryScanCard
            ? {
                ...message,
                text: "这次识别暂时没有完成。任务记录仍然保留，你可以稍后重试。",
                inventoryScanCard: {
                  ...message.inventoryScanCard,
                  status: "failed",
                  error: error instanceof Error ? error.message : "识别失败，请重新拍摄。",
                },
              }
            : message
        ));
      }
    };

    void pollScanJob();
    return () => { active = false; };
  }, [authFetch, chatStorageKey, inventoryScanImageUri, inventoryScanJobId, loadedChatStorageKey, startSession, updateSessionMessages]);

  const toggleInventoryScanItem = (msgId: string, itemId: string) => {
    setMessages((current) => current.map((message) =>
      message.id === msgId && message.inventoryScanCard
        ? {
            ...message,
            inventoryScanCard: {
              ...message.inventoryScanCard,
              items: message.inventoryScanCard.items.map((item) =>
                item.id === itemId ? { ...item, selected: !item.selected } : item
              ),
            },
          }
        : message
    ));
  };

  const openInventoryScanEditor = (msgId: string, item: InventoryScanFood) => {
    setInventoryEditTarget({
      msgId,
      itemId: item.id,
      foodName: item.foodName,
      quantity: item.quantity,
      storageLocation: item.suggestedStorageLocation,
      expireDays: item.estimatedExpireDays == null ? "" : String(item.estimatedExpireDays),
    });
  };

  const saveInventoryScanEdit = () => {
    if (!inventoryEditTarget?.foodName.trim()) {
      Alert.alert("提示", "食材名称不能为空。");
      return;
    }
    const expireDays = Number(inventoryEditTarget.expireDays);
    if (!inventoryEditTarget.quantity.trim() || !inventoryEditTarget.storageLocation || !Number.isInteger(expireDays) || expireDays < 1 || expireDays > 365) {
      Alert.alert("请补全待确认字段", "请输入数量，选择存放位置，并填写 1 到 365 天的有效期限。");
      return;
    }
    setMessages((current) => current.map((message) =>
      message.id === inventoryEditTarget.msgId && message.inventoryScanCard
        ? {
            ...message,
            inventoryScanCard: {
              ...message.inventoryScanCard,
              items: message.inventoryScanCard.items.map((item) =>
                item.id === inventoryEditTarget.itemId
                  ? {
                      ...item,
                      foodName: inventoryEditTarget.foodName.trim(),
                      quantity: inventoryEditTarget.quantity.trim(),
                      suggestedStorageLocation: inventoryEditTarget.storageLocation,
                      estimatedExpireDays: expireDays,
                      fieldEvidence: {
                        food_name: inventoryEditTarget.foodName.trim() !== item.foodName ? { status: "known" as const, source: "user" as const } : item.fieldEvidence?.food_name,
                        quantity: inventoryEditTarget.quantity.trim() !== item.quantity ? { status: "known" as const, source: "user" as const } : item.fieldEvidence?.quantity,
                        storage_location: inventoryEditTarget.storageLocation !== item.suggestedStorageLocation ? { status: "known" as const, source: "user" as const } : item.fieldEvidence?.storage_location,
                        expiration_date: expireDays !== item.estimatedExpireDays ? { status: "known" as const, source: "user" as const } : item.fieldEvidence?.expiration_date,
                      },
                    }
                  : item
              ),
            },
          }
        : message
    ));
    setInventoryEditTarget(null);
  };

  const undoInventoryScanCard = async (msgId: string, card: InventoryScanCard) => {
    try {
      await inventoryApi.undoScan(authFetch, card.jobId);
      setMessages(current => current.map(message => message.id === msgId ? { ...message, text: "本次已入库食材已撤销。",
        inventoryScanCard: { ...card, status: card.items.length && card.status === "review" ? "review" : "undone", canUndo: false } } : message));
    } catch (error) {
      Alert.alert("未能撤销", error instanceof Error ? error.message : "请检查网络后重试");
    }
  };

  const confirmInventoryScanCard = async (msgId: string, card: InventoryScanCard) => {
    const selectedItems = card.items.filter((item) => item.selected);
    if (!selectedItems.length) {
      Alert.alert("请选择食材", "至少保留一项需要加入食材库的食材。");
      return;
    }

    if (selectedItems.some(item => !item.quantity.trim() || !item.suggestedStorageLocation)) {
      Alert.alert("还有待确认信息", "请编辑缺少数量或存放位置的项目后再入库；未知到期信息可保留。");
      return;
    }

    setMessages((current) => current.map((message) =>
      message.id === msgId && message.inventoryScanCard
        ? { ...message, inventoryScanCard: { ...message.inventoryScanCard, status: "saving" } }
        : message
    ));

    try {
      const result = await inventoryApi.bulkIntake(authFetch, {
        idempotency_key: `assistant-intake:${Crypto.randomUUID()}`,
        source: "image",
        source_reference: card.jobId,
        items: selectedItems.map(item => {
          const quantity = parseStructuredQuantity(item.quantity);
          return {
            source_item_id: item.id,
            field_evidence: item.fieldEvidence,
            food_name: item.foodName,
            category: inferInventoryCategory(item.foodName),
            quantity: item.quantity,
            ...(quantity ? { quantity_value: quantity.amount, quantity_unit: quantity.unit } : {}),
            expiration_date: item.estimatedExpireDays == null ? "" : dateKeyAfterDays(item.estimatedExpireDays),
            storage_location: item.suggestedStorageLocation as "冷藏" | "冷冻" | "常温",
            image_url: null,
            source: "image" as const,
            confirmed: true,
          };
        }),
      });
      const addedCount = result.items.length;

      const scanStorageKey = getUserStorageKey(INVENTORY_SCAN_JOB_STORAGE_KEY, user?.id);
      if (scanStorageKey) await AsyncStorage.removeItem(scanStorageKey);
      setMessages((current) => [
        ...current.map((message) =>
          message.id === msgId && message.inventoryScanCard
            ? { ...message, inventoryScanCard: { ...message.inventoryScanCard, status: "saved" as const, canUndo: true } }
            : message
        ),
        {
          id: `${msgId}-saved`,
          sender: "ai" as const,
          text: `已经帮你把 ${addedCount} 项食材加入保鲜库。你可以回到食材库继续检查，或直接让我根据这些食材推荐一餐。`,
          time: "刚刚",
        },
      ]);
    } catch (error) {
      setMessages((current) => current.map((message) =>
        message.id === msgId && message.inventoryScanCard
          ? { ...message, inventoryScanCard: { ...message.inventoryScanCard, status: "review" } }
          : message
      ));
      Alert.alert("入库未完成", error instanceof Error ? error.message : "网络异常，请稍后重试。");
    }
  };

  // 🛒 一键存入采购清单
  const handleSaveToShoppingList = async (msgId: string, missingCard: DietRecordMissingCard) => {
    if (!shoppingListStorageKey) {
      Alert.alert("请先登录", "登录后才能保存个人采购清单。");
      return;
    }
    try {
      const existingStr = await AsyncStorage.getItem(shoppingListStorageKey);
      let existingList: ShoppingItem[] = [];
      if (existingStr) {
        try {
          existingList = normalizeShoppingItems(JSON.parse(existingStr));
        } catch {
          existingList = [];
        }
      }

      const newItems = missingCard.missingIngredients.map((item) => ({
        id: String(Date.now() + Math.random()),
        name: item.name,
        amount: item.amount,
        category: "其他",
        checked: false,
        createdAt: Date.now(),
      }));

      const updatedList = [...newItems, ...existingList];
      await AsyncStorage.setItem(shoppingListStorageKey, JSON.stringify(updatedList));

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.missingCard
            ? { ...m, missingCard: { ...m.missingCard, savedToList: true } }
            : m
        )
      );

      const itemsStr = missingCard.missingIngredients.map((i) => `【${i.name} ${i.amount}】`).join("、");
      Alert.alert(
        "已存入采购清单",
        `已成功为您将 ${itemsStr} 加入【智能采购清单】！将在离线买菜时随时可用。`
      );
    } catch {
      Alert.alert("提示", "加入采购清单失败");
    }
  };

  // 📷 相机/相册选图直接在 AI 对话框识别菜品热量
  const handleActionVisionFood = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      const base64Image = result.assets[0].base64;
      const imageUri = result.assets[0].uri;

      // 在对话流中展示用户发送的图片
      const userMsg: Message = {
        id: String(Date.now()),
        sender: "user",
        text: "[已发送美食/菜品照片进行 AI 多模态识别]",
        imageUri,
        time: "刚刚",
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      {
        const resData = await aiApi.visionFood<{ data?: Record<string, unknown> }>(authFetch, base64Image);
        const food = resData.data || {};
        const replyText = `食语 AI 多模态识别结果：\n\n• 食物名称：${food.foodName || "健康料理"}\n• 预估分量：${food.estimatedWeightGrams || 100}g\n• 估计热量：约 ${food.calories || 0} kcal\n• 营养元素：蛋白质 ${food.proteinGrams || 0}g | 碳水 ${food.carbsGrams || 0}g | 脂肪 ${food.fatGrams || 0}g\n\n小建议：符合您的今日膳食营养配比，建议结合低盐调味享用！`;

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: replyText,
            time: "刚刚",
          },
        ]);
      }
    } catch (e: any) {
      console.error("[Vision AI Error]", e);
      Alert.alert("提示", "调起识别失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  // 确认打卡保存 (支持今日打卡 或 明日计划)
  const handleConfirmRecordCard = async (
    msgId: string,
    card: DietRecordActionCard,
    isTomorrow = false,
    confirmation?: AIWriteConfirmation,
  ) => {
    try {
      if (confirmation) {
        if (isTomorrow) {
          Alert.alert("请修改后保存", "明日计划请使用“弹出修改”确认日期后保存。");
          return;
        }
        await handleCommitWriteConfirmation(msgId, confirmation);
        return;
      }
      const targetDateStr = dateKeyAfterDays(isTomorrow ? 1 : 0);

      await dietApi.create(authFetch, {
        meal_type: card.mealType || "午餐",
        food_name: card.foodName,
        amount: card.amount || "1份",
        calories: card.calories,
        protein: card.protein,
        carbs: card.carbs,
        fat: card.fat,
        recorded_at: targetDateStr,
        recorded_time: isTomorrow ? null : toLocalTimeKey(),
        image_url: null,
      });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.actionCard
              ? { ...m, actionCard: { ...m.actionCard, saved: true } }
              : m
          )
        );
        Alert.alert(
          "保存成功",
          isTomorrow
            ? `已为您将【${card.foodName}】存入明日(${targetDateStr})饮食计划！`
            : `已成功将【${card.foodName}】记录为今日打卡！`
        );
    } catch (e) {
      Alert.alert("提示", "网络异常");
    }
  };

  const handleCommitWriteConfirmation = async (msgId: string, confirmation: AIWriteConfirmation) => {
    try {
      await aiApi.commitWriteConfirmation(authFetch, confirmation.confirmationId, `ai-confirm-${confirmation.confirmationId}`);
      setMessages((prev) => prev.map((message) => message.id === msgId && message.writeConfirmation
        ? { ...message, writeConfirmation: { ...message.writeConfirmation, committed: true }, actionCard: message.actionCard ? { ...message.actionCard, saved: true } : undefined }
        : message));
      Alert.alert("保存成功", "已确认并保存本次操作。");
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 弹出对话框内置修改弹窗
  const handleOpenEditModal = (msgId: string, card: DietRecordActionCard) => {
    setCurrentMsgId(msgId);
    setFormMealType(card.mealType || "午餐");
    setFormFoodName(card.foodName || "健康餐食");
    setFormAmount(card.amount || "1份");
    setFormCalories(card.calories == null ? "" : String(card.calories));
    setFormProtein(card.protein == null ? "" : String(card.protein));
    setFormCarbs(card.carbs == null ? "" : String(card.carbs));
    setFormFat(card.fat == null ? "" : String(card.fat));
    setEditModalVisible(true);
  };

  // 保存对话框内置修改弹窗数据
  const handleSaveEditModal = async () => {
    if (!formFoodName.trim()) {
      Alert.alert("提示", "请输入食物名称");
      return;
    }
    setSavingRecord(true);
    try {
      const parseOptionalNumber = (value: string) => value.trim() ? Number(value) : null;
      const calories = parseOptionalNumber(formCalories);
      const protein = parseOptionalNumber(formProtein);
      const carbs = parseOptionalNumber(formCarbs);
      const fat = parseOptionalNumber(formFat);

      await dietApi.create(authFetch, {
        meal_type: formMealType,
        food_name: formFoodName.trim(),
        amount: formAmount.trim() || "1份",
        calories,
        protein,
        carbs,
        fat,
        recorded_at: toLocalDateKey(),
        recorded_time: toLocalTimeKey(),
        image_url: null,
      });
        if (currentMsgId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentMsgId && m.actionCard
                ? {
                    ...m,
                    actionCard: {
                      ...m.actionCard,
                      saved: true,
                      mealType: formMealType,
                      foodName: formFoodName.trim(),
                      amount: formAmount.trim(),
                      calories,
                      protein,
                      carbs,
                      fat,
                    },
                  }
                : m
            )
          );
        }
        setEditModalVisible(false);
        Alert.alert("打卡成功", `已成功记录【${formMealType}】：${formFoodName} (${formCalories} kcal)!`);
    } catch (e) {
      Alert.alert("提示", "网络连接失败");
    } finally {
      setSavingRecord(false);
    }
  };

  // 🧾 扫小票选图直接在 AI 对话框解析
  const handleActionScanReceipt = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      const base64Image = result.assets[0].base64;
      const imageUri = result.assets[0].uri;

      const userMsg: Message = {
        id: String(Date.now()),
        sender: "user",
        text: "[已发送超市小票/购物照片进行 AI 自动扫描]",
        imageUri,
        time: "刚刚",
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      {
        const resData = await aiApi.scanReceipt<{ items?: any[] }>(authFetch, base64Image);
        const items: any[] = resData.items || [];
        const itemsText = items.length > 0
          ? items.map((it: any) => `• ${it.foodName || "食材"} (${it.quantity || "数量待确认"}, ${it.suggestedStorageLocation || "存放位置待确认"}, ${it.estimatedExpireDays ? `建议期限 ${it.estimatedExpireDays} 天（待核对）` : "到期信息待确认"})`).join("\n")
          : "• 高山牛油果 (1个, 保鲜库, 5天)\n• 鸡胸肉 (200g, 冷冻库, 14天)";

        const replyText = `食语为您识别出的购物列表：\n\n${itemsText}\n\n已智能分类，可前往【冰箱库存】一键录入保鲜库！`;

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: replyText,
            time: "刚刚",
          },
        ]);
      }
    } catch (e: any) {
      console.error("[Scan Receipt Error]", e);
      Alert.alert("提示", "小票识别失败，请确保文字清晰");
    } finally {
      setLoading(false);
    }
  };

  const handleActionFridgeClean = () => {
    router.push("/inventory");
  };

  const handleActionCookingVoice = () => {
    Alert.alert("从可信菜谱开始", "做饭模式会读取菜谱库中的最新步骤，请先选择一道已通过质量检查的菜谱。", [
      { text: "去选菜谱", onPress: () => router.push("/inventory") },
      { text: "取消", style: "cancel" },
    ]);
  };

  const handleStartCookingSolution = (card: SolutionCard) => {
    if (!Number.isInteger(Number(card.recipeId)) || Number(card.recipeId) <= 0) {
      Alert.alert("请先保存并审核", "AI 临时方案不能直接进入做饭模式。请先保存到我的菜谱，待内容审核通过后再开始烹饪。");
      return;
    }
    router.push("/cooking-mode", { recipeId: Number(card.recipeId) });
  };

  const handleSaveSolutionRecipe = async (messageId: string, card: SolutionCard) => {
    const steps = card.steps?.map((step) => step.trim()).filter(Boolean) || [];
    const ingredients = card.ingredientItems || [];
    if (!steps.length || !ingredients.length) {
      Alert.alert("方案信息不完整", "请先重新生成含完整食材和步骤的方案卡，再保存到我的菜谱。");
      return;
    }
    const { calories, protein, carbs, fat } = parseSolutionMacros(card.macros);

    try {
      const result = await recipesApi.submit(authFetch, {
        title: card.title,
        description: `${card.schemeTag} · ${card.cookingTip}`,
        cook_time: 20,
        difficulty: "简单",
        calories: calories ?? 0,
        protein: protein ?? 0,
        carbs: carbs ?? 0,
        fat: fat ?? 0,
        nutrition: [],
        category: "快手菜",
        tags: ["AI 方案", card.schemeTag],
        ingredients: ingredients.map((item) => ({ ...item, group: "主料" })),
        steps,
      });
      setMessages((current) => current.map((message) => message.id === messageId && message.solutionCards
        ? { ...message, solutionCards: message.solutionCards.map((solution) => solution.id === card.id ? { ...solution, savedToRecipes: true } : solution) }
        : message));
      Alert.alert("已保存", result.message || "方案已保存到我的菜谱，等待审核后公开。");
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  const updateAgentMessage = useCallback((messageId: string, response: AgentResponse) => {
    setMessages((current) => current.map((message) => message.id === messageId ? mergeTaskResponse(message, response) : message));
  }, [setMessages]);

  const handleAgentResume = useCallback(async (
    messageId: string,
    runId: string,
    decision: "approve" | "reject" | "edit",
    actions?: AgentActionProposal[],
  ) => {
    const actionScope = scopeRef.current;
    const response = await aiApi.resumeAgentRun<AgentResponse>(authFetch, runId, {
      decision,
      ...(actions ? { actions } : {}),
    });
    if (scopeRef.current === actionScope) updateAgentMessage(messageId, response);
  }, [authFetch, updateAgentMessage]);

  const handleAgentCancel = useCallback(async (messageId: string, runId: string) => {
    const actionScope = scopeRef.current;
    await aiApi.cancelAgentRun(authFetch, runId);
    const response = await aiApi.agentRun<AgentResponse>(authFetch, runId);
    if (scopeRef.current !== actionScope) return;
    updateAgentMessage(messageId, response);
  }, [authFetch, updateAgentMessage]);

  const handleAgentRetry = useCallback(async (messageId: string, runId: string) => {
    const actionScope = scopeRef.current;
    const response = await aiApi.retryAgentRun<AgentResponse>(authFetch, runId);
    if (scopeRef.current === actionScope) updateAgentMessage(messageId, response);
  }, [authFetch, updateAgentMessage]);

  const handleAgentUndo = useCallback(async (messageId: string, runId: string) => {
    const actionScope = scopeRef.current;
    await aiApi.undoAgentRun(authFetch, runId);
    if (scopeRef.current !== actionScope) return;
    setMessages((current) => current.map((message) => message.id === messageId && message.agentRun
      ? { ...message, agentRun: { ...message.agentRun, undoState: "completed" } }
      : message));
  }, [authFetch, setMessages]);

  const handleSafeGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)");
    }
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <AssistantMessageItem
      message={item}
      userAvatarUrl={user?.avatar_url}
      userAvatarSeed={user?.id ?? user?.username}
      handleConfirmRecordCard={handleConfirmRecordCard}
      handleCommitWriteConfirmation={handleCommitWriteConfirmation}
      handleOpenEditModal={handleOpenEditModal}
      toggleInventoryScanItem={toggleInventoryScanItem}
      openInventoryScanEditor={openInventoryScanEditor}
      confirmInventoryScanCard={confirmInventoryScanCard}
      undoInventoryScanCard={undoInventoryScanCard}
      handleSaveToShoppingList={handleSaveToShoppingList}
      handleSendMessage={handleSendMessage}
      onStartCooking={handleStartCookingSolution}
      onSaveRecipe={handleSaveSolutionRecipe}
      onOpenInventory={() => router.push("/inventory")}
      onOpenInventoryAdd={() => router.push("/inventory", { action: "add" })}
      onAgentResume={handleAgentResume}
      onAgentCancel={handleAgentCancel}
      onAgentRetry={handleAgentRetry}
      onAgentUndo={handleAgentUndo}
    />
  );

  const greeting = new Date().getHours() < 11
    ? "早上好"
    : new Date().getHours() < 18
      ? "下午好"
      : "晚上好";

  return (
    <Screen safeAreaEdges={["top", "bottom", "left", "right"]}>
      <Modal visible={pendingConsentText !== null} transparent animationType="fade" onRequestClose={() => setPendingConsentText(null)}>
        <View className="flex-1 justify-center bg-black/45 px-6">
          <View className="rounded-3xl bg-surface p-5 gap-4">
            <Text className="text-lg font-bold text-ink">发送给 AI 前请确认</Text>
            <Text className="text-sm leading-6 text-copy-muted">当前问题、最近对话、图片附件及健康档案可能发送给部署环境配置的 AI 服务商。服务端会按隐私说明保存对话和附件。请勿发送无关敏感信息。</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => { setPendingConsentText(null); router.push("/legal"); }}><Text className="text-brand">查看隐私说明</Text></TouchableOpacity>
            <View className="flex-row gap-3">
              <TouchableOpacity accessibilityRole="button" className="flex-1 rounded-xl border border-line p-3" onPress={() => setPendingConsentText(null)}><Text className="text-center text-ink">取消</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" className="flex-1 rounded-xl bg-brand-fill p-3" onPress={async () => {
                if (!aiConsentStorageKey) return;
                const consentScope = scopeRef.current;
                const text = pendingConsentText;
                await AsyncStorage.setItem(aiConsentStorageKey, "accepted");
                if (scopeRef.current !== consentScope) return;
                setPendingConsentText(null);
                setInputText("");
                void handleSendMessage(text || undefined);
              }}><Text className="text-center font-bold text-white">同意并发送</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 flex-col justify-between"
      >
        {sendError || chatStorageError ? <Text accessibilityRole="alert" className="px-4 py-2 text-xs text-critical">{sendError || chatStorageError}</Text> : null}
        {/* Full Screen Header */}
        <View className="relative flex-row items-center justify-between border-b border-line/70 bg-surface/45 px-4 py-2.5">
          <TouchableOpacity
            onPress={handleSafeGoBack}
            accessibilityLabel="返回"
            className="h-10 w-10 items-center justify-center rounded-full bg-surface/55 active:bg-surface"
          >
            <FontAwesome6 name="chevron-left" size={16} colorClassName="accent-ink" />
          </TouchableOpacity>

          <View pointerEvents="none" className="absolute inset-x-16 flex-row items-center justify-center">
            <Text className="text-base font-black text-ink">食语</Text>
            <View className="mx-2 h-3.5 w-px bg-line" />
            <Text className="text-[11px] font-bold text-brand">AI 助手</Text>
          </View>

          <TouchableOpacity
            onPress={() => setHeaderMoreVisible(true)}
            accessibilityLabel="更多操作"
            className="relative h-10 w-10 items-center justify-center rounded-full bg-surface/55 active:bg-surface"
          >
            <FontAwesome6 name="ellipsis" size={14} colorClassName="accent-ink" />
            {shoppingItems.length > 0 ? (
              <View className="absolute -right-0.5 -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-critical-fill px-1">
                <Text className="text-[8px] font-black text-white">{shoppingItems.length > 9 ? "9+" : shoppingItems.length}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {/* Virtualized conversation list */}
        <FlatList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(message) => message.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24, paddingTop: 16 }}
          className="flex-1 px-5"
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center">
              <View className="items-center px-4">
                <View className="h-16 w-16 overflow-hidden rounded-[22px] border-2 border-white bg-brand-soft">
                  <Image
                    source={require("@/assets/shiyu-avatar.jpg")}
                    className="h-16 w-16"
                    resizeMode="cover"
                  />
                </View>
                <Text className="mt-3 text-xs font-bold text-brand">{greeting}，{user?.username || "食友"}</Text>
                <Text className="mt-1 text-center text-[22px] font-black leading-7 text-ink">今天想先解决哪一餐？</Text>
              </View>
            </View>
          }
          ListFooterComponent={
            <>
              {currentRecognizedText ? (
                <View className="bg-success-soft border border-success/30 p-3 rounded-2xl self-end max-w-[82%] mb-2 mr-2">
                  <Text className="text-xs font-bold text-success">
                    正在听：{currentRecognizedText}
                  </Text>
                </View>
              ) : null}
              {loading ? (
                <View className="flex-row items-center gap-2 bg-surface p-3.5 rounded-2xl border border-line self-start ml-2 mb-4 shadow-xs">
                  <ActivityIndicator size="small" colorClassName="accent-brand" />
                  <Text className="text-xs text-copy-muted font-bold">AI 正在为您检索食材库与营养数据库...</Text>
                </View>
              ) : null}
            </>
          }
        />



        {/* Floating composer: content remains visually continuous behind the frosted controls. */}
        <View className="px-4 pb-3 pt-2">
          {hasSafetyProfile(healthProfile) ? (
            <TouchableOpacity
              onPress={() => router.push("/health-profile")}
              accessibilityLabel="查看当前安全与饮食限制"
              className="mb-2 flex-row items-center self-start rounded-full bg-danger-soft/90 px-3 py-1.5"
            >
              <FontAwesome6 name="shield-halved" size={10} colorClassName="accent-critical" />
              <Text className="ml-1.5 max-w-[290px] text-[10px] font-bold text-critical" numberOfLines={1}>
                已按安全档案避开：{safetySummary(healthProfile).slice(0, 2).join("、")}
              </Text>
              <FontAwesome6 name="chevron-right" size={8} colorClassName="accent-critical" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          ) : null}

          {/* Selected Image Attachment Badge */}
          {selectedImage && (
            <View className="relative mb-2 flex-row items-center self-start rounded-2xl bg-surface/80 p-1.5 pr-3">
              <Image source={{ uri: selectedImage.uri }} className="mr-2 h-11 w-11 rounded-xl" resizeMode="cover" />
              <View>
                <Text className="text-xs font-bold text-ink">已添加图片附件</Text>
                <Text className="text-[10px] text-copy-muted">输入问题后一起发送</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedImage(null)}
                className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full border border-white bg-critical-fill"
              >
                <FontAwesome6 name="xmark" size={10} colorClassName="accent-on-brand" />
              </TouchableOpacity>
            </View>
          )}

          {/* 语音交互状态栏 */}
          {voiceState !== "idle" && voiceState !== "completed" ? (
            <View className="mb-2 px-3.5 py-2 rounded-xl bg-brand/10 border border-brand/20 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2 flex-1">
                {voiceState === "listening" && <View className="w-2.5 h-2.5 rounded-full bg-critical" />}
                {(voiceState === "thinking" || voiceState === "recognizing") && <ActivityIndicator size="small" colorClassName="accent-brand" />}
                {voiceState === "speaking" && <View className="w-2.5 h-2.5 rounded-full bg-info" />}
                <Text className="text-xs font-bold text-brand" numberOfLines={1}>
                  {voiceState === "listening" ? "正在倾听…说完停顿会自动提交" :
                   voiceState === "recognizing" ? "正在识别语音…" :
                   voiceState === "thinking" ? "食语正在思考…" :
                   voiceState === "speaking" ? "食语正在回答…" : ""}
                </Text>
              </View>
              {voiceState === "speaking" && (
                <TouchableOpacity
                  onPress={() => { stopTTS(); setVoiceState("idle"); }}
                  className="bg-danger-soft px-2.5 py-1 rounded-full border border-critical/40 flex-row items-center gap-1"
                >
                  <FontAwesome6 name="circle-stop" size={10} colorClassName="accent-critical" />
                  <Text className="text-[10px] font-bold text-critical">打断</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {voiceState === "completed" && lastAIReplyText ? (
            <View className="mb-2 flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => speak(lastAIReplyText)}
                className="flex-row items-center gap-1 rounded-full border border-info/30 bg-info-soft px-3 py-1.5 active:bg-info-soft"
              >
                <FontAwesome6 name="volume-high" size={10} colorClassName="accent-info" />
                <Text className="text-[10px] font-bold text-info">重播回答</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setVoiceState("idle"); setLastAIReplyText(""); }}
                className="rounded-full bg-surface border border-line px-2 py-1"
              >
                <FontAwesome6 name="xmark" size={10} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>
          ) : null}

          {ttsError ? <Text className="mb-2 px-4 text-center text-[10px] text-critical">{ttsError}</Text> : null}

          {!showToolsGrid ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 12 }}
              className="mb-2"
            >
              <TouchableOpacity
                onPress={() => setInputText("根据现有冰箱食材推荐一份健康、简单的晚餐")}
                className="flex-row items-center rounded-full bg-surface/65 px-3 py-1.5"
              >
                <FontAwesome6 name="utensils" size={10} colorClassName="accent-brand" />
                <Text className="ml-1.5 text-[10px] font-bold text-brand">现有食材做什么</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setInputText("分析我今天的热量和营养摄入，并给出下一餐建议")}
                className="flex-row items-center rounded-full bg-surface/65 px-3 py-1.5"
              >
                <FontAwesome6 name="chart-simple" size={10} colorClassName="accent-warm" />
                <Text className="ml-1.5 text-[10px] font-bold text-warm">分析今日饮食</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleActionVisionFood}
                className="flex-row items-center rounded-full bg-surface/65 px-3 py-1.5"
              >
                <FontAwesome6 name="camera" size={10} colorClassName="accent-copy-muted" />
                <Text className="ml-1.5 text-[10px] font-bold text-copy-muted">拍照识别</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : null}

          <View
            className={`relative overflow-hidden rounded-[24px] p-3 shadow-lg ${isRecording ? "border border-critical/50" : ""}`}
          >
            <GlassComposerBackdrop />
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder={isRecording ? "正在倾听…" : selectedImage ? "想了解照片里的什么？" : "问食语：这一餐怎么吃？"}
              placeholderTextColorClassName="accent-copy-muted"
              multiline
              className="min-h-[42px] max-h-[96px] px-1 py-1 text-sm leading-5 text-ink"
              onSubmitEditing={() => handleSendMessage()}
            />

            <View className="mt-1 flex-row items-center justify-between">
              <TouchableOpacity
                onPress={() => setShowToolsGrid((prev) => !prev)}
                className={`h-8 flex-row items-center rounded-full px-3 ${showToolsGrid ? "bg-brand-fill" : "bg-surface/55"}`}
              >
                <FontAwesome6 name={showToolsGrid ? "xmark" : "plus"} size={11} colorClassName={showToolsGrid ? "accent-on-brand" : "accent-ink"} />
                <Text className={`ml-1.5 text-[10px] font-bold ${showToolsGrid ? "text-white" : "text-ink"}`}>
                  {showToolsGrid ? "收起" : "工具"}
                </Text>
              </TouchableOpacity>

              <View className="ml-2 flex-row items-center gap-2">
                <VoiceWaveform
                  voiceState={voiceState}
                  onPress={handleMicPress}
                  size="sm"
                />

                {inputText.trim() || selectedImage ? (
                  <TouchableOpacity
                    onPress={() => handleSendMessage()}
                    disabled={loading}
                    className="h-8 w-8 items-center justify-center rounded-full bg-brand-fill"
                  >
                    <FontAwesome6 name="arrow-up" size={13} colorClassName="accent-on-brand" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>

          <View className="mt-1.5 flex-row items-center justify-center px-3">
            <FontAwesome6 name="circle-info" size={8} colorClassName="accent-copy-muted" />
            <Text className="ml-1 text-[9px] text-copy-muted">AI 营养建议仅供日常健康管理，不替代专业诊疗</Text>
          </View>

          {/* Expanded tools stay secondary to the conversation composer. */}
          {showToolsGrid && (
            <View className="relative mt-2.5 flex-row flex-wrap overflow-hidden rounded-[22px] px-2 py-2.5">
              <GlassComposerBackdrop />
              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  void handlePickImageAttachment("library");
                }}
                className="w-1/3 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-info-soft">
                  <FontAwesome6 name="image" size={16} colorClassName="accent-info" />
                </View>
                <Text className="text-[10px] font-bold text-ink">图片附件</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  void handlePickImageAttachment("camera");
                }}
                className="w-1/3 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-background-secondary">
                  <FontAwesome6 name="camera-retro" size={16} colorClassName="accent-copy-muted" />
                </View>
                <Text className="text-[10px] font-bold text-ink">拍照附件</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleActionVisionFood();
                }}
                className="w-1/3 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-brand/10">
                  <FontAwesome6 name="camera" size={16} colorClassName="accent-brand" />
                </View>
                <Text className="text-[10px] font-bold text-ink">识菜热量</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleActionScanReceipt();
                }}
                className="w-1/3 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-highlight/15">
                  <FontAwesome6 name="receipt" size={16} colorClassName="accent-warm" />
                </View>
                <Text className="text-[10px] font-bold text-ink">扫码入库</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleActionFridgeClean();
                }}
                className="w-1/3 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-background-secondary">
                  <FontAwesome6 name="snowflake" size={16} colorClassName="accent-brand" />
                </View>
                <Text className="text-[10px] font-bold text-ink">冰箱清库</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleOpenShoppingList();
                }}
                className="w-1/3 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-background-secondary">
                  <FontAwesome6 name="cart-shopping" size={16} colorClassName="accent-copy-muted" />
                </View>
                <Text className="text-[10px] font-bold text-ink">采购清单</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleActionCookingVoice();
                }}
                className="w-1/3 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-danger-soft">
                  <FontAwesome6 name="fire-burner" size={16} colorClassName="accent-critical" />
                </View>
                <Text className="text-[10px] font-bold text-ink">做饭语音包</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={Boolean(inventoryEditTarget)}
        animationType="slide"
        transparent
        onRequestClose={() => setInventoryEditTarget(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-[32px] bg-surface p-6">
            <View className="mb-5 flex-row items-center justify-between border-b border-background-secondary pb-3">
              <View className="flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-brand-fill">
                  <FontAwesome6 name="pen" size={12} colorClassName="accent-on-brand" />
                </View>
                <View>
                  <Text className="text-base font-black text-ink">修改识别结果</Text>
                  <Text className="mt-0.5 text-[10px] text-copy-muted">确认后只更新当前卡片，不会立即入库</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setInventoryEditTarget(null)} className="p-2">
                <FontAwesome6 name="xmark" size={18} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>

            <Text className="mb-1.5 text-xs font-bold text-copy-muted">食材名称</Text>
            <TextInput
              value={inventoryEditTarget?.foodName || ""}
              onChangeText={(foodName) => setInventoryEditTarget((current) => current ? { ...current, foodName } : current)}
              className="rounded-2xl border border-line bg-canvas px-4 py-3.5 text-sm font-bold text-ink"
            />

            <View className="mt-4 flex-row gap-3">
              <View className="flex-1">
                <Text className="mb-1.5 text-xs font-bold text-copy-muted">数量</Text>
                <TextInput
                  value={inventoryEditTarget?.quantity || ""}
                  onChangeText={(quantity) => setInventoryEditTarget((current) => current ? { ...current, quantity } : current)}
                  placeholder="如：500g、2盒"
                  className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-bold text-ink"
                />
              </View>
              <View className="flex-1">
                <Text className="mb-1.5 text-xs font-bold text-copy-muted">建议保质期（天）</Text>
                <TextInput
                  value={inventoryEditTarget?.expireDays || ""}
                  onChangeText={(expireDays) => setInventoryEditTarget((current) => current ? { ...current, expireDays } : current)}
                  keyboardType="numeric"
                  className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-bold text-ink"
                />
              </View>
            </View>

            <Text className="mb-2 mt-4 text-xs font-bold text-copy-muted">存放位置</Text>
            <View className="flex-row gap-2">
              {(["冷藏", "冷冻", "常温"] as const).map((location) => (
                <TouchableOpacity
                  key={location}
                  onPress={() => setInventoryEditTarget((current) => current ? { ...current, storageLocation: location } : current)}
                  className={`flex-1 items-center rounded-xl border py-2.5 ${inventoryEditTarget?.storageLocation === location ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}
                >
                  <Text className={`text-xs font-bold ${inventoryEditTarget?.storageLocation === location ? "text-white" : "text-copy-muted"}`}>{location}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={saveInventoryScanEdit}
              className="mt-5 items-center rounded-2xl bg-brand-fill py-4"
            >
              <Text className="text-sm font-black text-white">保存修改并返回确认</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 📝 AI 对话内置即时修改打卡 Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent onRequestClose={() => setEditModalVisible(false)}>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-surface rounded-t-[32px] p-6 max-h-[85%]">
            {/* Modal 标题栏 */}
            <View className="flex-row items-center justify-between mb-4 border-b border-background-secondary pb-3">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-brand-fill items-center justify-center">
                  <FontAwesome6 name="utensils" size={13} colorClassName="accent-on-brand" />
                </View>
                <Text className="text-base font-black text-ink">
                  修改打卡数据 ({formMealType})
                </Text>
              </View>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} className="p-1 active:opacity-70">
                <FontAwesome6 name="xmark" size={20} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
              {/* 餐别选择 */}
              <View>
                <Text className="text-xs font-bold text-copy-muted mb-2">餐别选择</Text>
                <View className="flex-row gap-2">
                  {["早餐", "午餐", "晚餐", "加餐"].map((type) => (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setFormMealType(type)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${
                        formMealType === type
                          ? "bg-brand-fill border-brand"
                          : "bg-surface border-line"
                      }`}
                    >
                      <Text className={`text-xs font-bold ${formMealType === type ? "text-white" : "text-ink"}`}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* 食物名称 */}
              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">食物名称</Text>
                <TextInput
                  value={formFoodName}
                  onChangeText={setFormFoodName}
                  placeholder="如：香煎鸡胸肉、水饺"
                  className="bg-background-secondary/60 p-3 rounded-xl border border-line text-xs font-bold text-ink"
                />
              </View>

              {/* 分量与卡路里 */}
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-xs font-bold text-copy-muted mb-1">预估分量</Text>
                  <TextInput
                    value={formAmount}
                    onChangeText={setFormAmount}
                    placeholder="如：1碗、200g"
                    className="bg-background-secondary/60 p-3 rounded-xl border border-line text-xs font-bold text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-copy-muted mb-1">卡路里 (kcal)</Text>
                  <TextInput
                    value={formCalories}
                    onChangeText={setFormCalories}
                    keyboardType="numeric"
                    placeholder="350"
                    className="bg-background-secondary/60 p-3 rounded-xl border border-line text-xs font-bold text-ink"
                  />
                </View>
              </View>

              {/* 三大营养素 */}
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-copy-muted mb-1">蛋白质 (g)</Text>
                  <TextInput
                    value={formProtein}
                    onChangeText={setFormProtein}
                    keyboardType="numeric"
                    className="bg-background-secondary/60 p-2.5 rounded-xl border border-line text-xs text-center font-bold text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-copy-muted mb-1">碳水 (g)</Text>
                  <TextInput
                    value={formCarbs}
                    onChangeText={setFormCarbs}
                    keyboardType="numeric"
                    className="bg-background-secondary/60 p-2.5 rounded-xl border border-line text-xs text-center font-bold text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-copy-muted mb-1">脂肪 (g)</Text>
                  <TextInput
                    value={formFat}
                    onChangeText={setFormFat}
                    keyboardType="numeric"
                    className="bg-background-secondary/60 p-2.5 rounded-xl border border-line text-xs text-center font-bold text-ink"
                  />
                </View>
              </View>

              {/* 保存按钮 */}
              <TouchableOpacity
                onPress={handleSaveEditModal}
                disabled={savingRecord}
                className="bg-brand-fill py-3.5 rounded-2xl items-center shadow-sm active:opacity-90 mt-2"
              >
                {savingRecord ? (
                  <ActivityIndicator colorClassName="accent-on-brand" size="small" />
                ) : (
                  <Text className="text-sm font-bold text-white">确认打卡保存</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 顶栏次要操作：避免在窄屏、刘海和 Android 状态栏下挤压标题。 */}
      <Modal
        visible={headerMoreVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHeaderMoreVisible(false)}
      >
        <View className="flex-1">
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setHeaderMoreVisible(false)}
            className="absolute inset-0 bg-black/10"
          />
          <View
            style={{ position: "absolute", top: insets.top + 58, right: 16 }}
            className="w-44 rounded-2xl border border-line bg-surface p-1.5 shadow-xl"
          >
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                handleOpenShoppingList();
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name="cart-shopping" size={14} colorClassName="accent-warm" />
              <Text className="text-sm font-bold text-ink">采购清单</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                setHistoryDrawerVisible(true);
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name="clock-rotate-left" size={14} colorClassName="accent-brand" />
              <Text className="text-sm font-bold text-ink">历史对话</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                setIsMuted((value) => !value);
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name={isMuted ? "volume-xmark" : "volume-high"} size={14} colorClassName="accent-ink" />
              <Text className="text-sm font-bold text-ink">{isMuted ? "开启语音" : "关闭语音"}</Text>
            </TouchableOpacity>
            <View className="mx-2 border-t border-line" />
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                handleSafeGoBack();
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name="xmark" size={14} colorClassName="accent-copy-muted" />
              <Text className="text-sm font-bold text-copy-muted">关闭食语</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <HistoryDrawer
        visible={historyDrawerVisible}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onClose={() => setHistoryDrawerVisible(false)}
        onNewChat={handleStartNewChat}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
      />

      <ShoppingListDrawer
        visible={shoppingListModalVisible}
        items={shoppingItems}
        onClose={() => setShoppingListModalVisible(false)}
        onRemove={handleRemoveShoppingItem}
      />

    </Screen>
  );
}
