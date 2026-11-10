import { useRef, useState } from "react";
import { Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import type { InventoryBulkIntakeInput } from "@dietdigidose/contracts";
import { useAuth } from "@/contexts/AuthContext";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { AI_DATA_CONSENT_STORAGE_KEY, getPrivateStorageGeneration, getUserStorageKey, writeUserPrivateStorage } from "@/utils/userStorage";
import { buildIntake, summarizeInventoryText, type IntakeEntry } from "./intakeEntry";
import { useIntakeDraft } from "./useIntakeDraft";

type Props = { saveIntake: (input: InventoryBulkIntakeInput) => Promise<unknown>; onSaved: () => void };
export function InventoryTextIntake(props: Props) {
  const { user } = useAuth();
  return user ? <AccountIntake key={user.id} userId={user.id} {...props} /> : null;
}
function AccountIntake({ userId, saveIntake, onSaved }: Props & { userId: number }) {
  const router = useSafeRouter();
  const draft = useIntakeDraft("@inventory_text_draft_v1", userId, { entries: [], pending: null });
  const [text, setText] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [consent, setConsent] = useState(false);
  const sending = useRef(false);
  const { isRecording, isTranscribing, statusText, toggleRecording } = useVoiceRecorder({ onSpeechFinal: value => { setText(value); setError(""); }, onSpeechEmpty: () => setError("暂未听清，可以重新口述或直接输入文字") });
  const locked = !!draft.value.pending || busy;
  const change = (index: number, fields: Partial<IntakeEntry>) => {
    if (locked) return;
    void draft.save({ entries: draft.valueRef.current.entries.map((item, i) => i === index ? { ...item, ...fields } : item), pending: null }).catch(() => undefined);
  };
  const record = async () => {
    if (isRecording) { toggleRecording(); return; }
    try {
      const accepted = await AsyncStorage.getItem(getUserStorageKey(AI_DATA_CONSENT_STORAGE_KEY, userId)!);
      if (!draft.mounted.current) return;
      if (accepted !== "accepted") { setConsent(true); return; }
      toggleRecording();
    } catch { setError("暂时无法使用语音，请直接输入文字"); }
  };
  const acceptConsent = async () => {
    try {
      const saved = await writeUserPrivateStorage(AI_DATA_CONSENT_STORAGE_KEY, userId, getPrivateStorageGeneration(userId), "accepted");
      if (saved && draft.mounted.current) { setConsent(false); toggleRecording(); }
    } catch { if (draft.mounted.current) setError("授权未保存，请重试或直接输入文字"); }
  };
  const save = async () => {
    if (sending.current || !draft.ready) return;
    sending.current = true; setBusy(true); setError("");
    const generation = getPrivateStorageGeneration(userId);
    const current = () => draft.mounted.current && generation === getPrivateStorageGeneration(userId);
    try {
      const pending = draft.valueRef.current.pending ?? buildIntake(draft.valueRef.current.entries, Crypto.randomUUID());
      await draft.save({ ...draft.valueRef.current, pending });
      if (!current()) return;
      await saveIntake(pending);
      if (!current()) return;
      await draft.clear();
      if (current()) { setText(""); onSaved(); }
    } catch (reason) {
      if (current()) {
        if (reason && typeof reason === "object" && "status" in reason && [400, 422].includes(Number(reason.status))) await draft.save({ ...draft.valueRef.current, pending: null }).catch(() => undefined);
        setError(reason instanceof Error ? reason.message : "保存结果待确认，重试不会重复入库");
      }
    } finally { sending.current = false; if (current()) setBusy(false); }
  };
  return <View className="mt-4 gap-3 rounded-3xl border border-line bg-surface p-4">
    <Text className="text-base font-bold text-ink">说一说，或写下手边的食材</Text>
    <Text className="text-xs leading-5 text-copy-muted">例如：鸡蛋 3 个、番茄、牛奶 1 盒。逐项核对后才保存，数量和到期日期可以留空。</Text>
    <TextInput accessibilityLabel="口述或输入食材" editable={!locked} value={text} onChangeText={setText} multiline maxLength={2000} placeholder="用逗号分隔不同食材" className="min-h-20 rounded-xl border border-line p-3 text-ink" />
    <View className="flex-row gap-2"><TouchableOpacity accessibilityRole="button" disabled={locked || isTranscribing} onPress={() => void record()} className="flex-1 rounded-xl bg-brand-soft p-3"><Text className="text-center text-brand">{isRecording ? "结束录音" : isTranscribing ? "识别中…" : "开始口述"}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={locked || !draft.ready || !text.trim() || isRecording || isTranscribing} onPress={() => { setError(""); void draft.save({ entries: summarizeInventoryText(text), pending: null }).catch(() => undefined); }} className="flex-1 rounded-xl bg-brand-fill p-3 disabled:opacity-40"><Text className="text-center font-bold text-white">整理为待核对清单</Text></TouchableOpacity></View>
    {statusText ? <Text className="text-copy-muted">{statusText}</Text> : null}
    {error || draft.error ? <Text accessibilityRole="alert" className="text-critical">{error || draft.error}</Text> : null}
    {draft.value.pending ? <Text className="text-copy-muted">上次保存结果待确认。请重试同一清单，不会重复添加。</Text> : null}
    {draft.value.entries.map((entry, index) => <View key={index} className="gap-2 rounded-xl bg-canvas p-3">
      <View className="flex-row items-center gap-2"><TextInput accessibilityLabel={`第${index + 1}项食材名称`} editable={!locked} value={entry.foodName} onChangeText={foodName => change(index, { foodName })} className="min-h-11 flex-1 rounded-lg border border-line p-2 font-bold text-ink" /><TouchableOpacity disabled={locked} accessibilityLabel={`删除第${index + 1}项食材`} onPress={() => void draft.save({ entries: draft.valueRef.current.entries.filter((_, i) => i !== index), pending: null }).catch(() => undefined)} className="p-2"><Text className="text-critical">移除</Text></TouchableOpacity></View>
      <TextInput accessibilityLabel={`第${index + 1}项数量`} editable={!locked} value={entry.quantity} onChangeText={quantity => change(index, { quantity })} placeholder="数量不确定可留空" className="min-h-11 rounded-lg border border-line p-2 text-ink" />
      <View className="flex-row gap-2">{(["冷藏", "冷冻", "常温"] as const).map(storageLocation => <TouchableOpacity key={storageLocation} disabled={locked} onPress={() => change(index, { storageLocation })} className={`flex-1 rounded-lg p-2 ${entry.storageLocation === storageLocation ? "bg-brand-soft" : "bg-surface"}`}><Text className="text-center text-ink">{storageLocation}</Text></TouchableOpacity>)}</View>
      <TextInput accessibilityLabel={`第${index + 1}项到期日期`} editable={!locked} value={entry.expirationDate} onChangeText={expirationDate => change(index, { expirationDate })} placeholder="到期日期可不填；如 2026-10-01" className="min-h-11 rounded-lg border border-line p-2 text-ink" />
    </View>)}
    {draft.value.entries.length ? <TouchableOpacity accessibilityRole="button" disabled={busy || isRecording || isTranscribing} onPress={() => void save()} className="rounded-xl bg-brand-fill p-4 disabled:opacity-40"><Text className="text-center font-bold text-white">{busy ? "正在保存…" : draft.value.pending ? "重试确认保存结果" : `确认并保存 ${draft.value.entries.length} 项食材`}</Text></TouchableOpacity> : null}
    <Modal visible={consent} transparent onRequestClose={() => setConsent(false)}><View className="flex-1 justify-center bg-black/40 p-6"><View className="gap-4 rounded-3xl bg-surface p-5"><Text className="text-lg font-bold text-ink">使用语音输入</Text><Text className="leading-6 text-ink">录音会发送给配置的 AI 服务识别为文字。先核对清单，再确认保存；也可以直接输入文字。</Text><TouchableOpacity onPress={() => { setConsent(false); router.push("/legal"); }}><Text className="text-brand">查看隐私说明</Text></TouchableOpacity><TouchableOpacity onPress={() => setConsent(false)} className="p-3"><Text className="text-center text-ink">使用文字输入</Text></TouchableOpacity><TouchableOpacity onPress={() => void acceptConsent()} className="rounded-xl bg-brand-fill p-3"><Text className="text-center font-bold text-white">同意并开始录音</Text></TouchableOpacity></View></View></Modal>
  </View>;
}
