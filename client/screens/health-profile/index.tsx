import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ZodError } from "zod";
import type { KitchenPreferences } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { PreferenceVoiceInput } from "@/components/PreferenceVoiceInput";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useUserDraft } from "@/hooks/useUserDraft";
import { ApiError, healthApi } from "@/services/api";
import { ALLERGY_LABELS, type AllergyEntry, type HealthProfile } from "@/utils/healthProfile";
import ProfileSettingsScreen from "@/screens/profile-settings";
import { EMPTY_FORM, SECTION_TITLES, parseProfileDraft, profileToForm, profileUpdate, type FormTextKey, type ProfileDraft, type ProfileForm, type ProfileSection } from "@/screens/health-profile/form";

const COMMON_ALLERGIES = ["坚果", "海鲜", "乳制品", "乳糖", "麸质", "鸡蛋", "大豆"];
const CONDITIONS = ["糖尿病", "高血压", "高尿酸", "肾病", "胃肠问题", "孕期", "哺乳期"];
const RESTRICTIONS = ["蛋奶素", "纯素", "不吃猪肉", "清真", "低盐", "低糖", "低嘌呤"];
const FIELD_NAMES: Record<string, string> = { age: "年龄", height: "身高", weight: "体重", target_weight: "目标体重", calories_kcal: "每日热量", protein_g: "蛋白质", salt_g: "盐", sugar_g: "添加糖", water_ml: "每日饮水", meal_time_minutes: "做饭时间", budget_per_meal: "每餐预算", servings: "就餐人数" };

export default function HealthProfileScreen() {
  const { section } = useSafeSearchParams<{ section?: string }>(); const { user } = useAuth(); const router = useSafeRouter();
  if (!section || !Object.prototype.hasOwnProperty.call(SECTION_TITLES, section)) return <ProfileSettingsScreen />;
  if (!user) return <Screen><View className="gap-4 p-6"><Text className="text-ink">登录后管理你的资料。</Text><Button label="登录 / 注册" onPress={() => router.replace("/login")} /></View></Screen>;
  return <ProfileEditor key={`${user.id}:${section}`} section={section as ProfileSection} />;
}

