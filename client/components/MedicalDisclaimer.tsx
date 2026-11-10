import { Text, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";

export function MedicalDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <View className={`flex-row items-start gap-2 rounded-xl bg-background-secondary ${compact ? "px-3 py-2" : "p-3"}`}>
      <FontAwesome6 name="circle-info" size={12} colorClassName="accent-copy-muted" style={{ marginTop: 2 }} />
      <Text className="flex-1 text-[10px] leading-4 text-copy-muted">
        AI 与营养估算仅供日常健康管理，不构成医疗诊断或治疗建议；特殊疾病、过敏及用药问题请咨询医生或注册营养师。
      </Text>
    </View>
  );
}
