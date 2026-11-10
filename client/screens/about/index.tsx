import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { systemApi, type VersionInfo } from "@/services/api";
import { APP_BUILD_TIME, APP_RELEASE_LABEL, formatBuildTime } from "@/utils/appVersion";
import { useAppUpdate } from "@/components/AppUpdateProvider";

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={`px-4 py-4 flex-row items-center justify-between ${last ? "" : "border-b border-background-secondary"}`}>
      <Text className="text-sm font-bold text-ink">{label}</Text>
      <Text className="text-xs text-copy-muted text-right ml-4 flex-shrink">{value}</Text>
    </View>
  );
}

export default function AboutScreen() {
  const router = useSafeRouter();
  const appUpdate = useAppUpdate();
  const [serverInfo, setServerInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void systemApi.version()
      .then(setServerInfo)
      .catch(() => setServerInfo(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-line bg-canvas">
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-surface border border-line items-center justify-center shadow-xs">
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>
        <Text className="text-lg font-black text-ink">关于食光烙记</Text>
        <View className="w-10" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <View className="items-center py-7">
          <Image
            source={require("@/assets/logo.png")}
            className="mb-3 h-20 w-20 rounded-3xl"
            resizeMode="contain"
            accessibilityLabel="食光烙记 Logo"
          />
          <Text className="text-xl font-black text-ink">食光烙记</Text>
          <Text className="text-xs text-copy-muted mt-1">让每一餐都留下健康的记录</Text>
        </View>

        <Text className="text-xs font-bold text-copy-muted mb-2 px-1">客户端</Text>
        <View className="bg-surface rounded-2xl border border-line overflow-hidden shadow-xs mb-5">
          <InfoRow label="应用版本" value={APP_RELEASE_LABEL} />
          {appUpdate.installed && <InfoRow label="原生安装包" value={`${appUpdate.installed.version} (${appUpdate.installed.snapshot} · build ${appUpdate.installed.buildNumber} · ${appUpdate.installed.channel})`} />}
          <InfoRow label="客户端打包时间" value={formatBuildTime(APP_BUILD_TIME)} last />
        </View>

        {Platform.OS === 'android' && <TouchableOpacity accessibilityRole="button" onPress={appUpdate.check} className="mb-5 rounded-2xl border border-line bg-surface px-4 py-4">
          <Text className="text-sm font-bold text-ink">检查应用更新</Text>
          <Text className="mt-1 text-xs text-copy-muted">查看当前渠道的新版本及更新说明</Text>
        </TouchableOpacity>}

        <Text className="text-xs font-bold text-copy-muted mb-2 px-1">服务状态</Text>
        <View className="bg-surface rounded-2xl border border-line overflow-hidden shadow-xs">
          {loading ? (
            <View className="py-6 items-center"><ActivityIndicator size="small" colorClassName="accent-brand" /></View>
          ) : serverInfo ? (
            <>
              <InfoRow label="服务端版本" value={`v${serverInfo.serverVersion}`} />
              <InfoRow label="服务端构建时间" value={formatBuildTime(serverInfo.serverBuildTime)} last />
            </>
          ) : (
            <View className="px-4 py-5">
              <Text className="text-sm font-bold text-ink">暂时无法获取服务信息</Text>
              <Text className="text-xs text-copy-muted mt-1">客户端版本信息仍可用于问题反馈。</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
