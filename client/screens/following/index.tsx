import { useCallback, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { communityApi } from "@/services/api";
import { getAvatarSource } from "@/utils/defaultAvatar";

type ConnectionUser = {
  id: number;
  username: string;
  nickname?: string | null;
  avatar_url: string | null;
  created_at?: string;
};

type Mode = "following" | "followers";

export default function FollowingScreen() {
  const router = useSafeRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const params = useSafeSearchParams<{ userId?: string | number; mode?: string; title?: string }>();
  const mode: Mode = params.mode === "followers" ? "followers" : "following";
  const targetUserId = params.userId != null ? Number(params.userId) : user?.id;
  const isSelf = targetUserId != null && user?.id === targetUserId;

  const [users, setUsers] = useState<ConnectionUser[]>([]);
  const [loading, setLoading] = useState(true);

  const title = params.title
    || (mode === "followers"
      ? (isSelf ? "我的粉丝" : "粉丝")
      : (isSelf ? "我关注的人" : "关注"));

  const load = useCallback(async () => {
    if (!targetUserId || Number.isNaN(targetUserId)) {
      setLoading(false);
      setUsers([]);
      return;
    }
    if (isSelf && !isAuthenticated) {
      setLoading(false);
      setUsers([]);
      return;
    }
    try {
      setLoading(true);
      const list = mode === "followers"
        ? await communityApi.userFollowers<ConnectionUser>(authFetch, targetUserId)
        : isSelf
          ? await communityApi.following<ConnectionUser>(authFetch)
          : await communityApi.userFollowing<ConnectionUser>(authFetch, targetUserId);
      setUsers(Array.isArray(list) ? list : []);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, isAuthenticated, isSelf, mode, targetUserId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const unfollow = async (id: number) => {
    if (!isSelf || mode !== "following") return;
    const previous = users;
    setUsers((current) => current.filter((item) => item.id !== id));
    try {
      await communityApi.toggleFollow(authFetch, id);
    } catch {
      setUsers(previous);
    }
  };

  return (
    <Screen>
      <View className="flex-row items-center border-b border-line bg-surface px-4 py-3">
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="返回"
          className="h-10 w-10 items-center justify-center rounded-lg border border-line bg-canvas"
        >
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-brand" />
        </TouchableOpacity>
        <View className="ml-3 flex-1">
          <Text className="text-lg font-semibold text-ink">{title}</Text>
          <Text className="text-[11px] text-copy-muted">
            {mode === "followers" ? "关注了这位创作者的人" : "正在关注的健康生活伙伴"}
          </Text>
        </View>
        <View className="rounded-md bg-brand-soft px-3 py-1">
          <Text className="text-xs font-semibold text-brand">{users.length} 人</Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator colorClassName="accent-brand" />
        </View>
      ) : users.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <FontAwesome6 name="user-group" size={28} colorClassName="accent-brand" />
          <Text className="mt-4 text-base font-semibold text-ink">
            {mode === "followers" ? "还没有粉丝" : "还没有关注的人"}
          </Text>
          <Text className="mt-2 text-center text-sm leading-6 text-copy-muted">
            {mode === "followers"
              ? "多分享日常，慢慢会有食友来找你。"
              : "在社区动态中关注感兴趣的创作者吧。"}
          </Text>
          <TouchableOpacity
            onPress={() => router.replace("/(tabs)/community")}
            className="mt-5 h-10 items-center justify-center rounded-lg bg-brand-fill px-5"
          >
            <Text className="text-sm font-semibold text-white">去社区看看</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {users.map((item) => (
            <View key={item.id} className="flex-row items-center rounded-xl border border-line bg-surface p-3">
              <TouchableOpacity
                onPress={() => router.push("/user-profile", { userId: item.id })}
                accessibilityRole="button"
                accessibilityLabel={`查看${item.nickname || item.username}的主页`}
                className="min-w-0 flex-1 flex-row items-center active:opacity-75"
              >
                <Image source={getAvatarSource(item.avatar_url, item.id)} className="h-11 w-11 rounded-full" />
                <View className="ml-3 min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                    {item.nickname || item.username}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-copy-muted">@{item.username}</Text>
                </View>
              </TouchableOpacity>
              {isSelf && mode === "following" ? (
                <TouchableOpacity
                  onPress={() => void unfollow(item.id)}
                  className="ml-2 rounded-lg border border-line px-3 py-2"
                >
                  <Text className="text-xs font-medium text-copy-muted">已关注</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
