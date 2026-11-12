import AsyncStorage from "@react-native-async-storage/async-storage";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { communityApi, type CommunityPost } from "@/services/api";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { formatLocalPostDate } from "@/utils/postDate";
import { getUserStorageKey, SEARCH_HISTORY_STORAGE_KEY } from "@/utils/userStorage";
import { resolveMediaUrl } from "@/utils/mediaUrl";

const MAX_HISTORY = 10;
const HOT_TOPICS = ["减脂沙拉", "空气炸锅", "全麦", "控糖", "便当", "牛油果", "高蛋白", "清冰箱"];
const CATEGORY_HINTS = ["寻味", "榜单", "活动", "问答"] as const;

type UserHit = {
  id: number;
  username: string;
  nickname?: string | null;
  avatar_url: string | null;
  bio?: string | null;
};

type ResultTab = "all" | "posts" | "users";

export default function CommunitySearchScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<{ q?: string }>();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const historyKey = getUserStorageKey(`${SEARCH_HISTORY_STORAGE_KEY}:community`, user?.id);
  const inputRef = useRef<TextInput>(null);

  const [draft, setDraft] = useState(params.q?.trim() || "");
  const [submittedQuery, setSubmittedQuery] = useState(() => params.q?.trim() || "");
  const [history, setHistory] = useState<string[]>([]);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [users, setUsers] = useState<UserHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("all");
  const requestSeq = useRef(0);

  const showingResults = submittedQuery.length > 0;

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!historyKey) {
        if (active) setHistory([]);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(historyKey);
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        if (active) {
          setHistory(Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_HISTORY)
            : []);
        }
      } catch {
        if (active) setHistory([]);
      }
    })();
    return () => { active = false; };
  }, [historyKey]);

  const saveHistory = useCallback((value: string) => {
    const next = [value, ...history.filter((item) => item !== value)].slice(0, MAX_HISTORY);
    setHistory(next);
    if (historyKey) void AsyncStorage.setItem(historyKey, JSON.stringify(next));
  }, [history, historyKey]);

  const runSearch = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const seq = ++requestSeq.current;
    setSubmittedQuery(value);
    setDraft(value);
    setLoading(true);
    setError(null);
    setResultTab("all");
    saveHistory(value);

    const [postResult, userResult] = await Promise.allSettled([
      communityApi.postPage<CommunityPost>(`?search=${encodeURIComponent(value)}&pageSize=24`, authFetch),
      communityApi.users<UserHit>(authFetch, value),
    ]);
    if (requestSeq.current !== seq) return;

    setPosts(postResult.status === "fulfilled" ? postResult.value.items : []);
    setUsers(userResult.status === "fulfilled" ? userResult.value : []);
    if (postResult.status === "rejected" && userResult.status === "rejected") {
      setError("搜索暂时不可用，请稍后重试");
    } else if (postResult.status === "rejected" || userResult.status === "rejected") {
      setError("部分结果未能加载");
    }
    setLoading(false);
  }, [authFetch, saveHistory]);

  useEffect(() => {
    if (params.q?.trim()) void runSearch(params.q);
    // only on mount / deep link
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => ({
    posts: posts.length,
    users: users.length,
    all: posts.length + users.length,
  }), [posts, users]);

  const clearResults = () => {
    requestSeq.current += 1;
    setSubmittedQuery("");
    setDraft("");
    setPosts([]);
    setUsers([]);
    setError(null);
    setLoading(false);
    setResultTab("all");
    setTimeout(() => inputRef.current?.focus(), 40);
  };

  return (
    <Screen safeAreaEdges={["top", "bottom"]}>
      <View className="border-b border-line bg-surface px-4 pb-3 pt-2">
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => (showingResults ? clearResults() : router.back())}
            accessibilityLabel={showingResults ? "返回搜索首页" : "返回社区"}
            className="h-10 w-10 items-center justify-center rounded-lg active:bg-background-secondary"
          >
            <FontAwesome6 name="arrow-left" size={15} colorClassName="accent-ink" />
          </TouchableOpacity>

          <View className="h-10 flex-1 flex-row items-center rounded-lg border border-line bg-canvas px-3">
            <FontAwesome6 name="magnifying-glass" size={13} colorClassName="accent-copy-muted" />
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void runSearch(draft)}
              placeholder="搜索动态、话题或食友"
              placeholderTextColorClassName="accent-copy-muted"
              autoFocus={!params.q}
              autoCorrect={false}
              returnKeyType="search"
              className="min-w-0 flex-1 px-2.5 py-0 text-sm text-ink outline-none"
              style={{ outlineStyle: "none", outlineWidth: 0, boxShadow: "none" } as object}
              accessibilityLabel="社区搜索输入"
            />
            {draft ? (
              <TouchableOpacity onPress={() => setDraft("")} accessibilityLabel="清空">
                <FontAwesome6 name="circle-xmark" size={14} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            onPress={() => void runSearch(draft)}
            disabled={!draft.trim()}
            accessibilityLabel="搜索"
            className={`h-10 items-center justify-center rounded-lg px-3 ${draft.trim() ? "bg-brand-fill" : "bg-background-secondary"}`}
          >
            <Text className={`text-sm font-semibold ${draft.trim() ? "text-white" : "text-copy-muted"}`}>搜索</Text>
          </TouchableOpacity>
        </View>

        {showingResults ? (
          <View className="mt-3 flex-row gap-2">
            {([
              { key: "all", label: `全部 ${counts.all || ""}` },
              { key: "posts", label: `动态 ${counts.posts || ""}` },
              { key: "users", label: `食友 ${counts.users || ""}` },
            ] as const).map((tab) => {
              const active = resultTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => setResultTab(tab.key)}
                  className={`rounded-md border px-3 py-1.5 ${active ? "border-brand bg-brand-soft" : "border-line bg-canvas"}`}
                >
                  <Text className={`text-xs font-medium ${active ? "text-brand-strong" : "text-copy-muted"}`}>
                    {tab.label.trim()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>

      <ScrollView
        className="flex-1 bg-canvas"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        {!showingResults ? (
          <View>
            {history.length > 0 ? (
              <View className="mb-6">
                <View className="mb-2.5 flex-row items-center justify-between">
                  <Text className="text-sm font-semibold text-ink">最近搜索</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setHistory([]);
                      if (historyKey) void AsyncStorage.removeItem(historyKey);
                    }}
                  >
                    <Text className="text-xs text-copy-muted">清除</Text>
                  </TouchableOpacity>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {history.map((item) => (
                    <TouchableOpacity
                      key={item}
                      onPress={() => void runSearch(item)}
                      className="rounded-md border border-line bg-surface px-3 py-2"
                    >
                      <Text className="text-xs text-ink">{item}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <View className="mb-6">
              <Text className="mb-2.5 text-sm font-semibold text-ink">社区热搜</Text>
              <View className="flex-row flex-wrap gap-2">
                {HOT_TOPICS.map((item, index) => (
                  <TouchableOpacity
                    key={item}
                    onPress={() => void runSearch(item)}
                    className="flex-row items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2"
                  >
                    {index < 3 ? (
                      <Text className="text-[10px] font-semibold text-brand">{index + 1}</Text>
                    ) : null}
                    <Text className="text-xs text-ink">{item}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View>
              <Text className="mb-2.5 text-sm font-semibold text-ink">按频道逛</Text>
              <View className="overflow-hidden rounded-xl border border-line bg-surface">
                {CATEGORY_HINTS.map((category, index) => (
                  <TouchableOpacity
                    key={category}
                    onPress={() => void runSearch(category)}
                    className={`flex-row items-center justify-between px-4 py-3 ${index < CATEGORY_HINTS.length - 1 ? "border-b border-line" : ""}`}
                  >
                    <Text className="text-sm text-ink">{category}</Text>
                    <FontAwesome6 name="chevron-right" size={11} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        ) : loading ? (
          <View className="items-center py-24">
            <ActivityIndicator size="large" colorClassName="accent-brand" />
            <Text className="mt-3 text-xs text-copy-muted">正在搜索「{submittedQuery}」…</Text>
          </View>
        ) : error && counts.all === 0 ? (
          <View className="items-center py-20">
            <Text className="text-base font-semibold text-ink">搜索失败</Text>
            <Text className="mt-2 text-xs text-copy-muted">{error}</Text>
            <TouchableOpacity
              onPress={() => void runSearch(submittedQuery)}
              className="mt-5 h-10 items-center justify-center rounded-lg bg-brand-fill px-5"
            >
              <Text className="text-sm font-semibold text-white">重试</Text>
            </TouchableOpacity>
          </View>
        ) : counts.all === 0 ? (
          <View className="items-center py-20">
            <Text className="text-base font-semibold text-ink">没有找到「{submittedQuery}」</Text>
            <Text className="mt-2 text-center text-xs leading-5 text-copy-muted">
              换个关键词试试，或去频道里浏览热门内容
            </Text>
          </View>
        ) : (
          <View className="gap-5">
            {error ? (
              <TouchableOpacity onPress={() => void runSearch(submittedQuery)} className="rounded-lg border border-warm/30 bg-warm-soft px-3 py-2.5">
                <Text className="text-xs text-warm">{error} · 点击重试</Text>
              </TouchableOpacity>
            ) : null}

            {(resultTab === "all" || resultTab === "users") && users.length > 0 ? (
              <View>
                <Text className="mb-2 text-xs font-medium text-copy-muted">食友 · {users.length}</Text>
                {users.map((hit) => (
                  <TouchableOpacity
                    key={hit.id}
                    onPress={() => router.push("/user-profile", { userId: hit.id })}
                    className="mb-2 flex-row items-center rounded-xl border border-line bg-surface px-3.5 py-3"
                  >
                    <Image source={getAvatarSource(hit.avatar_url, hit.id)} className="h-10 w-10 rounded-full" />
                    <View className="min-w-0 flex-1 px-3">
                      <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                        {hit.nickname || hit.username}
                      </Text>
                      <Text className="mt-0.5 text-xs text-copy-muted" numberOfLines={1}>
                        @{hit.username}{hit.bio?.trim() ? ` · ${hit.bio.trim()}` : ""}
                      </Text>
                    </View>
                    <FontAwesome6 name="chevron-right" size={11} colorClassName="accent-copy-muted" />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {(resultTab === "all" || resultTab === "posts") && posts.length > 0 ? (
              <View>
                <Text className="mb-2 text-xs font-medium text-copy-muted">动态 · {posts.length}</Text>
                {posts.map((post) => {
                  const cover = resolveMediaUrl(post.image_url || post.image_urls?.[0] || null);
                  return (
                    <TouchableOpacity
                      key={post.id}
                      onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
                      className="mb-2 overflow-hidden rounded-xl border border-line bg-surface"
                    >
                      <View className="flex-row">
                        {cover ? (
                          <Image source={{ uri: cover }} className="h-[88px] w-[88px] bg-background-secondary" />
                        ) : null}
                        <View className="min-w-0 flex-1 px-3.5 py-3">
                          <View className="flex-row items-center gap-2">
                            {post.category ? (
                              <Text className="text-[10px] font-medium text-brand">#{post.category}</Text>
                            ) : null}
                            <Text className="text-[10px] text-copy-muted">{formatLocalPostDate(post.created_at)}</Text>
                          </View>
                          <Text className="mt-1 text-sm leading-5 text-ink" numberOfLines={2}>{post.content}</Text>
                          <Text className="mt-1.5 text-[11px] text-copy-muted">
                            {(post as CommunityPost & { nickname?: string }).nickname || post.username}
                            {" · "}
                            {post.likes_count ?? 0} 赞
                            {" · "}
                            {(post as CommunityPost & { comment_count?: number }).comment_count ?? 0} 评
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
