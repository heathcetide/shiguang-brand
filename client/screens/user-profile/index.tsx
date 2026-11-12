import { resolveMediaUrl } from "@/utils/mediaUrl";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { Button, IconButton } from "@/components/ui";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { communityApi } from "@/services/api";
import { getAvatarSource } from "@/utils/defaultAvatar";

const PROFILE_COVER = require("@/assets/images/profile-cover.jpg");
type ProfilePost = { id: number; content: string; image_url: string | null; likes_count: number; created_at: string; category?: string };
type UserLevel = { level: number; title: string; xp: number; nextXp: number | null; progress: number };
type UserProfile = { id: number; username: string; avatar_url: string | null; bio: string | null; followers_count?: number; following_count?: number; posts_count?: number; is_following?: boolean; following?: boolean; level?: UserLevel | null; posts?: ProfilePost[]; nextCursor?: number | null; hasMore?: boolean };

export default function UserProfileScreen() {
  const router = useSafeRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const { userId, pendingAction } = useSafeSearchParams<{ userId?: number | string; pendingAction?: "follow" }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [followError, setFollowError] = useState("");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const postsAnchorY = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try {
      setLoading(true);
      const result = await communityApi.userProfile<UserProfile>(authFetch, Number(userId), "?limit=20");
      setProfile({
        ...result,
        followers_count: result.followers_count ?? 0,
        following_count: result.following_count ?? 0,
        posts_count: result.posts_count ?? 0,
        is_following: result.is_following ?? result.following ?? false,
        posts: result.posts ?? [],
        nextCursor: result.nextCursor ?? null,
        hasMore: Boolean(result.hasMore),
      });
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [authFetch, userId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const loadMorePosts = useCallback(async () => {
    if (!profile?.id || !profile.hasMore || !profile.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await communityApi.userProfile<UserProfile>(authFetch, profile.id, `?limit=20&cursor=${profile.nextCursor}`);
      setProfile((current) => {
        if (!current || current.id !== profile.id) return current;
        const existing = new Set((current.posts ?? []).map((p) => p.id));
        const appended = (result.posts ?? []).filter((p) => !existing.has(p.id));
        return {
          ...current,
          posts: [...(current.posts ?? []), ...appended],
          nextCursor: result.nextCursor ?? null,
          hasMore: Boolean(result.hasMore),
        };
      });
    } finally {
      setLoadingMore(false);
    }
  }, [authFetch, loadingMore, profile?.hasMore, profile?.id, profile?.nextCursor]);

  const toggleFollow = async () => {
    if (!profile || followPending) return;
    if (!isAuthenticated) {
      Alert.alert("登录后关注", "登录后即可关注这位创作者。", [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login", {
          returnTo: { pathname: "/user-profile", params: { userId: profile.id, pendingAction: "follow" } },
        }) },
      ]);
      return;
    }
    const previousProfile = profile;
    setFollowError("");
    setFollowPending(true);
    setProfile({ ...profile, is_following: !profile.is_following, followers_count: Math.max(0, (profile.followers_count ?? 0) + (profile.is_following ? -1 : 1)) });
    try {
      const result = await communityApi.toggleFollow(authFetch, profile.id);
      setProfile(current => current?.id === profile.id ? {
        ...current,
        is_following: result.is_following,
        followers_count: Math.max(0, (previousProfile.followers_count ?? 0) + (result.is_following ? 1 : 0) - (previousProfile.is_following ? 1 : 0)),
      } : current);
    } catch {
      setProfile(current => current?.id === previousProfile.id ? previousProfile : current);
      setFollowError("没有操作成功，请再试一次");
    } finally {
      setFollowPending(false);
    }
  };

  useFocusEffect(useCallback(() => {
    if (!isAuthenticated || pendingAction !== "follow") return;
    router.setParams({ pendingAction: undefined });
    Alert.alert("已返回个人主页", "请再次点击“关注 TA”完成操作。");
  }, [isAuthenticated, pendingAction]));

  const goBack = () => router.canGoBack() ? router.back() : router.replace("/community");
  if (loading) return <Screen><View className="flex-1 items-center justify-center gap-3"><ActivityIndicator colorClassName="accent-brand" /><Text className="text-sm text-copy-muted">正在打开个人主页</Text></View></Screen>;
  if (!profile) return <Screen><View className="flex-1 items-center justify-center gap-4 px-8">
    <FontAwesome6 name="leaf" size={28} colorClassName="accent-brand" />
    <Text className="text-lg font-semibold text-ink">这页暂时没有打开</Text>
    <Text className="text-center text-sm leading-6 text-copy-muted">可以重新试试，或先去社区逛逛。</Text>
    <Button size="lg" onPress={() => void load()}>重新加载</Button>
    <Button variant="ghost" onPress={goBack}>返回社区</Button>
  </View></Screen>;

  const isSelf = user?.id === profile.id;
  const posts = profile.posts ?? [];
  const openConnections = (mode: "following" | "followers") => {
    router.push("/following", {
      userId: profile.id,
      mode,
      title: mode === "following"
        ? (isSelf ? "我关注的人" : `${profile.username}的关注`)
        : (isSelf ? "我的粉丝" : `${profile.username}的粉丝`),
    });
  };

  return <Screen>
    <ScrollView
      ref={scrollRef}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View className="w-full max-w-[880px] self-center sm:px-6 sm:pt-5">
        <View className="h-52 overflow-hidden rounded-b-[28px] bg-brand-soft sm:h-64 sm:rounded-[28px]">
          <Image source={PROFILE_COVER} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="cover" accessible={false} testID="profile-cover" />
          <View className="flex-row items-center justify-between px-5 pt-4">
            <IconButton name="chevron-left" onPress={goBack} accessibilityLabel="返回社区" className="h-11 w-11 rounded-full bg-surface" />
            <View className="rounded-full bg-surface px-3.5 py-2"><Text className="text-[11px] font-medium tracking-widest text-brand-strong">拾味 · 日常</Text></View>
          </View>
        </View>

        <View className="mx-4 -mt-10 rounded-[24px] border border-line bg-surface px-5 pb-5 sm:mx-5 sm:px-7 sm:pb-6">
          <View className="-mt-6 flex-row items-end justify-between gap-3">
            <TouchableOpacity
              onPress={() => setAvatarOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`查看${profile.username}的头像详情`}
              className="rounded-full border-4 border-surface bg-surface p-0.5 active:opacity-90"
            >
              <Image source={getAvatarSource(profile.avatar_url, profile.id)} style={{ width: 84, height: 84, borderRadius: 42 }} />
            </TouchableOpacity>
            {isSelf ? <Button variant="outline" size="lg" className="mb-1 px-4" onPress={() => router.push("/profile-edit")}>编辑资料</Button> :
              <Button variant={profile.is_following ? "outline" : "primary"} size="lg" className="mb-1 min-w-[112px] px-5" disabled={followPending} loading={followPending} onPress={() => void toggleFollow()} accessibilityLabel={profile.is_following ? "已关注，点击取消关注" : "关注 TA"}>
                {profile.is_following ? "已关注" : "关注 TA"}
              </Button>}
          </View>
          <View className="mt-3 flex-row flex-wrap items-center gap-2.5">
            <Text className="shrink text-[23px] font-semibold leading-8 tracking-tight text-ink" accessibilityRole="header">{profile.username}</Text>
            {profile.level ? <View className="flex-row items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1">
              <FontAwesome6 name="seedling" size={10} colorClassName="accent-brand" />
              <Text className="text-[11px] font-medium text-brand-strong">V{profile.level.level} · {profile.level.title}</Text>
            </View> : null}
          </View>
          <Text className="mt-2 text-[13px] leading-6 text-copy-muted">{profile.bio?.trim() || "认真吃饭，慢慢生活。"}</Text>
          {followError ? <Text accessibilityRole="alert" className="mt-2 text-xs text-critical">{followError}</Text> : null}
          <View className="mt-5 flex-row border-t border-line pt-4">
            <Stat
              label="动态"
              value={profile.posts_count}
              onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, postsAnchorY.current - 12), animated: true })}
            />
            <Stat label="关注" value={profile.following_count} onPress={() => openConnections("following")} />
            <Stat label="粉丝" value={profile.followers_count} onPress={() => openConnections("followers")} />
          </View>
          {profile.level ? <View className="mt-4 flex-row flex-wrap items-center justify-between gap-1 rounded-xl bg-brand-soft px-3 py-2.5">
            <Text className="text-xs text-ink">成长经验 {profile.level.xp} XP</Text>
            <Text className="text-xs text-copy-muted">{profile.level.nextXp ? `${profile.level.progress}% · 慢慢积攒每一份成长` : "已达到当前最高等级"}</Text>
          </View> : null}
        </View>

        <View
          className="px-4 pt-8 sm:px-5"
          onLayout={(event) => { postsAnchorY.current = event.nativeEvent.layout.y; }}
        >
          <View className="mb-5 flex-row items-center justify-between gap-3">
            <View>
              <Text className="text-lg font-semibold tracking-tight text-ink" accessibilityRole="header">{isSelf ? "我的日常" : "TA 的日常"}</Text>
              <Text className="mt-1 text-xs leading-5 text-copy-muted">把一餐一饭，写成生活的小记</Text>
            </View>
            <View className="h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"><FontAwesome6 name="leaf" size={14} colorClassName="accent-brand" /></View>
          </View>
          {posts.length ? (
            <>
              {posts.map((post) => (
                <TouchableOpacity
                  key={post.id}
                  onPress={() => router.push("/post-detail", { id: post.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`查看动态：${post.content}`}
                  className="mb-3 overflow-hidden rounded-[20px] border border-line bg-surface active:opacity-80"
                >
                  <View className="flex-row">
                    {post.image_url ? (
                      <Image
                        source={{ uri: resolveMediaUrl(post.image_url) }}
                        className="h-28 w-28 self-stretch"
                        resizeMode="cover"
                        accessible={false}
                      />
                    ) : null}
                    <View className="min-w-0 flex-1 p-4">
                      <View className="mb-2 flex-row items-center gap-2">
                        <View className="rounded-full bg-brand-soft px-2.5 py-1">
                          <Text className="text-[10px] font-medium text-brand-strong">{post.category || "生活小记"}</Text>
                        </View>
                        <Text className="text-[11px] text-copy-muted">{post.created_at?.slice(0, 10)}</Text>
                      </View>
                      <Text className="text-sm leading-6 text-ink" numberOfLines={3}>{post.content}</Text>
                      <View className="mt-3 flex-row items-center justify-between">
                        <View className="flex-row items-center gap-1.5">
                          <FontAwesome6 name="heart" size={12} colorClassName="accent-copy-muted" />
                          <Text className="text-xs text-copy-muted">{post.likes_count ?? 0} 人喜欢</Text>
                        </View>
                        <Text className="text-xs font-medium text-brand">看看这篇</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {profile.hasMore ? (
                <Button
                  className="mt-1"
                  variant="outline"
                  disabled={loadingMore}
                  onPress={() => void loadMorePosts()}
                >
                  {loadingMore ? "加载中…" : "加载更多日常"}
                </Button>
              ) : null}
            </>
          ) : (
            <View className="items-center rounded-[24px] border border-line bg-surface px-6 py-10 sm:py-14">
              <View className="mb-5 h-16 w-16 items-center justify-center rounded-[22px] bg-brand-soft"><FontAwesome6 name="seedling" size={25} colorClassName="accent-brand" /></View>
              <Text className="text-base font-semibold text-ink">{isSelf ? "从今天的第一餐开始吧" : "还没有分享日常"}</Text>
              <Text className="mt-2 max-w-[260px] text-center text-[13px] leading-6 text-copy-muted">{isSelf ? "一碗热汤、一份早餐，都是值得留下的小日常。" : "好好吃饭的日子，也值得慢慢记录。\n等 TA 来分享下一份小美好。"}</Text>
              {isSelf ? <Button className="mt-5 px-5" size="lg" onPress={() => router.push("/post-create")}>记录第一篇日常</Button> : null}
            </View>
          )}
          <View className="mt-7 items-center"><Text className="text-[10px] tracking-[2px] text-copy-muted">三餐有味 · 日常有光</Text></View>
        </View>
      </View>
    </ScrollView>

    <Modal visible={avatarOpen} transparent animationType="fade" onRequestClose={() => setAvatarOpen(false)}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => setAvatarOpen(false)}
        className="flex-1 items-center justify-center bg-black/70 px-8"
        accessibilityRole="button"
        accessibilityLabel="关闭头像详情"
      >
        <Image
          source={getAvatarSource(profile.avatar_url, profile.id)}
          style={{ width: 240, height: 240, borderRadius: 120 }}
          accessibilityLabel={`${profile.username}的头像大图`}
        />
        <Text className="mt-4 text-sm font-medium text-white">{profile.username}</Text>
        {isSelf ? (
          <TouchableOpacity
            onPress={() => {
              setAvatarOpen(false);
              router.push("/profile-edit");
            }}
            className="mt-4 h-10 items-center justify-center rounded-lg bg-brand-fill px-5"
          >
            <Text className="text-sm font-semibold text-white">编辑资料</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    </Modal>
  </Screen>;
}

function Stat({
  label,
  value,
  onPress,
}: {
  label: string;
  value: number | null | undefined;
  onPress?: () => void;
}) {
  const count = value ?? 0;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}：${count}`}
      className="flex-1 items-center gap-1 active:opacity-70"
    >
      <Text className="text-[23px] font-semibold leading-7 text-ink" style={{ fontVariant: ["tabular-nums"] }}>{count}</Text>
      <Text className="text-xs text-copy-muted">{label}</Text>
    </TouchableOpacity>
  );
}