function ProfileEditor({ section }: { section: ProfileSection }) {
  const router = useSafeRouter(); const authFetch = useAuthFetch();
  const draft = useUserDraft<ProfileDraft>(`health-profile-draft:${section}`, null, parseProfileDraft);
  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false); const [notice, setNotice] = useState("");
  const [error, setError] = useState(""); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<HealthProfile | null>(null);
  const [customAllergy, setCustomAllergy] = useState(""); const [allergyType, setAllergyType] = useState<"allergy" | "intolerance">("allergy");
  const alive = useRef(true); const request = useRef(0); const savingRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current += 1; }; }, []);
  const load = useCallback(async () => {
    const version = ++request.current; setLoading(true); setLoadError("");
    try {
      const result = await healthApi.profile<HealthProfile>(authFetch, { fresh: true });
      if (!result || !result.version) throw new Error("资料暂时不可用，请重试");
      if (alive.current && version === request.current) setProfile(result);
    } catch (reason) { if (alive.current && version === request.current) setLoadError(reason instanceof Error ? reason.message : "资料加载失败，请重试"); }
    finally { if (alive.current && version === request.current) setLoading(false); }
  }, [authFetch]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const baseline = profile ? profileToForm(profile) : EMPTY_FORM;
  const active: NonNullable<ProfileDraft> = draft.value || { version: profile?.version || 1, initial: baseline, form: baseline };
  const form = active.form;
  const change = (patch: Partial<ProfileForm>) => { draft.save({ ...active, form: { ...form, ...patch } }); setNotice(""); setError(""); setFieldErrors({}); };
  const kitchen = (patch: KitchenPreferences) => change({ kitchen: { ...form.kitchen, ...patch } });
  const toggle = (key: "medical_conditions" | "dietary_restrictions", value: string) => change({ [key]: form[key].includes(value) ? form[key].filter(item => item !== value) : [...form[key], value], ...(key === "dietary_restrictions" ? { safety_status: "provided" as const } : {}) });
  const addAllergy = (name: string, type: AllergyEntry["type"] = "allergy") => { const clean = name.trim(); if (!clean || form.allergies.some(item => item.name === clean)) return; change({ allergies: [...form.allergies, { name: clean, type, severity: "moderate" }], safety_status: "provided" }); setCustomAllergy(""); };
  const save = async () => {
    if (!profile || loading || loadError || savingRef.current || !draft.ready) return;
    let input;
    try { input = profileUpdate(section, active); }
    catch (reason) {
      if (reason instanceof ZodError) { const issues: Record<string, string> = {}; for (const issue of reason.issues) { const key = String(issue.path.at(-1)); issues[key] = `${FIELD_NAMES[key] || "此项"}格式或范围不正确，请检查`; } setFieldErrors(issues); setError("请检查标出的输入项"); }
      else setError("请检查填写内容");
      return;
    }
    if (!input) { setNotice("没有需要保存的修改"); return; }
    savingRef.current = true; setSaving(true); setError("");
    try {
      const saved = await healthApi.patchProfile<HealthProfile>(authFetch, input);
      if (!alive.current) return;
      setProfile(saved); setConflict(null);
      try { await draft.clear(); if (alive.current) setNotice("已保存，其他页面将使用最新资料"); }
      catch { if (alive.current) { draft.save(null); setNotice("资料已保存，但本机草稿清理失败。当前显示已保存资料，下次进入请核对草稿提示。"); } }
    } catch (reason) {
      if (!alive.current) return;
      if (reason instanceof ApiError && reason.code === "HEALTH_PROFILE_VERSION_CONFLICT") {
        const latest = (reason.details as { currentProfile?: HealthProfile } | undefined)?.currentProfile;
        if (latest?.version) setConflict(latest);
        setError("资料已在其他页面更新，你的填写仍保留。请合并最新资料，再核对保存。");
      } else setError(reason instanceof Error ? reason.message : "保存失败，填写内容已保留");
    } finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };
  const mergeLatest = (latest: HealthProfile) => {
    const initial = profileToForm(latest); const edits: Partial<ProfileForm> = {};
    for (const key of Object.keys(form) as (keyof ProfileForm)[]) {
      if (key === "kitchen") { const changes: KitchenPreferences = {}; for (const field of Object.keys(form.kitchen) as (keyof KitchenPreferences)[]) if (JSON.stringify(form.kitchen[field]) !== JSON.stringify(active.initial.kitchen[field])) Object.assign(changes, { [field]: form.kitchen[field] }); if (Object.keys(changes).length) edits.kitchen = { ...initial.kitchen, ...changes }; }
      else if (JSON.stringify(form[key]) !== JSON.stringify(active.initial[key])) Object.assign(edits, { [key]: form[key] });
    }
    setProfile(latest); draft.save({ version: latest.version!, initial, form: { ...initial, ...edits } }); setConflict(null); setError(""); setNotice("已合并最新资料，请核对你的修改后再次保存");
  };
  const chooseSafety = (value: ProfileForm["safety_status"]) => {
    if (value === "none" && (form.allergies.length || form.dietary_restrictions.length)) Alert.alert("确认没有过敏和饮食限制？", "确认后将从本组草稿移除已选过敏和饮食限制；疾病、用药及备注保留。保存后生效。", [{ text: "取消", style: "cancel" }, { text: "清空并确认没有", onPress: () => change({ safety_status: "none", allergies: [], dietary_restrictions: [] }) }]);
    else change({ safety_status: value });
  };
  const field = (key: FormTextKey, label: string, unit = "", multiline = false) => <View key={key} className="gap-2"><Text className="text-sm font-bold text-ink">{label}{unit ? `（${unit}）` : ""}</Text><TextInput accessibilityLabel={label} value={String(form[key])} onChangeText={value => change({ [key]: value })} editable={!saving} placeholder="尚未填写，可留空" multiline={multiline} keyboardType={unit ? "decimal-pad" : "default"} className={`min-h-12 rounded-xl border bg-background-secondary px-3 py-3 text-ink ${fieldErrors[key] ? "border-critical" : "border-line"}`} placeholderTextColorClassName="accent-copy-muted" />{fieldErrors[key] ? <Text accessibilityRole="alert" className="text-critical">{fieldErrors[key]}</Text> : null}</View>;
  return <Screen><View className="flex-row items-center gap-3 border-b border-line px-4 py-3"><TouchableOpacity accessibilityLabel="返回" onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full bg-surface"><FontAwesome6 name="arrow-left" size={16} colorClassName="accent-ink" /></TouchableOpacity><View className="flex-1"><Text className="text-lg font-bold text-ink">{SECTION_TITLES[section]}</Text><Text className="text-xs text-copy-muted">按需填写 · 只保存当前分组</Text></View></View>
    {loading || !draft.ready ? <View className="flex-1 items-center justify-center p-8"><ActivityIndicator accessibilityLabel="正在读取资料" colorClassName="accent-brand" /><Text className="mt-3 text-copy-muted">正在读取资料与草稿</Text></View> : loadError || !profile ? <View className="gap-4 p-6"><Text accessibilityRole="alert" className="text-critical">{loadError || "资料读取失败"}</Text><Button label="重新加载资料" onPress={() => void load()} /></View> : <ScrollView pointerEvents={saving ? "none" : "auto"} keyboardShouldPersistTaps="handled" contentContainerClassName="mx-auto w-full max-w-2xl gap-4 p-4 pb-8">
      <Text className="leading-6 text-copy-muted">留空表示尚未填写，你可以随时回来补充。身体与营养资料用于个人记录和饮食参考。</Text>
      {draft.value ? <View className="gap-2 rounded-2xl bg-brand-soft p-3"><Text className="text-brand">已恢复本账号的未保存草稿</Text><TouchableOpacity onPress={() => { void draft.clear(); setError(""); setConflict(null); }}><Text className="text-sm text-brand">放弃草稿，恢复已保存资料</Text></TouchableOpacity></View> : null}
      {draft.error ? <Text accessibilityRole="alert" className="text-critical">{draft.error}</Text> : null}
      {(conflict || active.version !== profile.version) ? <View className="gap-3 rounded-2xl border border-line bg-warm-soft p-4"><Text className="text-ink">服务器资料已有更新。合并后保留你的修改，并补入其他页面的新资料。</Text><Button label="合并最新资料，保留我的修改" onPress={() => mergeLatest(conflict || profile)} /></View> : null}
      {section === "body" ? <>
        <Card title="基础资料"><Choices label="性别" value={form.gender} options={[["", "尚未填写"], ["男", "男"], ["女", "女"], ["保密", "保密"]]} onChange={gender => change({ gender })} />{field("age", "年龄", "岁")}{field("height", "身高", "cm")}{field("weight", "当前体重", "kg")}<Text className="text-xs leading-5 text-copy-muted">修改当前体重会记入今天的体重记录。清空此框只清除档案旧值；历史测量请到体征记录管理。当前来源：{profile.currentMeasurements?.weight?.recordedDate || (profile.currentMeasurements?.weight ? "旧档案，日期未知" : "尚无记录")}</Text>{field("target_weight", "目标体重", "kg")}</Card>
        <Card title="目标与日常活动"><Choices label="健康目标" value={form.health_goal} options={[["", "尚未填写"], ["healthy", "日常健康"], ["maintain", "保持状态"], ["lose_weight", "减重"], ["reduce_fat", "减脂"], ["gain_muscle", "增肌"]]} onChange={health_goal => change({ health_goal })} /><Choices label="日常活动" value={form.activity_level} options={[["", "尚未填写"], ["sedentary", "久坐"], ["light", "轻度活动"], ["moderate", "中等活动"], ["active", "较多活动"], ["very_active", "大量活动"]]} onChange={activity_level => change({ activity_level })} /><Choices label="允许个性化趋势参考" value={form.tracking_enabled ? "yes" : "no"} options={[["yes", "允许"], ["no", "暂不开启"]]} onChange={value => change({ tracking_enabled: value === "yes" })} /><Button label="管理体重、血压等测量记录" onPress={() => router.push("/health-data")} /></Card>
      </> : null}
      {section === "nutrition" ? <Card title="每日营养目标"><Text className="leading-6 text-copy-muted">{profile.calorieTarget?.source === "legacy_unconfirmed" ? "热量来自旧版资料，请核对后保存确认。" : profile.calorieTarget?.source === "user" ? "当前热量目标由你确认。" : "尚未设置个人热量目标；系统参考值不会自动保存为你的目标。"} 有医生或营养师制定的目标时，可直接填写。</Text>{field("calories_kcal", "每日热量", "kcal")}{field("protein_g", "蛋白质", "g")}{field("salt_g", "盐", "g")}{field("sugar_g", "添加糖", "g")}{field("water_ml", "每日饮水", "ml")}{field("professional_advice", "医生或营养师建议", "", true)}<Button label="查看身体资料" onPress={() => router.push("/health-profile", { section: "body" })} /></Card> : null}
      {section === "safety" ? <>
        <Card title="饮食限制确认"><Choices label="过敏与饮食限制" value={form.safety_status} options={[["unknown", "暂不填写"], ["none", "确认没有"], ["provided", "有，下面补充"]]} onChange={value => chooseSafety(value as ProfileForm["safety_status"])} /><Text className="text-xs leading-5 text-copy-muted">“暂不填写”表示未知，不会被当作确认没有过敏。已有记录仍参与饮食风险提示。</Text></Card>
        <Card title="过敏与不耐受"><View className="flex-row flex-wrap gap-2">{COMMON_ALLERGIES.map(name => <Chip key={name} label={name} selected={form.allergies.some(item => item.name === name)} onPress={() => form.allergies.some(item => item.name === name) ? change({ allergies: form.allergies.filter(item => item.name !== name) }) : addAllergy(name, name === "乳糖" ? "intolerance" : "allergy")} />)}</View>{form.allergies.map(item => <View key={item.name} className="gap-2 rounded-xl bg-background-secondary p-3"><Text className="font-bold text-ink">{item.name} · {item.type === "allergy" ? "过敏" : "不耐受"}</Text><Choices label={`${item.name}程度`} value={item.severity} options={Object.entries(ALLERGY_LABELS)} onChange={severity => change({ allergies: form.allergies.map(entry => entry.name === item.name ? { ...entry, severity: severity as AllergyEntry["severity"] } : entry) })} /><TouchableOpacity accessibilityLabel={`移除${item.name}`} onPress={() => change({ allergies: form.allergies.filter(entry => entry.name !== item.name) })}><Text className="text-critical">移除此项</Text></TouchableOpacity></View>)}<TextInput accessibilityLabel="其他过敏或不耐受名称" placeholder="其他食物或成分" value={customAllergy} onChangeText={setCustomAllergy} maxLength={80} className="min-h-12 rounded-xl border border-line p-3 text-ink" /><Choices label="新增项目类型" value={allergyType} options={[["allergy", "过敏"], ["intolerance", "不耐受"]]} onChange={value => setAllergyType(value as typeof allergyType)} /><Button label="添加过敏或不耐受" disabled={!customAllergy.trim()} onPress={() => addAllergy(customAllergy, allergyType)} /></Card>
        <Card title="饮食习惯与忌口"><View className="flex-row flex-wrap gap-2">{[...new Set([...RESTRICTIONS, ...form.dietary_restrictions])].map(item => <Chip key={item} label={item} selected={form.dietary_restrictions.includes(item)} onPress={() => toggle("dietary_restrictions", item)} />)}</View>{field("dietary_preference", "饮食偏好", "", true)}{field("disliked_foods", "不喜欢的食物", "", true)}</Card>
        <Card title="健康状态与用药"><View className="flex-row flex-wrap gap-2">{[...new Set([...CONDITIONS, ...form.medical_conditions])].map(item => <Chip key={item} label={item} selected={form.medical_conditions.includes(item)} onPress={() => toggle("medical_conditions", item)} />)}</View>{field("medications", "用药与补充剂", "", true)}{field("medical_notes", "健康备注", "", true)}<Text className="text-xs leading-5 text-copy-muted">这些记录用于饮食参考，不替代诊疗或专业用药指导。</Text><TouchableOpacity onPress={() => Alert.alert("清空本组敏感资料？", "过敏、用药、疾病、健康备注和饮食限制将从草稿中清除，点击保存后生效。", [{ text: "取消", style: "cancel" }, { text: "清空本组草稿", style: "destructive", onPress: () => change({ allergies: [], medications: "", medical_conditions: [], medical_notes: "", dietary_restrictions: [], disliked_foods: "", dietary_preference: "", safety_status: "unknown" }) }])}><Text className="text-critical">清空本组敏感资料</Text></TouchableOpacity></Card>
      </> : null}
      {section === "kitchen" ? <>
        <PreferenceVoiceInput onApply={(value, persistent) => { if (!persistent) { setNotice("摘要选择了仅本次使用；请到安排一餐应用，本页常用设置未修改。"); return; } change({ kitchen: { ...form.kitchen, ...value }, budget_per_meal: value.budget_per_meal == null ? form.budget_per_meal : String(value.budget_per_meal), servings: value.servings == null ? form.servings : String(value.servings), meal_time_minutes: value.meal_time_minutes == null ? form.meal_time_minutes : String(value.meal_time_minutes) }); }} />
        <Card title="常用做饭条件">{field("servings", "就餐人数", "人")}{field("meal_time_minutes", "做饭时间", "分钟")}{field("budget_per_meal", "每餐预算", "元")}<Choices label="烹饪水平" value={form.kitchen.cooking_level || ""} options={[["", "尚未填写"], ["beginner", "新手"], ["intermediate", "熟练"], ["advanced", "进阶"]]} onChange={value => kitchen({ cooking_level: (value || null) as KitchenPreferences["cooking_level"] })} /><Choices label="外食频率" value={form.kitchen.eating_out_frequency || ""} options={[["", "尚未填写"], ["rarely", "很少"], ["sometimes", "偶尔"], ["often", "经常"]]} onChange={value => kitchen({ eating_out_frequency: (value || null) as KitchenPreferences["eating_out_frequency"] })} /></Card>
        <Card title="备餐与用餐环境"><Text className="font-bold text-ink">常用餐次</Text><View className="flex-row flex-wrap gap-2">{([["breakfast", "早餐"], ["lunch", "午餐"], ["dinner", "晚餐"], ["snack", "加餐"]] as const).map(([value, label]) => <Chip key={value} label={label} selected={form.kitchen.usual_meals?.includes(value) ?? false} onPress={() => kitchen({ usual_meals: form.kitchen.usual_meals?.includes(value) ? form.kitchen.usual_meals.filter(item => item !== value) : [...form.kitchen.usual_meals || [], value] })} />)}</View><Choices label="通常在哪里吃" value={form.kitchen.eating_location || ""} options={[["", "尚未填写"], ["home", "家里"], ["work", "单位"], ["school", "学校"], ["other", "其他"]]} onChange={value => kitchen({ eating_location: (value || null) as KitchenPreferences["eating_location"] })} />{([["avoid_spicy", "长期不吃辣"], ["carry_meals", "需要携带饭菜"], ["refrigeration_available", "用餐前可以冷藏"], ["reheating_available", "用餐时可以加热"]] as const).map(([key, label]) => <Choices key={key} label={label} value={form.kitchen[key] == null ? "unknown" : form.kitchen[key] ? "yes" : "no"} options={[["unknown", "尚未填写"], ["yes", "是"], ["no", "否"]]} onChange={value => kitchen({ [key]: value === "unknown" ? null : value === "yes" })} />)}<Button label="管理我的厨具" onPress={() => router.push("/inventory")} /></Card>
      </> : null}
      {error ? <Text accessibilityRole="alert" className="text-critical">{error}</Text> : null}{notice ? <Text accessibilityRole="alert" className="text-brand">{notice}</Text> : null}
      <Button label={saving ? "正在保存…" : "保存本组资料"} disabled={saving || Boolean(conflict) || active.version !== profile.version} onPress={() => void save()} primary />
    </ScrollView>}
  </Screen>;
}

