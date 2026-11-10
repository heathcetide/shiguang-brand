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
  const targetCalories = target?.value ?? target?.referenceValue ?? 2000;
  const targetLabel = target?.source === "user" ? "每日目标" : target?.source === "legacy_unconfirmed" ? "旧版目标，待确认" : "系统参考，尚未设置目标";
  return { profile, targetCalories, targetLabel, error: state.owner === user?.id ? state.error : "" };
}
