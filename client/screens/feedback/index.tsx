import { useMemo, useState, useRef, useEffect } from "react";
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Crypto from "expo-crypto";
import { APP_VERSION, APP_RELEASE_SNAPSHOT } from "@/utils/appVersion";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { feedbackApi, type FeedbackCategory } from "@/services/api";

const categories: { key: FeedbackCategory; title: string; description: string; icon: "bug" | "lightbulb" | "headset" }[] = [
  { key: "issue", title: "问题反馈", description: "识别、数据或页面显示不正确", icon: "bug" },
  { key: "suggestion", title: "功能建议", description: "告诉我们你希望增加什么", icon: "lightbulb" },
  { key: "support", title: "联系客服", description: "账号、数据或使用上的帮助", icon: "headset" },
];

export default function FeedbackScreen() {
  const { user } = useAuth();
  return <FeedbackForm key={user?.id || "guest"} />;
}
function FeedbackForm() {
  const router = useSafeRouter();
  const { isAuthenticated, user } = useAuth();
  const authFetch = useAuthFetch();
  const { category: initialCategory, page, recipeId, recipeTitle } = useSafeSearchParams<{
    category?: FeedbackCategory;
    page?: string;
    recipeId?: string;
    recipeTitle?: string;
  }>();
  const [category, setCategory] = useState<FeedbackCategory>(
    initialCategory && categories.some((item) => item.key === initialCategory) ? initialCategory : "issue",
  );
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const busy = useRef(false);
  const account = useRef(user?.id);
  account.current = user?.id;
  useEffect(() => () => { account.current = undefined; }, []);
  const [submitting, setSubmitting] = useState(false);
  const contextLabel = useMemo(() => recipeTitle ? `已附带：食谱「${recipeTitle}」` : page ? `已附带：${page}` : null, [page, recipeTitle]);

  const submit = async () => {
    if (busy.current) return;
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (content.trim().length < 5) {
      setError("请至少填写 5 个字，方便我们准确处理。");
      return;
    }
    const owner = account.current;
    busy.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const fingerprint = JSON.stringify([owner, category, content.trim(), page, recipeId, recipeTitle]);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: Crypto.randomUUID() };
      const result = await feedbackApi.create(authFetch, {
        requestKey: request.current.key,
        category,
        content: content.trim(),
        context: {
          appVersion: APP_VERSION,
          snapshot: APP_RELEASE_SNAPSHOT,
          platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
          page: page || "帮助与反馈",
          recipeId: recipeId ? Number(recipeId) : undefined,
          recipeTitle,
        },
      });
      if (account.current !== owner) return;
      request.current = null;
      setContent("");
      router.replace("/feedback-history", { id: result.id });
    } catch (err) {
      if (account.current === owner) setError(err instanceof Error ? err.message : "暂时无法发送反馈，请稍后重试。");
    } finally {
      busy.current = false;
      if (account.current === owner) setSubmitting(false);
    }
  };

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <View className="flex-row items-center justify-between border-b border-line bg-canvas px-5 pb-3 pt-4">
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="返回" className="h-10 w-10 items-center justify-center rounded-full border border-line bg-surface shadow-xs">
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>
        <Text className="text-lg font-black text-ink">帮助与反馈</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/feedback-history")}><Text className="text-brand">我的反馈</Text></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 44 }} keyboardShouldPersistTaps="handled">
        <View className="mb-5 rounded-3xl bg-brand-fill p-5">
          <Text className="text-base font-black text-white">你的每一次反馈都很重要</Text>
          <Text className="mt-1 text-xs leading-5 text-white/80">提交时附带应用版本、平台和当前页面；不自动附带健康资料或聊天记录。你可以在“我的反馈”查看进度和回复。</Text>
        </View>
        <Text className="mb-2 px-1 text-xs font-bold text-copy-muted">选择类型</Text>
        <View className="gap-2">
          {categories.map((item) => {
            const selected = item.key === category;
            return <TouchableOpacity key={item.key} onPress={() => setCategory(item.key)} accessibilityRole="radio" accessibilityState={{ selected }} className={`flex-row items-center rounded-2xl border p-4 ${selected ? "border-brand bg-brand/10" : "border-line bg-surface"}`}>
              <View className={`mr-3 h-10 w-10 items-center justify-center rounded-xl ${selected ? "bg-brand-fill" : "bg-canvas"}`}>
                <FontAwesome6 name={item.icon} size={15} colorClassName={selected ? "accent-on-brand" : "accent-brand"} />
              </View>
              <View className="flex-1"><Text className="text-sm font-black text-ink">{item.title}</Text><Text className="mt-0.5 text-[11px] text-copy-muted">{item.description}</Text></View>
              {selected ? <FontAwesome6 name="circle-check" size={16} colorClassName="accent-brand" /> : null}
            </TouchableOpacity>;
          })}
        </View>
        {contextLabel ? <View className="mt-5 flex-row items-center rounded-xl bg-brand-soft px-3 py-2.5"><FontAwesome6 name="paperclip" size={12} colorClassName="accent-brand" /><Text className="ml-2 flex-1 text-[11px] font-medium text-brand">{contextLabel}</Text></View> : null}
        <Text className="mb-2 mt-5 px-1 text-xs font-bold text-copy-muted">详细描述</Text>
        <TextInput value={content} onChangeText={setContent} multiline textAlignVertical="top" maxLength={2000} placeholder="请描述你遇到的问题、期待的改进，或需要客服协助的事项…" placeholderTextColorClassName="accent-copy-muted" className="min-h-40 rounded-2xl border border-line bg-surface p-4 text-sm leading-6 text-ink" />
        <Text className="mt-1.5 text-right text-[10px] text-copy-muted">{content.length}/2000</Text>
        {error ? <Text accessibilityRole="alert" className="mt-3 text-critical">{error}</Text> : null}
        <TouchableOpacity disabled={submitting} onPress={() => void submit()} accessibilityLabel="提交反馈" className={`mt-4 items-center rounded-2xl py-3.5 ${submitting ? "bg-brand/50" : "bg-brand-fill active:opacity-85"}`}>
          <Text className="text-sm font-black text-white">{submitting ? "提交中…" : "提交反馈"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}
