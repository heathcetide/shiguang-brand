import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { interventionPreferencesUpdateSchema, type InterventionPreferencesUpdate } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { interventionApi } from "@/services/api/interventions";
import { ApiError } from "@/services/api/client";

export default function InterventionSettings() {
  const { token } = useAuth(); const router = useSafeRouter();
  const [draft,setDraft] = useState<InterventionPreferencesUpdate | null>(null);
  const [numbers,setNumbers] = useState<Record<string,string>>({});
  const [message,setMessage] = useState(""); const [saving,setSaving] = useState(false);
  const [reload,setReload] = useState(0); const [conflict,setConflict] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setDraft(null);setMessage("");setConflict(false);setSaving(false);
    if (token) void interventionApi.preferences(token).then(value => {
      if (generation.current === current) { setDraft(value);setNumbers({ dinner_lead_minutes: String(value.dinner_lead_minutes),daily_push_limit: String(value.daily_push_limit),cooldown_minutes: String(value.cooldown_minutes) }); }
    }).catch(() => { if (generation.current === current) setMessage("加载失败，请重试"); });
    return () => { generation.current++; };
  },[token,reload]);
  const update = (patch: Partial<InterventionPreferencesUpdate>) => setDraft(current => current ? { ...current,...patch } : null);
  const save = async () => {
    if (!token || !draft || saving || conflict) return;
    const parsed = interventionPreferencesUpdateSchema.safeParse({ ...draft,...Object.fromEntries(Object.entries(numbers).map(([key,value]) => [key,value.trim() ? Number(value) : null])) });
    if (!parsed.success) { setMessage("请核对时区、24 小时时间、提前量 15–180 分钟、每日额度 0–3 和冷却 60–10080 分钟。");return; }
    const current = generation.current;
    setSaving(true);setMessage("");
    try {
      const saved = await interventionApi.savePreferences(token,parsed.data);
      if (generation.current === current) { setDraft(saved);setMessage("偏好已保存"); }
    } catch (error) {
      if (generation.current === current) {
        setConflict(error instanceof ApiError && error.status === 409);
        setMessage(error instanceof ApiError && error.status === 409 ? "设置已在其他地方修改。请重新加载，核对后再保存。" : "保存失败，修改仍保留在此页，请重试。");
      }
    } finally { if (generation.current === current) setSaving(false); }
  };
  const toggles = [{ key: "enabled",label: "允许主动食物提醒" },{ key: "expiry_rescue",label: "临期抢救建议" },{ key: "dinner_window",label: "晚餐决策窗口" }] as const;
  const fields = [{ key: "time_zone",label: "时区（例如 Asia/Shanghai）" },{ key: "quiet_start",label: "安静时段开始（HH:MM）" },{ key: "quiet_end",label: "安静时段结束（HH:MM）" },{ key: "dinner_time",label: "晚餐时间（HH:MM）" },{ key: "dinner_lead_minutes",label: "提前提醒（分钟）",numeric: true },{ key: "daily_push_limit",label: "每日智能推送上限",numeric: true },{ key: "cooldown_minutes",label: "两次干预最短间隔（分钟）",numeric: true }] as const;
  return <Screen><View className="gap-4 p-5">
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity>
    <Text className="text-2xl font-bold text-ink">主动食物提醒</Text>
    <Text className="text-sm text-copy-muted">此功能仍在准备中。目前可保存偏好，尚不发送智能提醒。</Text>
    {!token ? <Text className="text-ink">登录后可管理提醒偏好。</Text> : !draft && !message ? <ActivityIndicator /> : null}
    {message ? <Text accessibilityRole="alert" className="text-sm text-ink">{message}</Text> : null}
    {token && <TouchableOpacity disabled={saving} onPress={() => setReload(value => value+1)}><Text className="text-brand">重新加载已保存设置（放弃本页修改）</Text></TouchableOpacity>}
    {draft && <>
      {toggles.map(({ key,label }) => <View key={key} className="flex-row items-center justify-between rounded-xl bg-surface p-3"><Text className="flex-1 text-ink">{label}</Text><Switch accessibilityLabel={label} disabled={saving || conflict} value={draft[key]} onValueChange={value => update({ [key]: value })} /></View>)}
      <Text className="text-xs text-copy-muted">只有总开关与对应类型同时开启才表示授权。安静时段不发送智能推送；起止相同表示不设置安静时段。每日上限为 0 时仅使用站内提醒。</Text>
      {fields.map(field => <View key={field.key}><Text className="mb-1 text-sm text-ink">{field.label}</Text><TextInput accessibilityLabel={field.label} autoCapitalize="none" autoCorrect={false} editable={!saving && !conflict} value={'numeric' in field ? numbers[field.key] ?? '' : String(draft[field.key])} keyboardType={'numeric' in field ? 'number-pad' : 'default'} onChangeText={value => 'numeric' in field ? setNumbers(current => ({ ...current,[field.key]: value })) : update({ [field.key]: value })} className="rounded-xl border border-line bg-surface px-3 py-3 text-ink" /></View>)}
      <TouchableOpacity accessibilityRole="button" disabled={saving || conflict} onPress={() => void save()} className="items-center rounded-xl bg-brand-fill p-4"><Text className="font-bold text-white">{saving ? "保存中…" : "保存偏好"}</Text></TouchableOpacity>
    </>}
  </View></Screen>;
}
