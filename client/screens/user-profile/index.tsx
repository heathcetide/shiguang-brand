import { resolveMediaUrl } from "@/utils/mediaUrl";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { communityApi } from "@/services/api";
import { getAvatarSource } from "@/utils/defaultAvatar";

type ProfilePost = { id: number; content: string; image_url: string | null; likes_count: number; created_at: string; category?: string };
type UserLevel = { level: number; title: string; xp: number; nextXp: number | null; progress: number };
type UserProfile = { id: number; username: string; avatar_url: string | null; bio: string | null; followers_count: number; following_count: number; posts_count: number; is_following: boolean; level: UserLevel; posts: ProfilePost[] };

export default function UserProfileScreen() {
  const router = useSafeRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const { userId, pendingAction } = useSafeSearchParams<{ userId?: number | string; pendingAction?: "follow" }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [followPending, setFollowPending] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try { setLoading(true); setProfile(await communityApi.userProfile<UserProfile>(authFetch, Number(userId))); }
    catch { setProfile(null); } finally { setLoading(false); }
  }, [authFetch, userId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggleFollow = async () => {
    if (!profile || followPending) return;
    if (!isAuthenticated) {
      Alert.alert("登录后关注", "登录后即可关注这位创作者。", [
        { text: "取消", style: "cancel" },
        {
          text: "去登录",
          onPress: () => router.push("/login", {
            returnTo: { pathname: "/user-profile", params: { userId: profile.id, pendingAction: "follow" } },
          }),
        },
      ]);
      return;
    }
    const previousProfile = profile;
    setFollowPending(true);
    setProfile({ ...profile, is_following: !profile.is_following, followers_count: Math.max(0, profile.followers_count + (profile.is_following ? -1 : 1)) });
    try {
      const result = await communityApi.toggleFollow(authFetch, profile.id);
      setProfile((current) => current?.id === profile.id ? {
        ...current,
        is_following: result.is_following,
        followers_count: Math.max(0, previousProfile.followers_count + (result.is_following ? 1 : 0) - (previousProfile.is_following ? 1 : 0)),
      } : current);
    } catch {
      setProfile((current) => current?.id === previousProfile.id ? previousProfile : current);
    } finally {
      setFollowPending(false);
    }
  };

  useFocusEffect(useCallback(() => {
    if (!isAuthenticated || pendingAction !== "follow") return;
    router.setParams({ pendingAction: undefined });
    Alert.alert("已返回个人主页", "请再次点击“关注 TA”完成操作。");
  }, [isAuthenticated, pendingAction]));

  if (loading) return <Screen><View className="flex-1 items-center justify-center"><ActivityIndicator colorClassName="accent-brand" /><Text className="mt-3 text-xs text-copy-muted">正在打开个人主页</Text></View></Screen>;
  if (!profile) return <Screen><View className="flex-1 items-center justify-center px-8"><FontAwesome6 name="user-slash" size={28} colorClassName="accent-copy-muted" /><Text className="mt-4 text-base font-bold text-ink">该用户暂不可查看</Text><TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-2xl bg-brand-fill px-6 py-3"><Text className="font-bold text-white">返回社区</Text></TouchableOpacity></View></Screen>;

  const isSelf = user?.id === profile.id;
  return <Screen><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
    <View className="overflow-hidden bg-brand-fill px-5 pb-10 pt-4">
      <View className="absolute -right-12 -top-10 h-48 w-48 rounded-full bg-highlight/15" />
      <View className="absolute -left-16 bottom-0 h-28 w-28 rounded-full bg-surface/10" />
      <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-surface/15"><FontAwesome6 name="chevron-left" size={15} colorClassName="accent-on-brand" /></TouchableOpacity>
      <View className="mt-7 items-center">
        <View className="rounded-full border-4 border-highlight bg-surface p-1 shadow-lg"><Image source={getAvatarSource(profile.avatar_url, profile.id)} className="h-20 w-20 rounded-full" /></View>
        <Text className="mt-3 text-xl font-black text-white">{profile.username}</Text>
        <View className="mt-2 flex-row items-center gap-1.5 rounded-full bg-surface/15 px-3 py-1"><FontAwesome6 name="medal" size={10} colorClassName="accent-highlight" /><Text className="text-[10px] font-bold text-emerald-50">V{profile.level.level} · {profile.level.title}</Text></View>
        {profile.bio?.trim() ? (
          <Text className="mt-3 max-w-[290px] text-center text-xs leading-5 text-emerald-100">{profile.bio.trim()}</Text>
        ) : null}
      </View>
      <View className="mt-6 flex-row rounded-[22px] border border-white/10 bg-black/15 py-3.5"><Stat label="动态" value={profile.posts_count} /><Stat label="关注" value={profile.following_count} /><Stat label="粉丝" value={profile.followers_count} /></View>
      <View className="mt-3 rounded-2xl border border-white/10 bg-surface/10 px-3 py-2.5"><View className="flex-row items-center justify-between"><Text className="text-[10px] font-bold text-emerald-50">成长经验 {profile.level.xp} XP</Text><Text className="text-[10px] text-emerald-100">{profile.level.nextXp ? `${profile.level.progress}%` : "满级"}</Text></View><View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/15"><View className="h-full rounded-full bg-highlight" style={{ width: `${profile.level.progress}%` }} /></View></View>
      {!isSelf ? <TouchableOpacity disabled={followPending} onPress={() => void toggleFollow()} className={`mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-3.5 ${followPending ? "opacity-60" : ""} ${profile.is_following ? "border border-white/20 bg-surface/15" : "bg-highlight"}`}><FontAwesome6 name={profile.is_following ? "check" : "plus"} size={12} colorClassName={profile.is_following ? "accent-on-brand" : "accent-ink"} /><Text className={`text-sm font-black ${profile.is_following ? "text-white" : "text-ink"}`}>{followPending ? "处理中…" : profile.is_following ? "已关注" : "关注 TA"}</Text></TouchableOpacity> : null}
    </View>
    <View className="-mt-5 rounded-t-[30px] bg-background-secondary px-4 pt-6">
      <View className="mb-4 flex-row items-center justify-between"><View><Text className="text-base font-black text-ink">TA 的动态</Text><Text className="mt-1 text-[10px] text-copy-muted">最近发布的健康生活记录</Text></View><View className="h-8 w-8 items-center justify-center rounded-full bg-brand-soft"><FontAwesome6 name="leaf" size={13} colorClassName="accent-brand" /></View></View>
      {profile.posts.length ? profile.posts.map((post) => <TouchableOpacity key={post.id} onPress={() => router.push("/post-detail", { id: post.id })} className="mb-3 overflow-hidden rounded-[22px] border border-line bg-surface shadow-2xs active:opacity-85"><View className="flex-row"><View className="flex-1 p-4"><View className="mb-2 flex-row items-center gap-2"><View className="rounded-full bg-brand-soft px-2 py-1"><Text className="text-[9px] font-bold text-brand">#{post.category || "寻味"}</Text></View><Text className="text-[9px] text-copy-muted">{post.likes_count} 赞</Text></View><Text className="text-[13px] font-bold leading-5 text-ink" numberOfLines={3}>{post.content}</Text><View className="mt-3 flex-row items-center gap-1"><FontAwesome6 name="arrow-up-right-from-square" size={9} colorClassName="accent-copy-muted" /><Text className="text-[10px] text-copy-muted">查看动态</Text></View></View>{post.image_url ? <Image source={{ uri: resolveMediaUrl(post.image_url) }} className="h-32 w-28" resizeMode="cover" /> : <View className="w-7 bg-brand-soft" />}</View></TouchableOpacity>) : <View className="items-center rounded-3xl border border-dashed border-line bg-surface py-14"><FontAwesome6 name="seedling" size={25} colorClassName="accent-brand" /><Text className="mt-3 text-sm font-bold text-copy-muted">还没有发布动态</Text></View>}
    </View>
  </ScrollView></Screen>;
}

function Stat({ label, value }: { label: string; value: number }) { return <View className="flex-1 items-center border-r border-white/10 last:border-r-0"><Text className="text-lg font-black text-white">{value}</Text><Text className="mt-1 text-[10px] text-emerald-100">{label}</Text></View>; }
