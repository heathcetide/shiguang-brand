import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Screen } from "@/components/Screen";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { healthApi } from "@/services/api";
import type { HealthProfile } from "@/utils/healthProfile";

export default function ProfileSettingsScreen() {
  const { user } = useAuth(); const router = useSafeRouter();
  return <Screen><View className="flex-row items-center gap-3 border-b border-line p-4"><TouchableOpacity accessibilityLabel="返回" onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full bg-surface"><FontAwesome6 name="arrow-left" size={16} colorClassName="accent-ink" /></TouchableOpacity><Text className="text-xl font-bold text-ink">我的资料与偏好</Text></View>{user ? <ProfileGroups key={user.id} /> : <View className="gap-4 p-6"><Text className="text-ink">登录后管理你的个人资料。</Text><TouchableOpacity onPress={() => router.push("/login")}><Text className="text-brand">登录 / 注册</Text></TouchableOpacity></View>}</Screen>;
}

function ProfileGroups() {
  const router = useSafeRouter(); const authFetch = useAuthFetch(); const { user } = useAuth();
  const [profile, setProfile] = useState<HealthProfile | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => { let active = true; void healthApi.profile<HealthProfile>(authFetch, { fresh: true }).then(value => { if (active) { setProfile(value); setError(""); } }).catch(() => { if (active) setError("资料摘要加载失败，可重试或进入分组重新读取"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [authFetch, retry]));
  const summaryUnavailable = loading || Boolean(error) || !profile;
  const limit = summaryUnavailable ? "资料摘要尚未读取" : profile?.safety_status === "none" ? "已确认没有过敏与饮食限制" : profile?.safety_status === "provided" ? "已记录限制，随时核对" : "尚未确认，可稍后补充";
  const calories = profile?.calorieTarget?.value;
  const rows = [
    { title: "公开资料", detail: user?.username ? `昵称、头像与简介 · ${user.username}` : "昵称、头像与简介", icon: "user" as const, action: () => router.push("/profile-edit") },
    { title: "饮食限制与健康资料", detail: limit, icon: "shield-halved" as const, action: () => router.push("/health-profile", { section: "safety" }) },
    { title: "厨房与做饭习惯", detail: "人数、时间、预算、备餐环境与厨具", icon: "kitchen-set" as const, action: () => router.push("/health-profile", { section: "kitchen" }) },
    { title: "身体资料与营养目标", detail: summaryUnavailable ? "资料摘要尚未读取" : calories == null ? "个人热量目标尚未设置" : `每日 ${calories} kcal${profile?.calorieTarget?.source === "legacy_unconfirmed" ? " · 旧版资料待确认" : " · 已确认"}`, icon: "seedling" as const, action: () => router.push("/health-profile", { section: "nutrition" }) },
    { title: "系统记住了什么", detail: "查看、纠正推荐偏好与学习记录", icon: "brain" as const, action: () => router.push("/preference-learning") },
  ];
  return <ScrollView contentContainerClassName="mx-auto w-full max-w-2xl gap-4 p-4 pb-8"><Text className="leading-6 text-copy-muted">你主动填写的资料集中在这里。没有填写的内容保持未知，系统的推测也可以查看和纠正。</Text>{loading ? <ActivityIndicator accessibilityLabel="正在读取资料摘要" colorClassName="accent-brand" /> : null}{error ? <View className="gap-2 rounded-xl bg-warm-soft p-3"><Text accessibilityRole="alert" className="text-ink">{error}</Text><TouchableOpacity onPress={() => { setLoading(true); setRetry(value => value + 1); }}><Text className="text-brand">重新读取摘要</Text></TouchableOpacity></View> : null}{rows.map(row => <TouchableOpacity key={row.title} accessibilityRole="button" accessibilityLabel={row.title} onPress={row.action} className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-4"><View className="h-11 w-11 items-center justify-center rounded-xl bg-brand-soft"><FontAwesome6 name={row.icon} size={18} colorClassName="accent-brand" /></View><View className="flex-1 gap-1"><Text className="text-base font-bold text-ink">{row.title}</Text><Text className="text-sm leading-5 text-copy-muted">{row.detail}</Text></View><FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" /></TouchableOpacity>)}<View className="flex-row flex-wrap gap-3"><TouchableOpacity onPress={() => router.push("/health-profile", { section: "body" })} className="rounded-xl bg-brand-soft p-3"><Text className="text-brand">身体资料</Text></TouchableOpacity><TouchableOpacity onPress={() => router.push("/health-data")} className="rounded-xl bg-brand-soft p-3"><Text className="text-brand">测量记录</Text></TouchableOpacity><TouchableOpacity onPress={() => router.push("/inventory")} className="rounded-xl bg-brand-soft p-3"><Text className="text-brand">我的厨具</Text></TouchableOpacity></View></ScrollView>;
}
