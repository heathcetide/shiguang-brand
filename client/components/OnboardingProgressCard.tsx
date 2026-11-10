import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import type { OnboardingState, OnboardingTask } from "@dietdigidose/contracts";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { onboardingApi } from "@/services/api/onboarding";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";

const seenKey = "@onboarding_completion_seen_v1";
const taskLabels: Record<OnboardingTask, string> = {
  inventory: "管理家里的食材", meal_plan: "安排一餐", diet_record: "记录刚吃的一餐", nutrition: "设置营养目标",
};

/** One optional card; a pristine account never receives a forced onboarding prompt. */
export function OnboardingProgressCard() {
  const { user, token, sessionGeneration } = useAuth();
  return user && token ? <AccountProgress key={`${user.id}:${sessionGeneration}:${token}`} userId={user.id} token={token} /> : null;
}

function AccountProgress({ userId, token }: { userId: number; token: string }) {
  const router = useSafeRouter();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const sending = useRef(false);
  const epoch = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current += 1; }; }, []);

  useFocusEffect(useCallback(() => {
    let focused = true;
    const requestEpoch = ++epoch.current;
    const generation = getPrivateStorageGeneration(userId);
    const current = () => focused && mounted.current && requestEpoch === epoch.current && generation === getPrivateStorageGeneration(userId);
    setState(null); setShowCompleted(false); setError("");
    void (async () => {
      try {
        const result = await onboardingApi.get(token);
        if (!current()) return;
        if (result.status === "completed") {
          await removeUserPrivateStorage("@onboarding_draft_v2", userId, generation);
          if (!current()) return;
          if (result.dismissed) return;
          const storageKey = getUserStorageKey(seenKey, userId)!;
          const seen = await AsyncStorage.getItem(storageKey);
          if (!current() || seen === result.completedAt) return;
          // Save the receipt before displaying so another focus cannot repeat the feedback.
          const written = await writeUserPrivateStorage(seenKey, userId, generation, result.completedAt || "completed");
          if (!current() || !written) return;
          setState(result); setShowCompleted(true);
          // The server receipt also prevents repeated feedback on another device.
          void onboardingApi.update(token, { version: result.version, requestKey: Crypto.randomUUID(), dismissed: true }).catch(() => undefined);
          return;
        }
        if (result.version > 0 && result.selectedTask && !result.dismissed && (result.status === "in_progress" || result.status === "paused")) setState(result);
      } catch {
        // Progress is optional on the home page; a failed read must not block real tasks.
      }
    })();
    return () => { focused = false; };
  }, [token, userId]));

  const actOnProgress = async (dismiss: boolean) => {
    if (!state || sending.current) return;
    if (showCompleted) { setShowCompleted(false); setState(null); return; }
    const requestEpoch = ++epoch.current;
    const generation = getPrivateStorageGeneration(userId);
    const current = () => mounted.current && requestEpoch === epoch.current && generation === getPrivateStorageGeneration(userId);
    sending.current = true; setBusy(true); setError("");
    try {
      const result = await onboardingApi.update(token, {
        version: state.version, requestKey: Crypto.randomUUID(), dismissed: dismiss,
        ...(!dismiss && state.status === "paused" ? { status: "in_progress" as const } : {}),
      });
      if (!current()) return;
      if (dismiss) setState(null);
      else { setState(result); router.push("/onboarding"); }
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : "进度暂未保存，请重试");
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  };

  if (!state || state.status === "completed" && !showCompleted) return null;
  return <View testID="onboarding-progress-card" className="mb-4 gap-2 rounded-2xl border border-line bg-surface p-4">
    <View className="flex-row items-center justify-between gap-3">
      <Text className="flex-1 font-bold text-ink">{showCompleted ? "第一件事，完成了" : "从上次的地方继续"}</Text>
      <TouchableOpacity accessibilityLabel={showCompleted ? "关闭完成提示" : "关闭首次任务提示"} accessibilityRole="button" disabled={busy} onPress={() => void actOnProgress(true)} className="p-2">
        <Text className="text-copy-muted">关闭</Text>
      </TouchableOpacity>
    </View>
    <Text className="text-copy-muted">{showCompleted ? "已成功保存。接下来，按自己的节奏使用就好。" : `${taskLabels[state.selectedTask!]} · 进度已经记住了`}</Text>
    {error ? <Text accessibilityRole="alert" className="text-critical">{error}</Text> : null}
    {!showCompleted ? <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void actOnProgress(false)} className="self-start rounded-full bg-brand-fill px-4 py-2">
      {busy ? <ActivityIndicator size="small" /> : <Text className="font-bold text-white">继续首次任务</Text>}
    </TouchableOpacity> : null}
  </View>;
}
