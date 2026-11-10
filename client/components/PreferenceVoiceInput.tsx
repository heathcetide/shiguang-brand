import { useIsFocused } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { KitchenPreferences } from "@dietdigidose/contracts";
import { useAuth } from "@/contexts/AuthContext";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { AI_DATA_CONSENT_STORAGE_KEY, getPrivateStorageGeneration, getUserStorageKey, writeUserPrivateStorage } from "@/utils/userStorage";
import { summarizeMealPreferences } from "@/utils/preferenceSummary";

export function PreferenceVoiceInput({ onApply }: { onApply: (value: KitchenPreferences, persistent: boolean) => void }) {
  const focused = useIsFocused();
  const { user, sessionGeneration } = useAuth(); const router = useSafeRouter();
  const [text, setText] = useState(""); const [error, setError] = useState("");
  const [consent, setConsent] = useState(false); const [persistent, setPersistent] = useState(false);
  const scopeKey = JSON.stringify([user?.id ?? null, sessionGeneration]);
  const scope = useMemo(() => ({}), [scopeKey, focused]);
  const owner = useRef<object | undefined>(scope);
  useLayoutEffect(() => { owner.current = scope; return () => { owner.current = undefined; }; }, [scope]);
  const [previousScopeKey, setPreviousScopeKey] = useState(scopeKey);
  if (previousScopeKey !== scopeKey) {
    setPreviousScopeKey(scopeKey);
    setText(""); setError(""); setConsent(false); setPersistent(false);
  }
  const { isRecording, isTranscribing, statusText, toggleRecording } = useVoiceRecorder({
    focused,
    scopeKey,
    onSpeechFinal: value => { setText(value); setError(""); },
    onSpeechEmpty: () => setError("暂未识别出内容，可以重新录音或直接输入"),
  });
  const summary = summarizeMealPreferences(text);
  const record = async () => {
    if (isRecording) { toggleRecording(); return; }
    if (!user || !focused) return;
    const id = user.id;
    try {
      const accepted = await AsyncStorage.getItem(getUserStorageKey(AI_DATA_CONSENT_STORAGE_KEY, id)!);
      if (owner.current !== scope) return;
      if (accepted !== "accepted") { setConsent(true); return; }
      toggleRecording();
    } catch { if (owner.current !== scope) return; setError("无法读取语音授权，请使用文字输入"); }
  };
  return <View className="gap-3 rounded-2xl border border-line bg-surface p-4">
    <Text className="font-bold text-ink">也可以说一句话</Text>
    <TextInput accessibilityLabel="做饭需求" placeholder="例如：两个人，20分钟，不吃辣" value={text} onChangeText={setText} multiline maxLength={500} className="min-h-12 rounded-xl bg-background-secondary p-3 text-ink" />
    <TouchableOpacity accessibilityRole="button" disabled={isTranscribing} onPress={() => void record()} className="min-h-12 justify-center rounded-xl bg-brand-soft px-4">
      <Text className="font-bold text-brand">{isRecording ? "结束录音并识别" : isTranscribing ? "正在识别…" : "按一下开始口述"}</Text>
    </TouchableOpacity>
    {statusText ? <Text className="text-copy-muted">{statusText}</Text> : null}
    {error ? <Text accessibilityRole="alert" className="text-critical">{error}</Text> : null}
    {text.trim() ? <>
      <Text className="text-copy-muted">请核对摘要；可提取人数、时间、不吃辣、预算、做饭水平、外食频率、常用餐次、地点、带饭和冷藏/加热条件；未提取的内容和过敏限制请在对应选项中补充。</Text>
      <Text className="font-bold text-ink">{summary.labels.join(" · ") || "还没有可提取的条件，请使用下方选项"}</Text>
      <View className="flex-row gap-2">{[false, true].map(value => <TouchableOpacity key={String(value)} accessibilityRole="radio" accessibilityState={{ checked: persistent === value }} onPress={() => setPersistent(value)} className={`flex-1 rounded-xl border p-3 ${persistent === value ? "border-brand bg-brand-soft" : "border-line"}`}><Text className="text-ink">{value ? "保存为常用设置" : "仅本次使用"}</Text></TouchableOpacity>)}</View>
      <TouchableOpacity accessibilityRole="button" disabled={!summary.labels.length} onPress={() => onApply(summary.preferences, persistent)} className="min-h-12 justify-center rounded-xl bg-brand-fill p-3 disabled:opacity-40"><Text className="text-center font-bold text-white">确认摘要，应用到表单</Text></TouchableOpacity>
    </> : null}
    <Modal visible={consent} transparent animationType="fade" onRequestClose={() => setConsent(false)}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6"><View className="w-full max-w-md gap-4 rounded-3xl bg-surface p-6">
        <Text className="text-xl font-bold text-ink">使用语音输入</Text>
        <Text className="leading-6 text-ink">录音会发送给配置的 AI 服务进行文字识别。识别后先展示摘要，未经确认不会修改你的资料。</Text>
        <TouchableOpacity onPress={() => { setConsent(false); router.push("/legal"); }}><Text className="text-brand">查看隐私说明</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setConsent(false)} className="p-3"><Text className="text-center text-ink">暂不使用</Text></TouchableOpacity>
        <TouchableOpacity className="rounded-xl bg-brand-fill p-3" onPress={() => { if (!user || !focused) return; const id = user.id; void writeUserPrivateStorage(AI_DATA_CONSENT_STORAGE_KEY, id, getPrivateStorageGeneration(id), "accepted").then(saved => { if (saved && owner.current === scope) { setConsent(false); toggleRecording(); } }).catch(() => { if (owner.current !== scope) return; setConsent(false); setError("授权未保存，请重试或使用文字输入"); }); }}><Text className="text-center font-bold text-white">同意并开始录音</Text></TouchableOpacity>
      </View></View>
    </Modal>
  </View>;
}