function Card({ title, children }: { title: string; children: ReactNode }) { return <View className="gap-4 rounded-2xl border border-line bg-surface p-4"><Text className="text-base font-bold text-ink">{title}</Text>{children}</View>; }
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} className={`min-h-11 justify-center rounded-xl border px-3 py-2 ${selected ? "border-brand bg-brand-soft" : "border-line bg-background-secondary"}`}><Text className={selected ? "text-brand" : "text-ink"}>{label}</Text></TouchableOpacity>; }
function Choices({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <View className="gap-2"><Text className="text-sm font-bold text-ink">{label}</Text><View className="flex-row flex-wrap gap-2">{options.map(([key, title]) => <TouchableOpacity key={key} accessibilityRole="radio" accessibilityLabel={`${label}：${title}`} accessibilityState={{ checked: value === key }} onPress={() => onChange(key)} className={`min-h-11 justify-center rounded-xl border px-3 py-2 ${value === key ? "border-brand bg-brand-soft" : "border-line bg-background-secondary"}`}><Text className={value === key ? "text-brand" : "text-ink"}>{title}</Text></TouchableOpacity>)}</View></View>; }
function Button({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) { return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} className={`min-h-12 items-center justify-center rounded-xl px-4 py-3 ${primary ? "bg-brand-fill" : "bg-brand-soft"} ${disabled ? "opacity-40" : ""}`}><Text className={`font-bold ${primary ? "text-white" : "text-brand"}`}>{label}</Text></TouchableOpacity>; }
