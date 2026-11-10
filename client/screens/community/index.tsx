import { resolveMediaUrl } from "@/utils/mediaUrl";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  DeviceEventEmitter,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { communityApi } from "@/services/api";
import type { ActivityStatus, Post } from "./types";
import { formatActivityDate, getActivityStatus, parseCommunityDate } from "./activity";
import { buildRefreshedFeed } from "./feed";
import { useAppThemeColors } from "@/hooks/useAppThemeColors";
import { LinkedRecipeCard } from "@/components/LinkedRecipeCard";

const PAGE_SIZE = 12;

export default function CommunityScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const colors = useAppThemeColors();
  const insets = useSafeAreaInsets();
  const requestInFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("寻味");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<"进行中" | "即将开始" | "往期活动">("进行中");
  const [questionFilter, setQuestionFilter] = useState<"热门问题" | "待回答" | "已解决">("热门问题");
  const [hasMore, setHasMore] = useState(false);
  const refreshSequence = useRef(0);
  const fetchRequestSequence = useRef(0);
  const nextCursorRef = useRef<string | null>(null);

  // 帖子详情 Modal 控制
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  const openPostComposer = useCallback((category?: string) => {
    const params = category ? { category } : {};
    if (isAuthenticated) {
      router.push("/post-create", params);
      return;
    }
    Alert.alert("登录后发布", "登录后即可把你的美食分享给社区食友。", [
      { text: "取消", style: "cancel" },
      {
        text: "去登录",
        onPress: () => router.push("/login", {
          returnTo: { pathname: "/post-create", params },
        }),
      },
    ]);
  }, [isAuthenticated, router]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("open-community-post", () => {
      openPostComposer();
    });
    return () => sub.remove();
  }, [openPostComposer]);

  const tabs = ["寻味", "榜单", "活动", "问答"];

  const fetchPosts = useCallback(async (forceRefresh = false, append = false) => {
    if (append && (requestInFlight.current || !nextCursorRef.current)) return;
    requestInFlight.current = true;
    const requestSequence = ++fetchRequestSequence.current;
    if (forceRefresh) setRefreshing(true);
    try {
      setLoading(true);
      setFetchError(null);
      if (append && !nextCursorRef.current) return;
      const cursorQuery = append && nextCursorRef.current ? `&cursor=${encodeURIComponent(nextCursorRef.current)}` : "";
      const query = `?category=${encodeURIComponent(activeTab)}&sort=recommended&pageSize=${PAGE_SIZE}${cursorQuery}`;
      if (forceRefresh) {
        refreshSequence.current += 1;
        const cacheBuster = Date.now();
        const [recommended, latest] = await Promise.all([
          communityApi.postPage<Post>(`${query}&_=${cacheBuster}`, authFetch),
          communityApi.postPage<Post>(`?category=${encodeURIComponent(activeTab)}&sort=latest&pageSize=${PAGE_SIZE}&_=${cacheBuster}`, authFetch),
        ]);
        if (requestSequence !== fetchRequestSequence.current) return;
        const refreshed = buildRefreshedFeed(recommended.items, latest.items, refreshSequence.current);
        setPosts(refreshed);
        nextCursorRef.current = recommended.nextCursor;
        setHasMore(Boolean(recommended.nextCursor));
      } else {
        const data = await communityApi.postPage<Post>(query, authFetch);
        if (requestSequence !== fetchRequestSequence.current) return;
        const nextPosts = Array.isArray(data.items) ? data.items : [];
        setPosts((current) => append ? [...current, ...nextPosts.filter((item) => !current.some((post) => post.id === item.id))] : nextPosts);
        nextCursorRef.current = data.nextCursor;
        setHasMore(Boolean(data.nextCursor));
      }
    } catch (e) {
      if (requestSequence !== fetchRequestSequence.current) return;
      if (!append) {
        setPosts([]);
        nextCursorRef.current = null;
      }
      setFetchError(e instanceof Error ? e.message : "社区内容加载失败");
    } finally {
      if (requestSequence === fetchRequestSequence.current) {
        requestInFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeTab, authFetch]);

  useFocusEffect(
    useCallback(() => {
      fetchPosts();
    }, [fetchPosts])
  );

  const handleLike = async (id: number) => {
    if (!isAuthenticated) {
      Alert.alert("登录后点赞", "登录后即可点赞支持这篇分享。", [
        { text: "取消", style: "cancel" },
        {
          text: "去登录",
          onPress: () => router.push("/login", {
            returnTo: { pathname: "/post-detail", params: { id, pendingAction: "like" } },
          }),
        },
      ]);
      return;
    }
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              is_liked: !p.is_liked,
              likes_count: p.is_liked ? p.likes_count - 1 : p.likes_count + 1,
            }
          : p
      )
    );

    // 如果选中的帖子正在详情弹窗里查看，也同步更新
    if (selectedPost && selectedPost.id === id) {
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              is_liked: !prev.is_liked,
              likes_count: prev.is_liked ? prev.likes_count - 1 : prev.likes_count + 1,
            }
          : null
      );
    }

    try {
      const data = await communityApi.toggleLike(authFetch, id);
      setPosts((prev) => prev.map((item) => item.id === id ? { ...item, likes_count: data.likes_count, is_liked: data.is_liked } : item));
    } catch (e) {
      fetchPosts();
    }
  };

  const handleJoinEvent = async (post: Post) => {
    if (!isAuthenticated) {
      Alert.alert("登录后参加", "登录后即可参加社区活动。", [
        { text: "取消", style: "cancel" },
        {
          text: "去登录",
          onPress: () => router.push("/login", {
            returnTo: { pathname: "/post-detail", params: { id: post.id, pendingAction: "join" } },
          }),
        },
      ]);
      return;
    }
    if (getActivityStatus(post) === "ended") return;

    const previousJoined = Boolean(post.is_joined);
    const previousCount = post.participant_count || 0;
    setPosts((current) => current.map((item) => item.id === post.id ? {
      ...item,
      is_joined: !previousJoined,
      participant_count: Math.max(0, previousCount + (previousJoined ? -1 : 1)),
    } : item));

    try {
      const data = await communityApi.toggleJoin(authFetch, post.id);
      setPosts((current) => current.map((item) => item.id === post.id ? {
        ...item,
        is_joined: Boolean(data.is_joined),
        participant_count: Number(data.participant_count) || 0,
      } : item));
    } catch (error) {
      setPosts((current) => current.map((item) => item.id === post.id ? {
        ...item,
        is_joined: previousJoined,
        participant_count: previousCount,
      } : item));
      Alert.alert("操作失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 格式化赞数 (如 1000+、10000+、5000+)
  const formatLikes = (count: number) => {
    if (count >= 10000) return "10000+";
    if (count >= 5000) return "5000+";
    if (count >= 1000) return "1000+";
    return count.toString();
  };

  // 过滤数据 (分类 Tab + 搜索关键词)
  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      const pCat = p.category || "寻味";
      const matchCategory = pCat === activeTab;
      const matchSearch = !searchQuery || p.content.includes(searchQuery);
      return matchCategory && matchSearch;
    });
  }, [posts, activeTab, searchQuery]);

  const rankedPosts = useMemo(() => {
    if (activeTab !== "榜单") return [];
    return [...filteredPosts].sort((left, right) => {
      const leftHeat =
        (left.likes_count || 0) +
        (left.comment_count || 0) * 3 +
        (left.views_count || 0) * 0.1;
      const rightHeat =
        (right.likes_count || 0) +
        (right.comment_count || 0) * 3 +
        (right.views_count || 0) * 0.1;
      return rightHeat - leftHeat || right.id - left.id;
    });
  }, [activeTab, filteredPosts]);

  const activityPosts = useMemo(() => {
    if (activeTab !== "活动") return [];
    const statusForFilter: Record<typeof activityFilter, ActivityStatus> = {
      "进行中": "ongoing",
      "即将开始": "upcoming",
      "往期活动": "ended",
    };
    return filteredPosts
      .filter((post) => getActivityStatus(post) === statusForFilter[activityFilter])
      .sort((left, right) => {
        const leftDate = parseCommunityDate(left.event_start_at)?.getTime() || 0;
        const rightDate = parseCommunityDate(right.event_start_at)?.getTime() || 0;
        return activityFilter === "往期活动" ? rightDate - leftDate : leftDate - rightDate;
      });
  }, [activeTab, activityFilter, filteredPosts]);

  const questionPosts = useMemo(() => {
    if (activeTab !== "问答") return [];
    return filteredPosts
      .filter((post) => {
        if (questionFilter === "待回答") return (post.comment_count || 0) === 0;
        if (questionFilter === "已解决") return post.question_status === "resolved";
        return true;
      })
      .sort((left, right) => {
        if (questionFilter === "热门问题") {
          const leftHeat = (left.comment_count || 0) * 5 + (left.views_count || 0) + (left.likes_count || 0) * 2;
          const rightHeat = (right.comment_count || 0) * 5 + (right.views_count || 0) + (right.likes_count || 0) * 2;
          return rightHeat - leftHeat;
        }
        return right.id - left.id;
      });
  }, [activeTab, filteredPosts, questionFilter]);

  const formatHeat = (post: Post) => {
    const heat = Math.round(
      (post.likes_count || 0) +
      (post.comment_count || 0) * 3 +
      (post.views_count || 0) * 0.1
    );
    if (heat >= 10000) return `${(heat / 10000).toFixed(1)}万`;
    if (heat >= 1000) return `${(heat / 1000).toFixed(1)}k`;
    return String(heat);
  };

  const formatRankingDate = (value: string) => {
    const date = new Date(value.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return "近期更新";
    return `${date.getMonth() + 1}月${date.getDate()}日更新`;
  };

  // 紧凑交错拆分为双列 (Masonry Grid)
  const { leftColumn, rightColumn } = useMemo(() => {
    const left: Post[] = [];
    const right: Post[] = [];
    filteredPosts.forEach((post, index) => {
      if (index % 2 === 0) {
        left.push(post);
      } else {
        right.push(post);
      }
    });
    return { leftColumn: left, rightColumn: right };
  }, [filteredPosts]);

  const renderPostCard = (post: Post, index: number) => {
    // 等宽不等长 (Pinterest / 小红书 瀑布流 Masonry Waterfall Layout)
    // 根据 post.id 派生不同的图片高度比例，使左右两列错落有致
    const heightVariants = ["h-56", "h-36", "h-48", "h-64", "h-44"];
    const imageHeight = heightVariants[post.id % heightVariants.length];

    return (
      <TouchableOpacity
        key={post.id}
        onPress={() =>
          router.push("/post-detail", { id: post.id, postData: post })
        }
        activeOpacity={0.9}
        className="bg-surface rounded-2xl overflow-hidden mb-3 border border-line shadow-xs relative"
      >
        {/* 分类浮沉小胶囊 */}
        {post.category && (
          <View className="absolute top-2 left-2 z-10 bg-black/45 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/20">
            <Text className="text-[9px] font-bold text-white">#{post.category}</Text>
          </View>
        )}

        {/* 高清等宽不等长封面图片 */}
        {post.image_url ? (
          <Image
            source={{ uri: resolveMediaUrl(post.image_url) }}
            className={`w-full ${imageHeight}`}
            resizeMode="cover"
          />
        ) : (
          <View className="w-full bg-warm-soft gap-3 p-4 pt-8">
            <View className="w-9 h-9 rounded-full bg-brand/10 items-center justify-center self-end">
              <FontAwesome6 name="pen-nib" size={15} colorClassName="accent-brand" />
            </View>
            <Text className="text-sm font-bold text-ink leading-6" numberOfLines={5}>
              {post.content}
            </Text>
            <Text className="text-[10px] font-bold text-brand">食光文字笔记</Text>
          </View>
        )}

        {/* 标题 & 作者信息面板 (不等长自然延伸) */}
        <View className="p-3">
          {post.recommendation_reason ? (
            <View className="mb-2 flex-row items-center gap-1 self-start rounded-full bg-brand/10 px-2 py-1">
              <FontAwesome6 name="wand-magic-sparkles" size={9} colorClassName="accent-brand" />
              <Text className="shrink text-[9px] font-bold text-brand">{post.recommendation_reason}</Text>
            </View>
          ) : null}
          {post.image_url ? <Text className="text-xs font-bold text-ink leading-5" numberOfLines={3}>{post.content}</Text> : null}
          <LinkedRecipeCard
            recipe={post.linked_recipe}
            unavailable={post.linked_recipe_unavailable}
            compact
            onPress={(event) => {
              event.stopPropagation();
              if (post.linked_recipe) router.push("/recipe-detail", { id: post.linked_recipe.id });
            }}
          />

          <View className="flex-row items-center justify-between mt-2.5 pt-2 border-t border-line">
            {/* 作者头像与用户名 */}
            <TouchableOpacity onPress={(event) => { event.stopPropagation(); router.push("/user-profile", { userId: post.user_id }); }} className="min-w-0 flex-1 flex-row items-center gap-1.5 pr-2">
              <Image
                source={getAvatarSource(post.avatar_url, post.user_id ?? post.username)}
                className="w-5 h-5 rounded-full"
                style={{ width: 20, height: 20, borderRadius: 10, flexShrink: 0 }}
              />
              <Text className="flex-1 text-[10px] font-medium text-copy-muted" numberOfLines={1}>
                {post.username}
              </Text>
            </TouchableOpacity>

            {/* 点赞 */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleLike(post.id);
              }}
              className="ml-auto shrink-0 flex-row items-center gap-1 px-1 py-0.5"
            >
              <FontAwesome6
                name="heart"
                size={11}
                colorClassName={post.is_liked ? "accent-critical" : "accent-copy-muted"}
                solid={post.is_liked}
              />
              <Text className={`text-[10px] font-medium ${post.is_liked ? "text-critical" : "text-copy-muted"}`}>
                {formatLikes(post.likes_count)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderRankingCard = (post: Post, index: number) => {
    const rank = index + 1;
    const rankTheme =
      rank === 1
        ? { background: "bg-highlight", text: "text-warm", border: "border-warm" }
        : rank === 2
          ? { background: "bg-info-soft", text: "text-copy-muted", border: "border-line" }
          : rank === 3
            ? { background: "bg-warm-soft", text: "text-warm", border: "border-warm" }
            : { background: "bg-background-secondary", text: "text-brand", border: "border-brand" };

    if (rank === 1) {
      return (
        <TouchableOpacity
          key={post.id}
          onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
          activeOpacity={0.9}
          className="overflow-hidden rounded-[24px] border border-warm bg-surface shadow-sm"
        >
          <View className="relative h-48 bg-brand-soft">
            {post.image_url ? (
              <Image source={{ uri: resolveMediaUrl(post.image_url) }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <View className="h-full w-full items-center justify-center">
                <FontAwesome6 name="trophy" size={42} colorClassName="accent-warm" />
              </View>
            )}
            <View className="absolute left-3 top-3 flex-row items-center gap-1.5 rounded-full border border-warm bg-highlight px-3 py-1.5">
              <FontAwesome6 name="crown" size={11} colorClassName="accent-warm" />
              <Text className="text-xs font-black text-warm">TOP 1</Text>
            </View>
            <View className="absolute right-3 top-3 flex-row items-center gap-1 rounded-full bg-black/60 px-2.5 py-1">
              <FontAwesome6 name="fire" size={10} colorClassName="accent-highlight" />
              <Text className="text-[10px] font-bold text-white">热度 {formatHeat(post)}</Text>
            </View>
          </View>

          <View className="p-4">
            <View className="mb-2 flex-row items-center gap-2">
              <View className="rounded-md bg-warm-soft px-2 py-1">
                <Text className="text-[10px] font-black text-warm">本周冠军</Text>
              </View>
              <Text className="text-[10px] font-medium text-copy-muted">
                {formatRankingDate(post.created_at)}
              </Text>
            </View>
            <Text className="text-[15px] font-black leading-6 text-ink" numberOfLines={3}>
              {post.content}
            </Text>
            <View className="mt-3 flex-row items-center justify-between border-t border-line pt-3">
              <View className="flex-1 flex-row items-center gap-2 pr-3">
                <Image
                  source={getAvatarSource(post.avatar_url, post.user_id ?? post.username)}
                  className="h-6 w-6 rounded-full"
                  style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0 }}
                />
                <Text className="flex-1 text-[11px] font-semibold text-copy-muted" numberOfLines={1}>
                  {post.username}
                </Text>
              </View>
              <TouchableOpacity
                onPress={(event) => {
                  event.stopPropagation();
                  handleLike(post.id);
                }}
                className="flex-row items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1.5"
              >
                <FontAwesome6
                  name="heart"
                  size={11}
                  colorClassName={post.is_liked ? "accent-critical" : "accent-copy-muted"}
                  solid={post.is_liked}
                />
                <Text className="text-[10px] font-bold text-critical">{formatLikes(post.likes_count)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        key={post.id}
        onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
        activeOpacity={0.88}
        className={`flex-row items-center rounded-2xl border bg-surface p-2.5 shadow-2xs ${rankTheme.border}`}
      >
        <View className={`mr-2.5 h-10 w-10 items-center justify-center rounded-xl ${rankTheme.background}`}>
          <Text className={`text-base font-black ${rankTheme.text}`}>{rank}</Text>
          {rank <= 3 ? <Text className={`text-[7px] font-black ${rankTheme.text}`}>TOP</Text> : null}
        </View>

        {post.image_url ? (
          <Image source={{ uri: resolveMediaUrl(post.image_url) }} className="mr-3 h-[74px] w-[74px] rounded-xl" resizeMode="cover" />
        ) : (
          <View className="mr-3 h-[74px] w-[74px] items-center justify-center rounded-xl bg-background-secondary">
            <FontAwesome6 name="ranking-star" size={20} colorClassName="accent-brand" />
          </View>
        )}

        <View className="min-w-0 flex-1 py-0.5">
          <Text className="text-xs font-bold leading-[18px] text-ink" numberOfLines={2}>
            {post.content}
          </Text>
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="max-w-[55%] text-[9px] font-medium text-copy-muted" numberOfLines={1}>
              {post.username}
            </Text>
            <View className="flex-row items-center gap-1">
              <FontAwesome6 name="fire" size={9} colorClassName={rank <= 3 ? "accent-warm" : "accent-brand"} />
              <Text className={`text-[9px] font-black ${rank <= 3 ? "text-warm" : "text-brand"}`}>
                {formatHeat(post)}
              </Text>
            </View>
          </View>
        </View>

        <FontAwesome6 name="chevron-right" size={10} colorClassName="accent-copy-muted" style={{ marginLeft: 8 }} />
      </TouchableOpacity>
    );
  };

  const renderActivityCard = (post: Post, index: number) => {
    const status = getActivityStatus(post);
    const statusMeta = status === "ongoing"
      ? { label: "进行中", background: "bg-brand-soft", text: "text-brand" }
      : status === "upcoming"
        ? { label: "即将开始", background: "bg-warm-soft", text: "text-warm" }
        : { label: "已结束", background: "bg-background-secondary", text: "text-copy-muted" };
    const startTime = parseCommunityDate(post.event_start_at)?.getTime();
    const endTime = parseCommunityDate(post.event_end_at)?.getTime();
    const progress = status === "ongoing" && startTime && endTime && endTime > startTime
      ? Math.min(100, Math.max(4, ((Date.now() - startTime) / (endTime - startTime)) * 100))
      : status === "ended" ? 100 : 0;

    if (index === 0) {
      return (
        <TouchableOpacity
          key={post.id}
          onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
          activeOpacity={0.9}
          className="overflow-hidden rounded-[24px] border border-line bg-surface shadow-sm"
        >
          <View className="relative h-44 bg-brand-soft">
            {post.image_url ? (
              <Image source={{ uri: resolveMediaUrl(post.image_url) }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <View className="h-full w-full items-center justify-center">
                <FontAwesome6 name="calendar-check" size={38} colorClassName="accent-brand" />
              </View>
            )}
            <View className={`absolute left-3 top-3 rounded-full px-3 py-1.5 ${statusMeta.background}`}>
              <Text className={`text-[10px] font-black ${statusMeta.text}`}>{statusMeta.label}</Text>
            </View>
            <View className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1">
              <Text className="text-[10px] font-bold text-white">主推活动</Text>
            </View>
          </View>
          <View className="p-4">
            <Text className="text-[15px] font-black leading-6 text-ink" numberOfLines={2}>{post.content}</Text>
            <View className="mt-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <FontAwesome6 name="calendar-days" size={11} colorClassName="accent-copy-muted" />
                <Text className="text-[10px] font-semibold text-copy-muted">
                  {formatActivityDate(post.event_start_at)}—{formatActivityDate(post.event_end_at)}
                </Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <FontAwesome6 name="user-group" size={10} colorClassName="accent-copy-muted" />
                <Text className="text-[10px] font-bold text-copy-muted">{post.participant_count || 0} 人参加</Text>
              </View>
            </View>
            {status !== "upcoming" ? (
              <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-soft">
                <View className="h-full rounded-full bg-brand-fill" style={{ width: `${progress}%` }} />
              </View>
            ) : null}
            <TouchableOpacity
              disabled={status === "ended"}
              onPress={(event) => {
                event.stopPropagation();
                void handleJoinEvent(post);
              }}
              className={`mt-4 items-center rounded-xl py-2.5 ${status === "ended" ? "bg-background-secondary" : post.is_joined ? "bg-brand-soft" : "bg-brand-fill"}`}
            >
              <Text className={`text-xs font-black ${status === "ended" ? "text-copy-muted" : post.is_joined ? "text-brand" : "text-white"}`}>
                {status === "ended" ? "活动已结束" : post.is_joined ? "已参加 · 点击退出" : status === "upcoming" ? "提前报名" : "立即参加"}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        key={post.id}
        onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
        activeOpacity={0.88}
        className="flex-row rounded-2xl border border-line bg-surface p-3 shadow-2xs"
      >
        {post.image_url ? (
          <Image source={{ uri: resolveMediaUrl(post.image_url) }} className="mr-3 h-24 w-24 rounded-xl" resizeMode="cover" />
        ) : (
          <View className="mr-3 h-24 w-24 items-center justify-center rounded-xl bg-brand-soft">
            <FontAwesome6 name="calendar-check" size={23} colorClassName="accent-brand" />
          </View>
        )}
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center justify-between">
            <View className={`rounded-md px-2 py-1 ${statusMeta.background}`}>
              <Text className={`text-[9px] font-black ${statusMeta.text}`}>{statusMeta.label}</Text>
            </View>
            <Text className="text-[9px] font-semibold text-copy-muted">{post.participant_count || 0} 人参加</Text>
          </View>
          <Text className="mt-2 text-xs font-bold leading-[18px] text-ink" numberOfLines={2}>{post.content}</Text>
          <View className="mt-auto flex-row items-end justify-between pt-2">
            <Text className="text-[9px] text-copy-muted">截止 {formatActivityDate(post.event_end_at)}</Text>
            <TouchableOpacity
              disabled={status === "ended"}
              onPress={(event) => {
                event.stopPropagation();
                void handleJoinEvent(post);
              }}
              className={`rounded-full px-3 py-1.5 ${status === "ended" ? "bg-background-secondary" : post.is_joined ? "bg-brand-soft" : "bg-brand-fill"}`}
            >
              <Text className={`text-[9px] font-black ${status === "ended" ? "text-copy-muted" : post.is_joined ? "text-brand" : "text-white"}`}>
                {status === "ended" ? "已结束" : post.is_joined ? "已参加" : "参加"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderQuestionCard = (post: Post) => {
    const isResolved = post.question_status === "resolved";
    const answerCount = post.comment_count || 0;
    return (
      <TouchableOpacity
        key={post.id}
        onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
        activeOpacity={0.88}
        className="flex-row gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-2xs"
      >
        <View className={`h-[62px] w-[54px] items-center justify-center rounded-xl ${isResolved ? "bg-brand-soft" : answerCount > 0 ? "bg-warm-soft" : "bg-background-secondary"}`}>
          <Text className={`text-lg font-black ${isResolved ? "text-brand" : answerCount > 0 ? "text-warm" : "text-copy-muted"}`}>{answerCount}</Text>
          <Text className={`text-[8px] font-bold ${isResolved ? "text-brand" : "text-copy-muted"}`}>个回答</Text>
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-start gap-2">
            <Text className="flex-1 text-[13px] font-bold leading-5 text-ink" numberOfLines={3}>{post.content}</Text>
            {post.image_url ? <Image source={{ uri: resolveMediaUrl(post.image_url) }} className="h-14 w-14 rounded-lg" resizeMode="cover" /> : null}
          </View>
          <View className="mt-2.5 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-1.5 pr-2">
              <Text className="max-w-[55%] text-[9px] font-medium text-copy-muted" numberOfLines={1}>{post.username}</Text>
              {post.author_is_expert ? (
                <View className="rounded bg-brand-soft px-1.5 py-0.5">
                  <Text className="text-[8px] font-black text-brand">专业用户</Text>
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-2">
              <Text className="text-[8px] text-copy-muted">{post.views_count || 0} 浏览</Text>
              <View className={`rounded-full px-2 py-1 ${isResolved ? "bg-brand-soft" : "bg-warm-soft"}`}>
                <Text className={`text-[8px] font-black ${isResolved ? "text-brand" : "text-warm"}`}>
                  {isResolved ? "已解决" : answerCount > 0 ? "讨论中" : "待解答"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void fetchPosts(true)}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}
        scrollEventThrottle={100}
        onScroll={({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
          if (hasMore && !loading && !fetchError && contentOffset.y + layoutMeasurement.height >= contentSize.height - 280) {
            void fetchPosts(false, true);
          }
        }}
        className="bg-background-secondary"
      >
        {/* 单层频道栏：发布操作由底部动态 Dock 承担 */}
        <View className="z-20 border-b border-line/60 bg-background-secondary px-4 py-2">
          <View className="h-11 flex-row items-center">
            <TouchableOpacity
              onPress={() => setSearchOpen(!searchOpen)}
              accessibilityLabel={searchOpen ? "收起搜索" : "搜索社区内容"}
              className={`h-10 w-10 items-center justify-center rounded-full active:opacity-70 ${searchOpen ? "bg-brand-fill" : "bg-surface"}`}
            >
              <FontAwesome6 name={searchOpen ? "xmark" : "magnifying-glass"} size={14} colorClassName={searchOpen ? "accent-on-brand" : "accent-brand"} />
            </TouchableOpacity>

            <View className="ml-2 flex-1 flex-row self-stretch">
              {tabs.map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => setActiveTab(tab)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    className="relative flex-1 items-center justify-center"
                  >
                    <Text
                      className={`text-xs ${isActive ? "font-black text-brand" : "font-bold text-copy-muted"}`}
                    >
                      {tab}
                    </Text>
                    {isActive ? (
                      <View className="absolute bottom-0 h-[3px] w-5 rounded-full bg-brand-fill" />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* 搜索展开框 */}
        {searchOpen && (
          <View className="mx-5 mt-2 mb-2 bg-surface px-3.5 py-2.5 rounded-2xl border border-line flex-row items-center gap-2 shadow-xs">
            <FontAwesome6 name="magnifying-glass" size={13} colorClassName="accent-copy-muted" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="搜索社区动态、食材搭配或食友..."
              placeholderTextColorClassName="accent-copy-muted"
              className="flex-1 text-xs text-ink py-0"
              autoFocus
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <FontAwesome6 name="circle-xmark" size={13} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {fetchError ? (
          <TouchableOpacity onPress={() => void fetchPosts()} className="mx-5 my-2 rounded-2xl border border-critical/40 bg-danger-soft p-3">
            <Text className="text-xs font-bold text-critical">{fetchError} · 点击重试</Text>
          </TouchableOpacity>
        ) : null}

      {/* 社区内容区：榜单使用排名列表，其余板块保留双列瀑布流 */}
        {loading && posts.length === 0 ? (
          <View className="py-20 items-center">
            <ActivityIndicator size="large" colorClassName="accent-brand" />
          </View>
        ) : filteredPosts.length === 0 ? (
          <View className="mx-5 mt-8 items-center rounded-3xl border border-line bg-surface px-5 py-12">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-background-secondary">
              <FontAwesome6
                name={activeTab === "榜单" ? "ranking-star" : "note-sticky"}
                size={20}
                colorClassName="accent-brand"
              />
            </View>
            <Text className="mt-3 text-sm font-black text-ink">暂时没有相关内容</Text>
            <Text className="mt-1 text-xs text-copy-muted">换个关键词，或者发布第一条动态</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="重新加载社区内容"
              onPress={() => void fetchPosts(true)} className="mt-4 rounded-xl bg-brand-soft px-5 py-3">
              <Text className="text-sm font-bold text-brand">重新加载</Text>
            </TouchableOpacity>
          </View>
        ) : activeTab === "榜单" ? (
          <View className="px-4 pb-2 pt-1">
            <View className="mb-3 overflow-hidden rounded-[22px] bg-brand-fill p-4">
              <View className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-surface/5" />
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <View className="mb-2 flex-row items-center gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-xl bg-highlight">
                      <FontAwesome6 name="trophy" size={14} colorClassName="accent-warm" />
                    </View>
                    <Text className="text-base font-black text-white">社区食力热榜</Text>
                  </View>
                  <Text className="text-[11px] leading-4 text-white/70">
                    根据点赞、讨论和浏览热度综合排名
                  </Text>
                </View>
                <View className="items-end">
                  <View className="flex-row items-center gap-1 rounded-full border border-white/15 bg-surface/10 px-2.5 py-1">
                    <View className="h-1.5 w-1.5 rounded-full bg-brand" />
                    <Text className="text-[9px] font-bold text-white">实时更新</Text>
                  </View>
                  <Text className="mt-2 text-[10px] font-semibold text-on-brand">
                    共 {rankedPosts.length} 个榜单
                  </Text>
                </View>
              </View>
            </View>

            <View className="gap-3">
              {rankedPosts.map((post, index) => renderRankingCard(post, index))}
            </View>
          </View>
        ) : activeTab === "活动" ? (
          <View className="px-4 pb-2 pt-1">
            <View className="mb-3 rounded-[22px] border border-line bg-background-secondary p-4">
              <View className="flex-row items-center justify-between">
                <View>
                  <View className="flex-row items-center gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-xl bg-brand-fill">
                      <FontAwesome6 name="calendar-check" size={14} colorClassName="accent-on-brand" />
                    </View>
                    <Text className="text-base font-black text-ink">社区活动中心</Text>
                  </View>
                  <Text className="mt-2 text-[10px] text-copy-muted">参与真实打卡，与食友一起完成健康目标</Text>
                </View>
                <TouchableOpacity onPress={() => openPostComposer("活动")} className="rounded-full bg-surface px-3 py-2 shadow-2xs">
                  <Text className="text-[10px] font-black text-brand">发起活动</Text>
                </TouchableOpacity>
              </View>
              <View className="mt-4 flex-row rounded-xl bg-surface p-1">
                {(["进行中", "即将开始", "往期活动"] as const).map((filter) => (
                  <TouchableOpacity
                    key={filter}
                    onPress={() => setActivityFilter(filter)}
                    className={`flex-1 items-center rounded-lg py-2 ${activityFilter === filter ? "bg-brand-fill" : ""}`}
                  >
                    <Text className={`text-[10px] font-black ${activityFilter === filter ? "text-white" : "text-copy-muted"}`}>{filter}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {activityPosts.length ? (
              <View className="gap-3">{activityPosts.map((post, index) => renderActivityCard(post, index))}</View>
            ) : (
              <View className="items-center rounded-2xl border border-line bg-surface py-10">
                <FontAwesome6 name="calendar-day" size={22} colorClassName="accent-copy-muted" />
                <Text className="mt-3 text-xs font-bold text-copy-muted">当前没有{activityFilter}的项目</Text>
              </View>
            )}
          </View>
        ) : activeTab === "问答" ? (
          <View className="px-4 pb-2 pt-1">
            <View className="mb-3 rounded-[22px] border border-line bg-warm-soft p-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <View className="flex-row items-center gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-xl bg-warm-soft">
                      <FontAwesome6 name="circle-question" size={15} colorClassName="accent-warm" />
                    </View>
                    <Text className="text-base font-black text-ink">营养问答广场</Text>
                  </View>
                  <Text className="mt-2 text-[10px] text-copy-muted">真实回答数、解决状态和专业身份清晰可见</Text>
                </View>
                <TouchableOpacity onPress={() => openPostComposer("问答")} className="rounded-full bg-ink px-3 py-2">
                  <Text className="text-[10px] font-black text-white">我要提问</Text>
                </TouchableOpacity>
              </View>
              <View className="mt-4 flex-row gap-2">
                {(["热门问题", "待回答", "已解决"] as const).map((filter) => (
                  <TouchableOpacity
                    key={filter}
                    onPress={() => setQuestionFilter(filter)}
                    className={`rounded-full border px-3 py-1.5 ${questionFilter === filter ? "border-ink bg-ink" : "border-line bg-surface"}`}
                  >
                    <Text className={`text-[9px] font-black ${questionFilter === filter ? "text-white" : "text-copy-muted"}`}>{filter}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {questionPosts.length ? (
              <View className="gap-3">{questionPosts.map(renderQuestionCard)}</View>
            ) : (
              <View className="items-center rounded-2xl border border-line bg-surface py-10">
                <FontAwesome6 name="comment-dots" size={22} colorClassName="accent-copy-muted" />
                <Text className="mt-3 text-xs font-bold text-copy-muted">这里暂时没有{questionFilter}</Text>
              </View>
            )}
          </View>
        ) : (
          <View className="px-3 flex-row gap-2.5 mt-1">
            {/* 左列 */}
            <View className="flex-1">
              {leftColumn.map((post, i) => renderPostCard(post, i))}
            </View>

            {/* 右列 */}
            <View className="flex-1">
              {rightColumn.map((post, i) => renderPostCard(post, i))}
            </View>
          </View>
        )}

        {loading && posts.length > 0 && !refreshing ? <ActivityIndicator className="py-4" color={colors.brand} /> : null}
        {hasMore && !loading ? (
          <View className="items-center px-4 py-4">
            <TouchableOpacity onPress={() => void fetchPosts(false, true)} className="rounded-full border border-brand bg-surface px-5 py-2.5 active:opacity-80">
              <Text className="text-xs font-bold text-brand">加载更多内容</Text>
            </TouchableOpacity>
          </View>
        ) : null}



      {/* 帖子详情查看 Modal */}
      <Modal visible={!!selectedPost} animationType="slide" transparent onRequestClose={() => setSelectedPost(null)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface rounded-t-[32px] overflow-hidden max-h-[90%]">
            {/* 顶栏关闭与作者 */}
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-background-secondary bg-surface">
              <View className="flex-row items-center gap-3">
                <Image
                  source={getAvatarSource(selectedPost?.avatar_url, selectedPost?.user_id ?? selectedPost?.username)}
                  className="w-10 h-10 rounded-full border border-brand/20"
                  style={{ width: 40, height: 40, borderRadius: 20, flexShrink: 0 }}
                />
                <View>
                  <Text className="text-sm font-bold text-ink">
                    {selectedPost?.username}
                  </Text>
                  <Text className="text-[10px] text-copy-muted mt-0.5">
                    {selectedPost?.created_at || "刚刚"} · 发布于【{selectedPost?.category || "寻味"}】
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setSelectedPost(null)}
                className="w-8 h-8 rounded-full bg-background-secondary items-center justify-center"
              >
                <FontAwesome6 name="xmark" size={16} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
            </View>

            {/* 详情内容区 */}
            <ScrollView showsVerticalScrollIndicator={false} className="p-5">
              {selectedPost?.image_url && (
                <Image
                  source={{ uri: resolveMediaUrl(selectedPost.image_url) }}
                  className="w-full h-72 rounded-2xl mb-4"
                  resizeMode="cover"
                />
              )}

              <Text className="text-base font-bold text-ink leading-6 mb-3">
                {selectedPost?.content}
              </Text>

              {/* 互动数据栏 */}
              <View className="flex-row items-center justify-between py-3 border-t border-b border-background-secondary my-4">
                <TouchableOpacity
                  onPress={() => selectedPost && handleLike(selectedPost.id)}
                  className="flex-row items-center gap-2 bg-critical/10 px-4 py-2 rounded-full"
                >
                  <FontAwesome6
                    name="heart"
                    size={16}
                    colorClassName={selectedPost?.is_liked ? "accent-critical" : "accent-copy-muted"}
                    solid={selectedPost?.is_liked}
                  />
                  <Text
                    className={`text-xs font-bold ${
                      selectedPost?.is_liked ? "text-critical" : "text-copy-muted"
                    }`}
                  >
                    {selectedPost?.is_liked ? "已赞" : "点赞"} · {selectedPost ? formatLikes(selectedPost.likes_count) : 0}
                  </Text>
                </TouchableOpacity>

                <View className="flex-row gap-3">
                  <View className="bg-background-secondary px-3 py-2 rounded-full flex-row items-center gap-1.5">
                    <FontAwesome6 name="comment" size={13} colorClassName="accent-copy-muted" />
                    <Text className="text-xs text-copy-muted font-semibold">评论</Text>
                  </View>
                  <View className="bg-background-secondary px-3 py-2 rounded-full flex-row items-center gap-1.5">
                    <FontAwesome6 name="share" size={13} colorClassName="accent-copy-muted" />
                    <Text className="text-xs text-copy-muted font-semibold">分享</Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      </ScrollView>

    </Screen>
  );
}
