import { Text, View } from "react-native";
import type { InventoryFieldEvidence as FieldEvidence } from "@dietdigidose/contracts";

const fields = { food_name: "名称", quantity: "数量", storage_location: "位置", expiration_date: "到期日期" } as const;
const statuses = { known: "已知", estimated: "估计", unknown: "未知" };
const sources = { user: "用户填写", recognition: "识别结果", barcode: "条码资料", rule: "规则建议", unknown: "来源未知" };

export function InventoryFieldEvidence({ evidence }: { evidence?: FieldEvidence }) {
  return (
    <View className="gap-1" accessibilityLabel="食材字段依据">
      {(Object.keys(fields) as Array<keyof typeof fields>).map((field) => {
        const value = evidence?.[field];
        return (
          <Text key={field} className="text-caption text-copy-muted">
            {fields[field]}：{statuses[value?.status ?? "unknown"]} · {sources[value?.source ?? "unknown"]}
            {value?.note ? ` · ${value.note}` : ""}
          </Text>
        );
      })}
    </View>
  );
}
