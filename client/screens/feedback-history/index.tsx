import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { feedbackApi, feedbackStatusLabels, type FeedbackDetail, type FeedbackItem } from "@/services/api/feedback";
export default function FeedbackHistoryScreen() {
  const { user } = useAuth();
  return <FeedbackHistory key={user?.id || "guest"} authenticated={Boolean(user)} />;
}
function FeedbackHistory({ authenticated }: { authenticated: boolean }) {
  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  const { id } = useSafeSearchParams<{ id?: number | string }>();
  const [selectedId, setSelectedId] = useState<number | undefined>(Number(id) || undefined);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const busy = useRef(false);
  const pending = useRef<{ requestKey: string; content: string; version: number; id: number } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const load = useCallback(async (selected?: number, cursor?: number) => {
    if (!authenticated) return;
    const sequence = ++generation.current;
    setSelectedId(selected);
    setContent(""); pending.current = null;
    setLoading(true); setError(null);
    if (selected) setDetail(null);
    try {
      if (selected) {
        const result = await feedbackApi.detail(authFetch, selected);
        if (alive.current && sequence === generation.current) setDetail(result);
      } else {
        const result = await feedbackApi.list(authFetch, cursor);
        if (!alive.current || sequence !== generation.current) return;
        setDetail(null); setItems(current => cursor ? [...current, ...result.items] : result.items); setNext(result.nextCursor);
      }
    } catch (err) { if (alive.current && sequence === generation.current) setError(err instanceof Error ? err.message : "加载失败，请重试"); }
    finally { if (alive.current && sequence === generation.current) setLoading(false); }
  }, [authFetch, authenticated]);
  useEffect(() => { void load(Number(id) || undefined); }, [id, load]);
  const reply = async () => {
    if (!detail || busy.current || !content.trim()) return;
    busy.current = true; setLoading(true); setError(null);
    const sequence = generation.current;
    const previous = pending.current;
    const input = previous && previous.id === detail.id && previous.content === content.trim() && previous.version === detail.version
      ? previous : { id: detail.id, content: content.trim(), version: detail.version, requestKey: Crypto.randomUUID() };
    pending.current = input;
    try {
      const result = await feedbackApi.reply(authFetch, detail.id, { requestKey: input.requestKey, content: input.content, version: input.version });
      if (!alive.current || sequence !== generation.current) return;
      setDetail(result); setContent(""); pending.current = null;
    } catch (err) { if (alive.current && sequence === generation.current) setError(err instanceof Error ? err.message : "发送失败，请重试"); }
    finally { busy.current = false; if (alive.current && sequence === generation.current) setLoading(false); }
  };
  return <Screen safeAreaEdges={["top", "bottom", "left", "right"]}>
    <View className="flex-row justify-between items-center border-b border-line p-4">
      <TouchableOpacity accessibilityRole="button" onPress={() => detail ? void load() : router.back()}><Text className="text-brand">返回</Text></TouchableOpacity>
      <Text className="text-lg font-bold text-ink">{detail ? `反馈 #${detail.id}` : "我的反馈"}</Text>
      <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={() => void load(selectedId)}><Text className="text-brand">刷新</Text></TouchableOpacity>
    </View>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      {!authenticated ? <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/login")}><Text className="text-brand">登录后查看自己的反馈</Text></TouchableOpacity> : null}
      {error ? <Text accessibilityRole="alert" className="text-critical">{error}</Text> : null}
      {loading ? <ActivityIndicator /> : null}
      {detail ? <>
        <Text className="font-bold text-brand">{feedbackStatusLabels[detail.status]}</Text>
        <View className="rounded-2xl bg-surface border border-line p-4 gap-2"><Text className="text-ink">{detail.content}</Text><Text className="text-xs text-copy-muted">{new Date(detail.createdAt).toLocaleString()}</Text></View>
        {detail.messages.map(message => <View key={message.id} className="rounded-2xl bg-surface border border-line p-4 gap-2">
          <Text className="text-xs font-bold text-brand">{message.authorRole === "admin" ? "处理人员" : "我的补充"} · {feedbackStatusLabels[message.status]}</Text>
          <Text className="text-ink">{message.content}</Text><Text className="text-xs text-copy-muted">{new Date(message.createdAt).toLocaleString()}</Text>
        </View>)}
        {detail.status !== "closed" ? <>
          <TextInput accessibilityLabel="补充反馈内容" multiline maxLength={2000} value={content} onChangeText={setContent} placeholder="补充发生步骤或回复处理人员…" className="min-h-28 rounded-2xl border border-line bg-surface p-4 text-ink" />
          <TouchableOpacity accessibilityRole="button" disabled={loading || !content.trim()} onPress={() => void reply()} className="rounded-xl bg-brand-fill p-3 disabled:opacity-50"><Text className="text-center font-bold text-white">发送补充</Text></TouchableOpacity>
        </> : <Text className="text-copy-muted">此反馈已关闭。如需继续协助，请新建反馈并注明原编号。</Text>}
      </> : items.map(item => <TouchableOpacity accessibilityRole="button" key={item.id} onPress={() => void load(item.id)} className="rounded-2xl border border-line bg-surface p-4 gap-2"><Text className="font-bold text-brand">#{item.id} · {feedbackStatusLabels[item.status]}</Text><Text numberOfLines={3} className="text-ink">{item.content}</Text><Text className="text-xs text-copy-muted">{new Date(item.updatedAt).toLocaleString()}</Text></TouchableOpacity>)}
      {!detail && !loading && authenticated && !items.length ? <Text className="text-copy-muted">还没有反馈记录。</Text> : null}
      {!detail && next ? <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={() => void load(undefined, next)}><Text className="text-center text-brand">加载更多</Text></TouchableOpacity> : null}
      <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/feedback")}><Text className="text-center text-brand">新建反馈</Text></TouchableOpacity>
      <Text className="text-xs text-copy-muted">反馈与回复保留至账号注销，供你跟踪处理进度。请勿提交密码、验证码或无关健康资料。</Text>
    </ScrollView>
  </Screen>;
}
