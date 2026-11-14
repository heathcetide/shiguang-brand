import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { healthApi } from "@/services/api/health";
import type { HealthProfile } from "@/utils/healthProfile";

export function useHealthSummary() {
  const { user } = useAuth(); const authFetch = useAuthFetch();
  const userId = user?.id;
  const [state, setState] = useState<{ owner?: number; profile: HealthProfile | null; error: string }>({ profile: null, error: "" });
  const sequence = useRef(0);
  useFocusEffect(useCallback(() => {
    const request = ++sequence.current;
    if (!userId) { setState({ profile: null, error: "" }); return; }
    const owner = userId;
    void healthApi.profile<HealthProfile>(authFetch).then(profile => {
      if (request === sequence.current) setState({ owner, profile, error: "" });
    }).catch(() => {
      if (request === sequence.current) setState(current => ({ owner, profile: current.owner === owner ? current.profile : null, error: "资料暂未更新，请稍后重试" }));
    });
    return () => { sequence.current += 1; };
  }, [userId, authFetch]));
  const profile = state.owner === user?.id ? state.profile : null;
  const target = profile?.calorieTarget;
  const targetCalories = target?.value ?? target?.referenceValue ?? profile?.nutrition_targets?.calories_kcal ?? 2000;
  const proteinTarget = profile?.nutrition_targets?.protein_g;
  const carbsTarget = profile?.nutrition_targets?.carbs_g;
  const fatTarget = profile?.nutrition_targets?.fat_g;
  const targetProtein = typeof proteinTarget === "number" && proteinTarget > 0 ? proteinTarget : null;
  const targetCarbs = typeof carbsTarget === "number" && carbsTarget > 0 ? carbsTarget : null;
  const targetFat = typeof fatTarget === "number" && fatTarget > 0 ? fatTarget : null;
  const targetLabel = target?.source === "user" || (typeof profile?.nutrition_targets?.calories_kcal === "number" && profile.nutrition_targets.calories_kcal > 0)
    ? "每日目标"
    : target?.source === "legacy_unconfirmed"
      ? "旧版目标，待确认"
      : "系统参考，尚未设置目标";
  return {
    profile,
    targetCalories,
    targetProtein,
    targetCarbs,
    targetFat,
    targetLabel,
    error: state.owner === user?.id ? state.error : "",
  };
}
